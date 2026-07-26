use crate::auth::AuthState;
use crate::error::Result;
use async_trait::async_trait;

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

#[derive(Debug, Default)]
pub(crate) struct ApiDriveMetadataClient;

#[async_trait]
impl DriveMetadataClient for ApiDriveMetadataClient {
    async fn fetch_owner_simfile(
        &self,
        auth: &AuthState,
        simfile_id: &str,
    ) -> Result<OwnerDriveSimfile> {
        crate::api::fetch_owner_drive_simfile(auth, simfile_id).await
    }

    async fn update_drive_file(
        &self,
        auth: &AuthState,
        simfile_id: &str,
        drive_file_id: &str,
        download_url: &str,
    ) -> Result<OwnerDriveSimfile> {
        crate::api::update_drive_file(auth, simfile_id, drive_file_id, download_url).await
    }
}

pub(crate) mod build_config;
