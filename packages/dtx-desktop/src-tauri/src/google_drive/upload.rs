use crate::error::{DesktopError, Result};
use async_trait::async_trait;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use uuid::Uuid;

use super::drive_client::{
    DriveApiError, DriveChunkResult, DriveCreateMetadata, DriveFile, DriveUpdateMetadata,
    GoogleDriveApi, PublicPermissionStatus,
};

const UPLOAD_CACHE_NAMESPACE: &str = "google-drive-uploads";
const UPLOAD_ARCHIVE_NAME: &str = "upload.zip";
const MAX_UPLOAD_RETRIES: usize = 4;
const MAX_FINAL_METADATA_ATTEMPTS: usize = 3;
const RETRY_BASE_DELAY: Duration = Duration::from_millis(100);
const MAX_RETRY_DELAY: Duration = Duration::from_secs(5);
const MAX_DOWNLOAD_URL_BYTES: usize = 8 * 1024;

pub(crate) const DRIVE_UPLOAD_CHUNK_SIZE: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum DriveUploadTarget {
    Create {
        generated_id: String,
        folder_id: String,
    },
    Update {
        file_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DriveUploadRequest {
    pub(crate) simfile_id: String,
    pub(crate) saved_title: String,
    pub(crate) archive_path: PathBuf,
    pub(crate) target: DriveUploadTarget,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DriveUploadOutcome {
    pub(crate) file_id: String,
    pub(crate) file_name: String,
    pub(crate) download_url: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PendingBindingDisposition {
    NotApplicable,
    Retain,
    DeleteConfirmed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DriveUploadFailure {
    pub(crate) error: DriveApiError,
    pub(crate) pending_binding: PendingBindingDisposition,
}

#[async_trait]
pub(crate) trait DriveSleeper: Send + Sync {
    async fn sleep(&self, duration: Duration);
}

pub(crate) struct TokioDriveSleeper;

#[async_trait]
impl DriveSleeper for TokioDriveSleeper {
    async fn sleep(&self, duration: Duration) {
        tokio::time::sleep(duration).await;
    }
}

struct DiskArchiveSource {
    file: tokio::fs::File,
    total_bytes: u64,
}

impl DiskArchiveSource {
    async fn open(path: &Path) -> std::result::Result<Self, DriveApiError> {
        let metadata = tokio::fs::symlink_metadata(path)
            .await
            .map_err(|_| DriveApiError::LocalState)?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(DriveApiError::LocalState);
        }
        let file = tokio::fs::File::open(path)
            .await
            .map_err(|_| DriveApiError::LocalState)?;
        let opened_metadata = file
            .metadata()
            .await
            .map_err(|_| DriveApiError::LocalState)?;
        if !opened_metadata.is_file() || opened_metadata.len() == 0 {
            return Err(DriveApiError::LocalState);
        }
        Ok(Self {
            file,
            total_bytes: opened_metadata.len(),
        })
    }

    fn len(&self) -> u64 {
        self.total_bytes
    }

    async fn read_chunk(
        &mut self,
        offset: u64,
        chunk_size: usize,
    ) -> std::result::Result<Vec<u8>, DriveApiError> {
        if chunk_size == 0 || offset >= self.total_bytes {
            return Err(DriveApiError::LocalState);
        }
        let remaining = self
            .total_bytes
            .checked_sub(offset)
            .ok_or(DriveApiError::LocalState)?;
        let chunk_limit = u64::try_from(chunk_size).map_err(|_| DriveApiError::LocalState)?;
        let read_len_u64 = remaining.min(chunk_limit);
        let read_len = usize::try_from(read_len_u64).map_err(|_| DriveApiError::LocalState)?;
        self.file
            .seek(std::io::SeekFrom::Start(offset))
            .await
            .map_err(|_| DriveApiError::LocalState)?;
        let mut bytes = vec![0_u8; read_len];
        self.file
            .read_exact(&mut bytes)
            .await
            .map_err(|_| DriveApiError::LocalState)?;
        Ok(bytes)
    }
}

pub(crate) async fn run_resumable_upload<A, S, F>(
    api: &A,
    sleeper: &S,
    access_token: &str,
    request: DriveUploadRequest,
    on_progress: F,
) -> std::result::Result<DriveUploadOutcome, DriveUploadFailure>
where
    A: GoogleDriveApi + ?Sized,
    S: DriveSleeper + ?Sized,
    F: FnMut(u64, u64),
{
    run_resumable_upload_with_chunk_size(
        api,
        sleeper,
        access_token,
        request,
        DRIVE_UPLOAD_CHUNK_SIZE,
        on_progress,
    )
    .await
}

#[cfg(test)]
pub(crate) async fn run_resumable_upload_for_test<A, S, F>(
    api: &A,
    sleeper: &S,
    access_token: &str,
    request: DriveUploadRequest,
    chunk_size: usize,
    on_progress: F,
) -> std::result::Result<DriveUploadOutcome, DriveUploadFailure>
where
    A: GoogleDriveApi + ?Sized,
    S: DriveSleeper + ?Sized,
    F: FnMut(u64, u64),
{
    run_resumable_upload_with_chunk_size(
        api,
        sleeper,
        access_token,
        request,
        chunk_size,
        on_progress,
    )
    .await
}

async fn run_resumable_upload_with_chunk_size<A, S, F>(
    api: &A,
    sleeper: &S,
    access_token: &str,
    request: DriveUploadRequest,
    chunk_size: usize,
    mut on_progress: F,
) -> std::result::Result<DriveUploadOutcome, DriveUploadFailure>
where
    A: GoogleDriveApi + ?Sized,
    S: DriveSleeper + ?Sized,
    F: FnMut(u64, u64),
{
    if chunk_size == 0
        || request.simfile_id.trim().is_empty()
        || request.saved_title.trim().is_empty()
    {
        return Err(upload_failure(
            DriveApiError::InvalidResponse,
            &request.target,
        ));
    }

    let mut archive = DiskArchiveSource::open(&request.archive_path)
        .await
        .map_err(|error| upload_failure(error, &request.target))?;
    let total_bytes = archive.len();
    let file_name = sanitize_drive_zip_name(&request.saved_title, &request.simfile_id);
    let (file_id, session) = match &request.target {
        DriveUploadTarget::Create {
            generated_id,
            folder_id,
        } => {
            if generated_id.trim().is_empty() || folder_id.trim().is_empty() {
                return Err(upload_failure(
                    DriveApiError::InvalidResponse,
                    &request.target,
                ));
            }
            let folder = api
                .validate_folder(access_token, folder_id)
                .await
                .map_err(|error| upload_failure(error, &request.target))?;
            if folder.id != *folder_id {
                return Err(upload_failure(
                    DriveApiError::FolderUnavailable,
                    &request.target,
                ));
            }
            let metadata = DriveCreateMetadata {
                id: generated_id.clone(),
                parent_id: folder_id.clone(),
                name: file_name.clone(),
            };
            let session =
                start_create_with_retry(api, sleeper, access_token, &metadata, total_bytes)
                    .await
                    .map_err(|error| upload_failure(error, &request.target))?;
            (generated_id.clone(), session)
        }
        DriveUploadTarget::Update { file_id } => {
            let existing = api
                .get_file_for_update(access_token, file_id)
                .await
                .map_err(|error| upload_failure(error, &request.target))?;
            if existing.id != *file_id || existing.trashed || !existing.can_edit {
                return Err(upload_failure(
                    DriveApiError::PermissionDenied,
                    &request.target,
                ));
            }
            require_public_permission(api, access_token, file_id)
                .await
                .map_err(|error| upload_failure(error, &request.target))?;
            let metadata = DriveUpdateMetadata {
                name: file_name.clone(),
            };
            let session = start_update_with_retry(
                api,
                sleeper,
                access_token,
                file_id,
                &metadata,
                total_bytes,
            )
            .await
            .map_err(|error| upload_failure(error, &request.target))?;
            (file_id.clone(), session)
        }
    };

    let upload_result = transfer_archive(
        api,
        sleeper,
        access_token,
        &session,
        &mut archive,
        chunk_size,
        &mut on_progress,
    )
    .await;
    if let Err(error) = upload_result {
        return Err(upload_failure(error, &request.target));
    }

    let final_result = validate_final_file(api, sleeper, access_token, &file_id).await;
    let download_url = match final_result {
        Ok(download_url) => download_url,
        Err(error) => {
            return Err(compensate_after_final_validation(
                api,
                access_token,
                &request.target,
                &file_id,
                error,
            )
            .await);
        }
    };

    Ok(DriveUploadOutcome {
        file_id,
        file_name,
        download_url,
    })
}

async fn start_create_with_retry<A, S>(
    api: &A,
    sleeper: &S,
    access_token: &str,
    metadata: &DriveCreateMetadata,
    total_bytes: u64,
) -> std::result::Result<super::drive_client::ResumableUploadSession, DriveApiError>
where
    A: GoogleDriveApi + ?Sized,
    S: DriveSleeper + ?Sized,
{
    for attempt in 0..=MAX_UPLOAD_RETRIES {
        match api
            .start_resumable_create(access_token, metadata, total_bytes)
            .await
        {
            Ok(session) => return Ok(session),
            Err(DriveApiError::Network) if attempt < MAX_UPLOAD_RETRIES => {
                sleeper.sleep(bounded_retry_delay(attempt, None)).await;
            }
            Err(DriveApiError::Transient(retry_after)) if attempt < MAX_UPLOAD_RETRIES => {
                sleeper
                    .sleep(bounded_retry_delay(attempt, retry_after))
                    .await;
            }
            Err(DriveApiError::RateLimited(retry_after)) if attempt < MAX_UPLOAD_RETRIES => {
                sleeper
                    .sleep(bounded_retry_delay(attempt, retry_after))
                    .await;
            }
            Err(error) => return Err(error),
        }
    }
    Err(DriveApiError::Network)
}

async fn start_update_with_retry<A, S>(
    api: &A,
    sleeper: &S,
    access_token: &str,
    file_id: &str,
    metadata: &DriveUpdateMetadata,
    total_bytes: u64,
) -> std::result::Result<super::drive_client::ResumableUploadSession, DriveApiError>
where
    A: GoogleDriveApi + ?Sized,
    S: DriveSleeper + ?Sized,
{
    for attempt in 0..=MAX_UPLOAD_RETRIES {
        match api
            .start_resumable_update(access_token, file_id, metadata, total_bytes)
            .await
        {
            Ok(session) => return Ok(session),
            Err(DriveApiError::Network) if attempt < MAX_UPLOAD_RETRIES => {
                sleeper.sleep(bounded_retry_delay(attempt, None)).await;
            }
            Err(DriveApiError::Transient(retry_after)) if attempt < MAX_UPLOAD_RETRIES => {
                sleeper
                    .sleep(bounded_retry_delay(attempt, retry_after))
                    .await;
            }
            Err(DriveApiError::RateLimited(retry_after)) if attempt < MAX_UPLOAD_RETRIES => {
                sleeper
                    .sleep(bounded_retry_delay(attempt, retry_after))
                    .await;
            }
            Err(error) => return Err(error),
        }
    }
    Err(DriveApiError::Network)
}

async fn transfer_archive<A, S, F>(
    api: &A,
    sleeper: &S,
    access_token: &str,
    session: &super::drive_client::ResumableUploadSession,
    archive: &mut DiskArchiveSource,
    chunk_size: usize,
    on_progress: &mut F,
) -> std::result::Result<(), DriveApiError>
where
    A: GoogleDriveApi + ?Sized,
    S: DriveSleeper + ?Sized,
    F: FnMut(u64, u64),
{
    let total_bytes = archive.len();
    let mut accepted = 0_u64;
    let mut rate_retry_attempt = 0_usize;
    let mut stalled_recovery_attempts = 0_usize;
    let mut loaded_offset = None;
    let mut chunk = Vec::new();

    while accepted < total_bytes {
        if loaded_offset != Some(accepted) {
            chunk = archive.read_chunk(accepted, chunk_size).await?;
            loaded_offset = Some(accepted);
        }
        let attempted_end = accepted
            .checked_add(u64::try_from(chunk.len()).map_err(|_| DriveApiError::LocalState)?)
            .ok_or(DriveApiError::LocalState)?;
        if attempted_end > total_bytes || attempted_end <= accepted {
            return Err(DriveApiError::LocalState);
        }
        let result = api
            .upload_chunk(access_token, session, accepted, &chunk, total_bytes)
            .await;
        let acknowledgement = match result {
            Ok(acknowledgement) => acknowledgement,
            Err(DriveApiError::Network) => {
                query_status_with_retry(api, sleeper, access_token, session, total_bytes).await?
            }
            Err(DriveApiError::Transient(retry_after)) => {
                if let Some(retry_after) = retry_after {
                    sleeper
                        .sleep(bounded_retry_delay(0, Some(retry_after)))
                        .await;
                }
                query_status_with_retry(api, sleeper, access_token, session, total_bytes).await?
            }
            Err(DriveApiError::RateLimited(retry_after)) => {
                if rate_retry_attempt >= MAX_UPLOAD_RETRIES {
                    return Err(DriveApiError::RateLimited(retry_after));
                }
                sleeper
                    .sleep(bounded_retry_delay(rate_retry_attempt, retry_after))
                    .await;
                rate_retry_attempt += 1;
                continue;
            }
            Err(error) => return Err(error),
        };

        match validate_acknowledgement(accepted, attempted_end, total_bytes, acknowledgement)? {
            Acknowledgement::Progress(confirmed) => {
                accepted = confirmed;
                loaded_offset = None;
                stalled_recovery_attempts = 0;
                rate_retry_attempt = 0;
                on_progress(accepted, total_bytes);
            }
            Acknowledgement::Stalled => {
                if stalled_recovery_attempts >= MAX_UPLOAD_RETRIES {
                    return Err(DriveApiError::InvalidResponse);
                }
                sleeper
                    .sleep(bounded_retry_delay(stalled_recovery_attempts, None))
                    .await;
                stalled_recovery_attempts += 1;
            }
            Acknowledgement::Complete => {
                accepted = total_bytes;
                on_progress(accepted, total_bytes);
            }
        }
    }
    Ok(())
}

enum Acknowledgement {
    Progress(u64),
    Stalled,
    Complete,
}

fn validate_acknowledgement(
    previous: u64,
    attempted_end: u64,
    total: u64,
    acknowledgement: DriveChunkResult,
) -> std::result::Result<Acknowledgement, DriveApiError> {
    if attempted_end <= previous || attempted_end > total {
        return Err(DriveApiError::InvalidResponse);
    }
    match acknowledgement {
        DriveChunkResult::Accepted(confirmed)
            if confirmed < previous || confirmed > attempted_end =>
        {
            Err(DriveApiError::InvalidResponse)
        }
        DriveChunkResult::Accepted(confirmed) if confirmed == previous => {
            Ok(Acknowledgement::Stalled)
        }
        DriveChunkResult::Accepted(confirmed) => Ok(Acknowledgement::Progress(confirmed)),
        DriveChunkResult::Complete if attempted_end == total => Ok(Acknowledgement::Complete),
        DriveChunkResult::Complete => Err(DriveApiError::InvalidResponse),
    }
}

async fn query_status_with_retry<A, S>(
    api: &A,
    sleeper: &S,
    access_token: &str,
    session: &super::drive_client::ResumableUploadSession,
    total_bytes: u64,
) -> std::result::Result<DriveChunkResult, DriveApiError>
where
    A: GoogleDriveApi + ?Sized,
    S: DriveSleeper + ?Sized,
{
    for attempt in 0..=MAX_UPLOAD_RETRIES {
        match api
            .query_session_status(access_token, session, total_bytes)
            .await
        {
            Ok(status) => return Ok(status),
            Err(DriveApiError::Network) if attempt < MAX_UPLOAD_RETRIES => {
                sleeper.sleep(bounded_retry_delay(attempt, None)).await;
            }
            Err(DriveApiError::Transient(retry_after)) if attempt < MAX_UPLOAD_RETRIES => {
                sleeper
                    .sleep(bounded_retry_delay(attempt, retry_after))
                    .await;
            }
            Err(DriveApiError::RateLimited(retry_after)) if attempt < MAX_UPLOAD_RETRIES => {
                sleeper
                    .sleep(bounded_retry_delay(attempt, retry_after))
                    .await;
            }
            Err(error) => return Err(error),
        }
    }
    Err(DriveApiError::Network)
}

async fn validate_final_file<A, S>(
    api: &A,
    sleeper: &S,
    access_token: &str,
    file_id: &str,
) -> std::result::Result<String, DriveApiError>
where
    A: GoogleDriveApi + ?Sized,
    S: DriveSleeper + ?Sized,
{
    for attempt in 0..MAX_FINAL_METADATA_ATTEMPTS {
        let file = match api.get_file(access_token, file_id).await {
            Ok(file) => file,
            Err(DriveApiError::Network) if attempt + 1 < MAX_FINAL_METADATA_ATTEMPTS => {
                sleeper.sleep(bounded_retry_delay(attempt, None)).await;
                continue;
            }
            Err(DriveApiError::Transient(retry_after))
                if attempt + 1 < MAX_FINAL_METADATA_ATTEMPTS =>
            {
                sleeper
                    .sleep(bounded_retry_delay(attempt, retry_after))
                    .await;
                continue;
            }
            Err(DriveApiError::RateLimited(retry_after))
                if attempt + 1 < MAX_FINAL_METADATA_ATTEMPTS =>
            {
                sleeper
                    .sleep(bounded_retry_delay(attempt, retry_after))
                    .await;
                continue;
            }
            Err(error) => return Err(error),
        };
        validate_final_file_shape(&file, file_id)?;
        match validated_download_url(file.web_content_link.as_deref()) {
            Ok(Some(link)) => {
                require_public_permission(api, access_token, file_id).await?;
                return Ok(link);
            }
            Ok(None) if attempt + 1 < MAX_FINAL_METADATA_ATTEMPTS => {
                sleeper.sleep(bounded_retry_delay(attempt, None)).await;
            }
            Ok(None) => return Err(DriveApiError::InvalidResponse),
            Err(error) => return Err(error),
        }
    }
    Err(DriveApiError::InvalidResponse)
}

fn validate_final_file_shape(
    file: &DriveFile,
    intended_id: &str,
) -> std::result::Result<(), DriveApiError> {
    if file.id != intended_id
        || file.mime_type != "application/zip"
        || file.trashed
        || !file.can_download
    {
        return Err(DriveApiError::InvalidResponse);
    }
    Ok(())
}

fn validated_download_url(
    value: Option<&str>,
) -> std::result::Result<Option<String>, DriveApiError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.len() > MAX_DOWNLOAD_URL_BYTES {
        return Err(DriveApiError::InvalidResponse);
    }
    let url = reqwest::Url::parse(trimmed).map_err(|_| DriveApiError::InvalidResponse)?;
    if url.scheme() != "https" || url.host_str().is_none() {
        return Err(DriveApiError::InvalidResponse);
    }
    Ok(Some(trimmed.to_string()))
}

async fn require_public_permission<A>(
    api: &A,
    access_token: &str,
    item_id: &str,
) -> std::result::Result<(), DriveApiError>
where
    A: GoogleDriveApi + ?Sized,
{
    match api
        .validate_public_permission(access_token, item_id)
        .await?
    {
        PublicPermissionStatus::Public => Ok(()),
        PublicPermissionStatus::NotPublic => Err(DriveApiError::DownloadNotPublic),
        PublicPermissionStatus::CheckUnavailable => Err(DriveApiError::SharingCheckUnavailable),
    }
}

async fn compensate_after_final_validation<A>(
    api: &A,
    access_token: &str,
    target: &DriveUploadTarget,
    file_id: &str,
    error: DriveApiError,
) -> DriveUploadFailure
where
    A: GoogleDriveApi + ?Sized,
{
    let DriveUploadTarget::Create { .. } = target else {
        return DriveUploadFailure {
            error,
            pending_binding: PendingBindingDisposition::NotApplicable,
        };
    };
    let pending_binding = match api.delete_file(access_token, file_id).await {
        Ok(()) | Err(DriveApiError::NotFound) => PendingBindingDisposition::DeleteConfirmed,
        Err(_) => PendingBindingDisposition::Retain,
    };
    DriveUploadFailure {
        error,
        pending_binding,
    }
}

fn upload_failure(error: DriveApiError, target: &DriveUploadTarget) -> DriveUploadFailure {
    DriveUploadFailure {
        error,
        pending_binding: match target {
            DriveUploadTarget::Create { .. } => PendingBindingDisposition::Retain,
            DriveUploadTarget::Update { .. } => PendingBindingDisposition::NotApplicable,
        },
    }
}

pub(crate) fn bounded_retry_delay(attempt: usize, retry_after: Option<Duration>) -> Duration {
    let exponential = RETRY_BASE_DELAY
        .checked_mul(
            1_u32
                .checked_shl(attempt.min(31) as u32)
                .unwrap_or(u32::MAX),
        )
        .unwrap_or(MAX_RETRY_DELAY);
    retry_after.unwrap_or(exponential).min(MAX_RETRY_DELAY)
}

/// A native-only upload staging location. Its constructor intentionally takes
/// no renderer-controlled values: operation IDs and cloud titles are metadata,
/// never local path components.
pub(crate) struct DriveUploadArchive {
    directory: PathBuf,
    zip_path: PathBuf,
}

impl DriveUploadArchive {
    pub(crate) fn zip_path(&self) -> &Path {
        &self.zip_path
    }

    /// Idempotent cleanup for upload success, failure, and cancellation.
    pub(crate) fn cleanup(&mut self) {
        remove_upload_directory(&self.directory);
    }
}

impl Drop for DriveUploadArchive {
    fn drop(&mut self) {
        self.cleanup();
    }
}

/// Allocates `<app-cache>/google-drive-uploads/<native-random-id>/upload.zip`.
pub(crate) fn create_upload_archive(app_cache_dir: &Path) -> Result<DriveUploadArchive> {
    let namespace = validated_upload_namespace(app_cache_dir, true)?.ok_or_else(|| {
        DesktopError::Message("Unable to allocate Google Drive upload cache".to_string())
    })?;

    // UUID v4 comes from the native RNG; it has no relationship to a renderer
    // operation ID, a song title, or any other user-provided metadata.
    for _ in 0..8 {
        let directory = namespace.join(Uuid::new_v4().to_string());
        match std::fs::create_dir(&directory) {
            Ok(()) => {
                let zip_path = directory.join(UPLOAD_ARCHIVE_NAME);
                return Ok(DriveUploadArchive {
                    directory,
                    zip_path,
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }

    Err(DesktopError::Message(
        "Unable to allocate Google Drive upload cache".to_string(),
    ))
}

/// Best-effort startup cleanup. This never walks outside the dedicated upload
/// namespace; malformed entries are removed as entries rather than followed.
pub(crate) fn cleanup_stale_upload_archives(app_cache_dir: &Path) {
    let Ok(Some(namespace)) = validated_upload_namespace(app_cache_dir, false) else {
        return;
    };
    let Ok(entries) = std::fs::read_dir(&namespace) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.parent() != Some(namespace.as_path()) {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            let _ = std::fs::remove_dir_all(path);
        } else {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn remove_upload_directory(directory: &Path) {
    let Some(namespace) = directory.parent() else {
        return;
    };
    let Some(app_cache_dir) = namespace.parent() else {
        return;
    };
    let Ok(Some(validated_namespace)) = validated_upload_namespace(app_cache_dir, false) else {
        return;
    };
    if namespace == validated_namespace && directory.parent() == Some(validated_namespace.as_path())
    {
        let _ = std::fs::remove_dir_all(directory);
    }
}

/// Returns a namespace only when it is an ordinary directory immediately below
/// the canonical app cache. `symlink_metadata` is deliberately non-following:
/// a stale or malicious `google-drive-uploads` link must never redirect staging
/// or cleanup outside of the app cache.
fn validated_upload_namespace(
    app_cache_dir: &Path,
    create_if_missing: bool,
) -> Result<Option<PathBuf>> {
    if create_if_missing {
        std::fs::create_dir_all(app_cache_dir)?;
    }

    let namespace = app_cache_dir.join(UPLOAD_CACHE_NAMESPACE);
    let metadata = match std::fs::symlink_metadata(&namespace) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && !create_if_missing => {
            return Ok(None);
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            match std::fs::create_dir(&namespace) {
                Ok(()) => std::fs::symlink_metadata(&namespace)?,
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    std::fs::symlink_metadata(&namespace)?
                }
                Err(error) => return Err(error.into()),
            }
        }
        Err(error) => return Err(error.into()),
    };

    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(DesktopError::Message(
            "Invalid Google Drive upload cache namespace".to_string(),
        ));
    }

    let canonical_cache = std::fs::canonicalize(app_cache_dir)?;
    let canonical_namespace = std::fs::canonicalize(&namespace)?;
    if canonical_namespace.parent() != Some(canonical_cache.as_path()) {
        return Err(DesktopError::Message(
            "Invalid Google Drive upload cache namespace".to_string(),
        ));
    }

    Ok(Some(namespace))
}

/// Produces a Drive display name from metadata only. Unlike local manual
/// export names, printable punctuation such as `:` is valid here; path
/// separators and control characters collapse to one hyphen.
pub(crate) fn sanitize_drive_zip_name(title: &str, simfile_id: &str) -> String {
    let mut sanitized = String::new();
    let mut replaced = false;
    let mut has_printable_content = false;

    for character in title.trim().chars() {
        if character.is_control() || matches!(character, '/' | '\\') {
            if !replaced {
                sanitized.push('-');
                replaced = true;
            }
        } else {
            has_printable_content |= !character.is_whitespace();
            sanitized.push(character);
            replaced = false;
        }
    }

    let sanitized = sanitized.trim();
    let base_name = if !has_printable_content || sanitized.is_empty() {
        format!("simfile-{simfile_id}")
    } else {
        sanitized.to_string()
    };
    format!("{base_name}.zip")
}

#[cfg(test)]
#[path = "../tests/google_drive_upload_tests.rs"]
mod tests;
