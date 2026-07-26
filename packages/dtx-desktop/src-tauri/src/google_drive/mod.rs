use crate::auth::AuthState;
use crate::error::Result;
use async_trait::async_trait;
use tauri::{AppHandle, Runtime};

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
