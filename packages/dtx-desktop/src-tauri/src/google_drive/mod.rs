use std::collections::HashMap;
use std::sync::Arc;

use crate::auth::AuthState;
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
use self::settings::GoogleDriveSettingsStore;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OwnerDriveSimfile {
    pub id: String,
    pub title: String,
    pub google_drive_file_id: Option<String>,
    pub download_url: Option<String>,
}

#[async_trait]
pub(crate) trait DriveMetadataClient: Send + Sync {
    async fn fetch_owner_simfile(
        &self,
        auth: &AuthState,
        simfile_id: &str,
    ) -> Result<OwnerDriveSimfile>;

    async fn update_drive_file(
        &self,
        auth: &AuthState,
        simfile_id: &str,
        drive_file_id: &str,
        download_url: &str,
    ) -> Result<OwnerDriveSimfile>;
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
    ) -> Result<OwnerDriveSimfile> {
        crate::api::fetch_owner_drive_simfile(auth, &self.app, simfile_id).await
    }

    async fn update_drive_file(
        &self,
        auth: &AuthState,
        simfile_id: &str,
        drive_file_id: &str,
        download_url: &str,
    ) -> Result<OwnerDriveSimfile> {
        crate::api::update_drive_file(auth, &self.app, simfile_id, drive_file_id, download_url)
            .await
    }
}

pub(crate) mod build_config;
pub(crate) mod credential_store;
pub(crate) mod settings;
pub(crate) mod upload;

/// Rust-owned cross-command Drive state. Every adapter enters through this
/// constructor so production can use the platform keyring while E2E supplies
/// deterministic fakes without exposing credentials to the renderer.
pub(crate) struct GoogleDriveState {
    credential_store: Arc<dyn GoogleDriveCredentialStore>,
    pub(crate) credentials: GoogleDriveCredentialAccess,
    pub(crate) metadata_client: Arc<dyn DriveMetadataClient>,
    pub(crate) settings: Arc<GoogleDriveSettingsStore>,
    access_tokens_by_user: AsyncMutex<HashMap<String, Zeroizing<String>>>,
    /// Filled by Task 8 after it validates the selected Drive folder.
    pub(crate) folder_validation_cache_by_user: AsyncMutex<HashMap<String, ()>>,
    /// Replaced with the full PKCE attempt in Task 7. Until then it is only a
    /// native ownership slot; no OAuth material is stored here.
    pub(crate) active_picker_attempt: AsyncMutex<Option<()>>,
    /// Replaced by the persistent keyed binding store in Task 10.
    pub(crate) pending_bindings_by_user: AsyncMutex<HashMap<String, ()>>,
    /// Replaced by the bounded upload operation manager in Task 11.
    pub(crate) operation_manager: AsyncMutex<()>,
}

impl GoogleDriveState {
    pub(crate) fn with_adapters(
        credential_store: Arc<dyn GoogleDriveCredentialStore>,
        metadata_client: Arc<dyn DriveMetadataClient>,
        settings: Arc<GoogleDriveSettingsStore>,
    ) -> Self {
        Self {
            credentials: GoogleDriveCredentialAccess::new(credential_store.clone()),
            credential_store,
            metadata_client,
            settings,
            access_tokens_by_user: AsyncMutex::new(HashMap::new()),
            folder_validation_cache_by_user: AsyncMutex::new(HashMap::new()),
            active_picker_attempt: AsyncMutex::new(None),
            pending_bindings_by_user: AsyncMutex::new(HashMap::new()),
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
        Ok(Self::with_adapters(
            credential_store,
            Arc::new(ApiDriveMetadataClient::new(app)),
            Arc::new(GoogleDriveSettingsStore::new(data_dir)),
        ))
    }

    #[cfg(feature = "e2e")]
    pub(crate) fn e2e() -> Result<Self> {
        let data_dir = resolve_dirs().0.ok_or_else(|| {
            DesktopError::Message("Could not resolve application data directory".to_string())
        })?;
        Ok(Self::with_adapters(
            Arc::new(InMemoryGoogleDriveCredentialStore::default()),
            Arc::new(UnavailableDriveMetadataClient),
            Arc::new(GoogleDriveSettingsStore::new(data_dir)),
        ))
    }

    pub(crate) async fn cache_access_token(&self, user_id: &str, token: &str) {
        self.access_tokens_by_user
            .lock()
            .await
            .insert(user_id.to_string(), Zeroizing::new(token.to_string()));
    }

    pub(crate) async fn cached_access_token(&self, user_id: &str) -> Option<Zeroizing<String>> {
        self.access_tokens_by_user
            .lock()
            .await
            .get(user_id)
            .map(|token| Zeroizing::new(token.to_string()))
    }

    pub(crate) async fn clear_user_memory(&self, user_id: &str) {
        self.access_tokens_by_user.lock().await.remove(user_id);
        self.folder_validation_cache_by_user
            .lock()
            .await
            .remove(user_id);
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
    ) -> Result<OwnerDriveSimfile> {
        Err(DesktopError::Message(
            "Google Drive metadata is unavailable".to_string(),
        ))
    }

    async fn update_drive_file(
        &self,
        _auth: &AuthState,
        _simfile_id: &str,
        _drive_file_id: &str,
        _download_url: &str,
    ) -> Result<OwnerDriveSimfile> {
        Err(DesktopError::Message(
            "Google Drive metadata is unavailable".to_string(),
        ))
    }
}

#[cfg(test)]
#[path = "../tests/google_drive_state_tests.rs"]
mod tests;
