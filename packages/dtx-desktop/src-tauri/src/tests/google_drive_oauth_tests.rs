use super::*;
use crate::auth::AuthState;
use crate::error::{DesktopError, Result as DesktopResult};
use crate::google_drive::credential_store::{
    GoogleDriveCredentialAccess, GoogleDriveCredentialStore, InMemoryGoogleDriveCredentialStore,
};
use crate::google_drive::settings::{GoogleDriveFolderSetting, GoogleDriveSettingsAccess};
use crate::google_drive::{GoogleDriveState, UnavailableDriveMetadataClient};
use async_trait::async_trait;
use std::collections::VecDeque;
use std::io::Write;
use std::net::{Ipv4Addr, SocketAddrV4};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;
use tokio::sync::{Notify, Semaphore};
use url::Url;
use zeroize::Zeroizing;

fn attempt(now: Instant) -> PickerAttempt {
    PickerAttempt::new(
        "drumery-user".to_string(),
        SocketAddrV4::new(Ipv4Addr::LOCALHOST, 49152),
        now,
        Duration::from_secs(300),
    )
}

#[test]
fn picker_attempts_use_fresh_pkce_state_and_attempt_identifiers() {
    let now = Instant::now();
    let first = attempt(now);
    let second = attempt(now);

    assert_ne!(first.attempt_id(), second.attempt_id());
    assert_ne!(first.oauth_state(), second.oauth_state());
    assert_ne!(first.pkce_verifier(), second.pkce_verifier());
    assert!((43..=128).contains(&first.pkce_verifier().len()));
    assert_eq!(first.pkce_challenge().len(), 43);
}

#[test]
fn authorization_url_uses_exact_drive_file_picker_protocol() {
    let picker_attempt = attempt(Instant::now());
    let url = picker_attempt
        .authorization_url("desktop-client.apps.googleusercontent.com")
        .expect("authorization URL");
    let parsed = Url::parse(&url).expect("valid URL");
    let pairs = parsed.query_pairs().collect::<Vec<_>>();

    assert_eq!(parsed.scheme(), "https");
    assert_eq!(parsed.host_str(), Some("accounts.google.com"));
    assert_eq!(parsed.path(), "/o/oauth2/v2/auth");
    for (key, value) in [
        ("trigger_onepick", "true"),
        ("allow_folder_selection", "true"),
        ("prompt", "consent"),
        ("access_type", "offline"),
        ("response_type", "code"),
        ("scope", GOOGLE_DRIVE_FILE_SCOPE),
        ("code_challenge_method", "S256"),
    ] {
        assert_eq!(
            pairs
                .iter()
                .filter(|(candidate, _)| candidate == key)
                .map(|(_, candidate)| candidate.as_ref())
                .collect::<Vec<_>>(),
            vec![value],
            "{key}"
        );
    }
    assert_eq!(
        parsed
            .query_pairs()
            .find(|(key, _)| key == "redirect_uri")
            .unwrap()
            .1,
        "http://127.0.0.1:49152/google-drive/oauth/callback"
    );
}

#[test]
fn callback_requires_exact_path_state_selection_and_code_xor_error() {
    let now = Instant::now();
    let picker_attempt = attempt(now);
    let valid = format!(
        "{}?state={}&code=authorization-code&picked_file_ids=folder-42",
        GOOGLE_DRIVE_CALLBACK_PATH,
        picker_attempt.oauth_state()
    );
    assert_eq!(
        picker_attempt
            .validate_callback_target(&valid, "drumery-user", now)
            .expect("valid callback"),
        PickerCallback::AuthorizationCode {
            code: Zeroizing::new("authorization-code".to_string()),
            folder_id: "folder-42".to_string(),
        }
    );

    for invalid in [
        format!(
            "/wrong?state={}&code=authorization-code&picked_file_ids=folder-42",
            picker_attempt.oauth_state()
        ),
        format!(
            "{}?state=wrong&code=authorization-code&picked_file_ids=folder-42",
            GOOGLE_DRIVE_CALLBACK_PATH
        ),
        format!(
            "{}?state={}&state=duplicate&code=authorization-code&picked_file_ids=folder-42",
            GOOGLE_DRIVE_CALLBACK_PATH,
            picker_attempt.oauth_state()
        ),
        format!(
            "{}?state={}&code=one&code=two&picked_file_ids=folder-42",
            GOOGLE_DRIVE_CALLBACK_PATH,
            picker_attempt.oauth_state()
        ),
        format!(
            "{}?state={}&code=one&error=access_denied&picked_file_ids=folder-42",
            GOOGLE_DRIVE_CALLBACK_PATH,
            picker_attempt.oauth_state()
        ),
        format!(
            "{}?state={}&code=one&picked_file_ids=folder-a&picked_file_ids=folder-b",
            GOOGLE_DRIVE_CALLBACK_PATH,
            picker_attempt.oauth_state()
        ),
    ] {
        assert_eq!(
            picker_attempt.validate_callback_target(&invalid, "drumery-user", now),
            Err(GoogleDriveOAuthError::InvalidResponse)
        );
    }
}

#[test]
fn callback_rejects_timeout_and_authenticated_user_switch() {
    let now = Instant::now();
    let picker_attempt = attempt(now);
    let target = format!(
        "{}?state={}&code=authorization-code&picked_file_ids=folder-42",
        GOOGLE_DRIVE_CALLBACK_PATH,
        picker_attempt.oauth_state()
    );

    assert_eq!(
        picker_attempt.validate_callback_target(
            &target,
            "other-user",
            now + Duration::from_secs(1)
        ),
        Err(GoogleDriveOAuthError::Canceled)
    );
    assert_eq!(
        picker_attempt.validate_callback_target(
            &target,
            "drumery-user",
            now + Duration::from_secs(301)
        ),
        Err(GoogleDriveOAuthError::Canceled)
    );
}

#[test]
fn access_denied_and_missing_selection_are_sanitized_cancellation() {
    let now = Instant::now();
    let picker_attempt = attempt(now);

    for target in [
        format!(
            "{}?state={}&error=access_denied",
            GOOGLE_DRIVE_CALLBACK_PATH,
            picker_attempt.oauth_state()
        ),
        format!(
            "{}?state={}&code=authorization-code",
            GOOGLE_DRIVE_CALLBACK_PATH,
            picker_attempt.oauth_state()
        ),
    ] {
        assert_eq!(
            picker_attempt.validate_callback_target(&target, "drumery-user", now),
            Err(GoogleDriveOAuthError::Canceled)
        );
    }
}

#[test]
fn token_exchange_requires_refresh_token_and_drive_file_scope() {
    let valid = OAuthTokenResponse {
        access_token: "access-token".to_string(),
        refresh_token: Some("refresh-token".to_string()),
        expires_in: 3600,
        scope: Some(format!("openid {GOOGLE_DRIVE_FILE_SCOPE}")),
    };
    assert!(ValidatedPickerTokens::try_from(valid).is_ok());

    for invalid in [
        OAuthTokenResponse {
            access_token: "access-token".to_string(),
            refresh_token: None,
            expires_in: 3600,
            scope: Some(GOOGLE_DRIVE_FILE_SCOPE.to_string()),
        },
        OAuthTokenResponse {
            access_token: "access-token".to_string(),
            refresh_token: Some("   ".to_string()),
            expires_in: 3600,
            scope: Some(GOOGLE_DRIVE_FILE_SCOPE.to_string()),
        },
        OAuthTokenResponse {
            access_token: "access-token".to_string(),
            refresh_token: Some("refresh-token".to_string()),
            expires_in: 3600,
            scope: Some("openid".to_string()),
        },
    ] {
        assert_eq!(
            ValidatedPickerTokens::try_from(invalid),
            Err(GoogleDriveOAuthError::InvalidResponse)
        );
    }
}

#[test]
fn callback_html_never_reflects_authorization_artifacts() {
    let secret_fragments = [
        "authorization-code-secret",
        "oauth-state-secret",
        "folder-id-secret",
        "provider-error-secret",
    ];
    let html = callback_response_html();

    assert!(html.contains("Return to Drumery"));
    for secret in secret_fragments {
        assert!(!html.contains(secret));
    }
}

#[tokio::test]
async fn callback_read_uses_the_attempt_deadline_not_a_fresh_timeout_per_byte() {
    let listener = tokio::net::TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("bind loopback");
    let address = listener.local_addr().expect("listener address");
    let request = format!(
        "GET {GOOGLE_DRIVE_CALLBACK_PATH}?state=state&code=code&picked_file_ids=folder HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"
    );
    let writer = tokio::spawn(async move {
        let mut stream = tokio::net::TcpStream::connect(address)
            .await
            .expect("connect loopback");
        for byte in request.bytes() {
            if stream.write_all(&[byte]).await.is_err() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
    });
    let (mut stream, _) = listener.accept().await.expect("accept callback");

    let result =
        read_callback_target(&mut stream, Instant::now() + Duration::from_millis(25)).await;

    assert_eq!(result, Err(GoogleDriveOAuthError::Canceled));
    writer.abort();
}

#[derive(Default)]
struct FakeSettings {
    folder: Mutex<Option<GoogleDriveFolderSetting>>,
    fail_next_set: AtomicBool,
}

impl FakeSettings {
    fn with_folder(id: &str, name: &str) -> Self {
        Self {
            folder: Mutex::new(Some(GoogleDriveFolderSetting {
                id: id.to_string(),
                name: name.to_string(),
            })),
            fail_next_set: AtomicBool::new(false),
        }
    }
}

impl GoogleDriveSettingsAccess for FakeSettings {
    fn folder_for_user(&self, _user_id: &str) -> Option<GoogleDriveFolderSetting> {
        self.folder
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    fn set_folder_for_user(
        &self,
        _user_id: &str,
        folder: GoogleDriveFolderSetting,
    ) -> DesktopResult<()> {
        if self.fail_next_set.swap(false, Ordering::SeqCst) {
            return Err(DesktopError::Message(
                "injected settings failure".to_string(),
            ));
        }
        *self
            .folder
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(folder);
        Ok(())
    }

    fn clear_folder_for_user(&self, _user_id: &str) -> DesktopResult<()> {
        *self
            .folder
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
        Ok(())
    }
}

#[tokio::test]
async fn first_connect_settings_failure_removes_the_new_credential() {
    let credential_store = Arc::new(InMemoryGoogleDriveCredentialStore::default());
    let credentials = GoogleDriveCredentialAccess::new(credential_store.clone());
    let settings = FakeSettings::default();
    settings.fail_next_set.store(true, Ordering::SeqCst);

    assert_eq!(
        persist_validated_connection(
            &credentials,
            &settings,
            "user-42",
            Zeroizing::new("new-refresh-token".to_string()),
            folder("new-folder", "New folder"),
        )
        .await,
        Err(GoogleDriveOAuthError::LocalState)
    );
    assert_eq!(
        credential_store
            .get_refresh_token("user-42")
            .expect("read credential"),
        None
    );
    assert_eq!(settings.folder_for_user("user-42"), None);
}

#[tokio::test]
async fn change_folder_settings_failure_restores_prior_credential_and_folder() {
    let credential_store = Arc::new(InMemoryGoogleDriveCredentialStore::default());
    credential_store
        .set_refresh_token("user-42", "old-refresh-token")
        .expect("seed credential");
    let credentials = GoogleDriveCredentialAccess::new(credential_store.clone());
    let settings = FakeSettings::with_folder("old-folder", "Old folder");
    settings.fail_next_set.store(true, Ordering::SeqCst);

    assert_eq!(
        persist_validated_connection(
            &credentials,
            &settings,
            "user-42",
            Zeroizing::new("replacement-refresh-token".to_string()),
            folder("new-folder", "New folder"),
        )
        .await,
        Err(GoogleDriveOAuthError::LocalState)
    );
    assert_eq!(
        credential_store
            .get_refresh_token("user-42")
            .expect("read credential")
            .as_deref(),
        Some("old-refresh-token")
    );
    assert_eq!(
        settings.folder_for_user("user-42"),
        Some(folder("old-folder", "Old folder"))
    );
}

struct CallbackBrowser {
    folder_id: String,
    listener_was_bound: AtomicBool,
}

impl CallbackBrowser {
    fn new(folder_id: &str) -> Self {
        Self {
            folder_id: folder_id.to_string(),
            listener_was_bound: AtomicBool::new(false),
        }
    }
}

impl PickerBrowser for CallbackBrowser {
    fn open(&self, authorization_url: &str) -> Result<(), GoogleDriveOAuthError> {
        let authorization_url =
            Url::parse(authorization_url).map_err(|_| GoogleDriveOAuthError::InvalidResponse)?;
        let redirect_uri = authorization_url
            .query_pairs()
            .find(|(key, _)| key == "redirect_uri")
            .map(|(_, value)| value.into_owned())
            .ok_or(GoogleDriveOAuthError::InvalidResponse)?;
        let state = authorization_url
            .query_pairs()
            .find(|(key, _)| key == "state")
            .map(|(_, value)| value.into_owned())
            .ok_or(GoogleDriveOAuthError::InvalidResponse)?;
        let redirect =
            Url::parse(&redirect_uri).map_err(|_| GoogleDriveOAuthError::InvalidResponse)?;
        let addr = format!(
            "{}:{}",
            redirect.host_str().unwrap_or_default(),
            redirect.port().unwrap_or_default()
        );
        let mut stream =
            std::net::TcpStream::connect(addr).map_err(|_| GoogleDriveOAuthError::Network)?;
        self.listener_was_bound.store(true, Ordering::SeqCst);
        write!(
            stream,
            "GET {}?state={state}&code=authorization-code&picked_file_ids={} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
            redirect.path(),
            self.folder_id
        )
        .map_err(|_| GoogleDriveOAuthError::Network)?;
        Ok(())
    }
}

struct SilentBrowser {
    opened: Arc<AtomicBool>,
}

impl PickerBrowser for SilentBrowser {
    fn open(&self, _authorization_url: &str) -> Result<(), GoogleDriveOAuthError> {
        self.opened.store(true, Ordering::SeqCst);
        Ok(())
    }
}

struct FakeOAuthProvider {
    exchanges: Mutex<VecDeque<Result<OAuthTokenResponse, OAuthProviderError>>>,
    refreshes: Mutex<VecDeque<Result<OAuthTokenResponse, OAuthProviderError>>>,
    revoke_result: Mutex<Result<(), OAuthProviderError>>,
    revoke_calls: AtomicUsize,
}

struct BlockingRefreshProvider {
    refresh_started: Notify,
    release_refresh: Semaphore,
    refresh_calls: AtomicUsize,
    response: OAuthTokenResponse,
}

impl BlockingRefreshProvider {
    fn new(response: OAuthTokenResponse) -> Self {
        Self {
            refresh_started: Notify::new(),
            release_refresh: Semaphore::new(0),
            refresh_calls: AtomicUsize::new(0),
            response,
        }
    }

    async fn wait_until_refresh_started(&self) {
        if self.refresh_calls.load(Ordering::SeqCst) == 0 {
            self.refresh_started.notified().await;
        }
    }
}

#[async_trait]
impl GoogleOAuthProvider for BlockingRefreshProvider {
    async fn exchange_code(
        &self,
        _request: TokenExchangeRequest,
    ) -> Result<OAuthTokenResponse, OAuthProviderError> {
        Err(OAuthProviderError::InvalidResponse)
    }

    async fn refresh_access_token(
        &self,
        _refresh_token: &str,
    ) -> Result<OAuthTokenResponse, OAuthProviderError> {
        self.refresh_calls.fetch_add(1, Ordering::SeqCst);
        self.refresh_started.notify_waiters();
        let permit = self
            .release_refresh
            .acquire()
            .await
            .expect("refresh release");
        permit.forget();
        Ok(self.response.clone())
    }

    async fn revoke_refresh_token(&self, _refresh_token: &str) -> Result<(), OAuthProviderError> {
        Ok(())
    }
}

impl FakeOAuthProvider {
    fn with_exchanges(responses: Vec<OAuthTokenResponse>) -> Self {
        Self {
            exchanges: Mutex::new(responses.into_iter().map(Ok).collect()),
            refreshes: Mutex::new(VecDeque::new()),
            revoke_result: Mutex::new(Ok(())),
            revoke_calls: AtomicUsize::new(0),
        }
    }

    fn with_refreshes(responses: Vec<Result<OAuthTokenResponse, OAuthProviderError>>) -> Self {
        Self {
            exchanges: Mutex::new(VecDeque::new()),
            refreshes: Mutex::new(responses.into()),
            revoke_result: Mutex::new(Ok(())),
            revoke_calls: AtomicUsize::new(0),
        }
    }
}

#[async_trait]
impl GoogleOAuthProvider for FakeOAuthProvider {
    async fn exchange_code(
        &self,
        _request: TokenExchangeRequest,
    ) -> Result<OAuthTokenResponse, OAuthProviderError> {
        self.exchanges
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .pop_front()
            .unwrap_or(Err(OAuthProviderError::InvalidResponse))
    }

    async fn refresh_access_token(
        &self,
        _refresh_token: &str,
    ) -> Result<OAuthTokenResponse, OAuthProviderError> {
        self.refreshes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .pop_front()
            .unwrap_or(Err(OAuthProviderError::InvalidResponse))
    }

    async fn revoke_refresh_token(&self, _refresh_token: &str) -> Result<(), OAuthProviderError> {
        self.revoke_calls.fetch_add(1, Ordering::SeqCst);
        *self
            .revoke_result
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

struct AcceptFolder;

#[async_trait]
impl PickerFolderValidator for AcceptFolder {
    async fn validate_folder(
        &self,
        _access_token: &str,
        folder_id: &str,
    ) -> Result<GoogleDriveFolderSetting, GoogleDriveOAuthError> {
        Ok(folder(folder_id, "Public uploads"))
    }
}

struct QueuedFolderValidator {
    results: Mutex<VecDeque<Result<GoogleDriveFolderSetting, GoogleDriveOAuthError>>>,
}

impl QueuedFolderValidator {
    fn new(results: Vec<Result<GoogleDriveFolderSetting, GoogleDriveOAuthError>>) -> Self {
        Self {
            results: Mutex::new(results.into()),
        }
    }
}

#[async_trait]
impl PickerFolderValidator for QueuedFolderValidator {
    async fn validate_folder(
        &self,
        _access_token: &str,
        _folder_id: &str,
    ) -> Result<GoogleDriveFolderSetting, GoogleDriveOAuthError> {
        self.results
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .pop_front()
            .unwrap_or(Err(GoogleDriveOAuthError::InvalidResponse))
    }
}

struct ExpireOnceFolderValidator {
    calls: Mutex<Vec<String>>,
}

#[async_trait]
impl PickerFolderValidator for ExpireOnceFolderValidator {
    async fn validate_folder(
        &self,
        _access_token: &str,
        _folder_id: &str,
    ) -> Result<GoogleDriveFolderSetting, GoogleDriveOAuthError> {
        Err(GoogleDriveOAuthError::InvalidResponse)
    }

    async fn execute_validation(
        &self,
        access_token: &str,
        folder_id: &str,
    ) -> Result<GoogleDriveFolderSetting, AuthorizedDriveRequestError> {
        let mut calls = self
            .calls
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        calls.push(access_token.to_string());
        if calls.len() == 1 {
            Err(AuthorizedDriveRequestError::TokenExpired)
        } else {
            Ok(folder(folder_id, "Uploads"))
        }
    }
}

#[tokio::test]
async fn picker_binds_loopback_before_browser_open_and_replaces_refresh_token() {
    let auth = AuthState::default();
    auth.set_current_session(Some(serde_json::json!({
        "user": { "id": "user-42" }
    })))
    .await;
    let credential_store = Arc::new(InMemoryGoogleDriveCredentialStore::default());
    credential_store
        .set_refresh_token("user-42", "prior-refresh-token")
        .expect("seed credential");
    let settings = Arc::new(FakeSettings::with_folder("old-folder", "Old folder"));
    let browser = Arc::new(CallbackBrowser::new("new-folder"));
    let provider = Arc::new(FakeOAuthProvider::with_exchanges(vec![token_response(
        "new-access-token",
        Some("replacement-refresh-token"),
    )]));
    let state = oauth_state(
        credential_store.clone(),
        settings.clone(),
        provider,
        browser.clone(),
    );

    let connection = state
        .connect_and_choose_folder(&auth)
        .await
        .expect("picker succeeds");

    assert!(browser.listener_was_bound.load(Ordering::SeqCst));
    assert!(connection.connected);
    assert_eq!(
        connection.folder,
        Some(folder("new-folder", "Public uploads"))
    );
    assert_eq!(
        credential_store
            .get_refresh_token("user-42")
            .expect("read credential")
            .as_deref(),
        Some("replacement-refresh-token")
    );
}

#[tokio::test]
async fn picker_public_sharing_rejection_preserves_prior_credential_and_folder() {
    let auth = AuthState::default();
    auth.set_current_session(Some(serde_json::json!({
        "user": { "id": "user-42" }
    })))
    .await;
    let credential_store = Arc::new(InMemoryGoogleDriveCredentialStore::default());
    credential_store
        .set_refresh_token("user-42", "prior-refresh-token")
        .expect("seed credential");
    let settings = Arc::new(FakeSettings::with_folder("old-folder", "Old folder"));
    let state = GoogleDriveState::with_oauth_adapters(
        credential_store.clone(),
        Arc::new(UnavailableDriveMetadataClient),
        settings.clone(),
        Arc::new(FakeOAuthProvider::with_exchanges(vec![token_response(
            "new-access-token",
            Some("replacement-refresh-token"),
        )])),
        Arc::new(QueuedFolderValidator::new(vec![Err(
            GoogleDriveOAuthError::DownloadNotPublic,
        )])),
        Arc::new(CallbackBrowser::new("private-folder")),
        PickerProtocolConfig::new(
            "desktop-client.apps.googleusercontent.com".to_string(),
            Duration::from_secs(1),
        ),
    );

    assert!(matches!(
        state.connect_and_choose_folder(&auth).await,
        Err(GoogleDriveOAuthError::DownloadNotPublic)
    ));
    assert_eq!(
        credential_store
            .get_refresh_token("user-42")
            .expect("read credential")
            .as_deref(),
        Some("prior-refresh-token")
    );
    assert_eq!(
        settings.folder_for_user("user-42"),
        Some(folder("old-folder", "Old folder"))
    );
}

#[tokio::test]
async fn explicit_sharing_recheck_updates_only_sanitized_connection_flags() {
    let auth = AuthState::default();
    auth.set_current_session(Some(serde_json::json!({
        "user": { "id": "user-42" }
    })))
    .await;
    let credential_store = Arc::new(InMemoryGoogleDriveCredentialStore::default());
    credential_store
        .set_refresh_token("user-42", "refresh-token")
        .expect("seed credential");
    let state = GoogleDriveState::with_oauth_adapters(
        credential_store,
        Arc::new(UnavailableDriveMetadataClient),
        Arc::new(FakeSettings::with_folder("folder-42", "Uploads")),
        Arc::new(FakeOAuthProvider::with_exchanges(vec![])),
        Arc::new(QueuedFolderValidator::new(vec![
            Err(GoogleDriveOAuthError::DownloadNotPublic),
            Err(GoogleDriveOAuthError::SharingCheckUnavailable),
            Ok(folder("folder-42", "Uploads")),
        ])),
        Arc::new(CallbackBrowser::new("unused")),
        PickerProtocolConfig::new(
            "desktop-client.apps.googleusercontent.com".to_string(),
            Duration::from_secs(1),
        ),
    );
    state.cache_access_token("user-42", "access-token").await;

    let private = state
        .recheck_google_drive_sharing(&auth)
        .await
        .expect("private is a sanitized state");
    assert!(private.connected);
    assert!(private.requires_public_sharing);
    assert!(!private.sharing_check_unavailable);

    let unavailable = state
        .recheck_google_drive_sharing(&auth)
        .await
        .expect("ACL 403 is a sanitized state");
    assert!(unavailable.connected);
    assert!(!unavailable.requires_public_sharing);
    assert!(unavailable.sharing_check_unavailable);

    let public = state
        .recheck_google_drive_sharing(&auth)
        .await
        .expect("public recheck succeeds");
    assert!(public.connected);
    assert!(!public.requires_public_sharing);
    assert!(!public.sharing_check_unavailable);
    assert_eq!(public.folder, Some(folder("folder-42", "Uploads")));
}

#[tokio::test]
async fn sharing_recheck_refreshes_and_retries_once_after_drive_rejects_access_token() {
    let auth = AuthState::default();
    auth.set_current_session(Some(serde_json::json!({
        "user": { "id": "user-42" }
    })))
    .await;
    let credential_store = Arc::new(InMemoryGoogleDriveCredentialStore::default());
    credential_store
        .set_refresh_token("user-42", "refresh-token")
        .expect("seed credential");
    let validator = Arc::new(ExpireOnceFolderValidator {
        calls: Mutex::new(Vec::new()),
    });
    let state = GoogleDriveState::with_oauth_adapters(
        credential_store,
        Arc::new(UnavailableDriveMetadataClient),
        Arc::new(FakeSettings::with_folder("folder-42", "Uploads")),
        Arc::new(FakeOAuthProvider::with_refreshes(vec![Ok(token_response(
            "fresh-access-token",
            None,
        ))])),
        validator.clone(),
        Arc::new(CallbackBrowser::new("unused")),
        PickerProtocolConfig::new(
            "desktop-client.apps.googleusercontent.com".to_string(),
            Duration::from_secs(1),
        ),
    );
    state
        .cache_access_token("user-42", "rejected-access-token")
        .await;

    let connection = state
        .recheck_google_drive_sharing(&auth)
        .await
        .expect("retry succeeds");

    assert!(connection.connected);
    assert_eq!(
        *validator
            .calls
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()),
        vec![
            "rejected-access-token".to_string(),
            "fresh-access-token".to_string()
        ]
    );
}

#[tokio::test]
async fn aborted_picker_future_discards_the_active_sensitive_attempt() {
    let auth = AuthState::default();
    auth.set_current_session(Some(serde_json::json!({
        "user": { "id": "user-42" }
    })))
    .await;
    let opened = Arc::new(AtomicBool::new(false));
    let state = Arc::new(GoogleDriveState::with_oauth_adapters(
        Arc::new(InMemoryGoogleDriveCredentialStore::default()),
        Arc::new(UnavailableDriveMetadataClient),
        Arc::new(FakeSettings::default()),
        Arc::new(FakeOAuthProvider::with_exchanges(vec![])),
        Arc::new(AcceptFolder),
        Arc::new(SilentBrowser {
            opened: opened.clone(),
        }),
        PickerProtocolConfig::new(
            "desktop-client.apps.googleusercontent.com".to_string(),
            Duration::from_secs(60),
        ),
    ));
    let task_state = state.clone();
    let task_auth = auth.clone();
    let picker =
        tokio::spawn(async move { task_state.connect_and_choose_folder(&task_auth).await });
    while !opened.load(Ordering::SeqCst) {
        tokio::task::yield_now().await;
    }

    picker.abort();
    let _ = picker.await;
    for _ in 0..10 {
        if state.active_picker_attempt.lock().await.is_none() {
            break;
        }
        tokio::task::yield_now().await;
    }

    assert!(state.active_picker_attempt.lock().await.is_none());
}

#[tokio::test]
async fn invalid_grant_refresh_sets_reconnect_without_exposing_provider_error() {
    let credential_store = Arc::new(InMemoryGoogleDriveCredentialStore::default());
    credential_store
        .set_refresh_token("user-42", "revoked-refresh-token")
        .expect("seed credential");
    let settings = Arc::new(FakeSettings::with_folder("folder-42", "Uploads"));
    let provider = Arc::new(FakeOAuthProvider::with_refreshes(vec![Err(
        OAuthProviderError::InvalidGrant,
    )]));
    let state = oauth_state(
        credential_store,
        settings,
        provider,
        Arc::new(CallbackBrowser::new("unused")),
    );

    assert_eq!(
        state.access_token_for_user("user-42").await,
        Err(GoogleDriveOAuthError::ReconnectRequired)
    );
    assert!(
        state
            .connection_state_for_user("user-42")
            .await
            .requires_reconnect
    );
}

#[tokio::test]
async fn concurrent_cache_misses_single_flight_one_refresh_per_user() {
    let credential_store = Arc::new(InMemoryGoogleDriveCredentialStore::default());
    credential_store
        .set_refresh_token("user-42", "refresh-token")
        .expect("seed credential");
    let provider = Arc::new(BlockingRefreshProvider::new(token_response(
        "shared-access-token",
        None,
    )));
    let state = Arc::new(oauth_state(
        credential_store,
        Arc::new(FakeSettings::with_folder("folder-42", "Uploads")),
        provider.clone(),
        Arc::new(CallbackBrowser::new("unused")),
    ));

    let first_state = state.clone();
    let first = tokio::spawn(async move { first_state.access_token_for_user("user-42").await });
    provider.wait_until_refresh_started().await;
    let second_state = state.clone();
    let second = tokio::spawn(async move { second_state.access_token_for_user("user-42").await });
    tokio::time::sleep(Duration::from_millis(20)).await;

    assert_eq!(provider.refresh_calls.load(Ordering::SeqCst), 1);
    provider.release_refresh.add_permits(2);
    assert_eq!(
        first.await.expect("first task").unwrap().as_str(),
        "shared-access-token"
    );
    assert_eq!(
        second.await.expect("second task").unwrap().as_str(),
        "shared-access-token"
    );
    assert_eq!(provider.refresh_calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn disconnect_waits_for_in_flight_refresh_then_removes_rotated_state() {
    let credential_store = Arc::new(InMemoryGoogleDriveCredentialStore::default());
    credential_store
        .set_refresh_token("user-42", "refresh-token")
        .expect("seed credential");
    let provider = Arc::new(BlockingRefreshProvider::new(token_response(
        "new-access-token",
        Some("rotated-refresh-token"),
    )));
    let settings = Arc::new(FakeSettings::with_folder("folder-42", "Uploads"));
    let state = Arc::new(oauth_state(
        credential_store.clone(),
        settings.clone(),
        provider.clone(),
        Arc::new(CallbackBrowser::new("unused")),
    ));

    let refresh_state = state.clone();
    let refresh = tokio::spawn(async move { refresh_state.access_token_for_user("user-42").await });
    provider.wait_until_refresh_started().await;
    let disconnect_state = state.clone();
    let disconnect = tokio::spawn(async move { disconnect_state.disconnect_user("user-42").await });
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert!(
        !disconnect.is_finished(),
        "disconnect must serialize behind the in-flight refresh"
    );

    provider.release_refresh.add_permits(1);
    assert_eq!(
        refresh.await.expect("refresh task").unwrap().as_str(),
        "new-access-token"
    );
    disconnect
        .await
        .expect("disconnect task")
        .expect("disconnect succeeds");
    assert_eq!(
        credential_store
            .get_refresh_token("user-42")
            .expect("read credential"),
        None
    );
    assert_eq!(state.cached_access_token("user-42").await, None);
    assert_eq!(settings.folder_for_user("user-42"), None);
}

#[tokio::test]
async fn invalid_grant_clears_the_expired_cached_access_token() {
    let credential_store = Arc::new(InMemoryGoogleDriveCredentialStore::default());
    credential_store
        .set_refresh_token("user-42", "revoked-refresh-token")
        .expect("seed credential");
    let provider = Arc::new(FakeOAuthProvider::with_refreshes(vec![Err(
        OAuthProviderError::InvalidGrant,
    )]));
    let state = oauth_state(
        credential_store,
        Arc::new(FakeSettings::with_folder("folder-42", "Uploads")),
        provider,
        Arc::new(CallbackBrowser::new("unused")),
    );
    state
        .cache_access_token_until(
            "user-42",
            Zeroizing::new("known-bad-access-token".to_string()),
            Instant::now() - Duration::from_secs(1),
        )
        .await;

    assert_eq!(
        state.access_token_for_user("user-42").await,
        Err(GoogleDriveOAuthError::ReconnectRequired)
    );
    assert_eq!(state.cached_access_token("user-42").await, None);
}

#[tokio::test]
async fn invalid_refresh_payload_clears_the_expired_cached_access_token() {
    let credential_store = Arc::new(InMemoryGoogleDriveCredentialStore::default());
    credential_store
        .set_refresh_token("user-42", "refresh-token")
        .expect("seed credential");
    let provider = Arc::new(FakeOAuthProvider::with_refreshes(vec![Ok(
        OAuthTokenResponse {
            access_token: "new-access-token".to_string(),
            refresh_token: None,
            expires_in: u64::MAX,
            scope: Some(GOOGLE_DRIVE_FILE_SCOPE.to_string()),
        },
    )]));
    let state = oauth_state(
        credential_store,
        Arc::new(FakeSettings::with_folder("folder-42", "Uploads")),
        provider,
        Arc::new(CallbackBrowser::new("unused")),
    );
    state
        .cache_access_token_until(
            "user-42",
            Zeroizing::new("expired-access-token".to_string()),
            Instant::now() - Duration::from_secs(1),
        )
        .await;

    assert_eq!(
        state.access_token_for_user("user-42").await,
        Err(GoogleDriveOAuthError::InvalidResponse)
    );
    assert_eq!(state.cached_access_token("user-42").await, None);
}

struct ExpireOnceRequest {
    calls: Mutex<Vec<String>>,
}

#[async_trait]
impl AuthorizedDriveRequest<String> for ExpireOnceRequest {
    async fn execute(&self, access_token: &str) -> Result<String, AuthorizedDriveRequestError> {
        let mut calls = self
            .calls
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        calls.push(access_token.to_string());
        if calls.len() == 1 {
            Err(AuthorizedDriveRequestError::TokenExpired)
        } else {
            Ok("accepted".to_string())
        }
    }
}

#[tokio::test]
async fn authorized_request_refreshes_and_retries_exactly_once_after_token_expiry() {
    let credential_store = Arc::new(InMemoryGoogleDriveCredentialStore::default());
    credential_store
        .set_refresh_token("user-42", "refresh-token")
        .expect("seed credential");
    let provider = Arc::new(FakeOAuthProvider::with_refreshes(vec![
        Ok(token_response("access-one", None)),
        Ok(token_response("access-two", None)),
    ]));
    let state = oauth_state(
        credential_store,
        Arc::new(FakeSettings::with_folder("folder-42", "Uploads")),
        provider,
        Arc::new(CallbackBrowser::new("unused")),
    );
    let request = ExpireOnceRequest {
        calls: Mutex::new(Vec::new()),
    };

    assert_eq!(
        state.execute_authorized_request("user-42", &request).await,
        Ok("accepted".to_string())
    );
    assert_eq!(
        *request
            .calls
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()),
        vec!["access-one".to_string(), "access-two".to_string()]
    );
}

struct AlwaysExpiredRequest;

#[async_trait]
impl AuthorizedDriveRequest<()> for AlwaysExpiredRequest {
    async fn execute(&self, _access_token: &str) -> Result<(), AuthorizedDriveRequestError> {
        Err(AuthorizedDriveRequestError::TokenExpired)
    }
}

#[tokio::test]
async fn second_token_expiry_clears_the_retried_access_token() {
    let credential_store = Arc::new(InMemoryGoogleDriveCredentialStore::default());
    credential_store
        .set_refresh_token("user-42", "refresh-token")
        .expect("seed credential");
    let provider = Arc::new(FakeOAuthProvider::with_refreshes(vec![Ok(token_response(
        "replacement-access-token",
        None,
    ))]));
    let state = oauth_state(
        credential_store,
        Arc::new(FakeSettings::with_folder("folder-42", "Uploads")),
        provider,
        Arc::new(CallbackBrowser::new("unused")),
    );
    state
        .cache_access_token("user-42", "first-access-token")
        .await;

    assert_eq!(
        state
            .execute_authorized_request("user-42", &AlwaysExpiredRequest)
            .await,
        Err(GoogleDriveOAuthError::InvalidResponse)
    );
    assert_eq!(state.cached_access_token("user-42").await, None);
}

#[tokio::test]
async fn disconnect_deletes_local_state_even_when_revocation_fails() {
    let credential_store = Arc::new(InMemoryGoogleDriveCredentialStore::default());
    credential_store
        .set_refresh_token("user-42", "refresh-token")
        .expect("seed credential");
    let settings = Arc::new(FakeSettings::with_folder("folder-42", "Uploads"));
    let provider = Arc::new(FakeOAuthProvider::with_refreshes(vec![]));
    *provider
        .revoke_result
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Err(OAuthProviderError::Network);
    let state = oauth_state(
        credential_store.clone(),
        settings.clone(),
        provider.clone(),
        Arc::new(CallbackBrowser::new("unused")),
    );
    state.cache_access_token("user-42", "access-token").await;

    let result = state
        .disconnect_user("user-42")
        .await
        .expect("local disconnect succeeds");

    assert!(result.revocation_unconfirmed);
    assert_eq!(provider.revoke_calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        credential_store
            .get_refresh_token("user-42")
            .expect("read credential"),
        None
    );
    assert_eq!(settings.folder_for_user("user-42"), None);
    assert_eq!(state.cached_access_token("user-42").await, None);
}

fn oauth_state(
    credential_store: Arc<dyn GoogleDriveCredentialStore>,
    settings: Arc<dyn GoogleDriveSettingsAccess>,
    provider: Arc<dyn GoogleOAuthProvider>,
    browser: Arc<dyn PickerBrowser>,
) -> GoogleDriveState {
    GoogleDriveState::with_oauth_adapters(
        credential_store,
        Arc::new(UnavailableDriveMetadataClient),
        settings,
        provider,
        Arc::new(AcceptFolder),
        browser,
        PickerProtocolConfig::new(
            "desktop-client.apps.googleusercontent.com".to_string(),
            Duration::from_secs(1),
        ),
    )
}

fn token_response(access_token: &str, refresh_token: Option<&str>) -> OAuthTokenResponse {
    OAuthTokenResponse {
        access_token: access_token.to_string(),
        refresh_token: refresh_token.map(str::to_string),
        expires_in: 3600,
        scope: Some(GOOGLE_DRIVE_FILE_SCOPE.to_string()),
    }
}

fn folder(id: &str, name: &str) -> GoogleDriveFolderSetting {
    GoogleDriveFolderSetting {
        id: id.to_string(),
        name: name.to_string(),
    }
}
