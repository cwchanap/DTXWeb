use super::*;
use crate::google_drive::credential_store::InMemoryGoogleDriveCredentialStore;
use crate::google_drive::oauth::OAuthTokenResponse;
use crate::google_drive::pending_bindings::{
    GoogleDrivePendingBindingStore, PendingBindingKind, PendingGoogleDriveBinding,
};
use crate::google_drive::settings::{GoogleDriveFolderSetting, GoogleDriveSettingsStore};
use std::sync::Arc;
use tempfile::tempdir;
use uuid::Uuid;
use zeroize::Zeroizing;

#[tokio::test]
async fn state_keeps_cached_access_tokens_isolated_by_authenticated_user() {
    let data_dir = tempdir().expect("data dir");
    let state = GoogleDriveState::with_adapters(
        Arc::new(InMemoryGoogleDriveCredentialStore::default()),
        Arc::new(UnavailableDriveMetadataClient),
        Arc::new(GoogleDriveSettingsStore::new(data_dir.path().to_path_buf())),
    );

    state.cache_access_token("user-a", "token-for-a").await;
    state.cache_access_token("user-b", "token-for-b").await;

    assert_eq!(
        state
            .cached_access_token("user-a")
            .await
            .as_ref()
            .map(|token| token.as_str()),
        Some("token-for-a")
    );
    assert_eq!(
        state
            .cached_access_token("user-b")
            .await
            .as_ref()
            .map(|token| token.as_str()),
        Some("token-for-b")
    );
}

#[tokio::test]
async fn logout_clear_removes_only_volatile_drive_state_and_visible_operations() {
    let data_dir = tempdir().expect("data dir");
    let credentials = Arc::new(InMemoryGoogleDriveCredentialStore::default());
    let settings = Arc::new(GoogleDriveSettingsStore::new(data_dir.path().to_path_buf()));
    let pending = GoogleDrivePendingBindingStore::new(data_dir.path().to_path_buf());
    let mut state = GoogleDriveState::with_adapters(
        credentials.clone(),
        Arc::new(UnavailableDriveMetadataClient),
        settings.clone(),
    );
    state.pending_bindings = Some(pending.clone());
    state
        .credentials
        .set_refresh_token("user-1", Zeroizing::new("refresh-token".to_string()))
        .await
        .expect("credential");
    settings
        .set_folder_for_user(
            "user-1",
            GoogleDriveFolderSetting {
                id: "folder-id".to_string(),
                name: "Public uploads".to_string(),
            },
        )
        .expect("folder setting");
    pending
        .replace(PendingGoogleDriveBinding {
            user_id: "user-1".to_string(),
            simfile_id: "sim-1".to_string(),
            drive_file_id: "pending-file".to_string(),
            kind: PendingBindingKind::FirstUpload,
            created_at: "1".to_string(),
            expected_previous_drive_file: None,
        })
        .expect("pending binding");
    state.cache_access_token("user-1", "access-token").await;
    state
        .folder_validation_cache_by_user
        .lock()
        .await
        .insert("user-1".to_string(), PublicPermissionStatus::Public);
    let operation = state
        .operation_manager
        .register("user-1", Uuid::new_v4(), "sim-1")
        .expect("visible operation");
    operation.set_phase(upload::DriveOperationPhase::Transferring);

    state.clear_user_memory("user-1").await;

    assert!(state.cached_access_token("user-1").await.is_none());
    assert!(!state
        .folder_validation_cache_by_user
        .lock()
        .await
        .contains_key("user-1"));
    assert!(operation.cancellation().is_cancelled());
    assert!(!operation.is_visible());
    assert!(state
        .credentials
        .get_refresh_token("user-1")
        .await
        .expect("credential read")
        .is_some());
    assert!(settings.folder_for_user("user-1").is_some());
    assert!(pending
        .get("user-1", "sim-1")
        .expect("pending read")
        .is_some());
}

#[test]
fn drive_metadata_error_code_strings_are_stable_renderer_contract() {
    assert_eq!(
        DriveMetadataError::DefinitiveUnavailable.code(),
        "SIMFILE_UNAVAILABLE"
    );
    assert_eq!(DriveMetadataError::Authentication.code(), "AUTHENTICATION");
    assert_eq!(DriveMetadataError::Network.code(), "NETWORK");
    assert_eq!(
        DriveMetadataError::ServiceUnavailable.code(),
        "SERVICE_UNAVAILABLE"
    );
    assert_eq!(
        DriveMetadataError::InvalidResponse.code(),
        "INVALID_RESPONSE"
    );
    assert_eq!(DriveMetadataError::LocalState.code(), "LOCAL_STATE");
    // Display delegates to code() so error surfaces stay renderer-safe.
    assert_eq!(DriveMetadataError::Network.to_string(), "NETWORK");
}

#[tokio::test]
async fn unavailable_metadata_client_always_reports_service_unavailable() {
    let auth = AuthState::default();
    assert_eq!(
        UnavailableDriveMetadataClient
            .fetch_owner_simfile(&auth, "sim-1")
            .await,
        Err(DriveMetadataError::ServiceUnavailable)
    );
    assert_eq!(
        UnavailableDriveMetadataClient
            .update_drive_file(&auth, "sim-1", "file-1", "https://example.test", None)
            .await,
        Err(DriveMetadataError::ServiceUnavailable)
    );
}

/// A `GoogleOAuthProvider` that returns a queued sequence of refresh results,
/// popping one per call. Exhausted calls yield `InvalidResponse`.
struct QueuedRefreshProvider {
    refreshes: std::sync::Mutex<
        std::collections::VecDeque<std::result::Result<OAuthTokenResponse, OAuthProviderError>>,
    >,
}

impl QueuedRefreshProvider {
    fn new(refreshes: Vec<std::result::Result<OAuthTokenResponse, OAuthProviderError>>) -> Self {
        Self {
            refreshes: std::sync::Mutex::new(refreshes.into()),
        }
    }
}

#[async_trait::async_trait]
impl GoogleOAuthProvider for QueuedRefreshProvider {
    async fn exchange_code(
        &self,
        _request: crate::google_drive::oauth::TokenExchangeRequest,
    ) -> std::result::Result<OAuthTokenResponse, OAuthProviderError> {
        Err(OAuthProviderError::InvalidResponse)
    }

    async fn refresh_access_token(
        &self,
        _refresh_token: &str,
    ) -> std::result::Result<OAuthTokenResponse, OAuthProviderError> {
        self.refreshes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .pop_front()
            .unwrap_or(Err(OAuthProviderError::InvalidResponse))
    }

    async fn revoke_refresh_token(
        &self,
        _refresh_token: &str,
    ) -> std::result::Result<(), OAuthProviderError> {
        Ok(())
    }
}

fn token_response_with(
    access_token: &str,
    expires_in: u64,
    scope: Option<&str>,
) -> OAuthTokenResponse {
    OAuthTokenResponse {
        access_token: access_token.to_string(),
        refresh_token: None,
        expires_in,
        scope: scope.map(str::to_string),
    }
}

fn state_with_provider(provider: Arc<dyn GoogleOAuthProvider>) -> GoogleDriveState {
    let credentials = Arc::new(InMemoryGoogleDriveCredentialStore::default());
    credentials
        .set_refresh_token("user-42", "refresh-token")
        .expect("seed credential");
    GoogleDriveState::with_oauth_adapters(
        credentials,
        Arc::new(UnavailableDriveMetadataClient),
        Arc::new(FakeSettingsFolder::with_folder("folder-42", "Uploads")),
        provider,
        Arc::new(DeferredPickerFolderValidator),
        Arc::new(UnavailablePickerBrowser),
        PickerProtocolConfig::new(String::new(), Duration::from_secs(5 * 60)),
    )
}

#[tokio::test]
async fn network_refresh_failure_surfaces_network_oauth_error() {
    let state = state_with_provider(Arc::new(QueuedRefreshProvider::new(vec![Err(
        OAuthProviderError::Network,
    )])));
    assert_eq!(
        state.access_token_for_user("user-42").await,
        Err(GoogleDriveOAuthError::Network)
    );
}

#[tokio::test]
async fn invalid_response_refresh_failure_clears_cache_and_surfaces_invalid_response() {
    let state = state_with_provider(Arc::new(QueuedRefreshProvider::new(vec![Err(
        OAuthProviderError::InvalidResponse,
    )])));
    // Cache a token that is already expired so `access_token_for_user` is
    // forced to call the OAuth provider's refresh endpoint.
    state
        .cache_access_token_until(
            "user-42",
            Zeroizing::new("stale-token".to_string()),
            std::time::Instant::now() - Duration::from_secs(1),
        )
        .await;
    assert_eq!(
        state.access_token_for_user("user-42").await,
        Err(GoogleDriveOAuthError::InvalidResponse)
    );
    assert_eq!(state.cached_access_token("user-42").await, None);
}

#[tokio::test]
async fn refresh_response_with_empty_access_token_is_rejected_as_invalid_response() {
    let state = state_with_provider(Arc::new(QueuedRefreshProvider::new(vec![Ok(
        token_response_with("   ", 3600, Some(GOOGLE_DRIVE_FILE_SCOPE)),
    )])));
    assert_eq!(
        state.access_token_for_user("user-42").await,
        Err(GoogleDriveOAuthError::InvalidResponse)
    );
}

#[tokio::test]
async fn refresh_response_with_zero_expires_in_is_rejected_as_invalid_response() {
    let state = state_with_provider(Arc::new(QueuedRefreshProvider::new(vec![Ok(
        token_response_with("access-token", 0, Some(GOOGLE_DRIVE_FILE_SCOPE)),
    )])));
    assert_eq!(
        state.access_token_for_user("user-42").await,
        Err(GoogleDriveOAuthError::InvalidResponse)
    );
}

#[tokio::test]
async fn refresh_response_with_missing_drive_scope_is_rejected_as_invalid_response() {
    let state = state_with_provider(Arc::new(QueuedRefreshProvider::new(vec![Ok(
        token_response_with("access-token", 3600, Some("openid email")),
    )])));
    assert_eq!(
        state.access_token_for_user("user-42").await,
        Err(GoogleDriveOAuthError::InvalidResponse)
    );
}

#[tokio::test]
async fn refresh_response_with_blank_rotated_refresh_token_is_rejected_as_invalid_response() {
    let response = OAuthTokenResponse {
        access_token: "access-token".to_string(),
        refresh_token: Some("   ".to_string()),
        expires_in: 3600,
        scope: Some(GOOGLE_DRIVE_FILE_SCOPE.to_string()),
    };
    let state = state_with_provider(Arc::new(QueuedRefreshProvider::new(vec![Ok(response)])));
    assert_eq!(
        state.access_token_for_user("user-42").await,
        Err(GoogleDriveOAuthError::InvalidResponse)
    );
}

#[tokio::test]
async fn refresh_response_without_scope_is_accepted() {
    // A response with no scope field is treated as valid (the provider did not
    // narrow the grant). This exercises the `None => true` arm.
    let state = state_with_provider(Arc::new(QueuedRefreshProvider::new(vec![Ok(
        token_response_with("scopeless-access-token", 3600, None),
    )])));
    assert_eq!(
        state
            .access_token_for_user("user-42")
            .await
            .expect("scopeless token")
            .as_str(),
        "scopeless-access-token"
    );
}

/// Settings mock that holds a single folder and can be mutated mid-test.
#[derive(Default)]
struct FakeSettingsFolder {
    folder: std::sync::Mutex<Option<GoogleDriveFolderSetting>>,
}

impl FakeSettingsFolder {
    fn with_folder(id: &str, name: &str) -> Self {
        Self {
            folder: std::sync::Mutex::new(Some(GoogleDriveFolderSetting {
                id: id.to_string(),
                name: name.to_string(),
            })),
        }
    }

    fn clear(&self) {
        *self.folder.lock().unwrap() = None;
    }

    fn replace(&self, id: &str, name: &str) {
        *self.folder.lock().unwrap() = Some(GoogleDriveFolderSetting {
            id: id.to_string(),
            name: name.to_string(),
        });
    }
}

impl GoogleDriveSettingsAccess for FakeSettingsFolder {
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
    ) -> crate::error::Result<()> {
        *self.folder.lock().unwrap() = Some(folder);
        Ok(())
    }

    fn clear_folder_for_user(&self, _user_id: &str) -> crate::error::Result<()> {
        *self.folder.lock().unwrap() = None;
        Ok(())
    }
}

#[tokio::test]
async fn recheck_returns_canceled_when_user_logs_out_before_validation_completes() {
    let auth = AuthState::default();
    auth.set_current_session(Some(serde_json::json!({
        "user": { "id": "user-42" }
    })))
    .await;
    let credentials = Arc::new(InMemoryGoogleDriveCredentialStore::default());
    credentials
        .set_refresh_token("user-42", "refresh-token")
        .expect("seed credential");
    let settings = Arc::new(FakeSettingsFolder::with_folder("folder-42", "Uploads"));
    let validator = Arc::new(GatedValidator::new(folder_setting("folder-42", "Uploads")));
    let state = GoogleDriveState::with_oauth_adapters(
        credentials,
        Arc::new(UnavailableDriveMetadataClient),
        settings,
        Arc::new(QueuedRefreshProvider::new(vec![Ok(token_response_with(
            "access-token",
            3600,
            Some(GOOGLE_DRIVE_FILE_SCOPE),
        ))])),
        validator.clone(),
        Arc::new(UnavailablePickerBrowser),
        PickerProtocolConfig::new(String::new(), Duration::from_secs(5 * 60)),
    );
    state.cache_access_token("user-42", "access-token").await;

    let state = Arc::new(state);
    let recheck_state = state.clone();
    let recheck_auth = auth.clone();
    let recheck = tokio::spawn(async move {
        recheck_state
            .recheck_google_drive_sharing(&recheck_auth)
            .await
    });
    // Wait until the validation request has parked on the gate.
    validator.started.notified().await;
    // Log the user out while validation is in-flight, then release the gate
    // so validation completes and recheck proceeds to the post-validation
    // user-identity check.
    auth.set_current_session(None).await;
    validator.release();
    assert!(matches!(
        tokio::time::timeout(Duration::from_secs(2), recheck)
            .await
            .expect("recheck must not hang")
            .expect("recheck task"),
        Err(GoogleDriveOAuthError::Canceled)
    ));
}

#[tokio::test]
async fn recheck_returns_canceled_when_folder_changes_before_validation_completes() {
    let auth = AuthState::default();
    auth.set_current_session(Some(serde_json::json!({
        "user": { "id": "user-42" }
    })))
    .await;
    let credentials = Arc::new(InMemoryGoogleDriveCredentialStore::default());
    credentials
        .set_refresh_token("user-42", "refresh-token")
        .expect("seed credential");
    let settings = Arc::new(FakeSettingsFolder::with_folder("folder-42", "Uploads"));
    let validator = Arc::new(GatedValidator::new(folder_setting("folder-42", "Uploads")));
    let state = GoogleDriveState::with_oauth_adapters(
        credentials,
        Arc::new(UnavailableDriveMetadataClient),
        settings.clone(),
        Arc::new(QueuedRefreshProvider::new(vec![Ok(token_response_with(
            "access-token",
            3600,
            Some(GOOGLE_DRIVE_FILE_SCOPE),
        ))])),
        validator.clone(),
        Arc::new(UnavailablePickerBrowser),
        PickerProtocolConfig::new(String::new(), Duration::from_secs(5 * 60)),
    );
    state.cache_access_token("user-42", "access-token").await;

    let state = Arc::new(state);
    let recheck_state = state.clone();
    let recheck_auth = auth.clone();
    let recheck = tokio::spawn(async move {
        recheck_state
            .recheck_google_drive_sharing(&recheck_auth)
            .await
    });
    validator.started.notified().await;
    // Swap the folder out from under the in-flight validation, then release.
    settings.replace("other-folder", "Other");
    validator.release();
    assert!(matches!(
        tokio::time::timeout(Duration::from_secs(2), recheck)
            .await
            .expect("recheck must not hang")
            .expect("recheck task"),
        Err(GoogleDriveOAuthError::Canceled)
    ));
}

#[tokio::test]
async fn recheck_returns_invalid_response_when_validated_folder_id_mismatches() {
    let auth = AuthState::default();
    auth.set_current_session(Some(serde_json::json!({
        "user": { "id": "user-42" }
    })))
    .await;
    let credentials = Arc::new(InMemoryGoogleDriveCredentialStore::default());
    credentials
        .set_refresh_token("user-42", "refresh-token")
        .expect("seed credential");
    let state = GoogleDriveState::with_oauth_adapters(
        credentials,
        Arc::new(UnavailableDriveMetadataClient),
        Arc::new(FakeSettingsFolder::with_folder("folder-42", "Uploads")),
        Arc::new(QueuedRefreshProvider::new(vec![Ok(token_response_with(
            "access-token",
            3600,
            Some(GOOGLE_DRIVE_FILE_SCOPE),
        ))])),
        // Validator returns a *different* folder id than the one stored.
        Arc::new(StaticFolderValidator(folder_setting(
            "wrong-folder",
            "Wrong",
        ))),
        Arc::new(UnavailablePickerBrowser),
        PickerProtocolConfig::new(String::new(), Duration::from_secs(5 * 60)),
    );
    state.cache_access_token("user-42", "access-token").await;
    assert!(matches!(
        state.recheck_google_drive_sharing(&auth).await,
        Err(GoogleDriveOAuthError::InvalidResponse)
    ));
}

#[tokio::test]
async fn recheck_propagates_unclassified_validation_errors() {
    let auth = AuthState::default();
    auth.set_current_session(Some(serde_json::json!({
        "user": { "id": "user-42" }
    })))
    .await;
    let credentials = Arc::new(InMemoryGoogleDriveCredentialStore::default());
    credentials
        .set_refresh_token("user-42", "refresh-token")
        .expect("seed credential");
    let state = GoogleDriveState::with_oauth_adapters(
        credentials,
        Arc::new(UnavailableDriveMetadataClient),
        Arc::new(FakeSettingsFolder::with_folder("folder-42", "Uploads")),
        Arc::new(QueuedRefreshProvider::new(vec![Ok(token_response_with(
            "access-token",
            3600,
            Some(GOOGLE_DRIVE_FILE_SCOPE),
        ))])),
        Arc::new(StaticFolderValidator(folder_setting(
            "folder-42",
            "Uploads",
        ))),
        Arc::new(UnavailablePickerBrowser),
        PickerProtocolConfig::new(String::new(), Duration::from_secs(5 * 60)),
    );
    state.cache_access_token("user-42", "access-token").await;
    // The validator returns a folder with the right id, but we inject a
    // generic error by using a validator that always fails with Network.
    let state2 = GoogleDriveState::with_oauth_adapters(
        Arc::new(InMemoryGoogleDriveCredentialStore::default()),
        Arc::new(UnavailableDriveMetadataClient),
        Arc::new(FakeSettingsFolder::with_folder("folder-42", "Uploads")),
        Arc::new(QueuedRefreshProvider::new(vec![Ok(token_response_with(
            "access-token",
            3600,
            Some(GOOGLE_DRIVE_FILE_SCOPE),
        ))])),
        Arc::new(AlwaysFailingValidator(GoogleDriveOAuthError::Network)),
        Arc::new(UnavailablePickerBrowser),
        PickerProtocolConfig::new(String::new(), Duration::from_secs(5 * 60)),
    );
    state2.cache_access_token("user-42", "access-token").await;
    assert!(matches!(
        state2.recheck_google_drive_sharing(&auth).await,
        Err(GoogleDriveOAuthError::Network)
    ));
}

#[tokio::test]
async fn disconnect_without_a_stored_credential_skips_revocation_and_clears_state() {
    let credentials = Arc::new(InMemoryGoogleDriveCredentialStore::default());
    let settings = Arc::new(FakeSettingsFolder::with_folder("folder-42", "Uploads"));
    let state = GoogleDriveState::with_oauth_adapters(
        credentials.clone(),
        Arc::new(UnavailableDriveMetadataClient),
        settings.clone(),
        Arc::new(QueuedRefreshProvider::new(vec![])),
        Arc::new(DeferredPickerFolderValidator),
        Arc::new(UnavailablePickerBrowser),
        PickerProtocolConfig::new(String::new(), Duration::from_secs(5 * 60)),
    );
    let result = state
        .disconnect_user("user-42")
        .await
        .expect("disconnect succeeds");
    // No refresh token → no revocation attempt → unconfirmed stays false.
    assert!(!result.revocation_unconfirmed);
    assert!(!result.connection.connected);
}

#[tokio::test]
async fn disconnect_marks_revocation_unconfirmed_when_credential_read_fails() {
    let credentials: Arc<dyn GoogleDriveCredentialStore> = Arc::new(FailingReadStore);
    let settings = Arc::new(FakeSettingsFolder::with_folder("folder-42", "Uploads"));
    let state = GoogleDriveState::with_oauth_adapters(
        credentials,
        Arc::new(UnavailableDriveMetadataClient),
        settings,
        Arc::new(QueuedRefreshProvider::new(vec![])),
        Arc::new(DeferredPickerFolderValidator),
        Arc::new(UnavailablePickerBrowser),
        PickerProtocolConfig::new(String::new(), Duration::from_secs(5 * 60)),
    );
    let result = state
        .disconnect_user("user-42")
        .await
        .expect("disconnect still clears local state");
    // Credential read failed → revocation could not be attempted.
    assert!(result.revocation_unconfirmed);
}

/// A `PickerFolderValidator` that parks on a `Notify` until released, so a
/// test can mutate session/folder state while validation is in-flight and
/// then let validation complete to exercise the post-validation checks.
struct GatedValidator {
    result: GoogleDriveFolderSetting,
    started: tokio::sync::Notify,
    release: tokio::sync::Notify,
}

impl GatedValidator {
    fn new(result: GoogleDriveFolderSetting) -> Self {
        Self {
            result,
            started: tokio::sync::Notify::new(),
            release: tokio::sync::Notify::new(),
        }
    }

    fn release(&self) {
        self.release.notify_one();
    }
}

#[async_trait::async_trait]
impl PickerFolderValidator for GatedValidator {
    async fn validate_folder(
        &self,
        _access_token: &str,
        _folder_id: &str,
    ) -> std::result::Result<GoogleDriveFolderSetting, GoogleDriveOAuthError> {
        self.started.notify_one();
        self.release.notified().await;
        Ok(self.result.clone())
    }
}

/// A validator that always returns the same folder setting.
struct StaticFolderValidator(GoogleDriveFolderSetting);

#[async_trait::async_trait]
impl PickerFolderValidator for StaticFolderValidator {
    async fn validate_folder(
        &self,
        _access_token: &str,
        _folder_id: &str,
    ) -> std::result::Result<GoogleDriveFolderSetting, GoogleDriveOAuthError> {
        Ok(self.0.clone())
    }
}

fn folder_setting(id: &str, name: &str) -> GoogleDriveFolderSetting {
    GoogleDriveFolderSetting {
        id: id.to_string(),
        name: name.to_string(),
    }
}

/// A validator that always fails with the injected error.
struct AlwaysFailingValidator(GoogleDriveOAuthError);

#[async_trait::async_trait]
impl PickerFolderValidator for AlwaysFailingValidator {
    async fn validate_folder(
        &self,
        _access_token: &str,
        _folder_id: &str,
    ) -> std::result::Result<GoogleDriveFolderSetting, GoogleDriveOAuthError> {
        Err(self.0)
    }
}

/// A credential store whose `get_refresh_token` always fails.
struct FailingReadStore;

impl GoogleDriveCredentialStore for FailingReadStore {
    fn get_refresh_token(
        &self,
        _user_id: &str,
    ) -> std::result::Result<
        Option<String>,
        crate::google_drive::credential_store::CredentialStoreError,
    > {
        Err(crate::google_drive::credential_store::CredentialStoreError::CredentialStore)
    }

    fn set_refresh_token(
        &self,
        _user_id: &str,
        _token: &str,
    ) -> std::result::Result<(), crate::google_drive::credential_store::CredentialStoreError> {
        Ok(())
    }

    fn delete_refresh_token(
        &self,
        _user_id: &str,
    ) -> std::result::Result<(), crate::google_drive::credential_store::CredentialStoreError> {
        Ok(())
    }
}
