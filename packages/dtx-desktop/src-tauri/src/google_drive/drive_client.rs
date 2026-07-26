use std::collections::HashSet;
use std::time::Duration;

use async_trait::async_trait;
use reqwest::{Client, StatusCode, Url};
use serde::de::DeserializeOwned;
use serde::Deserialize;

use super::oauth::{AuthorizedDriveRequestError, GoogleDriveOAuthError, PickerFolderValidator};
use super::settings::GoogleDriveFolderSetting;

const GOOGLE_DRIVE_API_BASE_URL: &str = "https://www.googleapis.com/drive/v3";
const FOLDER_MIME_TYPE: &str = "application/vnd.google-apps.folder";
const FOLDER_FIELDS: &str = "id,name,mimeType,trashed,capabilities(canAddChildren)";
const EXISTING_FILE_FIELDS: &str = "id,trashed";
const PERMISSION_FIELDS: &str = "permissions(id,type,role,view,allowFileDiscovery),nextPageToken";
const MAX_PERMISSION_PAGES: usize = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PublicPermissionStatus {
    Public,
    NotPublic,
    CheckUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ValidatedFolder {
    pub(crate) id: String,
    pub(crate) name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GoogleDriveValidationError {
    FolderUnavailable,
    DownloadNotPublic,
    SharingCheckUnavailable,
    FileNotFound,
    FilePermissionDenied,
    TokenExpired,
    Network,
    InvalidResponse,
}

impl GoogleDriveValidationError {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::FolderUnavailable => "FOLDER_UNAVAILABLE",
            Self::DownloadNotPublic => "DOWNLOAD_NOT_PUBLIC",
            Self::SharingCheckUnavailable => "SHARING_CHECK_UNAVAILABLE",
            Self::FileNotFound => "FILE_NOT_FOUND",
            Self::FilePermissionDenied => "FILE_PERMISSION_DENIED",
            Self::TokenExpired => "RECONNECT_REQUIRED",
            Self::Network => "NETWORK",
            Self::InvalidResponse => "INVALID_RESPONSE",
        }
    }
}

impl From<GoogleDriveValidationError> for GoogleDriveOAuthError {
    fn from(error: GoogleDriveValidationError) -> Self {
        match error {
            GoogleDriveValidationError::FolderUnavailable => Self::FolderUnavailable,
            GoogleDriveValidationError::DownloadNotPublic => Self::DownloadNotPublic,
            GoogleDriveValidationError::SharingCheckUnavailable => Self::SharingCheckUnavailable,
            GoogleDriveValidationError::FileNotFound => Self::FileNotFound,
            GoogleDriveValidationError::FilePermissionDenied => Self::FilePermissionDenied,
            GoogleDriveValidationError::TokenExpired => Self::ReconnectRequired,
            GoogleDriveValidationError::Network => Self::Network,
            GoogleDriveValidationError::InvalidResponse => Self::InvalidResponse,
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct GoogleDriveClient {
    client: Client,
    base_url: Url,
}

impl GoogleDriveClient {
    pub(crate) fn production() -> Result<Self, GoogleDriveValidationError> {
        Self::with_base_url(GOOGLE_DRIVE_API_BASE_URL)
    }

    pub(crate) fn with_base_url(
        base_url: impl AsRef<str>,
    ) -> Result<Self, GoogleDriveValidationError> {
        let mut base_url = Url::parse(base_url.as_ref())
            .map_err(|_| GoogleDriveValidationError::InvalidResponse)?;
        if !matches!(base_url.scheme(), "http" | "https") {
            return Err(GoogleDriveValidationError::InvalidResponse);
        }
        if !base_url.path().ends_with('/') {
            let path = format!("{}/", base_url.path());
            base_url.set_path(&path);
        }
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|_| GoogleDriveValidationError::Network)?;
        Ok(Self { client, base_url })
    }

    pub(crate) async fn validate_folder(
        &self,
        access_token: &str,
        folder_id: &str,
    ) -> Result<ValidatedFolder, GoogleDriveValidationError> {
        let item: DriveFolderItem = self
            .get_item(access_token, folder_id, FOLDER_FIELDS, ItemKind::Folder)
            .await?;
        if item.id != folder_id
            || item.name.trim().is_empty()
            || item.mime_type != FOLDER_MIME_TYPE
            || item.trashed != Some(false)
            || !item
                .capabilities
                .is_some_and(|capabilities| capabilities.can_add_children)
        {
            return Err(GoogleDriveValidationError::FolderUnavailable);
        }

        match self
            .public_permission_status(access_token, folder_id, ItemKind::Folder)
            .await?
        {
            PublicPermissionStatus::Public => Ok(ValidatedFolder {
                id: item.id,
                name: item.name,
            }),
            PublicPermissionStatus::NotPublic => Err(GoogleDriveValidationError::DownloadNotPublic),
            PublicPermissionStatus::CheckUnavailable => {
                Err(GoogleDriveValidationError::SharingCheckUnavailable)
            }
        }
    }

    pub(crate) async fn validate_folder_before_create(
        &self,
        access_token: &str,
        folder_id: &str,
    ) -> Result<ValidatedFolder, GoogleDriveValidationError> {
        self.validate_folder(access_token, folder_id).await
    }

    pub(crate) async fn validate_file_before_update(
        &self,
        access_token: &str,
        file_id: &str,
    ) -> Result<(), GoogleDriveValidationError> {
        let item: ExistingDriveFile = self
            .get_item(
                access_token,
                file_id,
                EXISTING_FILE_FIELDS,
                ItemKind::ExistingFile,
            )
            .await?;
        if item.id != file_id {
            return Err(GoogleDriveValidationError::InvalidResponse);
        }
        match item.trashed {
            Some(false) => {}
            Some(true) => return Err(GoogleDriveValidationError::FileNotFound),
            None => return Err(GoogleDriveValidationError::InvalidResponse),
        }

        match self
            .public_permission_status(access_token, file_id, ItemKind::ExistingFile)
            .await?
        {
            PublicPermissionStatus::Public => Ok(()),
            PublicPermissionStatus::NotPublic => Err(GoogleDriveValidationError::DownloadNotPublic),
            PublicPermissionStatus::CheckUnavailable => {
                Err(GoogleDriveValidationError::SharingCheckUnavailable)
            }
        }
    }

    async fn get_item<T: DeserializeOwned>(
        &self,
        access_token: &str,
        item_id: &str,
        fields: &str,
        kind: ItemKind,
    ) -> Result<T, GoogleDriveValidationError> {
        let url = self.item_url(item_id)?;
        let response = self
            .client
            .get(url)
            .bearer_auth(access_token)
            .query(&[("supportsAllDrives", "true"), ("fields", fields)])
            .send()
            .await
            .map_err(|_| GoogleDriveValidationError::Network)?;
        decode_item_response(response, kind).await
    }

    async fn public_permission_status(
        &self,
        access_token: &str,
        item_id: &str,
        kind: ItemKind,
    ) -> Result<PublicPermissionStatus, GoogleDriveValidationError> {
        let mut page_token: Option<String> = None;
        let mut seen_tokens = HashSet::new();
        for _ in 0..MAX_PERMISSION_PAGES {
            let url = self.permissions_url(item_id)?;
            let mut request = self
                .client
                .get(url)
                .bearer_auth(access_token)
                .query(&[("supportsAllDrives", "true"), ("fields", PERMISSION_FIELDS)]);
            if let Some(token) = page_token.as_deref() {
                request = request.query(&[("pageToken", token)]);
            }
            let response = request
                .send()
                .await
                .map_err(|_| GoogleDriveValidationError::Network)?;
            if response.status() == StatusCode::FORBIDDEN {
                return Ok(PublicPermissionStatus::CheckUnavailable);
            }
            let page: PermissionPage = decode_item_response(response, kind).await?;
            if page.permissions.iter().any(Permission::is_public) {
                return Ok(PublicPermissionStatus::Public);
            }
            let Some(next_page_token) = page
                .next_page_token
                .map(|token| token.trim().to_string())
                .filter(|token| !token.is_empty())
            else {
                return Ok(PublicPermissionStatus::NotPublic);
            };
            if !seen_tokens.insert(next_page_token.clone()) {
                return Err(GoogleDriveValidationError::InvalidResponse);
            }
            page_token = Some(next_page_token);
        }
        Err(GoogleDriveValidationError::InvalidResponse)
    }

    fn item_url(&self, item_id: &str) -> Result<Url, GoogleDriveValidationError> {
        self.url_with_segments(&["files", item_id])
    }

    fn permissions_url(&self, item_id: &str) -> Result<Url, GoogleDriveValidationError> {
        self.url_with_segments(&["files", item_id, "permissions"])
    }

    fn url_with_segments(&self, segments: &[&str]) -> Result<Url, GoogleDriveValidationError> {
        if segments.iter().any(|segment| segment.trim().is_empty()) {
            return Err(GoogleDriveValidationError::InvalidResponse);
        }
        let mut url = self.base_url.clone();
        url.path_segments_mut()
            .map_err(|_| GoogleDriveValidationError::InvalidResponse)?
            .pop_if_empty()
            .extend(segments);
        Ok(url)
    }
}

#[async_trait]
impl PickerFolderValidator for GoogleDriveClient {
    async fn validate_folder(
        &self,
        access_token: &str,
        folder_id: &str,
    ) -> Result<GoogleDriveFolderSetting, GoogleDriveOAuthError> {
        let folder = GoogleDriveClient::validate_folder(self, access_token, folder_id)
            .await
            .map_err(GoogleDriveOAuthError::from)?;
        Ok(GoogleDriveFolderSetting {
            id: folder.id,
            name: folder.name,
        })
    }

    async fn execute_validation(
        &self,
        access_token: &str,
        folder_id: &str,
    ) -> Result<GoogleDriveFolderSetting, AuthorizedDriveRequestError> {
        match GoogleDriveClient::validate_folder(self, access_token, folder_id).await {
            Ok(folder) => Ok(GoogleDriveFolderSetting {
                id: folder.id,
                name: folder.name,
            }),
            Err(GoogleDriveValidationError::TokenExpired) => {
                Err(AuthorizedDriveRequestError::TokenExpired)
            }
            Err(error) => Err(AuthorizedDriveRequestError::Request(error.into())),
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum ItemKind {
    Folder,
    ExistingFile,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveFolderItem {
    id: String,
    name: String,
    mime_type: String,
    trashed: Option<bool>,
    capabilities: Option<FolderCapabilities>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FolderCapabilities {
    #[serde(default)]
    can_add_children: bool,
}

#[derive(Deserialize)]
struct ExistingDriveFile {
    id: String,
    trashed: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PermissionPage {
    #[serde(default)]
    permissions: Vec<Permission>,
    #[serde(default)]
    next_page_token: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Permission {
    id: String,
    #[serde(rename = "type")]
    permission_type: String,
    role: String,
    #[serde(default)]
    view: Option<String>,
    #[serde(default)]
    allow_file_discovery: Option<bool>,
}

impl Permission {
    fn is_public(&self) -> bool {
        let _complete_response_fields = (&self.id, self.allow_file_discovery);
        self.permission_type == "anyone"
            && self
                .view
                .as_deref()
                .map_or(true, |view| view.trim().is_empty())
            && matches!(self.role.as_str(), "reader" | "commenter" | "writer")
    }
}

async fn decode_item_response<T: DeserializeOwned>(
    response: reqwest::Response,
    kind: ItemKind,
) -> Result<T, GoogleDriveValidationError> {
    match response.status() {
        status if status.is_success() => response
            .json::<T>()
            .await
            .map_err(|_| GoogleDriveValidationError::InvalidResponse),
        StatusCode::UNAUTHORIZED => Err(GoogleDriveValidationError::TokenExpired),
        StatusCode::NOT_FOUND => Err(match kind {
            ItemKind::Folder => GoogleDriveValidationError::FolderUnavailable,
            ItemKind::ExistingFile => GoogleDriveValidationError::FileNotFound,
        }),
        StatusCode::FORBIDDEN => Err(match kind {
            ItemKind::Folder => GoogleDriveValidationError::FolderUnavailable,
            ItemKind::ExistingFile => GoogleDriveValidationError::FilePermissionDenied,
        }),
        _ => Err(GoogleDriveValidationError::InvalidResponse),
    }
}

#[cfg(test)]
#[path = "../tests/google_drive_client_tests.rs"]
mod tests;
