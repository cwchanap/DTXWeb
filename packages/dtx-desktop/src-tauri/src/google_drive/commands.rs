use std::path::{Component, Path, PathBuf};
use std::sync::Mutex as StdMutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use uuid::{Uuid, Version};

use super::drive_client::DriveApiError;
use super::oauth::{
    GoogleDriveConnectionState, GoogleDriveDisconnectResult, GoogleDriveOAuthError,
};
use super::pending_bindings::PendingBindingKind;
use super::upload::{
    create_upload_archive, patch_existing_upload, run_crash_safe_create_cancelable,
    run_resumable_upload_cancelable, run_with_single_access_token_refresh, CrashSafeCreateRequest,
    DriveOperationLease, DriveOperationPhase, DriveUploadFailure, DriveUploadOutcome,
    DriveUploadRequest, DriveUploadTarget, MonotonicDriveProgress, TokioDriveSleeper,
};
use super::GoogleDriveState;
use crate::auth::AuthState;
use crate::error::{DesktopError, Result};
#[cfg(all(feature = "e2e", debug_assertions))]
use crate::models::E2eDriveProgressSnapshot;
use crate::workspace::WorkspaceRootState;

const GOOGLE_DRIVE_UPLOAD_PROGRESS_EVENT: &str = "google-drive-upload-progress";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UploadSongZipToGoogleDriveInput {
    operation_id: Uuid,
    simfile_id: String,
    song_relative_path: String,
    force_create_replacement: Option<bool>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GoogleDriveUploadResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replaced_existing_file: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<GoogleDriveErrorCode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum GoogleDriveErrorCode {
    WorkspaceRequired,
    NotConnected,
    ReconnectRequired,
    FolderRequired,
    FolderUnavailable,
    SharingCheckUnavailable,
    DownloadNotPublic,
    SimfileUnavailable,
    FileNotFound,
    FilePermissionDenied,
    UploadInProgress,
    Canceled,
    NoValidSongFiles,
    InsufficientDiskSpace,
    LocalState,
    MetadataSyncFailed,
    RateLimited,
    QuotaExceeded,
    Network,
    CredentialStore,
    InvalidResponse,
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum GoogleDriveUploadStage {
    WaitingForUploadSlot,
    PreparingZip,
    ConnectingToGoogleDrive,
    Uploading,
    Finalizing,
    SynchronizingDownloadMetadata,
    UploadComplete,
    UploadFailedSaveSucceeded,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GoogleDriveUploadProgress {
    pub operation_id: Uuid,
    pub simfile_id: String,
    pub stage: GoogleDriveUploadStage,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes_uploaded: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub percentage: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<GoogleDriveErrorCode>,
}

impl GoogleDriveUploadResult {
    fn completed(outcome: DriveUploadOutcome, replaced_existing_file: bool) -> Self {
        Self {
            success: true,
            file_id: Some(outcome.file_id),
            download_url: Some(outcome.download_url),
            file_name: Some(outcome.file_name),
            replaced_existing_file: Some(replaced_existing_file),
            error_code: None,
            error: None,
        }
    }

    fn failed(code: GoogleDriveErrorCode) -> Self {
        Self {
            success: false,
            file_id: None,
            download_url: None,
            file_name: None,
            replaced_existing_file: None,
            error_code: Some(code),
            error: Some(sanitized_error_message(code).to_string()),
        }
    }
}

#[tauri::command]
pub(crate) async fn get_google_drive_connection_state(
    app: AppHandle,
) -> Result<GoogleDriveConnectionState> {
    let user_id = current_user_id(&app).await?;
    Ok(app
        .state::<GoogleDriveState>()
        .connection_state_for_user(&user_id)
        .await)
}

#[tauri::command]
pub(crate) async fn connect_google_drive_and_choose_folder(
    app: AppHandle,
) -> Result<GoogleDriveConnectionState> {
    app.state::<GoogleDriveState>()
        .connect_and_choose_folder(&app.state::<AuthState>())
        .await
        .map_err(sanitized_oauth_error)
}

#[tauri::command]
pub(crate) async fn change_google_drive_folder(
    app: AppHandle,
) -> Result<GoogleDriveConnectionState> {
    app.state::<GoogleDriveState>()
        .connect_and_choose_folder(&app.state::<AuthState>())
        .await
        .map_err(sanitized_oauth_error)
}

#[tauri::command]
pub(crate) async fn recheck_google_drive_sharing(
    app: AppHandle,
) -> Result<GoogleDriveConnectionState> {
    app.state::<GoogleDriveState>()
        .recheck_google_drive_sharing(&app.state::<AuthState>())
        .await
        .map_err(sanitized_oauth_error)
}

#[tauri::command]
pub(crate) async fn disconnect_google_drive(app: AppHandle) -> Result<GoogleDriveDisconnectResult> {
    let user_id = current_user_id(&app).await?;
    app.state::<GoogleDriveState>()
        .disconnect_user(&user_id)
        .await
        .map_err(sanitized_oauth_error)
}

#[tauri::command]
pub(crate) async fn upload_song_zip_to_google_drive(
    app: AppHandle,
    input: UploadSongZipToGoogleDriveInput,
) -> Result<GoogleDriveUploadResult> {
    if !is_uuid_v4(input.operation_id) || input.simfile_id.trim().is_empty() {
        return Ok(GoogleDriveUploadResult::failed(
            GoogleDriveErrorCode::InvalidResponse,
        ));
    }
    let relative_path = match validate_song_relative_path(&input.song_relative_path) {
        Ok(path) => path,
        Err(code) => return Ok(GoogleDriveUploadResult::failed(code)),
    };
    let user_id = match app.state::<AuthState>().current_user_id().await {
        Some(user_id) => user_id,
        None => {
            return Ok(GoogleDriveUploadResult::failed(
                GoogleDriveErrorCode::NotConnected,
            ))
        }
    };
    let drive = app.state::<GoogleDriveState>();
    let lease =
        match drive
            .operation_manager
            .register(&user_id, input.operation_id, &input.simfile_id)
        {
            Ok(lease) => lease,
            Err(DriveApiError::UploadInProgress) => {
                return Ok(GoogleDriveUploadResult::failed(
                    GoogleDriveErrorCode::UploadInProgress,
                ))
            }
            Err(error) => return Ok(GoogleDriveUploadResult::failed(error_code(error))),
        };

    emit_progress(
        &app,
        &lease,
        &input.simfile_id,
        GoogleDriveUploadStage::WaitingForUploadSlot,
        None,
        None,
        None,
    );
    let result =
        run_upload_transaction(&app, &drive, &lease, &user_id, &input, relative_path).await;
    if let Err(failure) = &result {
        let code = error_code(failure.error.clone());
        emit_progress(
            &app,
            &lease,
            &input.simfile_id,
            GoogleDriveUploadStage::UploadFailedSaveSucceeded,
            None,
            None,
            Some(code),
        );
    }
    Ok(match result {
        Ok((outcome, replaced)) => {
            emit_progress(
                &app,
                &lease,
                &input.simfile_id,
                GoogleDriveUploadStage::UploadComplete,
                None,
                None,
                None,
            );
            GoogleDriveUploadResult::completed(outcome, replaced)
        }
        Err(failure) => GoogleDriveUploadResult::failed(error_code(failure.error)),
    })
}

#[tauri::command]
pub(crate) async fn cancel_google_drive_upload(app: AppHandle, operation_id: Uuid) -> Result<bool> {
    if !is_uuid_v4(operation_id) {
        return Ok(false);
    }
    let Some(user_id) = app.state::<AuthState>().current_user_id().await else {
        return Ok(false);
    };
    Ok(app
        .state::<GoogleDriveState>()
        .operation_manager
        .cancel_and_wait(&user_id, operation_id, Duration::from_secs(5))
        .await)
}

async fn run_upload_transaction(
    app: &AppHandle,
    drive: &GoogleDriveState,
    lease: &DriveOperationLease,
    user_id: &str,
    input: &UploadSongZipToGoogleDriveInput,
    relative_path: PathBuf,
) -> std::result::Result<(DriveUploadOutcome, bool), DriveUploadFailure> {
    let _resource_slot = lease
        .acquire_resource_slot()
        .await
        .map_err(upload_failure)?;
    lease.set_phase(DriveOperationPhase::Preparing);
    emit_progress(
        app,
        lease,
        &input.simfile_id,
        GoogleDriveUploadStage::PreparingZip,
        None,
        None,
        None,
    );

    let workspace_root = app
        .state::<WorkspaceRootState>()
        .current()
        .map_err(|_| upload_failure(DriveApiError::WorkspaceRequired))?;
    let joined = workspace_root.join(relative_path);
    let canonical_song = crate::filesystem::canonicalize_within_workspace(
        &joined.to_string_lossy(),
        Some(&workspace_root.to_string_lossy()),
    )
    .await
    .map_err(map_local_upload_error)?;
    let files = crate::songs::collect_valid_song_files(&canonical_song, &workspace_root)
        .await
        .map_err(map_local_upload_error)?;
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|_| upload_failure(DriveApiError::LocalState))?;
    let archive = create_upload_archive(&cache_dir).map_err(map_local_upload_error)?;
    let zip_path = archive.zip_path().to_path_buf();
    let zip_cancellation = lease.cancellation().clone();
    tokio::task::spawn_blocking(move || {
        crate::songs::write_song_zip_cancelable(&zip_path, &files, &zip_cancellation)
    })
    .await
    .map_err(|_| upload_failure(DriveApiError::LocalState))?
    .map_err(map_local_upload_error)?;
    if lease.cancellation().is_cancelled() {
        return Err(upload_failure(DriveApiError::Canceled));
    }

    lease.set_phase(DriveOperationPhase::Connecting);
    emit_progress(
        app,
        lease,
        &input.simfile_id,
        GoogleDriveUploadStage::ConnectingToGoogleDrive,
        None,
        None,
        None,
    );
    ensure_current_user(app, user_id).await?;
    let owner = drive
        .metadata_client
        .fetch_owner_simfile(&app.state::<AuthState>(), &input.simfile_id)
        .await
        .map_err(|error| upload_failure(metadata_error(error)))?;
    if owner.id != input.simfile_id {
        return Err(upload_failure(DriveApiError::InvalidResponse));
    }
    if lease.cancellation().is_cancelled() {
        return Err(upload_failure(DriveApiError::Canceled));
    }
    ensure_current_user(app, user_id).await?;
    let access_token = drive
        .access_token_for_user(user_id)
        .await
        .map_err(|error| upload_failure(oauth_error(error)))?;
    if lease.cancellation().is_cancelled() {
        return Err(upload_failure(DriveApiError::Canceled));
    }
    let api = drive
        .upload_api
        .as_deref()
        .ok_or_else(|| upload_failure(DriveApiError::NotConnected))?;

    lease.set_phase(DriveOperationPhase::Transferring);
    let force_replacement = input.force_create_replacement.unwrap_or(false);
    let existing_id = owner
        .google_drive_file_id
        .as_deref()
        .filter(|id| !id.trim().is_empty());
    let mut replaced_existing_file = false;
    let outcome = if let Some(existing_id) = existing_id {
        let finalization_gate = lease.finalization_gate();
        let request = DriveUploadRequest {
            simfile_id: input.simfile_id.clone(),
            saved_title: owner.title.clone(),
            archive_path: archive.zip_path().to_path_buf(),
            target: DriveUploadTarget::Update {
                file_id: existing_id.to_string(),
            },
        };
        let progress = StdMutex::new(MonotonicDriveProgress::default());
        let update = run_with_single_access_token_refresh(
            access_token,
            |access_token| {
                let request = request.clone();
                let progress = &progress;
                let finalization_gate = &finalization_gate;
                async move {
                    run_resumable_upload_cancelable(
                        api,
                        &TokioDriveSleeper,
                        &access_token,
                        request,
                        lease.cancellation(),
                        finalization_gate,
                        |accepted, total| {
                            if progress
                                .lock()
                                .unwrap_or_else(|poisoned| poisoned.into_inner())
                                .should_emit(accepted, total)
                            {
                                emit_transfer_progress(
                                    app,
                                    lease,
                                    &input.simfile_id,
                                    accepted,
                                    total,
                                );
                            }
                        },
                    )
                    .await
                }
            },
            || lease.set_phase(DriveOperationPhase::Transferring),
            |expired_access_token| async move {
                if lease.cancellation().is_cancelled() {
                    return Err(DriveApiError::Canceled);
                }
                drive
                    .refresh_access_token_after_expiry(user_id, &expired_access_token)
                    .await
                    .map_err(oauth_error)
            },
        )
        .await;
        if update
            .as_ref()
            .is_err_and(|failure| failure.error == DriveApiError::TokenExpired)
        {
            drive.set_requires_reconnect(user_id, true).await;
        }
        match update {
            Ok(outcome) => {
                lease.set_phase(DriveOperationPhase::Synchronizing);
                emit_progress(
                    app,
                    lease,
                    &input.simfile_id,
                    GoogleDriveUploadStage::SynchronizingDownloadMetadata,
                    None,
                    None,
                    None,
                );
                patch_existing_upload(
                    drive.metadata_client.as_ref(),
                    &app.state::<AuthState>(),
                    &owner,
                    outcome,
                )
                .await?
            }
            Err(failure) if replacement_is_explicitly_allowed(force_replacement, &failure) => {
                replaced_existing_file = true;
                create_and_bind(app, drive, lease, user_id, input, archive.zip_path(), true).await?
            }
            Err(failure) => return Err(failure),
        }
    } else {
        create_and_bind(app, drive, lease, user_id, input, archive.zip_path(), false).await?
    };
    Ok((outcome, replaced_existing_file))
}

async fn create_and_bind(
    app: &AppHandle,
    drive: &GoogleDriveState,
    lease: &DriveOperationLease,
    user_id: &str,
    input: &UploadSongZipToGoogleDriveInput,
    archive_path: &Path,
    replacement: bool,
) -> std::result::Result<DriveUploadOutcome, DriveUploadFailure> {
    ensure_current_user(app, user_id).await?;
    let folder = drive
        .settings
        .folder_for_user(user_id)
        .ok_or_else(|| upload_failure(DriveApiError::FolderRequired))?;
    let access_token = drive
        .access_token_for_user(user_id)
        .await
        .map_err(|error| upload_failure(oauth_error(error)))?;
    let api = drive
        .upload_api
        .as_deref()
        .ok_or_else(|| upload_failure(DriveApiError::NotConnected))?;
    let pending_store = drive
        .pending_bindings
        .as_ref()
        .ok_or_else(|| upload_failure(DriveApiError::LocalState))?;
    let finalization_gate = lease.finalization_gate();
    let request = CrashSafeCreateRequest {
        simfile_id: input.simfile_id.clone(),
        archive_path: archive_path.to_path_buf(),
        folder_id: folder.id,
        kind: if replacement {
            PendingBindingKind::ExplicitReplacement
        } else {
            PendingBindingKind::FirstUpload
        },
    };
    let progress = StdMutex::new(MonotonicDriveProgress::default());
    let result = run_with_single_access_token_refresh(
        access_token,
        |access_token| {
            let request = request.clone();
            let progress = &progress;
            let finalization_gate = &finalization_gate;
            async move {
                run_crash_safe_create_cancelable(
                    api,
                    &TokioDriveSleeper,
                    pending_store,
                    drive.metadata_client.as_ref(),
                    &app.state::<AuthState>(),
                    &access_token,
                    request,
                    lease.cancellation(),
                    finalization_gate,
                    |accepted, total| {
                        if !progress
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner())
                            .should_emit(accepted, total)
                        {
                            return;
                        }
                        emit_transfer_progress(app, lease, &input.simfile_id, accepted, total);
                        if total > 0 && accepted >= total {
                            lease.set_phase(DriveOperationPhase::Synchronizing);
                            emit_progress(
                                app,
                                lease,
                                &input.simfile_id,
                                GoogleDriveUploadStage::SynchronizingDownloadMetadata,
                                None,
                                None,
                                None,
                            );
                        }
                    },
                )
                .await
            }
        },
        || lease.set_phase(DriveOperationPhase::Transferring),
        |expired_access_token| async move {
            if lease.cancellation().is_cancelled() {
                return Err(DriveApiError::Canceled);
            }
            drive
                .refresh_access_token_after_expiry(user_id, &expired_access_token)
                .await
                .map_err(oauth_error)
        },
    )
    .await;
    if result
        .as_ref()
        .is_err_and(|failure| failure.error == DriveApiError::TokenExpired)
    {
        drive.set_requires_reconnect(user_id, true).await;
    }
    result
}

fn validate_song_relative_path(value: &str) -> std::result::Result<PathBuf, GoogleDriveErrorCode> {
    if value.is_empty()
        || value.contains('\\')
        || value.contains('\0')
        || value
            .split('/')
            .any(|component| component.is_empty() || matches!(component, "." | ".."))
    {
        return Err(GoogleDriveErrorCode::InvalidResponse);
    }
    let first = value.split('/').next().unwrap_or_default().as_bytes();
    if first.len() >= 2 && first[0].is_ascii_alphabetic() && first[1] == b':' {
        return Err(GoogleDriveErrorCode::InvalidResponse);
    }
    let path = Path::new(value);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(name) if !name.is_empty()))
    {
        return Err(GoogleDriveErrorCode::InvalidResponse);
    }
    Ok(path.to_path_buf())
}

fn replacement_is_explicitly_allowed(force: bool, failure: &DriveUploadFailure) -> bool {
    force
        && matches!(
            failure.error,
            DriveApiError::NotFound | DriveApiError::PermissionDenied
        )
}

async fn ensure_current_user(
    app: &AppHandle,
    expected_user_id: &str,
) -> std::result::Result<(), DriveUploadFailure> {
    if app.state::<AuthState>().current_user_id().await.as_deref() == Some(expected_user_id) {
        Ok(())
    } else {
        Err(upload_failure(DriveApiError::Canceled))
    }
}

fn is_uuid_v4(value: Uuid) -> bool {
    value.get_version() == Some(Version::Random)
}

fn emit_transfer_progress(
    app: &AppHandle,
    lease: &DriveOperationLease,
    simfile_id: &str,
    accepted: u64,
    total: u64,
) {
    let complete = total > 0 && accepted >= total;
    emit_progress(
        app,
        lease,
        simfile_id,
        if complete {
            GoogleDriveUploadStage::Finalizing
        } else {
            GoogleDriveUploadStage::Uploading
        },
        Some(accepted.min(total)),
        Some(total),
        None,
    );
}

fn emit_progress(
    app: &AppHandle,
    lease: &DriveOperationLease,
    simfile_id: &str,
    stage: GoogleDriveUploadStage,
    bytes_uploaded: Option<u64>,
    total_bytes: Option<u64>,
    error_code: Option<GoogleDriveErrorCode>,
) {
    if !lease.is_visible() {
        return;
    }
    let percentage = bytes_uploaded
        .zip(total_bytes)
        .and_then(|(uploaded, total)| {
            (u128::from(uploaded.min(total)) * 100)
                .checked_div(u128::from(total))
                .map(|percentage| percentage.min(100) as u8)
        });
    let progress = GoogleDriveUploadProgress {
        operation_id: lease.operation_id(),
        simfile_id: simfile_id.to_string(),
        stage,
        bytes_uploaded,
        total_bytes,
        percentage,
        error_code,
    };
    #[cfg(all(feature = "e2e", debug_assertions))]
    if let Some(fake) = app.state::<GoogleDriveState>().e2e_fake.as_ref() {
        fake.record_progress(E2eDriveProgressSnapshot {
            operation_id: progress.operation_id.to_string(),
            simfile_id: progress.simfile_id.clone(),
            stage: serde_json::to_value(progress.stage)
                .ok()
                .and_then(|value| value.as_str().map(str::to_string))
                .unwrap_or_else(|| "invalid".to_string()),
            bytes_uploaded: progress.bytes_uploaded,
            total_bytes: progress.total_bytes,
            percentage: progress.percentage,
            error_code: progress.error_code.and_then(|code| {
                serde_json::to_value(code)
                    .ok()
                    .and_then(|value| value.as_str().map(str::to_string))
            }),
        });
    }
    let _ = app.emit(GOOGLE_DRIVE_UPLOAD_PROGRESS_EVENT, progress);
}

fn upload_failure(error: DriveApiError) -> DriveUploadFailure {
    DriveUploadFailure {
        error,
        pending_binding: super::upload::PendingBindingDisposition::NotApplicable,
    }
}

fn map_local_upload_error(error: DesktopError) -> DriveUploadFailure {
    match error {
        DesktopError::Message(message) if message == "CANCELED" => {
            upload_failure(DriveApiError::Canceled)
        }
        DesktopError::Message(message) if message == "NO_VALID_SONG_FILES" => {
            upload_failure(DriveApiError::NoValidSongFiles)
        }
        DesktopError::Io(error) if matches!(error.raw_os_error(), Some(28 | 112)) => {
            upload_failure(DriveApiError::InsufficientDiskSpace)
        }
        _ => upload_failure(DriveApiError::LocalState),
    }
}

fn metadata_error(error: super::DriveMetadataError) -> DriveApiError {
    match error {
        super::DriveMetadataError::DefinitiveUnavailable => DriveApiError::SimfileUnavailable,
        super::DriveMetadataError::Authentication => DriveApiError::TokenExpired,
        super::DriveMetadataError::Network => DriveApiError::Network,
        super::DriveMetadataError::ServiceUnavailable => DriveApiError::MetadataSync,
        super::DriveMetadataError::InvalidResponse => DriveApiError::InvalidResponse,
        super::DriveMetadataError::LocalState => DriveApiError::LocalState,
    }
}

fn oauth_error(error: GoogleDriveOAuthError) -> DriveApiError {
    match error {
        GoogleDriveOAuthError::Canceled => DriveApiError::Canceled,
        GoogleDriveOAuthError::InvalidResponse => DriveApiError::InvalidResponse,
        GoogleDriveOAuthError::Network => DriveApiError::Network,
        GoogleDriveOAuthError::ReconnectRequired => DriveApiError::TokenExpired,
        GoogleDriveOAuthError::NotConnected => DriveApiError::NotConnected,
        GoogleDriveOAuthError::CredentialStore => DriveApiError::CredentialStore,
        GoogleDriveOAuthError::LocalState => DriveApiError::LocalState,
        GoogleDriveOAuthError::AlreadyInProgress => DriveApiError::UploadInProgress,
        GoogleDriveOAuthError::FolderUnavailable => DriveApiError::FolderUnavailable,
        GoogleDriveOAuthError::DownloadNotPublic => DriveApiError::DownloadNotPublic,
        GoogleDriveOAuthError::SharingCheckUnavailable => DriveApiError::SharingCheckUnavailable,
        GoogleDriveOAuthError::FileNotFound => DriveApiError::NotFound,
        GoogleDriveOAuthError::FilePermissionDenied => DriveApiError::PermissionDenied,
    }
}

fn error_code(error: DriveApiError) -> GoogleDriveErrorCode {
    match error {
        DriveApiError::Canceled => GoogleDriveErrorCode::Canceled,
        DriveApiError::UploadInProgress => GoogleDriveErrorCode::UploadInProgress,
        DriveApiError::WorkspaceRequired => GoogleDriveErrorCode::WorkspaceRequired,
        DriveApiError::NotConnected => GoogleDriveErrorCode::NotConnected,
        DriveApiError::FolderRequired => GoogleDriveErrorCode::FolderRequired,
        DriveApiError::TokenExpired => GoogleDriveErrorCode::ReconnectRequired,
        DriveApiError::Network | DriveApiError::Transient(_) => GoogleDriveErrorCode::Network,
        DriveApiError::InvalidResponse
        | DriveApiError::InvalidGeneratedId
        | DriveApiError::SessionExpired => GoogleDriveErrorCode::InvalidResponse,
        DriveApiError::LocalState => GoogleDriveErrorCode::LocalState,
        DriveApiError::InsufficientDiskSpace => GoogleDriveErrorCode::InsufficientDiskSpace,
        DriveApiError::NoValidSongFiles => GoogleDriveErrorCode::NoValidSongFiles,
        DriveApiError::MetadataSync => GoogleDriveErrorCode::MetadataSyncFailed,
        DriveApiError::SimfileUnavailable => GoogleDriveErrorCode::SimfileUnavailable,
        DriveApiError::FolderUnavailable => GoogleDriveErrorCode::FolderUnavailable,
        DriveApiError::DownloadNotPublic => GoogleDriveErrorCode::DownloadNotPublic,
        DriveApiError::SharingCheckUnavailable => GoogleDriveErrorCode::SharingCheckUnavailable,
        DriveApiError::RateLimited(_) => GoogleDriveErrorCode::RateLimited,
        DriveApiError::QuotaExceeded => GoogleDriveErrorCode::QuotaExceeded,
        DriveApiError::NotFound => GoogleDriveErrorCode::FileNotFound,
        DriveApiError::PermissionDenied => GoogleDriveErrorCode::FilePermissionDenied,
        DriveApiError::CredentialStore => GoogleDriveErrorCode::CredentialStore,
    }
}

fn sanitized_error_message(code: GoogleDriveErrorCode) -> &'static str {
    match code {
        GoogleDriveErrorCode::WorkspaceRequired => "Select a workspace folder before uploading.",
        GoogleDriveErrorCode::NotConnected => "Connect Google Drive before uploading.",
        GoogleDriveErrorCode::ReconnectRequired => "Reconnect Google Drive and try again.",
        GoogleDriveErrorCode::FolderRequired => "Choose a Google Drive folder before uploading.",
        GoogleDriveErrorCode::FolderUnavailable => {
            "The selected Google Drive folder is unavailable."
        }
        GoogleDriveErrorCode::SharingCheckUnavailable => {
            "Drumery could not verify Google Drive sharing."
        }
        GoogleDriveErrorCode::DownloadNotPublic => {
            "The Google Drive item is not publicly downloadable."
        }
        GoogleDriveErrorCode::SimfileUnavailable => "The saved song is unavailable.",
        GoogleDriveErrorCode::FileNotFound => "The linked Google Drive file was not found.",
        GoogleDriveErrorCode::FilePermissionDenied => {
            "The linked Google Drive file cannot be updated."
        }
        GoogleDriveErrorCode::UploadInProgress => {
            "A Drive upload is already running for this song."
        }
        GoogleDriveErrorCode::Canceled => "The Google Drive upload was canceled.",
        GoogleDriveErrorCode::NoValidSongFiles => "The song has no supported files to upload.",
        GoogleDriveErrorCode::InsufficientDiskSpace => {
            "There is not enough disk space to prepare the upload."
        }
        GoogleDriveErrorCode::LocalState => "The local Drive upload state is unavailable.",
        GoogleDriveErrorCode::MetadataSyncFailed => {
            "The file uploaded, but download metadata could not be synchronized."
        }
        GoogleDriveErrorCode::RateLimited => "Google Drive is busy. Try again later.",
        GoogleDriveErrorCode::QuotaExceeded => "The Google Drive quota was exceeded.",
        GoogleDriveErrorCode::Network => "A network error interrupted the Google Drive upload.",
        GoogleDriveErrorCode::CredentialStore => {
            "The secure Google Drive credential store is unavailable."
        }
        GoogleDriveErrorCode::InvalidResponse => "Google Drive returned an invalid response.",
        GoogleDriveErrorCode::Unknown => "The Google Drive upload failed.",
    }
}

async fn current_user_id(app: &AppHandle) -> Result<String> {
    app.state::<AuthState>()
        .current_user_id()
        .await
        .ok_or_else(|| {
            DesktopError::Message(GoogleDriveOAuthError::NotConnected.code().to_string())
        })
}

fn sanitized_oauth_error(error: GoogleDriveOAuthError) -> DesktopError {
    DesktopError::Message(error.code().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn operation_id_accepts_only_uuid_v4() {
        assert!(is_uuid_v4(
            Uuid::parse_str("a52d3d3c-46b0-4da8-b12b-4491d3bfc999").unwrap()
        ));
        assert!(!is_uuid_v4(Uuid::nil()));
        assert!(!is_uuid_v4(
            Uuid::parse_str("6ba7b810-9dad-11d1-80b4-00c04fd430c8").unwrap()
        ));
    }

    #[test]
    fn upload_input_rejects_renderer_supplied_native_authority_fields() {
        let base = serde_json::json!({
            "operationId": "a52d3d3c-46b0-4da8-b12b-4491d3bfc999",
            "simfileId": "sim-42",
            "songRelativePath": "pack/song",
            "forceCreateReplacement": false
        });
        assert!(serde_json::from_value::<UploadSongZipToGoogleDriveInput>(base.clone()).is_ok());
        for (field, value) in [
            ("userId", serde_json::json!("user-1")),
            ("workspaceRoot", serde_json::json!("/private/workspace")),
            ("absolutePath", serde_json::json!("/private/workspace/song")),
            ("folderId", serde_json::json!("folder")),
            ("title", serde_json::json!("title")),
            ("driveFileId", serde_json::json!("file")),
            ("downloadUrl", serde_json::json!("https://example.test")),
        ] {
            let mut input = base.clone();
            input
                .as_object_mut()
                .unwrap()
                .insert(field.to_string(), value);
            assert!(
                serde_json::from_value::<UploadSongZipToGoogleDriveInput>(input).is_err(),
                "{field}"
            );
        }
    }

    #[test]
    fn create_after_existing_identity_is_only_allowed_by_explicit_permanent_access_failure() {
        for error in [DriveApiError::NotFound, DriveApiError::PermissionDenied] {
            let failure = upload_failure(error);
            assert!(!replacement_is_explicitly_allowed(false, &failure));
            assert!(replacement_is_explicitly_allowed(true, &failure));
        }
        for error in [
            DriveApiError::Network,
            DriveApiError::RateLimited(None),
            DriveApiError::InvalidResponse,
        ] {
            assert!(!replacement_is_explicitly_allowed(
                true,
                &upload_failure(error)
            ));
        }
    }

    #[tokio::test]
    async fn upload_refresh_preserves_oauth_classification_for_update_and_create_commands() {
        // Break caught: rewriting every refresh failure to TokenExpired makes
        // transient network, credential-store, and invalid-response failures
        // falsely disconnect an otherwise connected user.
        for pending_binding in [
            super::super::upload::PendingBindingDisposition::NotApplicable,
            super::super::upload::PendingBindingDisposition::Retain,
        ] {
            for (oauth_failure, expected_error, requires_reconnect) in [
                (
                    GoogleDriveOAuthError::Network,
                    DriveApiError::Network,
                    false,
                ),
                (
                    GoogleDriveOAuthError::CredentialStore,
                    DriveApiError::CredentialStore,
                    false,
                ),
                (
                    GoogleDriveOAuthError::InvalidResponse,
                    DriveApiError::InvalidResponse,
                    false,
                ),
                (
                    GoogleDriveOAuthError::ReconnectRequired,
                    DriveApiError::TokenExpired,
                    true,
                ),
            ] {
                let refresh_error = oauth_error(oauth_failure);
                let failure = run_with_single_access_token_refresh(
                    zeroize::Zeroizing::new("expired-token".to_string()),
                    |_| async move {
                        Err::<(), _>(DriveUploadFailure {
                            error: DriveApiError::TokenExpired,
                            pending_binding,
                        })
                    },
                    || {},
                    |_| {
                        let refresh_error = refresh_error.clone();
                        async move { Err(refresh_error) }
                    },
                )
                .await
                .expect_err("refresh failure");

                assert_eq!(failure.error, expected_error);
                assert_eq!(failure.pending_binding, pending_binding);
                assert_eq!(
                    failure.error == DriveApiError::TokenExpired,
                    requires_reconnect
                );
            }
        }
    }

    #[test]
    fn relative_song_path_rejects_ambiguous_or_escaping_syntax_before_join() {
        for invalid in [
            "",
            "/song",
            "song/",
            "song//chart",
            ".",
            "..",
            "songs/./chart",
            "songs/../chart",
            r"songs\chart",
            r"C:\songs",
            "C:songs",
        ] {
            assert_eq!(
                validate_song_relative_path(invalid),
                Err(GoogleDriveErrorCode::InvalidResponse),
                "{invalid:?}"
            );
        }
        assert_eq!(
            validate_song_relative_path("pack/song").expect("normalized path"),
            PathBuf::from("pack/song")
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn normalized_relative_path_still_cannot_escape_managed_root_through_a_symlink() {
        use std::os::unix::fs::symlink;

        let workspace = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        symlink(outside.path(), workspace.path().join("linked-song")).unwrap();
        let relative = validate_song_relative_path("linked-song").unwrap();
        let joined = workspace.path().join(relative);

        let error = crate::filesystem::canonicalize_within_workspace(
            &joined.to_string_lossy(),
            Some(&workspace.path().to_string_lossy()),
        )
        .await
        .expect_err("escaping symlink");
        assert_eq!(error.to_string(), "Path is outside the workspace");
    }

    #[test]
    fn progress_wire_contract_contains_only_sanitized_fields_and_stage_values() {
        let progress = GoogleDriveUploadProgress {
            operation_id: Uuid::parse_str("a52d3d3c-46b0-4da8-b12b-4491d3bfc999").unwrap(),
            simfile_id: "sim-42".to_string(),
            stage: GoogleDriveUploadStage::Uploading,
            bytes_uploaded: Some(4),
            total_bytes: Some(8),
            percentage: Some(50),
            error_code: None,
        };
        let value = serde_json::to_value(progress).unwrap();
        assert_eq!(
            value
                .as_object()
                .unwrap()
                .keys()
                .cloned()
                .collect::<Vec<_>>(),
            vec![
                "bytesUploaded",
                "operationId",
                "percentage",
                "simfileId",
                "stage",
                "totalBytes"
            ]
        );
        assert_eq!(value["stage"], "uploading");
        for forbidden in [
            "title",
            "path",
            "folder",
            "fileId",
            "downloadUrl",
            "requestId",
            "session",
        ] {
            assert!(!value.as_object().unwrap().contains_key(forbidden));
        }
        assert_eq!(
            [
                GoogleDriveUploadStage::WaitingForUploadSlot,
                GoogleDriveUploadStage::PreparingZip,
                GoogleDriveUploadStage::ConnectingToGoogleDrive,
                GoogleDriveUploadStage::Uploading,
                GoogleDriveUploadStage::Finalizing,
                GoogleDriveUploadStage::SynchronizingDownloadMetadata,
                GoogleDriveUploadStage::UploadComplete,
                GoogleDriveUploadStage::UploadFailedSaveSucceeded,
            ]
            .map(|stage| serde_json::to_value(stage).unwrap()),
            [
                "waiting-for-upload-slot",
                "preparing-zip",
                "connecting-to-google-drive",
                "uploading",
                "finalizing",
                "synchronizing-download-metadata",
                "upload-complete",
                "upload-failed-save-succeeded",
            ]
            .map(serde_json::Value::from)
        );
    }

    #[test]
    fn failure_results_expose_only_static_sanitized_messages() {
        let value = serde_json::to_value(GoogleDriveUploadResult::failed(
            GoogleDriveErrorCode::Network,
        ))
        .unwrap();
        assert_eq!(value["success"], false);
        assert_eq!(value["errorCode"], "NETWORK");
        assert_eq!(
            value["error"],
            "A network error interrupted the Google Drive upload."
        );
        assert!(value.get("fileId").is_none());
        assert!(value.get("downloadUrl").is_none());
        assert!(value.get("fileName").is_none());
    }
}
