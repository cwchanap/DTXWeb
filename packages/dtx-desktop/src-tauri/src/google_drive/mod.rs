use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use crate::auth::AuthState;
#[cfg(any(feature = "google-drive", feature = "e2e"))]
use crate::error::{DesktopError, Result};
#[cfg(any(feature = "google-drive", feature = "e2e"))]
use crate::native_persistence::resolve_dirs;
use async_trait::async_trait;
use tauri::{AppHandle, Runtime};
use tokio::sync::Mutex as AsyncMutex;
use zeroize::Zeroizing;

#[cfg(feature = "e2e")]
use self::credential_store::InMemoryGoogleDriveCredentialStore;
use self::credential_store::{GoogleDriveCredentialAccess, GoogleDriveCredentialStore};
#[cfg(feature = "google-drive")]
use self::credential_store::{KeyringGoogleDriveCredentialStore, PlatformKeyringEntryFactory};
#[cfg(feature = "google-drive")]
use self::drive_client::GoogleDriveClient;
use self::drive_client::PublicPermissionStatus;
use self::oauth::{
    access_token_is_reusable, AuthorizedDriveRequest, AuthorizedDriveRequestError,
    DeferredPickerFolderValidator, GoogleDriveConnectionState, GoogleDriveDisconnectResult,
    GoogleDriveOAuthError, GoogleOAuthProvider, OAuthProviderError, PickerAttempt, PickerBrowser,
    PickerFolderValidationRequest, PickerFolderValidator, PickerProtocolConfig,
    UnavailableOAuthProvider, UnavailablePickerBrowser, GOOGLE_DRIVE_FILE_SCOPE,
};
#[cfg(feature = "google-drive")]
use self::oauth::{ReqwestGoogleOAuthProvider, TauriPickerBrowser};
use self::pending_bindings::GoogleDrivePendingBindingStore;
use self::settings::GoogleDriveSettingsAccess;
#[cfg(any(feature = "google-drive", feature = "e2e"))]
use self::settings::GoogleDriveSettingsStore;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OwnerDriveSimfile {
    pub id: String,
    pub title: String,
    pub google_drive_file_id: Option<String>,
    pub download_url: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DriveMetadataError {
    DefinitiveUnavailable,
    Authentication,
    Network,
    ServiceUnavailable,
    InvalidResponse,
    LocalState,
}

impl DriveMetadataError {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::DefinitiveUnavailable => "SIMFILE_UNAVAILABLE",
            Self::Authentication => "AUTHENTICATION",
            Self::Network => "NETWORK",
            Self::ServiceUnavailable => "SERVICE_UNAVAILABLE",
            Self::InvalidResponse => "INVALID_RESPONSE",
            Self::LocalState => "LOCAL_STATE",
        }
    }
}

impl std::fmt::Display for DriveMetadataError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.code())
    }
}

impl std::error::Error for DriveMetadataError {}

#[async_trait]
pub(crate) trait DriveMetadataClient: Send + Sync {
    async fn fetch_owner_simfile(
        &self,
        auth: &AuthState,
        simfile_id: &str,
    ) -> std::result::Result<OwnerDriveSimfile, DriveMetadataError>;

    async fn update_drive_file(
        &self,
        auth: &AuthState,
        simfile_id: &str,
        drive_file_id: &str,
        download_url: &str,
    ) -> std::result::Result<OwnerDriveSimfile, DriveMetadataError>;
}

#[derive(Debug)]
pub(crate) struct ApiDriveMetadataClient<R: Runtime = tauri::Wry> {
    app: AppHandle<R>,
}

impl<R: Runtime> ApiDriveMetadataClient<R> {
    pub(crate) fn new(app: AppHandle<R>) -> Self {
        Self { app }
    }
}

#[async_trait]
impl<R: Runtime> DriveMetadataClient for ApiDriveMetadataClient<R> {
    async fn fetch_owner_simfile(
        &self,
        auth: &AuthState,
        simfile_id: &str,
    ) -> std::result::Result<OwnerDriveSimfile, DriveMetadataError> {
        crate::api::fetch_owner_drive_simfile(auth, &self.app, simfile_id).await
    }

    async fn update_drive_file(
        &self,
        auth: &AuthState,
        simfile_id: &str,
        drive_file_id: &str,
        download_url: &str,
    ) -> std::result::Result<OwnerDriveSimfile, DriveMetadataError> {
        crate::api::update_drive_file(auth, &self.app, simfile_id, drive_file_id, download_url)
            .await
    }
}

pub(crate) mod build_config;
pub(crate) mod commands;
pub(crate) mod credential_store;
pub(crate) mod drive_client;
pub(crate) mod oauth;
pub(crate) mod pending_bindings;
pub(crate) mod settings;
pub(crate) mod upload;

struct CachedAccessToken {
    token: Zeroizing<String>,
    expires_at: Instant,
}

/// Rust-owned cross-command Drive state. Every adapter enters through this
/// constructor so production can use the platform keyring while E2E supplies
/// deterministic fakes without exposing credentials to the renderer.
pub(crate) struct GoogleDriveState {
    #[allow(dead_code)]
    credential_store: Arc<dyn GoogleDriveCredentialStore>,
    pub(crate) credentials: GoogleDriveCredentialAccess,
    pub(crate) metadata_client: Arc<dyn DriveMetadataClient>,
    pub(crate) settings: Arc<dyn GoogleDriveSettingsAccess>,
    oauth_provider: Arc<dyn GoogleOAuthProvider>,
    folder_validator: Arc<dyn PickerFolderValidator>,
    picker_browser: Arc<dyn PickerBrowser>,
    picker_config: PickerProtocolConfig,
    lifecycle_locks_by_user: StdMutex<HashMap<String, Arc<AsyncMutex<()>>>>,
    lifecycle_generations_by_user: StdMutex<HashMap<String, u64>>,
    access_tokens_by_user: AsyncMutex<HashMap<String, CachedAccessToken>>,
    requires_reconnect_by_user: AsyncMutex<HashSet<String>>,
    pub(crate) folder_validation_cache_by_user: AsyncMutex<HashMap<String, PublicPermissionStatus>>,
    pub(crate) active_picker_attempt: Arc<AsyncMutex<Option<PickerAttempt>>>,
    /// Native crash-recovery state. Adapter-only unit-test construction leaves
    /// this unavailable; production/E2E constructors always install the
    /// exact app-data-backed store.
    pub(crate) pending_bindings: Option<GoogleDrivePendingBindingStore>,
    /// Replaced by the bounded upload operation manager in Task 11.
    pub(crate) operation_manager: AsyncMutex<()>,
}

impl GoogleDriveState {
    pub(crate) fn with_adapters(
        credential_store: Arc<dyn GoogleDriveCredentialStore>,
        metadata_client: Arc<dyn DriveMetadataClient>,
        settings: Arc<dyn GoogleDriveSettingsAccess>,
    ) -> Self {
        Self::with_oauth_adapters(
            credential_store,
            metadata_client,
            settings,
            Arc::new(UnavailableOAuthProvider),
            Arc::new(DeferredPickerFolderValidator),
            Arc::new(UnavailablePickerBrowser),
            PickerProtocolConfig::new(String::new(), Duration::from_secs(5 * 60)),
        )
    }

    pub(crate) fn with_oauth_adapters(
        credential_store: Arc<dyn GoogleDriveCredentialStore>,
        metadata_client: Arc<dyn DriveMetadataClient>,
        settings: Arc<dyn GoogleDriveSettingsAccess>,
        oauth_provider: Arc<dyn GoogleOAuthProvider>,
        folder_validator: Arc<dyn PickerFolderValidator>,
        picker_browser: Arc<dyn PickerBrowser>,
        picker_config: PickerProtocolConfig,
    ) -> Self {
        Self {
            credentials: GoogleDriveCredentialAccess::new(credential_store.clone()),
            credential_store,
            metadata_client,
            settings,
            oauth_provider,
            folder_validator,
            picker_browser,
            picker_config,
            lifecycle_locks_by_user: StdMutex::new(HashMap::new()),
            lifecycle_generations_by_user: StdMutex::new(HashMap::new()),
            access_tokens_by_user: AsyncMutex::new(HashMap::new()),
            requires_reconnect_by_user: AsyncMutex::new(HashSet::new()),
            folder_validation_cache_by_user: AsyncMutex::new(HashMap::new()),
            active_picker_attempt: Arc::new(AsyncMutex::new(None)),
            pending_bindings: None,
            operation_manager: AsyncMutex::new(()),
        }
    }

    #[cfg(feature = "google-drive")]
    pub(crate) fn production(app: AppHandle) -> Result<Self> {
        let data_dir = resolve_dirs().0.ok_or_else(|| {
            DesktopError::Message("Could not resolve application data directory".to_string())
        })?;
        let credential_store: Arc<dyn GoogleDriveCredentialStore> = Arc::new(
            KeyringGoogleDriveCredentialStore::with_factory(Arc::new(PlatformKeyringEntryFactory)),
        );
        let picker_config = PickerProtocolConfig::production();
        let oauth_provider: Arc<dyn GoogleOAuthProvider> = if picker_config.client_id.is_empty() {
            Arc::new(UnavailableOAuthProvider)
        } else {
            Arc::new(
                ReqwestGoogleOAuthProvider::new(picker_config.client_id.clone())
                    .map_err(|error| DesktopError::Message(error.code().to_string()))?,
            )
        };
        let drive_client = Arc::new(
            GoogleDriveClient::production()
                .map_err(|error| DesktopError::Message(error.code().to_string()))?,
        );
        let mut state = Self::with_oauth_adapters(
            credential_store,
            Arc::new(ApiDriveMetadataClient::new(app.clone())),
            Arc::new(GoogleDriveSettingsStore::new(data_dir.clone())),
            oauth_provider,
            drive_client,
            Arc::new(TauriPickerBrowser::new(app)),
            picker_config,
        );
        state.pending_bindings = Some(GoogleDrivePendingBindingStore::new(data_dir));
        Ok(state)
    }

    #[cfg(feature = "e2e")]
    pub(crate) fn e2e() -> Result<Self> {
        let data_dir = resolve_dirs().0.ok_or_else(|| {
            DesktopError::Message("Could not resolve application data directory".to_string())
        })?;
        let mut state = Self::with_oauth_adapters(
            Arc::new(InMemoryGoogleDriveCredentialStore::default()),
            Arc::new(UnavailableDriveMetadataClient),
            Arc::new(GoogleDriveSettingsStore::new(data_dir.clone())),
            Arc::new(UnavailableOAuthProvider),
            Arc::new(DeferredPickerFolderValidator),
            Arc::new(UnavailablePickerBrowser),
            PickerProtocolConfig::new(String::new(), Duration::from_secs(5 * 60)),
        );
        state.pending_bindings = Some(GoogleDrivePendingBindingStore::new(data_dir));
        Ok(state)
    }

    pub(crate) async fn cache_access_token(&self, user_id: &str, token: &str) {
        let expires_at = Instant::now()
            .checked_add(Duration::from_secs(60 * 60))
            .unwrap_or_else(Instant::now);
        self.cache_access_token_until(user_id, Zeroizing::new(token.to_string()), expires_at)
            .await;
    }

    pub(crate) async fn cache_access_token_until(
        &self,
        user_id: &str,
        token: Zeroizing<String>,
        expires_at: Instant,
    ) {
        let lifecycle = self.lifecycle_lock_for_user(user_id);
        let _guard = lifecycle.lock().await;
        self.cache_access_token_until_locked(user_id, token, expires_at)
            .await;
    }

    async fn cache_access_token_until_locked(
        &self,
        user_id: &str,
        token: Zeroizing<String>,
        expires_at: Instant,
    ) {
        self.access_tokens_by_user
            .lock()
            .await
            .insert(user_id.to_string(), CachedAccessToken { token, expires_at });
    }

    pub(crate) async fn cached_access_token(&self, user_id: &str) -> Option<Zeroizing<String>> {
        self.access_tokens_by_user
            .lock()
            .await
            .get(user_id)
            .map(|cached| Zeroizing::new(cached.token.to_string()))
    }

    pub(crate) async fn access_token_for_user(
        &self,
        user_id: &str,
    ) -> std::result::Result<Zeroizing<String>, GoogleDriveOAuthError> {
        let lifecycle = self.lifecycle_lock_for_user(user_id);
        let _guard = lifecycle.lock().await;
        self.access_token_for_user_locked(user_id).await
    }

    async fn access_token_for_user_locked(
        &self,
        user_id: &str,
    ) -> std::result::Result<Zeroizing<String>, GoogleDriveOAuthError> {
        {
            let cache = self.access_tokens_by_user.lock().await;
            if let Some(cached) = cache.get(user_id) {
                if access_token_is_reusable(cached.expires_at, Instant::now()) {
                    return Ok(Zeroizing::new(cached.token.to_string()));
                }
            }
        }

        let refresh_token = self
            .credentials
            .get_refresh_token(user_id)
            .await
            .map_err(|_| GoogleDriveOAuthError::CredentialStore)?
            .ok_or(GoogleDriveOAuthError::NotConnected)?;
        let response = match self
            .oauth_provider
            .refresh_access_token(&refresh_token)
            .await
        {
            Ok(response) => response,
            Err(OAuthProviderError::InvalidGrant) => {
                self.access_tokens_by_user.lock().await.remove(user_id);
                self.set_requires_reconnect(user_id, true).await;
                return Err(GoogleDriveOAuthError::ReconnectRequired);
            }
            Err(OAuthProviderError::Network) => return Err(GoogleDriveOAuthError::Network),
            Err(OAuthProviderError::InvalidResponse) => {
                self.access_tokens_by_user.lock().await.remove(user_id);
                return Err(GoogleDriveOAuthError::InvalidResponse);
            }
        };

        let access_token = Zeroizing::new(response.access_token);
        let replacement_refresh_token = response.refresh_token.map(Zeroizing::new);
        let scope_is_valid = match response.scope.as_deref() {
            None => true,
            Some(scope) => scope
                .split_ascii_whitespace()
                .any(|candidate| candidate == GOOGLE_DRIVE_FILE_SCOPE),
        };
        if access_token.trim().is_empty()
            || response.expires_in == 0
            || !scope_is_valid
            || replacement_refresh_token
                .as_deref()
                .is_some_and(|token| token.trim().is_empty())
        {
            self.access_tokens_by_user.lock().await.remove(user_id);
            return Err(GoogleDriveOAuthError::InvalidResponse);
        }

        let Some(expires_at) = Instant::now().checked_add(Duration::from_secs(response.expires_in))
        else {
            self.access_tokens_by_user.lock().await.remove(user_id);
            return Err(GoogleDriveOAuthError::InvalidResponse);
        };
        if let Some(replacement) = replacement_refresh_token {
            self.credentials
                .set_refresh_token(user_id, Zeroizing::new(replacement.trim().to_string()))
                .await
                .map_err(|_| GoogleDriveOAuthError::CredentialStore)?;
        }
        self.cache_access_token_until_locked(
            user_id,
            Zeroizing::new(access_token.to_string()),
            expires_at,
        )
        .await;
        self.set_requires_reconnect(user_id, false).await;
        Ok(access_token)
    }

    pub(crate) async fn connection_state_for_user(
        &self,
        user_id: &str,
    ) -> GoogleDriveConnectionState {
        let credential = self.credentials.get_refresh_token(user_id).await;
        let credential_store_unavailable = credential.is_err();
        let has_credential = credential.ok().flatten().is_some();
        let folder = self.settings.folder_for_user(user_id);
        let requires_reconnect = self
            .requires_reconnect_by_user
            .lock()
            .await
            .contains(user_id);
        let permission_status = self
            .folder_validation_cache_by_user
            .lock()
            .await
            .get(user_id)
            .copied();
        GoogleDriveConnectionState {
            connected: has_credential && folder.is_some() && !requires_reconnect,
            folder,
            requires_reconnect,
            requires_public_sharing: permission_status == Some(PublicPermissionStatus::NotPublic),
            sharing_check_unavailable: permission_status
                == Some(PublicPermissionStatus::CheckUnavailable),
            credential_store_unavailable,
        }
    }

    pub(crate) async fn recheck_google_drive_sharing(
        &self,
        auth: &AuthState,
    ) -> std::result::Result<GoogleDriveConnectionState, GoogleDriveOAuthError> {
        let user_id = auth
            .current_user_id()
            .await
            .ok_or(GoogleDriveOAuthError::NotConnected)?;
        let lifecycle_generation = self.user_lifecycle_generation(&user_id);
        let folder = self
            .settings
            .folder_for_user(&user_id)
            .ok_or(GoogleDriveOAuthError::NotConnected)?;
        let request =
            PickerFolderValidationRequest::new(self.folder_validator.as_ref(), &folder.id);
        let validation = self.execute_authorized_request(&user_id, &request).await;

        let lifecycle = self.lifecycle_lock_for_user(&user_id);
        let _guard = lifecycle.lock().await;
        if auth.current_user_id().await.as_deref() != Some(user_id.as_str()) {
            return Err(GoogleDriveOAuthError::Canceled);
        }
        if self.user_lifecycle_generation(&user_id) != lifecycle_generation
            || self.settings.folder_for_user(&user_id).as_ref() != Some(&folder)
        {
            return Err(GoogleDriveOAuthError::Canceled);
        }

        let permission_status = match validation {
            Ok(validated) if validated.id == folder.id => PublicPermissionStatus::Public,
            Ok(_) => return Err(GoogleDriveOAuthError::InvalidResponse),
            Err(GoogleDriveOAuthError::DownloadNotPublic) => PublicPermissionStatus::NotPublic,
            Err(GoogleDriveOAuthError::SharingCheckUnavailable) => {
                PublicPermissionStatus::CheckUnavailable
            }
            Err(error) => return Err(error),
        };
        self.folder_validation_cache_by_user
            .lock()
            .await
            .insert(user_id.clone(), permission_status);
        Ok(self.connection_state_for_user(&user_id).await)
    }

    pub(crate) async fn execute_authorized_request<T, R>(
        &self,
        user_id: &str,
        request: &R,
    ) -> std::result::Result<T, GoogleDriveOAuthError>
    where
        T: Send,
        R: AuthorizedDriveRequest<T>,
    {
        let lifecycle = self.lifecycle_lock_for_user(user_id);
        let _guard = lifecycle.lock().await;
        let access_token = self.access_token_for_user_locked(user_id).await?;
        match request.execute(&access_token).await {
            Ok(value) => Ok(value),
            Err(AuthorizedDriveRequestError::Request(error)) => Err(error),
            Err(AuthorizedDriveRequestError::TokenExpired) => {
                self.access_tokens_by_user.lock().await.remove(user_id);
                let replacement = self.access_token_for_user_locked(user_id).await?;
                match request.execute(&replacement).await {
                    Ok(value) => Ok(value),
                    Err(AuthorizedDriveRequestError::Request(error)) => Err(error),
                    Err(AuthorizedDriveRequestError::TokenExpired) => {
                        self.access_tokens_by_user.lock().await.remove(user_id);
                        Err(GoogleDriveOAuthError::InvalidResponse)
                    }
                }
            }
        }
    }

    pub(crate) async fn set_requires_reconnect(&self, user_id: &str, required: bool) {
        let mut reconnect = self.requires_reconnect_by_user.lock().await;
        if required {
            reconnect.insert(user_id.to_string());
        } else {
            reconnect.remove(user_id);
        }
    }

    pub(crate) async fn disconnect_user(
        &self,
        user_id: &str,
    ) -> std::result::Result<GoogleDriveDisconnectResult, GoogleDriveOAuthError> {
        let lifecycle = self.lifecycle_lock_for_user(user_id);
        let _guard = lifecycle.lock().await;
        self.invalidate_user_lifecycle(user_id);
        let refresh_token = self.credentials.get_refresh_token(user_id).await;
        let mut revocation_unconfirmed = false;
        match refresh_token.as_ref() {
            Ok(Some(token)) => {
                if self
                    .oauth_provider
                    .revoke_refresh_token(token)
                    .await
                    .is_err()
                {
                    revocation_unconfirmed = true;
                }
            }
            Ok(None) => {}
            Err(_) => revocation_unconfirmed = true,
        }

        let delete_result = self.credentials.delete_refresh_token(user_id).await;
        let settings_result = self.settings.clear_folder_for_user(user_id);
        self.clear_user_memory_locked(user_id).await;
        self.set_requires_reconnect(user_id, false).await;
        delete_result.map_err(|_| GoogleDriveOAuthError::CredentialStore)?;
        settings_result.map_err(|_| GoogleDriveOAuthError::LocalState)?;

        Ok(GoogleDriveDisconnectResult {
            connection: self.connection_state_for_user(user_id).await,
            revocation_unconfirmed,
        })
    }

    pub(crate) async fn clear_user_memory(&self, user_id: &str) {
        let lifecycle = self.lifecycle_lock_for_user(user_id);
        let _guard = lifecycle.lock().await;
        self.invalidate_user_lifecycle(user_id);
        self.clear_user_memory_locked(user_id).await;
    }

    async fn clear_user_memory_locked(&self, user_id: &str) {
        self.access_tokens_by_user.lock().await.remove(user_id);
        self.folder_validation_cache_by_user
            .lock()
            .await
            .remove(user_id);
    }

    fn lifecycle_lock_for_user(&self, user_id: &str) -> Arc<AsyncMutex<()>> {
        self.lifecycle_locks_by_user
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .entry(user_id.to_string())
            .or_insert_with(|| Arc::new(AsyncMutex::new(())))
            .clone()
    }

    fn user_lifecycle_generation(&self, user_id: &str) -> u64 {
        *self
            .lifecycle_generations_by_user
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(user_id)
            .unwrap_or(&0)
    }

    fn invalidate_user_lifecycle(&self, user_id: &str) {
        let mut generations = self
            .lifecycle_generations_by_user
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let generation = generations.entry(user_id.to_string()).or_insert(0);
        *generation = generation.wrapping_add(1);
    }
}

/// E2E uses this until its deterministic Drive API fake arrives in Tasks 8–9.
/// It guarantees no accidental network metadata calls during setup.
pub(crate) struct UnavailableDriveMetadataClient;

#[async_trait]
impl DriveMetadataClient for UnavailableDriveMetadataClient {
    async fn fetch_owner_simfile(
        &self,
        _auth: &AuthState,
        _simfile_id: &str,
    ) -> std::result::Result<OwnerDriveSimfile, DriveMetadataError> {
        Err(DriveMetadataError::ServiceUnavailable)
    }

    async fn update_drive_file(
        &self,
        _auth: &AuthState,
        _simfile_id: &str,
        _drive_file_id: &str,
        _download_url: &str,
    ) -> std::result::Result<OwnerDriveSimfile, DriveMetadataError> {
        Err(DriveMetadataError::ServiceUnavailable)
    }
}

#[cfg(test)]
#[path = "../tests/google_drive_state_tests.rs"]
mod tests;
