use super::*;
use crate::google_drive::credential_store::InMemoryGoogleDriveCredentialStore;
use crate::google_drive::settings::GoogleDriveSettingsStore;
use std::sync::Arc;
use tempfile::tempdir;

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
