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
        read_callback_target(&mut stream, Instant::now() + Duration::from_millis(100)).await;

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
    // Give the second task enough scheduling rounds to reach the single-flight
    // wait (it must observe the in-flight refresh and join it rather than
    // starting a second refresh). A fixed sleep is non-deterministic; a bounded
    // yield_now loop provides deterministic scheduling within the current-thread
    // runtime.
    for _ in 0..10 {
        tokio::task::yield_now().await;
    }

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
    // Give the disconnect task enough scheduling rounds to reach the
    // per-user lock wait (it must serialize behind the in-flight refresh).
    // A fixed sleep is non-deterministic; a bounded yield_now loop provides
    // deterministic scheduling within the current-thread runtime.
    for _ in 0..10 {
        tokio::task::yield_now().await;
    }
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

#[tokio::test]
async fn upload_expiry_refresh_is_single_flight_and_reuses_the_secure_store_result() {
    let credential_store = Arc::new(InMemoryGoogleDriveCredentialStore::default());
    credential_store
        .set_refresh_token("user-42", "refresh-token")
        .expect("seed credential");
    let provider = Arc::new(BlockingRefreshProvider::new(token_response(
        "replacement-access-token",
        None,
    )));
    let state = Arc::new(oauth_state(
        credential_store,
        Arc::new(FakeSettings::with_folder("folder-42", "Uploads")),
        provider.clone(),
        Arc::new(CallbackBrowser::new("unused")),
    ));
    state
        .cache_access_token("user-42", "expired-access-token")
        .await;

    let first = tokio::spawn({
        let state = state.clone();
        async move {
            state
                .refresh_access_token_after_expiry("user-42", "expired-access-token")
                .await
        }
    });
    provider.wait_until_refresh_started().await;
    let second = tokio::spawn({
        let state = state.clone();
        async move {
            state
                .refresh_access_token_after_expiry("user-42", "expired-access-token")
                .await
        }
    });
    provider.release_refresh.add_permits(1);

    assert_eq!(
        first.await.unwrap().unwrap().as_str(),
        "replacement-access-token"
    );
    assert_eq!(
        second.await.unwrap().unwrap().as_str(),
        "replacement-access-token"
    );
    assert_eq!(provider.refresh_calls.load(Ordering::SeqCst), 1);
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

#[test]
fn oauth_error_codes_are_stable_renderer_contract() {
    use crate::google_drive::oauth::GoogleDriveOAuthError;
    assert_eq!(GoogleDriveOAuthError::Canceled.code(), "CANCELED");
    assert_eq!(
        GoogleDriveOAuthError::InvalidResponse.code(),
        "INVALID_RESPONSE"
    );
    assert_eq!(GoogleDriveOAuthError::Network.code(), "NETWORK");
    assert_eq!(
        GoogleDriveOAuthError::ReconnectRequired.code(),
        "RECONNECT_REQUIRED"
    );
    assert_eq!(GoogleDriveOAuthError::NotConnected.code(), "NOT_CONNECTED");
    assert_eq!(
        GoogleDriveOAuthError::CredentialStore.code(),
        "CREDENTIAL_STORE"
    );
    assert_eq!(GoogleDriveOAuthError::LocalState.code(), "LOCAL_STATE");
    assert_eq!(
        GoogleDriveOAuthError::AlreadyInProgress.code(),
        "UPLOAD_IN_PROGRESS"
    );
    assert_eq!(
        GoogleDriveOAuthError::FolderUnavailable.code(),
        "FOLDER_UNAVAILABLE"
    );
    assert_eq!(
        GoogleDriveOAuthError::DownloadNotPublic.code(),
        "DOWNLOAD_NOT_PUBLIC"
    );
    assert_eq!(
        GoogleDriveOAuthError::SharingCheckUnavailable.code(),
        "SHARING_CHECK_UNAVAILABLE"
    );
    assert_eq!(GoogleDriveOAuthError::FileNotFound.code(), "FILE_NOT_FOUND");
    assert_eq!(
        GoogleDriveOAuthError::FilePermissionDenied.code(),
        "FILE_PERMISSION_DENIED"
    );
}

#[tokio::test]
async fn unavailable_oauth_provider_always_fails() {
    use crate::google_drive::oauth::{TokenExchangeRequest, UnavailableOAuthProvider};
    let provider = UnavailableOAuthProvider;
    assert!(matches!(
        provider
            .exchange_code(TokenExchangeRequest {
                code: Zeroizing::new("code".to_string()),
                pkce_verifier: Zeroizing::new("verifier".to_string()),
                redirect_uri: "http://127.0.0.1/cb".to_string(),
            })
            .await,
        Err(OAuthProviderError::InvalidResponse)
    ));
    assert!(matches!(
        provider.refresh_access_token("refresh").await,
        Err(OAuthProviderError::InvalidResponse)
    ));
    assert!(matches!(
        provider.revoke_refresh_token("refresh").await,
        Err(OAuthProviderError::Network)
    ));
}

#[test]
fn unavailable_picker_browser_always_fails() {
    use crate::google_drive::oauth::UnavailablePickerBrowser;
    let browser = UnavailablePickerBrowser;
    assert_eq!(
        browser.open("https://accounts.google.com/auth"),
        Err(GoogleDriveOAuthError::InvalidResponse)
    );
}

#[tokio::test]
async fn deferred_picker_folder_validator_always_fails() {
    use crate::google_drive::oauth::DeferredPickerFolderValidator;
    let validator = DeferredPickerFolderValidator;
    assert_eq!(
        validator.validate_folder("token", "folder-42").await,
        Err(GoogleDriveOAuthError::InvalidResponse)
    );
}

#[test]
fn picker_protocol_config_new_stores_values_verbatim() {
    let config = PickerProtocolConfig::new("client-id-42".to_string(), Duration::from_secs(99));
    assert_eq!(config.client_id, "client-id-42");
    assert_eq!(config.timeout, Duration::from_secs(99));
}

#[test]
fn picker_protocol_config_production_trims_env_client_id() {
    let config = PickerProtocolConfig::production();
    // Whatever the env yields, production must trim whitespace.
    assert_eq!(config.client_id, config.client_id.trim());
    assert_eq!(config.timeout, DEFAULT_PICKER_TIMEOUT);
}

#[test]
fn validated_picker_tokens_reject_oversized_access_token_and_zero_expiry() {
    // Access token exceeding MAX_AUTH_ARTIFACT_BYTES is rejected.
    let oversized = OAuthTokenResponse {
        access_token: "a".repeat(MAX_AUTH_ARTIFACT_BYTES + 1),
        refresh_token: Some("refresh-token".to_string()),
        expires_in: 3600,
        scope: Some(GOOGLE_DRIVE_FILE_SCOPE.to_string()),
    };
    assert_eq!(
        ValidatedPickerTokens::try_from(oversized),
        Err(GoogleDriveOAuthError::InvalidResponse)
    );

    // expires_in == 0 is rejected.
    let zero_expiry = OAuthTokenResponse {
        access_token: "access-token".to_string(),
        refresh_token: Some("refresh-token".to_string()),
        expires_in: 0,
        scope: Some(GOOGLE_DRIVE_FILE_SCOPE.to_string()),
    };
    assert_eq!(
        ValidatedPickerTokens::try_from(zero_expiry),
        Err(GoogleDriveOAuthError::InvalidResponse)
    );
}

#[test]
fn map_provider_error_classifies_each_variant() {
    assert_eq!(
        map_provider_error(OAuthProviderError::InvalidGrant),
        GoogleDriveOAuthError::ReconnectRequired
    );
    assert_eq!(
        map_provider_error(OAuthProviderError::InvalidResponse),
        GoogleDriveOAuthError::InvalidResponse
    );
    assert_eq!(
        map_provider_error(OAuthProviderError::Network),
        GoogleDriveOAuthError::Network
    );
}

#[tokio::test]
async fn write_callback_response_writes_valid_http_response_and_closes_stream() {
    use tokio::io::AsyncReadExt;
    let listener = tokio::net::TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("bind loopback");
    let address = listener.local_addr().expect("listener address");
    let writer = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("accept");
        write_callback_response(&mut stream)
            .await
            .expect("write response");
    });
    let mut client = tokio::net::TcpStream::connect(address)
        .await
        .expect("connect loopback");
    let mut response = Vec::new();
    client.read_to_end(&mut response).await.expect("read all");
    writer.await.expect("writer task");
    let text = String::from_utf8(response).expect("utf8");
    assert!(text.starts_with("HTTP/1.1 200 OK\r\n"));
    assert!(text.contains("content-type: text/html; charset=utf-8"));
    assert!(text.contains("Return to Drumery"));
}

#[tokio::test]
async fn read_callback_target_rejects_non_get_methods_and_unsupported_versions() {
    for request in [
        format!(
            "POST {GOOGLE_DRIVE_CALLBACK_PATH}?state=s&code=c HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"
        ),
        format!(
            "GET {GOOGLE_DRIVE_CALLBACK_PATH}?state=s&code=c HTTP/2.0\r\nHost: 127.0.0.1\r\n\r\n"
        ),
        format!(
            "GET {GOOGLE_DRIVE_CALLBACK_PATH}?state=s&code=c HTTP/1.1 extra\r\nHost: 127.0.0.1\r\n\r\n"
        ),
    ] {
        let listener = tokio::net::TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("bind loopback");
        let address = listener.local_addr().expect("listener address");
        let request_bytes = request.as_bytes().to_vec();
        let writer = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept");
            stream.write_all(&request_bytes).await.expect("write request");
            // Keep the stream open briefly so read_callback_target sees EOF
            // only after the full request is consumed.
            tokio::time::sleep(Duration::from_millis(50)).await;
        });
        let mut stream = tokio::net::TcpStream::connect(address)
            .await
            .expect("connect loopback");
        let result =
            read_callback_target(&mut stream, Instant::now() + Duration::from_secs(5)).await;
        assert_eq!(result, Err(GoogleDriveOAuthError::InvalidResponse));
        let _ = writer.await;
    }
}

#[tokio::test]
async fn read_callback_target_rejects_oversized_request_body() {
    let listener = tokio::net::TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("bind loopback");
    let address = listener.local_addr().expect("listener address");
    let writer = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("accept");
        // Send a request line followed by a header that never terminates
        // (no \r\n\r\n) and exceeds MAX_CALLBACK_REQUEST_BYTES.
        let mut payload = format!(
            "GET {GOOGLE_DRIVE_CALLBACK_PATH}?state=s&code=c HTTP/1.1\r\nHost: 127.0.0.1\r\n"
        )
        .into_bytes();
        payload.extend(std::iter::repeat(b'X').take(MAX_CALLBACK_REQUEST_BYTES + 1));
        stream.write_all(&payload).await.expect("write payload");
        tokio::time::sleep(Duration::from_millis(50)).await;
    });
    let mut stream = tokio::net::TcpStream::connect(address)
        .await
        .expect("connect loopback");
    let result = read_callback_target(&mut stream, Instant::now() + Duration::from_secs(5)).await;
    assert_eq!(result, Err(GoogleDriveOAuthError::InvalidResponse));
    let _ = writer.await;
}

#[tokio::test]
async fn read_callback_target_rejects_oversized_header_line() {
    let listener = tokio::net::TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("bind loopback");
    let address = listener.local_addr().expect("listener address");
    let writer = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("accept");
        let mut payload = format!("GET {GOOGLE_DRIVE_CALLBACK_PATH}?state=s&code=c HTTP/1.1\r\n");
        // One header line exceeding MAX_CALLBACK_HEADER_BYTES.
        payload.push_str(&format!(
            "X-Big: {}\r\n",
            "a".repeat(MAX_CALLBACK_HEADER_BYTES + 1)
        ));
        payload.push_str("\r\n");
        stream.write_all(payload.as_bytes()).await.expect("write");
        tokio::time::sleep(Duration::from_millis(50)).await;
    });
    let mut stream = tokio::net::TcpStream::connect(address)
        .await
        .expect("connect loopback");
    let result = read_callback_target(&mut stream, Instant::now() + Duration::from_secs(5)).await;
    assert_eq!(result, Err(GoogleDriveOAuthError::InvalidResponse));
    let _ = writer.await;
}

#[tokio::test]
async fn read_callback_target_rejects_too_many_header_lines() {
    let listener = tokio::net::TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("bind loopback");
    let address = listener.local_addr().expect("listener address");
    let writer = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("accept");
        let mut payload = format!("GET {GOOGLE_DRIVE_CALLBACK_PATH}?state=s&code=c HTTP/1.1\r\n");
        for i in 0..=MAX_CALLBACK_HEADER_LINES {
            payload.push_str(&format!("X-Header-{i}: value\r\n"));
        }
        payload.push_str("\r\n");
        stream.write_all(payload.as_bytes()).await.expect("write");
        tokio::time::sleep(Duration::from_millis(50)).await;
    });
    let mut stream = tokio::net::TcpStream::connect(address)
        .await
        .expect("connect loopback");
    let result = read_callback_target(&mut stream, Instant::now() + Duration::from_secs(5)).await;
    assert_eq!(result, Err(GoogleDriveOAuthError::InvalidResponse));
    let _ = writer.await;
}

#[tokio::test]
async fn read_callback_target_rejects_empty_request() {
    let listener = tokio::net::TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("bind loopback");
    let address = listener.local_addr().expect("listener address");
    let writer = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.expect("accept");
        // Immediately close the connection without sending any data.
        drop(stream);
    });
    let mut stream = tokio::net::TcpStream::connect(address)
        .await
        .expect("connect loopback");
    let result = read_callback_target(&mut stream, Instant::now() + Duration::from_secs(5)).await;
    assert_eq!(result, Err(GoogleDriveOAuthError::InvalidResponse));
    let _ = writer.await;
}

/// A credential store whose `set_refresh_token` always fails, used to exercise
/// the rollback error path in `persist_validated_connection`.
struct FailingWriteCredentialStore {
    stored: Mutex<Option<String>>,
}

impl GoogleDriveCredentialStore for FailingWriteCredentialStore {
    fn get_refresh_token(
        &self,
        _user_id: &str,
    ) -> std::result::Result<
        Option<String>,
        crate::google_drive::credential_store::CredentialStoreError,
    > {
        Ok(self.stored.lock().unwrap().clone())
    }

    fn set_refresh_token(
        &self,
        _user_id: &str,
        _token: &str,
    ) -> std::result::Result<(), crate::google_drive::credential_store::CredentialStoreError> {
        Err(crate::google_drive::credential_store::CredentialStoreError::CredentialStore)
    }

    fn delete_refresh_token(
        &self,
        _user_id: &str,
    ) -> std::result::Result<(), crate::google_drive::credential_store::CredentialStoreError> {
        Ok(())
    }
}

#[tokio::test]
async fn persist_validated_connection_fails_when_credential_write_fails() {
    let store = Arc::new(FailingWriteCredentialStore {
        stored: Mutex::new(None),
    });
    let credentials = GoogleDriveCredentialAccess::new(store);
    let settings = FakeSettings::with_folder("old-folder", "Old folder");

    assert_eq!(
        persist_validated_connection(
            &credentials,
            &settings,
            "user-42",
            Zeroizing::new("new-refresh-token".to_string()),
            folder("new-folder", "New folder"),
        )
        .await,
        Err(GoogleDriveOAuthError::CredentialStore)
    );
    // Prior folder is untouched because the credential write failed first.
    assert_eq!(
        settings.folder_for_user("user-42"),
        Some(folder("old-folder", "Old folder"))
    );
}

/// A settings adapter whose `set_folder_for_user` always fails and which
/// *replaces* the stored folder on failure (violating the contract that a
/// failed atomic write must not change the stored value). This exercises the
/// contract-violation recovery path in `persist_validated_connection`.
struct ContractViolatingSettings {
    folder: Mutex<Option<GoogleDriveFolderSetting>>,
}

impl GoogleDriveSettingsAccess for ContractViolatingSettings {
    fn folder_for_user(&self, _user_id: &str) -> Option<GoogleDriveFolderSetting> {
        self.folder.lock().unwrap().clone()
    }

    fn set_folder_for_user(
        &self,
        _user_id: &str,
        folder: GoogleDriveFolderSetting,
    ) -> DesktopResult<()> {
        // Violate the contract: replace the stored value even though we
        // report failure.
        *self.folder.lock().unwrap() = Some(folder);
        Err(DesktopError::Message(
            "injected settings failure".to_string(),
        ))
    }

    fn clear_folder_for_user(&self, _user_id: &str) -> DesktopResult<()> {
        *self.folder.lock().unwrap() = None;
        Ok(())
    }
}

#[tokio::test]
async fn persist_validated_connection_restores_prior_folder_when_settings_violate_contract() {
    let store = Arc::new(InMemoryGoogleDriveCredentialStore::default());
    store
        .set_refresh_token("user-42", "prior-refresh-token")
        .expect("seed credential");
    let credentials = GoogleDriveCredentialAccess::new(store.clone());
    let settings = ContractViolatingSettings {
        folder: Mutex::new(Some(folder("prior-folder", "Prior"))),
    };

    assert_eq!(
        persist_validated_connection(
            &credentials,
            &settings,
            "user-42",
            Zeroizing::new("new-refresh-token".to_string()),
            folder("new-folder", "New"),
        )
        .await,
        Err(GoogleDriveOAuthError::LocalState)
    );
    // The new refresh token was written, then rolled back to the prior token.
    assert_eq!(
        store
            .get_refresh_token("user-42")
            .expect("read credential")
            .as_deref(),
        Some("prior-refresh-token")
    );
    // The contract-violating adapter replaced the folder, but
    // persist_validated_connection detected the mismatch and restored it.
    assert_eq!(
        settings.folder_for_user("user-42"),
        Some(folder("prior-folder", "Prior"))
    );
}

#[tokio::test]
async fn persist_validated_connection_clears_folder_when_settings_violate_contract_with_no_prior() {
    let store = Arc::new(InMemoryGoogleDriveCredentialStore::default());
    let credentials = GoogleDriveCredentialAccess::new(store.clone());
    let settings = ContractViolatingSettings {
        folder: Mutex::new(None),
    };

    assert_eq!(
        persist_validated_connection(
            &credentials,
            &settings,
            "user-42",
            Zeroizing::new("new-refresh-token".to_string()),
            folder("new-folder", "New"),
        )
        .await,
        Err(GoogleDriveOAuthError::LocalState)
    );
    // No prior token → the new token was written then deleted.
    assert_eq!(
        store.get_refresh_token("user-42").expect("read credential"),
        None
    );
    // The contract-violating adapter set the folder, but
    // persist_validated_connection detected the mismatch and cleared it.
    assert_eq!(settings.folder_for_user("user-42"), None);
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

#[test]
fn reqwest_oauth_provider_rejects_empty_client_id() {
    assert!(matches!(
        ReqwestGoogleOAuthProvider::new(String::new()),
        Err(GoogleDriveOAuthError::InvalidResponse)
    ));
}

#[test]
fn reqwest_oauth_provider_rejects_whitespace_only_client_id() {
    assert!(matches!(
        ReqwestGoogleOAuthProvider::new("   \t\n ".to_string()),
        Err(GoogleDriveOAuthError::InvalidResponse)
    ));
}

#[test]
fn reqwest_oauth_provider_accepts_valid_client_id() {
    let provider =
        ReqwestGoogleOAuthProvider::new("client-id-42.apps.googleusercontent.com".to_string())
            .expect("valid client id builds a provider");
    assert_eq!(
        provider.client_id,
        "client-id-42.apps.googleusercontent.com"
    );
}

#[tokio::test]
async fn disconnect_cancels_active_operations_before_awaiting_oauth_revocation() {
    use uuid::Uuid;

    // Regression: disconnect_user must cancel and hide active operations
    // BEFORE awaiting the OAuth revocation request. The revocation provider
    // blocks until released; if cancellation only happened after revocation,
    // an in-flight upload could finalize and patch metadata during the wait.
    struct BlockingRevokeProvider {
        revoke_entered: Arc<Notify>,
        release_revoke: Arc<Notify>,
        revoke_calls: AtomicUsize,
    }

    #[async_trait]
    impl GoogleOAuthProvider for BlockingRevokeProvider {
        async fn exchange_code(
            &self,
            _request: TokenExchangeRequest,
        ) -> std::result::Result<OAuthTokenResponse, OAuthProviderError> {
            Err(OAuthProviderError::InvalidResponse)
        }
        async fn refresh_access_token(
            &self,
            _refresh_token: &str,
        ) -> std::result::Result<OAuthTokenResponse, OAuthProviderError> {
            Err(OAuthProviderError::InvalidResponse)
        }
        async fn revoke_refresh_token(
            &self,
            _refresh_token: &str,
        ) -> std::result::Result<(), OAuthProviderError> {
            self.revoke_calls.fetch_add(1, Ordering::SeqCst);
            // notify_one stores a permit, so the handoff cannot be lost to a
            // scheduling race even if the receiver has not yet polled.
            self.revoke_entered.notify_one();
            self.release_revoke.notified().await;
            Ok(())
        }
    }

    let revoke_entered = Arc::new(Notify::new());
    let release_revoke = Arc::new(Notify::new());
    let provider = Arc::new(BlockingRevokeProvider {
        revoke_entered: Arc::clone(&revoke_entered),
        release_revoke: Arc::clone(&release_revoke),
        revoke_calls: AtomicUsize::new(0),
    });
    let credential_store = Arc::new(InMemoryGoogleDriveCredentialStore::default());
    credential_store
        .set_refresh_token("user-42", "refresh-token")
        .expect("seed credential");
    let settings = Arc::new(FakeSettings::with_folder("folder-42", "Uploads"));
    let state = oauth_state(
        credential_store.clone(),
        settings.clone(),
        provider as Arc<dyn GoogleOAuthProvider>,
        Arc::new(CallbackBrowser::new("unused")),
    );

    // Register an active upload operation for this user.
    let operation_id = Uuid::new_v4();
    let lease = state
        .operation_manager
        .register("user-42", operation_id, "sim-42")
        .expect("register operation");
    assert!(lease.is_visible());
    assert!(!lease.cancellation().is_cancelled());

    // Pre-register the notified future before spawning disconnect_user so the
    // revoke_entered handoff cannot be lost to a scheduling race. notify_one
    // stores a permit, so even if the provider signals before this future is
    // polled, the await completes immediately.
    let mut revoke_entered_wait = Box::pin(revoke_entered.notified());

    // Start disconnect in a spawned task — it will block on revocation.
    let disconnect = tokio::spawn(async move { state.disconnect_user("user-42").await });

    // Wait for the revocation provider to be entered — this confirms
    // disconnect_user has progressed past the cancellation step and is
    // now waiting on the network.
    revoke_entered_wait.as_mut().await;

    // The operation must already be cancelled and hidden BEFORE the
    // revocation network request returns.
    assert!(
        lease.cancellation().is_cancelled(),
        "active upload must be cancelled before revocation awaits"
    );
    assert!(
        !lease.is_visible(),
        "active upload must be hidden before revocation awaits"
    );

    // Release the revocation so disconnect can complete. notify_one stores a
    // permit so the provider's release_revoke.notified() await completes even
    // if it has not yet been polled when we signal.
    release_revoke.notify_one();
    disconnect
        .await
        .expect("disconnect task")
        .expect("disconnect succeeds");
}

// ---------------------------------------------------------------------------
// Additional coverage tests for previously uncovered lines.
// ---------------------------------------------------------------------------

#[test]
fn callback_rejects_oversized_target() {
    let now = Instant::now();
    let picker_attempt = attempt(now);
    // A target exceeding MAX_CALLBACK_TARGET_BYTES is rejected before parsing.
    let oversized_code = "a".repeat(MAX_CALLBACK_TARGET_BYTES + 1);
    let target = format!(
        "{}?state={}&code={}&picked_file_ids=folder-42",
        GOOGLE_DRIVE_CALLBACK_PATH,
        picker_attempt.oauth_state(),
        oversized_code,
    );
    assert_eq!(
        picker_attempt.validate_callback_target(&target, "drumery-user", now),
        Err(GoogleDriveOAuthError::InvalidResponse),
    );
}

#[test]
fn callback_rejects_folder_id_containing_comma() {
    let now = Instant::now();
    let picker_attempt = attempt(now);
    let target = format!(
        "{}?state={}&code=authorization-code&picked_file_ids=folder-a,folder-b",
        GOOGLE_DRIVE_CALLBACK_PATH,
        picker_attempt.oauth_state(),
    );
    assert_eq!(
        picker_attempt.validate_callback_target(&target, "drumery-user", now),
        Err(GoogleDriveOAuthError::InvalidResponse),
    );
}

#[test]
fn picker_callback_debug_redacts_secrets() {
    let callback = PickerCallback::AuthorizationCode {
        code: Zeroizing::new("secret-auth-code".to_string()),
        folder_id: "secret-folder-id".to_string(),
    };
    let debug = format!("{callback:?}");
    assert!(!debug.contains("secret-auth-code"));
    assert!(!debug.contains("secret-folder-id"));
    assert!(debug.contains("redacted"));
}

#[test]
fn validated_picker_tokens_debug_redacts_secrets() {
    let tokens = ValidatedPickerTokens {
        access_token: Zeroizing::new("secret-access-token".to_string()),
        refresh_token: Zeroizing::new("secret-refresh-token".to_string()),
        expires_in: 3600,
    };
    let debug = format!("{tokens:?}");
    assert!(!debug.contains("secret-access-token"));
    assert!(!debug.contains("secret-refresh-token"));
    assert!(debug.contains("redacted"));
}

#[tokio::test]
async fn decode_token_response_success_parses_valid_token() {
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "access_token": "access-token",
            "refresh_token": "refresh-token",
            "expires_in": 3600,
            "scope": GOOGLE_DRIVE_FILE_SCOPE,
        })))
        .mount(&server)
        .await;

    let http_client = reqwest::Client::new();
    let response = http_client.get(server.uri()).send().await.expect("send");
    let result = ReqwestGoogleOAuthProvider::decode_token_response(response, false).await;
    assert!(result.is_ok());
    let token = result.expect("token");
    assert_eq!(token.access_token, "access-token");
    assert_eq!(token.refresh_token.as_deref(), Some("refresh-token"));
}

#[tokio::test]
async fn decode_token_response_success_with_invalid_json_is_invalid_response() {
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(200).set_body_string("not valid json"))
        .mount(&server)
        .await;

    let http_client = reqwest::Client::new();
    let response = http_client.get(server.uri()).send().await.expect("send");
    let result = ReqwestGoogleOAuthProvider::decode_token_response(response, false).await;
    assert!(matches!(result, Err(OAuthProviderError::InvalidResponse)));
}

#[tokio::test]
async fn decode_token_response_non_success_without_grant_classification_is_invalid() {
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(
            ResponseTemplate::new(400).set_body_json(serde_json::json!({"error": "bad_request"})),
        )
        .mount(&server)
        .await;

    let http_client = reqwest::Client::new();
    let response = http_client.get(server.uri()).send().await.expect("send");
    let result = ReqwestGoogleOAuthProvider::decode_token_response(response, false).await;
    assert!(matches!(result, Err(OAuthProviderError::InvalidResponse)));
}

#[tokio::test]
async fn decode_token_response_classifies_invalid_grant_when_enabled() {
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(
            ResponseTemplate::new(400).set_body_json(serde_json::json!({"error": "invalid_grant"})),
        )
        .mount(&server)
        .await;

    let http_client = reqwest::Client::new();
    let response = http_client.get(server.uri()).send().await.expect("send");
    let result = ReqwestGoogleOAuthProvider::decode_token_response(response, true).await;
    assert!(matches!(result, Err(OAuthProviderError::InvalidGrant)));
}

#[tokio::test]
async fn decode_token_response_invalid_grant_not_classified_when_disabled() {
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(
            ResponseTemplate::new(400).set_body_json(serde_json::json!({"error": "invalid_grant"})),
        )
        .mount(&server)
        .await;

    let http_client = reqwest::Client::new();
    let response = http_client.get(server.uri()).send().await.expect("send");
    let result = ReqwestGoogleOAuthProvider::decode_token_response(response, false).await;
    assert!(matches!(result, Err(OAuthProviderError::InvalidResponse)));
}

#[tokio::test]
async fn decode_token_response_non_invalid_grant_error_with_classification_enabled() {
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(
            ResponseTemplate::new(400).set_body_json(serde_json::json!({"error": "bad_request"})),
        )
        .mount(&server)
        .await;

    let http_client = reqwest::Client::new();
    let response = http_client.get(server.uri()).send().await.expect("send");
    let result = ReqwestGoogleOAuthProvider::decode_token_response(response, true).await;
    assert!(matches!(result, Err(OAuthProviderError::InvalidResponse)));
}

#[tokio::test]
async fn decode_token_response_non_success_with_unparseable_body_is_invalid() {
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(400).set_body_string("not json"))
        .mount(&server)
        .await;

    let http_client = reqwest::Client::new();
    let response = http_client.get(server.uri()).send().await.expect("send");
    let result = ReqwestGoogleOAuthProvider::decode_token_response(response, true).await;
    assert!(matches!(result, Err(OAuthProviderError::InvalidResponse)));
}

/// A credential store whose `set_refresh_token` succeeds on the first call
/// but fails on subsequent calls, used to exercise the rollback error path
/// (line 626) in `persist_validated_connection`.
struct FailOnRollbackCredentialStore {
    set_calls: AtomicUsize,
    stored: Mutex<Option<String>>,
}

impl GoogleDriveCredentialStore for FailOnRollbackCredentialStore {
    fn get_refresh_token(
        &self,
        _user_id: &str,
    ) -> std::result::Result<
        Option<String>,
        crate::google_drive::credential_store::CredentialStoreError,
    > {
        Ok(self.stored.lock().expect("stored").clone())
    }

    fn set_refresh_token(
        &self,
        _user_id: &str,
        token: &str,
    ) -> std::result::Result<(), crate::google_drive::credential_store::CredentialStoreError> {
        let calls = self.set_calls.fetch_add(1, Ordering::SeqCst);
        if calls == 0 {
            *self.stored.lock().expect("stored") = Some(token.to_string());
            Ok(())
        } else {
            Err(crate::google_drive::credential_store::CredentialStoreError::CredentialStore)
        }
    }

    fn delete_refresh_token(
        &self,
        _user_id: &str,
    ) -> std::result::Result<(), crate::google_drive::credential_store::CredentialStoreError> {
        Ok(())
    }
}

#[tokio::test]
async fn persist_validated_connection_returns_credential_store_when_rollback_fails() {
    let store = Arc::new(FailOnRollbackCredentialStore {
        set_calls: AtomicUsize::new(0),
        stored: Mutex::new(Some("old-refresh-token".to_string())),
    });
    let credentials = GoogleDriveCredentialAccess::new(store);
    let settings = FakeSettings::with_folder("old-folder", "Old folder");
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
        Err(GoogleDriveOAuthError::CredentialStore),
    );
}

#[tokio::test]
async fn picker_rejects_second_concurrent_attempt_with_already_in_progress() {
    let auth = AuthState::default();
    auth.set_current_session(Some(serde_json::json!({
        "user": { "id": "user-42" }
    })))
    .await;
    let state = Arc::new(GoogleDriveState::with_oauth_adapters(
        Arc::new(InMemoryGoogleDriveCredentialStore::default()),
        Arc::new(UnavailableDriveMetadataClient),
        Arc::new(FakeSettings::default()),
        Arc::new(FakeOAuthProvider::with_exchanges(vec![])),
        Arc::new(AcceptFolder),
        Arc::new(SilentBrowser {
            opened: Arc::new(AtomicBool::new(false)),
        }),
        PickerProtocolConfig::new(
            "desktop-client.apps.googleusercontent.com".to_string(),
            Duration::from_secs(60),
        ),
    ));

    // Pre-populate the active picker attempt slot to simulate an in-progress attempt.
    let pre_attempt = PickerAttempt::new(
        "user-42".to_string(),
        SocketAddrV4::new(Ipv4Addr::LOCALHOST, 49152),
        Instant::now(),
        Duration::from_secs(60),
    );
    *state.active_picker_attempt.lock().await = Some(pre_attempt);

    assert!(matches!(
        state.connect_and_choose_folder(&auth).await,
        Err(GoogleDriveOAuthError::AlreadyInProgress),
    ));
}

#[tokio::test]
async fn picker_returns_browser_error_when_open_fails() {
    let auth = AuthState::default();
    auth.set_current_session(Some(serde_json::json!({
        "user": { "id": "user-42" }
    })))
    .await;
    let state = GoogleDriveState::with_oauth_adapters(
        Arc::new(InMemoryGoogleDriveCredentialStore::default()),
        Arc::new(UnavailableDriveMetadataClient),
        Arc::new(FakeSettings::default()),
        Arc::new(FakeOAuthProvider::with_exchanges(vec![])),
        Arc::new(AcceptFolder),
        Arc::new(UnavailablePickerBrowser),
        PickerProtocolConfig::new(
            "desktop-client.apps.googleusercontent.com".to_string(),
            Duration::from_secs(60),
        ),
    );

    assert!(matches!(
        state.connect_and_choose_folder(&auth).await,
        Err(GoogleDriveOAuthError::InvalidResponse),
    ));
}

#[tokio::test]
async fn picker_cancels_when_no_callback_arrives_before_deadline() {
    let auth = AuthState::default();
    auth.set_current_session(Some(serde_json::json!({
        "user": { "id": "user-42" }
    })))
    .await;
    let opened = Arc::new(AtomicBool::new(false));
    let state = GoogleDriveState::with_oauth_adapters(
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
            Duration::from_millis(100),
        ),
    );

    assert!(matches!(
        state.connect_and_choose_folder(&auth).await,
        Err(GoogleDriveOAuthError::Canceled),
    ));
}

// ---------------------------------------------------------------------------
// Additional coverage for previously uncovered lines in oauth.rs.
// ---------------------------------------------------------------------------

#[test]
fn authorization_url_rejects_empty_client_id() {
    let picker_attempt = attempt(Instant::now());
    assert_eq!(
        picker_attempt.authorization_url(""),
        Err(GoogleDriveOAuthError::InvalidResponse)
    );
}

#[test]
fn authorization_url_rejects_whitespace_only_client_id() {
    let picker_attempt = attempt(Instant::now());
    assert_eq!(
        picker_attempt.authorization_url("  \t\n "),
        Err(GoogleDriveOAuthError::InvalidResponse)
    );
}

/// A picker browser that connects to the callback listener and sends a
/// malformed (POST) request, causing `read_callback_target` to fail with
/// `InvalidResponse`.
struct MalformedCallbackBrowser;

impl PickerBrowser for MalformedCallbackBrowser {
    fn open(&self, authorization_url: &str) -> Result<(), GoogleDriveOAuthError> {
        let authorization_url =
            Url::parse(authorization_url).map_err(|_| GoogleDriveOAuthError::InvalidResponse)?;
        let redirect_uri = authorization_url
            .query_pairs()
            .find(|(key, _)| key == "redirect_uri")
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
        write!(
            stream,
            "POST {} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
            redirect.path()
        )
        .map_err(|_| GoogleDriveOAuthError::Network)?;
        Ok(())
    }
}

#[tokio::test]
async fn picker_returns_error_when_callback_sends_malformed_request() {
    let auth = AuthState::default();
    auth.set_current_session(Some(serde_json::json!({
        "user": { "id": "user-42" }
    })))
    .await;
    let state = GoogleDriveState::with_oauth_adapters(
        Arc::new(InMemoryGoogleDriveCredentialStore::default()),
        Arc::new(UnavailableDriveMetadataClient),
        Arc::new(FakeSettings::default()),
        Arc::new(FakeOAuthProvider::with_exchanges(vec![])),
        Arc::new(AcceptFolder),
        Arc::new(MalformedCallbackBrowser),
        PickerProtocolConfig::new(
            "desktop-client.apps.googleusercontent.com".to_string(),
            Duration::from_secs(60),
        ),
    );

    assert!(matches!(
        state.connect_and_choose_folder(&auth).await,
        Err(GoogleDriveOAuthError::InvalidResponse)
    ));
}

/// An OAuth provider that switches the authenticated user during
/// `exchange_code`, exercising the post-exchange user-identity check.
struct UserSwitchingExchangeProvider {
    auth: AuthState,
    response: OAuthTokenResponse,
}

#[async_trait]
impl GoogleOAuthProvider for UserSwitchingExchangeProvider {
    async fn exchange_code(
        &self,
        _request: TokenExchangeRequest,
    ) -> Result<OAuthTokenResponse, OAuthProviderError> {
        self.auth
            .set_current_session(Some(serde_json::json!({
                "user": { "id": "other-user" }
            })))
            .await;
        Ok(self.response.clone())
    }

    async fn refresh_access_token(
        &self,
        _refresh_token: &str,
    ) -> Result<OAuthTokenResponse, OAuthProviderError> {
        Err(OAuthProviderError::InvalidResponse)
    }

    async fn revoke_refresh_token(&self, _refresh_token: &str) -> Result<(), OAuthProviderError> {
        Err(OAuthProviderError::Network)
    }
}

#[tokio::test]
async fn picker_cancels_when_user_switches_after_token_exchange() {
    let auth = AuthState::default();
    auth.set_current_session(Some(serde_json::json!({
        "user": { "id": "user-42" }
    })))
    .await;
    let state = GoogleDriveState::with_oauth_adapters(
        Arc::new(InMemoryGoogleDriveCredentialStore::default()),
        Arc::new(UnavailableDriveMetadataClient),
        Arc::new(FakeSettings::default()),
        Arc::new(UserSwitchingExchangeProvider {
            auth: auth.clone(),
            response: token_response("access-token", Some("refresh-token")),
        }),
        Arc::new(AcceptFolder),
        Arc::new(CallbackBrowser::new("folder-42")),
        PickerProtocolConfig::new(
            "desktop-client.apps.googleusercontent.com".to_string(),
            Duration::from_secs(60),
        ),
    );

    assert!(matches!(
        state.connect_and_choose_folder(&auth).await,
        Err(GoogleDriveOAuthError::Canceled)
    ));
}

/// A folder validator that switches the authenticated user during
/// `validate_folder`, exercising the post-validation user-identity check.
struct UserSwitchingValidator {
    auth: AuthState,
}

#[async_trait]
impl PickerFolderValidator for UserSwitchingValidator {
    async fn validate_folder(
        &self,
        _access_token: &str,
        folder_id: &str,
    ) -> Result<GoogleDriveFolderSetting, GoogleDriveOAuthError> {
        self.auth
            .set_current_session(Some(serde_json::json!({
                "user": { "id": "other-user" }
            })))
            .await;
        Ok(folder(folder_id, "Uploads"))
    }
}

#[tokio::test]
async fn picker_cancels_when_user_switches_after_folder_validation() {
    let auth = AuthState::default();
    auth.set_current_session(Some(serde_json::json!({
        "user": { "id": "user-42" }
    })))
    .await;
    let state = GoogleDriveState::with_oauth_adapters(
        Arc::new(InMemoryGoogleDriveCredentialStore::default()),
        Arc::new(UnavailableDriveMetadataClient),
        Arc::new(FakeSettings::default()),
        Arc::new(FakeOAuthProvider::with_exchanges(vec![token_response(
            "access-token",
            Some("refresh-token"),
        )])),
        Arc::new(UserSwitchingValidator { auth: auth.clone() }),
        Arc::new(CallbackBrowser::new("folder-42")),
        PickerProtocolConfig::new(
            "desktop-client.apps.googleusercontent.com".to_string(),
            Duration::from_secs(60),
        ),
    );

    assert!(matches!(
        state.connect_and_choose_folder(&auth).await,
        Err(GoogleDriveOAuthError::Canceled)
    ));
}

#[tokio::test]
async fn active_picker_attempt_guard_take_returns_canceled_when_id_mismatches() {
    let slot = Arc::new(tokio::sync::Mutex::new(Some(attempt(Instant::now()))));
    let wrong_id = uuid::Uuid::new_v4();
    let mut guard = ActivePickerAttemptGuard::new(slot, wrong_id);
    assert!(matches!(
        guard.take().await,
        Err(GoogleDriveOAuthError::Canceled)
    ));
}

#[tokio::test]
async fn active_picker_attempt_guard_take_returns_canceled_when_slot_is_empty() {
    let slot: Arc<tokio::sync::Mutex<Option<PickerAttempt>>> =
        Arc::new(tokio::sync::Mutex::new(None));
    let picker_attempt = attempt(Instant::now());
    let mut guard = ActivePickerAttemptGuard::new(slot, picker_attempt.attempt_id());
    assert!(matches!(
        guard.take().await,
        Err(GoogleDriveOAuthError::Canceled)
    ));
}
