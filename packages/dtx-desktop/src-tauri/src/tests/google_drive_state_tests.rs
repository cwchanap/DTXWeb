use super::*;
use crate::google_drive::credential_store::InMemoryGoogleDriveCredentialStore;
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
