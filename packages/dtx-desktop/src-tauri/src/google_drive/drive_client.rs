use std::collections::HashSet;
use std::time::{Duration, SystemTime};

use async_trait::async_trait;
use reqwest::{Client, StatusCode, Url};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use super::oauth::{AuthorizedDriveRequestError, GoogleDriveOAuthError, PickerFolderValidator};
use super::settings::GoogleDriveFolderSetting;

const GOOGLE_DRIVE_API_BASE_URL: &str = "https://www.googleapis.com/drive/v3";
const FOLDER_MIME_TYPE: &str = "application/vnd.google-apps.folder";
const FOLDER_FIELDS: &str = "id,name,mimeType,trashed,capabilities(canAddChildren)";
const EXISTING_FILE_FIELDS: &str = "id,trashed";
const UPDATE_FILE_FIELDS: &str = "id,name,mimeType,trashed,capabilities(canEdit)";
const FINAL_FILE_FIELDS: &str = "id,name,mimeType,webContentLink,capabilities(canDownload)";
const PERMISSION_FIELDS: &str = "permissions(id,type,role,view,allowFileDiscovery),nextPageToken";
const MAX_PERMISSION_PAGES: usize = 100;
const MAX_PAGE_TOKEN_BYTES: usize = 8 * 1024;
const MAX_SESSION_URI_BYTES: usize = 16 * 1024;
const ZIP_MIME_TYPE: &str = "application/zip";

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

impl From<GoogleDriveValidationError> for DriveApiError {
    fn from(error: GoogleDriveValidationError) -> Self {
        match error {
            GoogleDriveValidationError::TokenExpired => Self::TokenExpired,
            GoogleDriveValidationError::Network => Self::Network,
            GoogleDriveValidationError::FileNotFound => Self::NotFound,
            GoogleDriveValidationError::FolderUnavailable => Self::FolderUnavailable,
            GoogleDriveValidationError::DownloadNotPublic => Self::DownloadNotPublic,
            GoogleDriveValidationError::SharingCheckUnavailable => Self::SharingCheckUnavailable,
            GoogleDriveValidationError::FilePermissionDenied => Self::PermissionDenied,
            GoogleDriveValidationError::InvalidResponse => Self::InvalidResponse,
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct GoogleDriveClient {
    client: Client,
    base_url: Url,
    upload_base_url: Url,
    allow_insecure_session_url: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DriveCreateMetadata {
    pub(crate) id: String,
    pub(crate) parent_id: String,
    pub(crate) name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DriveUpdateMetadata {
    pub(crate) name: String,
}

pub(crate) struct ResumableUploadSession(Url);

impl std::fmt::Debug for ResumableUploadSession {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_tuple("ResumableUploadSession")
            .field(&"<redacted>")
            .finish()
    }
}

impl ResumableUploadSession {
    pub(crate) fn as_str(&self) -> &str {
        self.0.as_str()
    }

    #[cfg(test)]
    pub(crate) fn for_test(value: &str) -> Result<Self, DriveApiError> {
        Self::parse(value, true)
    }

    fn parse(value: &str, allow_insecure_loopback: bool) -> Result<Self, DriveApiError> {
        let url = Url::parse(value).map_err(|_| DriveApiError::InvalidResponse)?;
        let secure = url.scheme() == "https" && url.host_str().is_some();
        let local_test = allow_insecure_loopback
            && url.scheme() == "http"
            && matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "::1"));
        if !secure && !local_test {
            return Err(DriveApiError::InvalidResponse);
        }
        Ok(Self(url))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum DriveApiError {
    TokenExpired,
    Network,
    InvalidResponse,
    FolderUnavailable,
    DownloadNotPublic,
    SharingCheckUnavailable,
    RateLimited(Option<Duration>),
    QuotaExceeded,
    NotFound,
    PermissionDenied,
    SessionExpired,
    Transient(Option<Duration>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum DriveChunkResult {
    Accepted(u64),
    Complete,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DriveFile {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) mime_type: String,
    pub(crate) trashed: bool,
    pub(crate) can_edit: bool,
    pub(crate) can_download: bool,
    pub(crate) web_content_link: Option<String>,
}

#[async_trait]
pub(crate) trait GoogleDriveApi: Send + Sync {
    async fn generate_id(&self, access_token: &str) -> Result<String, DriveApiError>;

    async fn get_file(&self, access_token: &str, file_id: &str)
        -> Result<DriveFile, DriveApiError>;

    async fn get_file_for_update(
        &self,
        access_token: &str,
        file_id: &str,
    ) -> Result<DriveFile, DriveApiError> {
        self.get_file(access_token, file_id).await
    }

    async fn validate_folder(
        &self,
        access_token: &str,
        folder_id: &str,
    ) -> Result<ValidatedFolder, DriveApiError>;

    async fn validate_public_permission(
        &self,
        access_token: &str,
        item_id: &str,
    ) -> Result<PublicPermissionStatus, DriveApiError>;

    async fn start_resumable_create(
        &self,
        access_token: &str,
        metadata: &DriveCreateMetadata,
        total_bytes: u64,
    ) -> Result<ResumableUploadSession, DriveApiError>;

    async fn start_resumable_update(
        &self,
        access_token: &str,
        file_id: &str,
        metadata: &DriveUpdateMetadata,
        total_bytes: u64,
    ) -> Result<ResumableUploadSession, DriveApiError>;

    async fn upload_chunk(
        &self,
        access_token: &str,
        session: &ResumableUploadSession,
        start: u64,
        bytes: &[u8],
        total_bytes: u64,
    ) -> Result<DriveChunkResult, DriveApiError>;

    async fn query_session_status(
        &self,
        access_token: &str,
        session: &ResumableUploadSession,
        total_bytes: u64,
    ) -> Result<DriveChunkResult, DriveApiError>;

    async fn delete_file(&self, access_token: &str, file_id: &str) -> Result<(), DriveApiError>;
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DriveCreateRequest<'a> {
    id: &'a str,
    name: &'a str,
    mime_type: &'static str,
    parents: [&'a str; 1],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DriveUpdateRequest<'a> {
    name: &'a str,
    mime_type: &'static str,
}

#[derive(Deserialize)]
struct GeneratedIdsResponse {
    ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveFileResponse {
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    mime_type: String,
    #[serde(default)]
    trashed: bool,
    #[serde(default)]
    capabilities: DriveFileCapabilities,
    #[serde(default)]
    web_content_link: Option<String>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveFileCapabilities {
    #[serde(default)]
    can_edit: bool,
    #[serde(default)]
    can_download: bool,
}

impl From<DriveFileResponse> for DriveFile {
    fn from(value: DriveFileResponse) -> Self {
        Self {
            id: value.id,
            name: value.name,
            mime_type: value.mime_type,
            trashed: value.trashed,
            can_edit: value.capabilities.can_edit,
            can_download: value.capabilities.can_download,
            web_content_link: value.web_content_link,
        }
    }
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
        let allow_insecure_session_url = base_url.scheme() == "http"
            && matches!(base_url.host_str(), Some("127.0.0.1" | "localhost" | "::1"));
        let mut upload_base_url = base_url.clone();
        let api_path = base_url.path().trim_end_matches('/');
        let upload_path = api_path
            .strip_suffix("/drive/v3")
            .map(|prefix| format!("{prefix}/upload/drive/v3/"))
            .ok_or(GoogleDriveValidationError::InvalidResponse)?;
        upload_base_url.set_path(&upload_path);
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|_| GoogleDriveValidationError::Network)?;
        Ok(Self {
            client,
            base_url,
            upload_base_url,
            allow_insecure_session_url,
        })
    }

    pub(crate) async fn generate_id(
        &self,
        access_token: &str,
    ) -> Result<String, GoogleDriveValidationError> {
        let url = self.url_with_segments(&["files", "generateIds"])?;
        let response = self
            .client
            .get(url)
            .bearer_auth(access_token)
            .query(&[("count", "1"), ("space", "drive"), ("type", "files")])
            .send()
            .await
            .map_err(|_| GoogleDriveValidationError::Network)?;
        let generated: GeneratedIdsResponse =
            decode_item_response(response, ItemKind::ExistingFile).await?;
        usable_generated_id(generated.ids)
    }

    pub(crate) async fn start_resumable_create(
        &self,
        access_token: &str,
        metadata: &DriveCreateMetadata,
        total_bytes: u64,
    ) -> Result<ResumableUploadSession, GoogleDriveValidationError> {
        if [
            metadata.id.as_str(),
            metadata.parent_id.as_str(),
            metadata.name.as_str(),
        ]
        .iter()
        .any(|value| value.trim().is_empty())
        {
            return Err(GoogleDriveValidationError::InvalidResponse);
        }
        let url = self.upload_url_with_segments(&["files"])?;
        let response = self
            .client
            .post(url)
            .bearer_auth(access_token)
            .query(&[("uploadType", "resumable"), ("supportsAllDrives", "true")])
            .header("X-Upload-Content-Type", ZIP_MIME_TYPE)
            .header("X-Upload-Content-Length", total_bytes)
            .json(&DriveCreateRequest {
                id: &metadata.id,
                name: &metadata.name,
                mime_type: ZIP_MIME_TYPE,
                parents: [&metadata.parent_id],
            })
            .send()
            .await
            .map_err(|_| GoogleDriveValidationError::Network)?;
        decode_resumable_session(response, self.allow_insecure_session_url).await
    }

    pub(crate) async fn start_resumable_update(
        &self,
        access_token: &str,
        file_id: &str,
        metadata: &DriveUpdateMetadata,
        total_bytes: u64,
    ) -> Result<ResumableUploadSession, GoogleDriveValidationError> {
        if file_id.trim().is_empty() || metadata.name.trim().is_empty() {
            return Err(GoogleDriveValidationError::InvalidResponse);
        }
        let url = self.upload_url_with_segments(&["files", file_id])?;
        let response = self
            .client
            .patch(url)
            .bearer_auth(access_token)
            .query(&[("uploadType", "resumable"), ("supportsAllDrives", "true")])
            .header("X-Upload-Content-Type", ZIP_MIME_TYPE)
            .header("X-Upload-Content-Length", total_bytes)
            .json(&DriveUpdateRequest {
                name: &metadata.name,
                mime_type: ZIP_MIME_TYPE,
            })
            .send()
            .await
            .map_err(|_| GoogleDriveValidationError::Network)?;
        decode_resumable_session(response, self.allow_insecure_session_url).await
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

    async fn get_drive_file_with_fields(
        &self,
        access_token: &str,
        file_id: &str,
        fields: &str,
    ) -> Result<DriveFile, DriveApiError> {
        let url = self.item_url(file_id).map_err(DriveApiError::from)?;
        let response = self
            .client
            .get(url)
            .bearer_auth(access_token)
            .query(&[("supportsAllDrives", "true"), ("fields", fields)])
            .send()
            .await
            .map_err(|_| DriveApiError::Network)?;
        decode_drive_file_response(response).await
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
            let next_page_token = match page.next_page_token {
                None => return Ok(PublicPermissionStatus::NotPublic),
                Some(token) if token.trim().is_empty() || token.len() > MAX_PAGE_TOKEN_BYTES => {
                    return Ok(PublicPermissionStatus::CheckUnavailable);
                }
                Some(token) => token,
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

    fn upload_url_with_segments(
        &self,
        segments: &[&str],
    ) -> Result<Url, GoogleDriveValidationError> {
        url_with_segments(&self.upload_base_url, segments)
    }

    fn url_with_segments(&self, segments: &[&str]) -> Result<Url, GoogleDriveValidationError> {
        url_with_segments(&self.base_url, segments)
    }
}

#[async_trait]
impl GoogleDriveApi for GoogleDriveClient {
    async fn generate_id(&self, access_token: &str) -> Result<String, DriveApiError> {
        let url = self
            .url_with_segments(&["files", "generateIds"])
            .map_err(DriveApiError::from)?;
        let response = self
            .client
            .get(url)
            .bearer_auth(access_token)
            .query(&[("count", "1"), ("space", "drive"), ("type", "files")])
            .send()
            .await
            .map_err(|_| DriveApiError::Network)?;
        if !response.status().is_success() {
            return Err(classify_drive_response(response, false).await);
        }
        let generated = response
            .json::<GeneratedIdsResponse>()
            .await
            .map_err(|_| DriveApiError::InvalidResponse)?;
        usable_generated_id(generated.ids).map_err(DriveApiError::from)
    }

    async fn get_file(
        &self,
        access_token: &str,
        file_id: &str,
    ) -> Result<DriveFile, DriveApiError> {
        self.get_drive_file_with_fields(access_token, file_id, FINAL_FILE_FIELDS)
            .await
    }

    async fn get_file_for_update(
        &self,
        access_token: &str,
        file_id: &str,
    ) -> Result<DriveFile, DriveApiError> {
        self.get_drive_file_with_fields(access_token, file_id, UPDATE_FILE_FIELDS)
            .await
    }

    async fn validate_folder(
        &self,
        access_token: &str,
        folder_id: &str,
    ) -> Result<ValidatedFolder, DriveApiError> {
        GoogleDriveClient::validate_folder(self, access_token, folder_id)
            .await
            .map_err(DriveApiError::from)
    }

    async fn validate_public_permission(
        &self,
        access_token: &str,
        item_id: &str,
    ) -> Result<PublicPermissionStatus, DriveApiError> {
        self.public_permission_status(access_token, item_id, ItemKind::ExistingFile)
            .await
            .map_err(DriveApiError::from)
    }

    async fn start_resumable_create(
        &self,
        access_token: &str,
        metadata: &DriveCreateMetadata,
        total_bytes: u64,
    ) -> Result<ResumableUploadSession, DriveApiError> {
        if [
            metadata.id.as_str(),
            metadata.parent_id.as_str(),
            metadata.name.as_str(),
        ]
        .iter()
        .any(|value| value.trim().is_empty())
        {
            return Err(DriveApiError::InvalidResponse);
        }
        let url = self
            .upload_url_with_segments(&["files"])
            .map_err(DriveApiError::from)?;
        let response = self
            .client
            .post(url)
            .bearer_auth(access_token)
            .query(&[("uploadType", "resumable"), ("supportsAllDrives", "true")])
            .header("X-Upload-Content-Type", ZIP_MIME_TYPE)
            .header("X-Upload-Content-Length", total_bytes)
            .json(&DriveCreateRequest {
                id: &metadata.id,
                name: &metadata.name,
                mime_type: ZIP_MIME_TYPE,
                parents: [&metadata.parent_id],
            })
            .send()
            .await
            .map_err(|_| DriveApiError::Network)?;
        decode_resumable_session_api(response, self.allow_insecure_session_url).await
    }

    async fn start_resumable_update(
        &self,
        access_token: &str,
        file_id: &str,
        metadata: &DriveUpdateMetadata,
        total_bytes: u64,
    ) -> Result<ResumableUploadSession, DriveApiError> {
        if file_id.trim().is_empty() || metadata.name.trim().is_empty() {
            return Err(DriveApiError::InvalidResponse);
        }
        let url = self
            .upload_url_with_segments(&["files", file_id])
            .map_err(DriveApiError::from)?;
        let response = self
            .client
            .patch(url)
            .bearer_auth(access_token)
            .query(&[("uploadType", "resumable"), ("supportsAllDrives", "true")])
            .header("X-Upload-Content-Type", ZIP_MIME_TYPE)
            .header("X-Upload-Content-Length", total_bytes)
            .json(&DriveUpdateRequest {
                name: &metadata.name,
                mime_type: ZIP_MIME_TYPE,
            })
            .send()
            .await
            .map_err(|_| DriveApiError::Network)?;
        decode_resumable_session_api(response, self.allow_insecure_session_url).await
    }

    async fn upload_chunk(
        &self,
        access_token: &str,
        session: &ResumableUploadSession,
        start: u64,
        bytes: &[u8],
        total_bytes: u64,
    ) -> Result<DriveChunkResult, DriveApiError> {
        if bytes.is_empty()
            || start >= total_bytes
            || start.saturating_add(bytes.len() as u64) > total_bytes
        {
            return Err(DriveApiError::InvalidResponse);
        }
        let end = start + bytes.len() as u64 - 1;
        let response = self
            .client
            .put(session.0.clone())
            .bearer_auth(access_token)
            .header(reqwest::header::CONTENT_LENGTH, bytes.len())
            .header(
                reqwest::header::CONTENT_RANGE,
                format!("bytes {start}-{end}/{total_bytes}"),
            )
            .body(bytes.to_vec())
            .send()
            .await
            .map_err(|_| DriveApiError::Network)?;
        decode_chunk_response(response, total_bytes, false).await
    }

    async fn query_session_status(
        &self,
        access_token: &str,
        session: &ResumableUploadSession,
        total_bytes: u64,
    ) -> Result<DriveChunkResult, DriveApiError> {
        let response = self
            .client
            .put(session.0.clone())
            .bearer_auth(access_token)
            .header(reqwest::header::CONTENT_LENGTH, 0)
            .header(
                reqwest::header::CONTENT_RANGE,
                format!("bytes */{total_bytes}"),
            )
            .body(Vec::<u8>::new())
            .send()
            .await
            .map_err(|_| DriveApiError::Network)?;
        decode_chunk_response(response, total_bytes, true).await
    }

    async fn delete_file(&self, access_token: &str, file_id: &str) -> Result<(), DriveApiError> {
        let url = self.item_url(file_id).map_err(DriveApiError::from)?;
        let response = self
            .client
            .delete(url)
            .bearer_auth(access_token)
            .query(&[("supportsAllDrives", "true")])
            .send()
            .await
            .map_err(|_| DriveApiError::Network)?;
        if response.status().is_success() {
            return Ok(());
        }
        Err(classify_drive_response(response, false).await)
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
            && self.view.is_none()
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

fn url_with_segments(base_url: &Url, segments: &[&str]) -> Result<Url, GoogleDriveValidationError> {
    if segments.iter().any(|segment| segment.trim().is_empty()) {
        return Err(GoogleDriveValidationError::InvalidResponse);
    }
    let mut url = base_url.clone();
    url.path_segments_mut()
        .map_err(|_| GoogleDriveValidationError::InvalidResponse)?
        .pop_if_empty()
        .extend(segments);
    Ok(url)
}

async fn decode_resumable_session(
    response: reqwest::Response,
    allow_insecure_loopback: bool,
) -> Result<ResumableUploadSession, GoogleDriveValidationError> {
    match response.status() {
        status if status.is_success() => {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .filter(|value| !value.trim().is_empty() && value.len() <= MAX_SESSION_URI_BYTES)
                .ok_or(GoogleDriveValidationError::InvalidResponse)?;
            ResumableUploadSession::parse(location, allow_insecure_loopback)
                .map_err(|_| GoogleDriveValidationError::InvalidResponse)
        }
        StatusCode::UNAUTHORIZED => Err(GoogleDriveValidationError::TokenExpired),
        StatusCode::FORBIDDEN => Err(GoogleDriveValidationError::FilePermissionDenied),
        StatusCode::NOT_FOUND => Err(GoogleDriveValidationError::FileNotFound),
        _ => Err(GoogleDriveValidationError::InvalidResponse),
    }
}

fn usable_generated_id(ids: Vec<String>) -> Result<String, GoogleDriveValidationError> {
    if ids.len() != 1 {
        return Err(GoogleDriveValidationError::InvalidResponse);
    }
    let id = ids
        .into_iter()
        .next()
        .ok_or(GoogleDriveValidationError::InvalidResponse)?;
    let trimmed = id.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_PAGE_TOKEN_BYTES {
        return Err(GoogleDriveValidationError::InvalidResponse);
    }
    Ok(trimmed.to_string())
}

async fn decode_resumable_session_api(
    response: reqwest::Response,
    allow_insecure_loopback: bool,
) -> Result<ResumableUploadSession, DriveApiError> {
    if !response.status().is_success() {
        return Err(classify_drive_response(response, false).await);
    }
    let location = response
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty() && value.len() <= MAX_SESSION_URI_BYTES)
        .ok_or(DriveApiError::InvalidResponse)?;
    ResumableUploadSession::parse(location, allow_insecure_loopback)
}

async fn decode_drive_file_response(
    response: reqwest::Response,
) -> Result<DriveFile, DriveApiError> {
    if !response.status().is_success() {
        return Err(classify_drive_response(response, false).await);
    }
    response
        .json::<DriveFileResponse>()
        .await
        .map(DriveFile::from)
        .map_err(|_| DriveApiError::InvalidResponse)
}

async fn decode_chunk_response(
    response: reqwest::Response,
    total_bytes: u64,
    status_probe: bool,
) -> Result<DriveChunkResult, DriveApiError> {
    match response.status().as_u16() {
        200 | 201 => Ok(DriveChunkResult::Complete),
        308 => {
            let confirmed = response
                .headers()
                .get(reqwest::header::RANGE)
                .map(parse_confirmed_range)
                .transpose()?
                .unwrap_or(0);
            if confirmed > total_bytes {
                return Err(DriveApiError::InvalidResponse);
            }
            Ok(DriveChunkResult::Accepted(confirmed))
        }
        404 if status_probe => Err(DriveApiError::SessionExpired),
        _ => Err(classify_drive_response(response, false).await),
    }
}

fn parse_confirmed_range(value: &reqwest::header::HeaderValue) -> Result<u64, DriveApiError> {
    let value = value.to_str().map_err(|_| DriveApiError::InvalidResponse)?;
    let range = value
        .strip_prefix("bytes=0-")
        .ok_or(DriveApiError::InvalidResponse)?;
    let end = range
        .parse::<u64>()
        .map_err(|_| DriveApiError::InvalidResponse)?;
    end.checked_add(1).ok_or(DriveApiError::InvalidResponse)
}

#[derive(Default, Deserialize)]
struct GoogleErrorEnvelope {
    #[serde(default)]
    error: GoogleErrorBody,
}

#[derive(Default, Deserialize)]
struct GoogleErrorBody {
    #[serde(default)]
    errors: Vec<GoogleErrorDetail>,
}

#[derive(Deserialize)]
struct GoogleErrorDetail {
    #[serde(default)]
    reason: String,
}

async fn classify_drive_response(
    response: reqwest::Response,
    session_not_found: bool,
) -> DriveApiError {
    let status = response.status();
    let retry_after = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| parse_retry_after_at(value, SystemTime::now()));
    if status == StatusCode::UNAUTHORIZED {
        return DriveApiError::TokenExpired;
    }
    if status == StatusCode::NOT_FOUND {
        return if session_not_found {
            DriveApiError::SessionExpired
        } else {
            DriveApiError::NotFound
        };
    }
    if status == StatusCode::TOO_MANY_REQUESTS {
        return DriveApiError::RateLimited(retry_after);
    }
    if status.is_server_error() {
        return DriveApiError::Transient(retry_after);
    }

    let reasons = response
        .json::<GoogleErrorEnvelope>()
        .await
        .map(|body| body.error.errors)
        .unwrap_or_default();
    if reasons.iter().any(|detail| {
        matches!(
            detail.reason.as_str(),
            "rateLimitExceeded" | "userRateLimitExceeded"
        )
    }) {
        return DriveApiError::RateLimited(retry_after);
    }
    if reasons.iter().any(|detail| {
        matches!(
            detail.reason.as_str(),
            "storageQuotaExceeded"
                | "dailyLimitExceeded"
                | "activeItemCreationLimitExceeded"
                | "teamDriveFileLimitExceeded"
                | "teamDriveHierarchyTooDeep"
                | "quotaExceeded"
        )
    }) {
        return DriveApiError::QuotaExceeded;
    }
    if status == StatusCode::FORBIDDEN {
        return DriveApiError::PermissionDenied;
    }
    DriveApiError::InvalidResponse
}

pub(crate) fn parse_retry_after_at(value: &str, now: SystemTime) -> Option<Duration> {
    let trimmed = value.trim();
    if let Ok(seconds) = trimmed.parse::<u64>() {
        return Some(Duration::from_secs(seconds));
    }
    let date = httpdate::parse_http_date(trimmed).ok()?;
    date.duration_since(now).ok()
}

#[cfg(test)]
#[path = "../tests/google_drive_client_tests.rs"]
mod tests;
