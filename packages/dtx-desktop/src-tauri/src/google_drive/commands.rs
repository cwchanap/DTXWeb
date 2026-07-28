use std::future::Future;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex as StdMutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};
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
pub(crate) async fn get_google_drive_connection_state<R: Runtime>(
    app: AppHandle<R>,
) -> Result<GoogleDriveConnectionState> {
    let user_id = current_user_id(&app).await?;
    Ok(app
        .state::<GoogleDriveState>()
        .connection_state_for_user(&user_id)
        .await)
}

#[tauri::command]
pub(crate) async fn connect_google_drive_and_choose_folder<R: Runtime>(
    app: AppHandle<R>,
) -> Result<GoogleDriveConnectionState> {
    app.state::<GoogleDriveState>()
        .connect_and_choose_folder(&app.state::<AuthState>())
        .await
        .map_err(sanitized_oauth_error)
}

#[tauri::command]
pub(crate) async fn change_google_drive_folder<R: Runtime>(
    app: AppHandle<R>,
) -> Result<GoogleDriveConnectionState> {
    app.state::<GoogleDriveState>()
        .connect_and_choose_folder(&app.state::<AuthState>())
        .await
        .map_err(sanitized_oauth_error)
}

#[tauri::command]
pub(crate) async fn recheck_google_drive_sharing<R: Runtime>(
    app: AppHandle<R>,
) -> Result<GoogleDriveConnectionState> {
    app.state::<GoogleDriveState>()
        .recheck_google_drive_sharing(&app.state::<AuthState>())
        .await
        .map_err(sanitized_oauth_error)
}

#[tauri::command]
pub(crate) async fn disconnect_google_drive<R: Runtime>(
    app: AppHandle<R>,
) -> Result<GoogleDriveDisconnectResult> {
    let user_id = current_user_id(&app).await?;
    app.state::<GoogleDriveState>()
        .disconnect_user(&user_id)
        .await
        .map_err(sanitized_oauth_error)
}

#[tauri::command]
pub(crate) async fn upload_song_zip_to_google_drive<R: Runtime>(
    app: AppHandle<R>,
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
pub(crate) async fn cancel_google_drive_upload<R: Runtime>(
    app: AppHandle<R>,
    operation_id: Uuid,
) -> Result<bool> {
    if !is_uuid_v4(operation_id) {
        return Ok(false);
    }
    // Distinguish "no authenticated session" (a typed error) from "operation
    // not found" (a valid Ok(false) — nothing to cancel). The no-session case
    // is a genuine error: the renderer should not be issuing Drive commands
    // without a session. Ok(false) is reserved for "the operation doesn't
    // exist, isn't visible, or isn't cancellable in its current phase."
    let user_id = current_user_id(&app).await?;
    Ok(app
        .state::<GoogleDriveState>()
        .operation_manager
        .cancel_and_wait(&user_id, operation_id, Duration::from_secs(5))
        .await)
}

async fn run_upload_transaction<R: Runtime>(
    app: &AppHandle<R>,
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
        let update = run_upload_with_single_access_token_refresh(
            drive,
            lease,
            user_id,
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

async fn create_and_bind<R: Runtime>(
    app: &AppHandle<R>,
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
    let result = run_upload_with_single_access_token_refresh(
        drive,
        lease,
        user_id,
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

async fn ensure_current_user<R: Runtime>(
    app: &AppHandle<R>,
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

fn emit_transfer_progress<R: Runtime>(
    app: &AppHandle<R>,
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

fn emit_progress<R: Runtime>(
    app: &AppHandle<R>,
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
        // 28 = ENOSPC (POSIX), 112 = ERROR_DISK_FULL (Windows),
        // 122 = EDQUOT (Linux quota exceeded).
        DesktopError::Io(error) if matches!(error.raw_os_error(), Some(28 | 112 | 122)) => {
            upload_failure(DriveApiError::InsufficientDiskSpace)
        }
        _ => upload_failure(DriveApiError::LocalState),
    }
}

fn metadata_error(error: super::DriveMetadataError) -> DriveApiError {
    match error {
        super::DriveMetadataError::DefinitiveUnavailable => DriveApiError::SimfileUnavailable,
        super::DriveMetadataError::BindingMismatch => DriveApiError::MetadataSync,
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

async fn refresh_upload_access_token(
    drive: &GoogleDriveState,
    user_id: &str,
    expired_access_token: &str,
    cancellation: &tokio_util::sync::CancellationToken,
) -> std::result::Result<zeroize::Zeroizing<String>, DriveApiError> {
    tokio::select! {
        biased;
        _ = cancellation.cancelled() => Err(DriveApiError::Canceled),
        result = drive.refresh_access_token_after_expiry(user_id, expired_access_token) => {
            result.map_err(oauth_error)
        }
    }
}

async fn run_upload_with_single_access_token_refresh<T, Run, RunFuture>(
    drive: &GoogleDriveState,
    lease: &DriveOperationLease,
    user_id: &str,
    access_token: zeroize::Zeroizing<String>,
    run: Run,
) -> std::result::Result<T, DriveUploadFailure>
where
    Run: FnMut(zeroize::Zeroizing<String>) -> RunFuture,
    RunFuture: Future<Output = std::result::Result<T, DriveUploadFailure>>,
{
    run_with_single_access_token_refresh(
        access_token,
        run,
        || lease.set_phase(DriveOperationPhase::Transferring),
        |expired_access_token| async move {
            refresh_upload_access_token(drive, user_id, &expired_access_token, lease.cancellation())
                .await
        },
    )
    .await
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

async fn current_user_id<R: Runtime>(app: &AppHandle<R>) -> Result<String> {
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
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::Arc;

    use async_trait::async_trait;
    use tokio::sync::Semaphore;

    use super::super::credential_store::{
        GoogleDriveCredentialStore, InMemoryGoogleDriveCredentialStore,
    };
    use super::super::oauth::{
        DeferredPickerFolderValidator, GoogleOAuthProvider, OAuthProviderError, OAuthTokenResponse,
        PickerProtocolConfig, TokenExchangeRequest, UnavailablePickerBrowser,
    };
    use super::super::settings::{GoogleDriveFolderSetting, GoogleDriveSettingsAccess};
    use super::super::UnavailableDriveMetadataClient;

    #[derive(Default)]
    struct ConnectedTestSettings {
        folder: StdMutex<Option<GoogleDriveFolderSetting>>,
    }

    impl ConnectedTestSettings {
        fn new() -> Self {
            Self {
                folder: StdMutex::new(Some(GoogleDriveFolderSetting {
                    id: "folder-42".to_string(),
                    name: "Uploads".to_string(),
                })),
            }
        }
    }

    impl GoogleDriveSettingsAccess for ConnectedTestSettings {
        fn folder_for_user(&self, _user_id: &str) -> Option<GoogleDriveFolderSetting> {
            self.folder
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .clone()
        }

        fn set_folder_for_user(
            &self,
            _user_id: &str,
            folder: GoogleDriveFolderSetting,
        ) -> Result<()> {
            *self
                .folder
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(folder);
            Ok(())
        }

        fn clear_folder_for_user(&self, _user_id: &str) -> Result<()> {
            *self
                .folder
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
            Ok(())
        }
    }

    struct BlockingUploadRefreshProvider {
        started: Semaphore,
        dropped: Arc<AtomicBool>,
    }

    impl Default for BlockingUploadRefreshProvider {
        fn default() -> Self {
            Self {
                started: Semaphore::new(0),
                dropped: Arc::new(AtomicBool::new(false)),
            }
        }
    }

    struct RefreshDropGuard(Arc<AtomicBool>);

    impl Drop for RefreshDropGuard {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }

    #[async_trait]
    impl GoogleOAuthProvider for BlockingUploadRefreshProvider {
        async fn exchange_code(
            &self,
            _request: TokenExchangeRequest,
        ) -> std::result::Result<OAuthTokenResponse, OAuthProviderError> {
            Err(OAuthProviderError::Network)
        }

        async fn refresh_access_token(
            &self,
            _refresh_token: &str,
        ) -> std::result::Result<OAuthTokenResponse, OAuthProviderError> {
            let _drop_guard = RefreshDropGuard(self.dropped.clone());
            self.started.add_permits(1);
            std::future::pending().await
        }

        async fn revoke_refresh_token(
            &self,
            _refresh_token: &str,
        ) -> std::result::Result<(), OAuthProviderError> {
            Err(OAuthProviderError::Network)
        }
    }

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

    #[tokio::test]
    async fn update_and_create_cancel_a_blocked_real_token_refresh_and_release_operation_resources()
    {
        // Break caught: replacing `refresh_upload_access_token` with a raw
        // `refresh_access_token_after_expiry(...).await` leaves cancellation
        // blocked behind the OAuth client's 30-second timeout.
        for pending_binding in [
            super::super::upload::PendingBindingDisposition::NotApplicable,
            super::super::upload::PendingBindingDisposition::Retain,
        ] {
            let credentials = Arc::new(InMemoryGoogleDriveCredentialStore::default());
            credentials
                .set_refresh_token("user-42", "refresh-token")
                .expect("seed refresh token");
            let provider = Arc::new(BlockingUploadRefreshProvider::default());
            let drive = Arc::new(GoogleDriveState::with_oauth_adapters(
                credentials.clone(),
                Arc::new(UnavailableDriveMetadataClient),
                Arc::new(ConnectedTestSettings::new()),
                provider.clone(),
                Arc::new(DeferredPickerFolderValidator),
                Arc::new(UnavailablePickerBrowser),
                PickerProtocolConfig::new(
                    "desktop-client.apps.googleusercontent.com".to_string(),
                    Duration::from_secs(1),
                ),
            ));
            drive
                .cache_access_token("user-42", "expired-access-token")
                .await;

            let operation_id = Uuid::new_v4();
            let manager = drive.operation_manager.clone();
            let available_resource_slots = manager.available_resource_slots();
            let lease = manager
                .register("user-42", operation_id, "sim-42")
                .expect("operation lease");
            lease.set_phase(DriveOperationPhase::Transferring);
            let attempts = Arc::new(AtomicUsize::new(0));

            let upload = tokio::spawn({
                let drive = drive.clone();
                let attempts = attempts.clone();
                async move {
                    let _resource_slot =
                        lease.acquire_resource_slot().await.expect("resource slot");
                    run_upload_with_single_access_token_refresh(
                        drive.as_ref(),
                        &lease,
                        "user-42",
                        zeroize::Zeroizing::new("expired-access-token".to_string()),
                        |_| {
                            let attempts = attempts.clone();
                            async move {
                                attempts.fetch_add(1, Ordering::SeqCst);
                                Err::<(), _>(DriveUploadFailure {
                                    error: DriveApiError::TokenExpired,
                                    pending_binding,
                                })
                            }
                        },
                    )
                    .await
                }
            });
            provider
                .started
                .acquire()
                .await
                .expect("real refresh started")
                .forget();

            let canceled = tokio::time::timeout(
                Duration::from_millis(500),
                manager.cancel_and_wait("user-42", operation_id, Duration::from_secs(5)),
            )
            .await
            .expect("cancel command contract must not wait for the OAuth HTTP timeout");
            assert!(canceled);

            let failure = tokio::time::timeout(Duration::from_millis(500), upload)
                .await
                .expect("upload task must stop promptly")
                .expect("upload task")
                .expect_err("canceled refresh");
            assert_eq!(failure.error, DriveApiError::Canceled);
            assert_eq!(failure.pending_binding, pending_binding);
            assert_eq!(attempts.load(Ordering::SeqCst), 1);
            assert!(provider.dropped.load(Ordering::SeqCst));
            assert_eq!(manager.active_count(), 0);
            assert_eq!(manager.available_resource_slots(), available_resource_slots);
            let connection = drive.connection_state_for_user("user-42").await;
            assert!(connection.connected);
            assert!(!connection.requires_reconnect);
            assert_eq!(
                credentials
                    .get_refresh_token("user-42")
                    .expect("refresh token after cancellation"),
                Some("refresh-token".to_string())
            );

            let second_cancellation = tokio_util::sync::CancellationToken::new();
            let second_refresh = tokio::spawn({
                let drive = drive.clone();
                let cancellation = second_cancellation.clone();
                async move {
                    refresh_upload_access_token(
                        drive.as_ref(),
                        "user-42",
                        "expired-access-token",
                        &cancellation,
                    )
                    .await
                }
            });
            tokio::time::timeout(Duration::from_millis(500), provider.started.acquire())
                .await
                .expect("canceled refresh must release the per-user OAuth lifecycle lock")
                .expect("second real refresh started")
                .forget();
            second_cancellation.cancel();
            assert_eq!(
                tokio::time::timeout(Duration::from_millis(500), second_refresh)
                    .await
                    .expect("second refresh must cancel promptly")
                    .expect("second refresh task"),
                Err(DriveApiError::Canceled)
            );
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

    #[test]
    fn completed_result_serializes_with_success_fields_and_replacement_flag() {
        let outcome = DriveUploadOutcome {
            file_id: "drive-file-42".to_string(),
            file_name: "song.zip".to_string(),
            download_url: "https://drive.google.com/uc?id=drive-file-42".to_string(),
        };
        let value =
            serde_json::to_value(GoogleDriveUploadResult::completed(outcome, true)).unwrap();
        assert_eq!(value["success"], true);
        assert_eq!(value["fileId"], "drive-file-42");
        assert_eq!(value["fileName"], "song.zip");
        assert_eq!(
            value["downloadUrl"],
            "https://drive.google.com/uc?id=drive-file-42"
        );
        assert_eq!(value["replacedExistingFile"], true);
        assert!(value.get("errorCode").is_none());
        assert!(value.get("error").is_none());
    }

    #[test]
    fn error_code_maps_every_drive_api_variant_to_a_renderer_code() {
        for (api_error, expected) in [
            (DriveApiError::Canceled, GoogleDriveErrorCode::Canceled),
            (
                DriveApiError::UploadInProgress,
                GoogleDriveErrorCode::UploadInProgress,
            ),
            (
                DriveApiError::WorkspaceRequired,
                GoogleDriveErrorCode::WorkspaceRequired,
            ),
            (
                DriveApiError::NotConnected,
                GoogleDriveErrorCode::NotConnected,
            ),
            (
                DriveApiError::FolderRequired,
                GoogleDriveErrorCode::FolderRequired,
            ),
            (
                DriveApiError::TokenExpired,
                GoogleDriveErrorCode::ReconnectRequired,
            ),
            (DriveApiError::Network, GoogleDriveErrorCode::Network),
            (
                DriveApiError::Transient(None),
                GoogleDriveErrorCode::Network,
            ),
            (
                DriveApiError::Transient(Some(Duration::from_secs(1))),
                GoogleDriveErrorCode::Network,
            ),
            (
                DriveApiError::InvalidResponse,
                GoogleDriveErrorCode::InvalidResponse,
            ),
            (
                DriveApiError::InvalidGeneratedId,
                GoogleDriveErrorCode::InvalidResponse,
            ),
            (
                DriveApiError::SessionExpired,
                GoogleDriveErrorCode::InvalidResponse,
            ),
            (DriveApiError::LocalState, GoogleDriveErrorCode::LocalState),
            (
                DriveApiError::CredentialStore,
                GoogleDriveErrorCode::CredentialStore,
            ),
            (
                DriveApiError::NoValidSongFiles,
                GoogleDriveErrorCode::NoValidSongFiles,
            ),
            (
                DriveApiError::InsufficientDiskSpace,
                GoogleDriveErrorCode::InsufficientDiskSpace,
            ),
            (
                DriveApiError::MetadataSync,
                GoogleDriveErrorCode::MetadataSyncFailed,
            ),
            (
                DriveApiError::SimfileUnavailable,
                GoogleDriveErrorCode::SimfileUnavailable,
            ),
            (
                DriveApiError::FolderUnavailable,
                GoogleDriveErrorCode::FolderUnavailable,
            ),
            (
                DriveApiError::DownloadNotPublic,
                GoogleDriveErrorCode::DownloadNotPublic,
            ),
            (
                DriveApiError::SharingCheckUnavailable,
                GoogleDriveErrorCode::SharingCheckUnavailable,
            ),
            (
                DriveApiError::RateLimited(None),
                GoogleDriveErrorCode::RateLimited,
            ),
            (
                DriveApiError::RateLimited(Some(Duration::from_secs(2))),
                GoogleDriveErrorCode::RateLimited,
            ),
            (
                DriveApiError::QuotaExceeded,
                GoogleDriveErrorCode::QuotaExceeded,
            ),
            (DriveApiError::NotFound, GoogleDriveErrorCode::FileNotFound),
            (
                DriveApiError::PermissionDenied,
                GoogleDriveErrorCode::FilePermissionDenied,
            ),
        ] {
            assert_eq!(error_code(api_error), expected);
        }
    }

    #[test]
    fn sanitized_error_message_returns_non_empty_static_text_for_every_code() {
        for code in [
            GoogleDriveErrorCode::WorkspaceRequired,
            GoogleDriveErrorCode::NotConnected,
            GoogleDriveErrorCode::ReconnectRequired,
            GoogleDriveErrorCode::FolderRequired,
            GoogleDriveErrorCode::FolderUnavailable,
            GoogleDriveErrorCode::SharingCheckUnavailable,
            GoogleDriveErrorCode::DownloadNotPublic,
            GoogleDriveErrorCode::SimfileUnavailable,
            GoogleDriveErrorCode::FileNotFound,
            GoogleDriveErrorCode::FilePermissionDenied,
            GoogleDriveErrorCode::UploadInProgress,
            GoogleDriveErrorCode::Canceled,
            GoogleDriveErrorCode::NoValidSongFiles,
            GoogleDriveErrorCode::InsufficientDiskSpace,
            GoogleDriveErrorCode::LocalState,
            GoogleDriveErrorCode::MetadataSyncFailed,
            GoogleDriveErrorCode::RateLimited,
            GoogleDriveErrorCode::QuotaExceeded,
            GoogleDriveErrorCode::Network,
            GoogleDriveErrorCode::CredentialStore,
            GoogleDriveErrorCode::InvalidResponse,
            GoogleDriveErrorCode::Unknown,
        ] {
            let message = sanitized_error_message(code);
            assert!(!message.is_empty(), "{code:?} should have a message");
            assert!(
                !message.contains('{') && !message.contains('}'),
                "{code:?} message must not contain format placeholders"
            );
            // Every failed result must surface the same static text.
            assert_eq!(
                serde_json::to_value(GoogleDriveUploadResult::failed(code)).unwrap()["error"],
                message
            );
        }
    }

    #[test]
    fn oauth_error_preserves_classification_for_every_variant() {
        for (source, expected) in [
            (GoogleDriveOAuthError::Canceled, DriveApiError::Canceled),
            (
                GoogleDriveOAuthError::InvalidResponse,
                DriveApiError::InvalidResponse,
            ),
            (GoogleDriveOAuthError::Network, DriveApiError::Network),
            (
                GoogleDriveOAuthError::ReconnectRequired,
                DriveApiError::TokenExpired,
            ),
            (
                GoogleDriveOAuthError::NotConnected,
                DriveApiError::NotConnected,
            ),
            (
                GoogleDriveOAuthError::CredentialStore,
                DriveApiError::CredentialStore,
            ),
            (GoogleDriveOAuthError::LocalState, DriveApiError::LocalState),
            (
                GoogleDriveOAuthError::AlreadyInProgress,
                DriveApiError::UploadInProgress,
            ),
            (
                GoogleDriveOAuthError::FolderUnavailable,
                DriveApiError::FolderUnavailable,
            ),
            (
                GoogleDriveOAuthError::DownloadNotPublic,
                DriveApiError::DownloadNotPublic,
            ),
            (
                GoogleDriveOAuthError::SharingCheckUnavailable,
                DriveApiError::SharingCheckUnavailable,
            ),
            (GoogleDriveOAuthError::FileNotFound, DriveApiError::NotFound),
            (
                GoogleDriveOAuthError::FilePermissionDenied,
                DriveApiError::PermissionDenied,
            ),
        ] {
            assert_eq!(oauth_error(source), expected);
        }
    }

    #[test]
    fn metadata_error_maps_every_variant() {
        use super::super::DriveMetadataError;
        for (source, expected) in [
            (
                DriveMetadataError::DefinitiveUnavailable,
                DriveApiError::SimfileUnavailable,
            ),
            (
                DriveMetadataError::BindingMismatch,
                DriveApiError::MetadataSync,
            ),
            (
                DriveMetadataError::Authentication,
                DriveApiError::TokenExpired,
            ),
            (DriveMetadataError::Network, DriveApiError::Network),
            (
                DriveMetadataError::ServiceUnavailable,
                DriveApiError::MetadataSync,
            ),
            (
                DriveMetadataError::InvalidResponse,
                DriveApiError::InvalidResponse,
            ),
            (DriveMetadataError::LocalState, DriveApiError::LocalState),
        ] {
            assert_eq!(metadata_error(source), expected);
        }
    }

    #[test]
    fn map_local_upload_error_classifies_known_messages_and_io_codes() {
        assert_eq!(
            map_local_upload_error(DesktopError::Message("CANCELED".to_string())).error,
            DriveApiError::Canceled
        );
        assert_eq!(
            map_local_upload_error(DesktopError::Message("NO_VALID_SONG_FILES".to_string())).error,
            DriveApiError::NoValidSongFiles
        );
        // 28 = ENOSPC (POSIX), 112 = ERROR_DISK_FULL (Windows),
        // 122 = EDQUOT (Linux quota) → InsufficientDiskSpace.
        assert_eq!(
            map_local_upload_error(DesktopError::Io(std::io::Error::from_raw_os_error(28))).error,
            DriveApiError::InsufficientDiskSpace
        );
        assert_eq!(
            map_local_upload_error(DesktopError::Io(std::io::Error::from_raw_os_error(112))).error,
            DriveApiError::InsufficientDiskSpace
        );
        assert_eq!(
            map_local_upload_error(DesktopError::Io(std::io::Error::from_raw_os_error(122))).error,
            DriveApiError::InsufficientDiskSpace
        );
        // EACCES (13) → LocalState (not disk space).
        assert_eq!(
            map_local_upload_error(DesktopError::Io(std::io::Error::from_raw_os_error(13))).error,
            DriveApiError::LocalState
        );
        // Unrecognized message → LocalState.
        assert_eq!(
            map_local_upload_error(DesktopError::Message("unexpected".to_string())).error,
            DriveApiError::LocalState
        );
    }

    #[test]
    fn sanitized_oauth_error_wraps_the_oauth_code_string() {
        for oauth_error in [
            GoogleDriveOAuthError::NotConnected,
            GoogleDriveOAuthError::ReconnectRequired,
            GoogleDriveOAuthError::FolderUnavailable,
        ] {
            let expected_code = oauth_error.code();
            match sanitized_oauth_error(oauth_error) {
                DesktopError::Message(message) => assert_eq!(message, expected_code),
                other => panic!("expected DesktopError::Message, got {other:?}"),
            }
        }
    }

    /// Builds a mock `AppHandle` with the supplied auth and Drive state, plus a
    /// default `WorkspaceRootState` so workspace-dependent commands can resolve
    /// state without panicking.
    fn build_test_app(
        auth: AuthState,
        drive: GoogleDriveState,
    ) -> AppHandle<tauri::test::MockRuntime> {
        use tauri::Manager as _;
        let app = tauri::test::mock_app();
        app.manage(auth);
        app.manage(drive);
        app.manage(WorkspaceRootState::default());
        app.handle().clone()
    }

    async fn authenticated_state(user_id: &str) -> AuthState {
        let auth = AuthState::default();
        auth.set_current_session(Some(serde_json::json!({
            "access_token": "access-token",
            "refresh_token": "refresh-token",
            "user": { "id": user_id }
        })))
        .await;
        auth
    }

    fn connected_drive() -> (Arc<InMemoryGoogleDriveCredentialStore>, GoogleDriveState) {
        let credentials = Arc::new(InMemoryGoogleDriveCredentialStore::default());
        let drive = GoogleDriveState::with_adapters(
            credentials.clone(),
            Arc::new(UnavailableDriveMetadataClient),
            Arc::new(ConnectedTestSettings::new()),
        );
        (credentials, drive)
    }

    #[tokio::test]
    async fn get_google_drive_connection_state_errors_without_session() {
        let (_credentials, drive) = connected_drive();
        let app = build_test_app(AuthState::default(), drive);
        let result = get_google_drive_connection_state(app).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn get_google_drive_connection_state_returns_state_when_authenticated() {
        let credentials = Arc::new(InMemoryGoogleDriveCredentialStore::default());
        credentials
            .set_refresh_token("user-42", "refresh-token")
            .expect("seed refresh token");
        let drive = GoogleDriveState::with_adapters(
            credentials,
            Arc::new(UnavailableDriveMetadataClient),
            Arc::new(ConnectedTestSettings::new()),
        );
        let app = build_test_app(authenticated_state("user-42").await, drive);
        let connection = get_google_drive_connection_state(app)
            .await
            .expect("connection state");
        assert!(connection.connected);
        assert_eq!(
            connection.folder.as_ref().map(|folder| folder.id.as_str()),
            Some("folder-42")
        );
        assert!(!connection.requires_reconnect);
    }

    #[tokio::test]
    async fn disconnect_google_drive_errors_without_session() {
        let (_credentials, drive) = connected_drive();
        let app = build_test_app(AuthState::default(), drive);
        let result = disconnect_google_drive(app).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn disconnect_google_drive_clears_credentials_when_authenticated() {
        let credentials = Arc::new(InMemoryGoogleDriveCredentialStore::default());
        credentials
            .set_refresh_token("user-42", "refresh-token")
            .expect("seed refresh token");
        let drive = GoogleDriveState::with_adapters(
            credentials.clone(),
            Arc::new(UnavailableDriveMetadataClient),
            Arc::new(ConnectedTestSettings::new()),
        );
        let app = build_test_app(authenticated_state("user-42").await, drive);
        let result = disconnect_google_drive(app)
            .await
            .expect("disconnect result");
        // UnavailableOAuthProvider always fails revocation → unconfirmed.
        assert!(result.revocation_unconfirmed);
        assert!(!result.connection.connected);
        assert!(
            credentials
                .get_refresh_token("user-42")
                .expect("credential store after disconnect")
                .is_none(),
            "refresh token must be deleted"
        );
    }

    #[tokio::test]
    async fn cancel_google_drive_upload_rejects_non_v4_operation_id() {
        let (_credentials, drive) = connected_drive();
        let app = build_test_app(authenticated_state("user-42").await, drive);
        // Uuid::nil is version 0, not v4.
        let canceled = cancel_google_drive_upload(app, Uuid::nil())
            .await
            .expect("cancel result");
        assert!(!canceled);
    }

    #[tokio::test]
    async fn cancel_google_drive_upload_errors_without_session() {
        let (_credentials, drive) = connected_drive();
        let app = build_test_app(AuthState::default(), drive);
        // No session is a typed error, not Ok(false): the renderer should not
        // issue Drive commands without an authenticated session.
        let error = cancel_google_drive_upload(app, Uuid::new_v4())
            .await
            .expect_err("no session is a typed error");
        assert!(
            matches!(error, crate::error::DesktopError::Message(ref msg)
                if msg == GoogleDriveOAuthError::NotConnected.code()),
            "expected NOT_CONNECTED error, got: {error:?}"
        );
    }

    #[tokio::test]
    async fn cancel_google_drive_upload_returns_false_for_unknown_operation() {
        let (_credentials, drive) = connected_drive();
        let app = build_test_app(authenticated_state("user-42").await, drive);
        let canceled = cancel_google_drive_upload(app, Uuid::new_v4())
            .await
            .expect("cancel result");
        // Operation was never registered → cancel_and_wait returns false
        // immediately without waiting for the timeout.
        assert!(!canceled);
    }

    #[tokio::test]
    async fn cancel_google_drive_upload_cancels_a_registered_visible_operation() {
        let (_credentials, drive) = connected_drive();
        let operation_id = Uuid::new_v4();
        // Register and hold the lease in a task that drops it once cancelled,
        // so cancel_and_wait observes the completion signal.
        let blocking_lease = drive
            .operation_manager
            .register("user-42", operation_id, "sim-42")
            .expect("operation lease");
        let cancellation = blocking_lease.cancellation().clone();
        tokio::spawn(async move {
            cancellation.cancelled().await;
            drop(blocking_lease);
        });
        let app = build_test_app(authenticated_state("user-42").await, drive);
        let canceled = tokio::time::timeout(
            Duration::from_secs(2),
            cancel_google_drive_upload(app, operation_id),
        )
        .await
        .expect("cancel must not hang")
        .expect("cancel result");
        assert!(canceled);
    }

    #[tokio::test]
    async fn upload_song_zip_rejects_non_v4_operation_id() {
        let (_credentials, drive) = connected_drive();
        let app = build_test_app(authenticated_state("user-42").await, drive);
        let result = upload_song_zip_to_google_drive(
            app,
            UploadSongZipToGoogleDriveInput {
                operation_id: Uuid::nil(),
                simfile_id: "sim-42".to_string(),
                song_relative_path: "pack/song".to_string(),
                force_create_replacement: None,
            },
        )
        .await
        .expect("upload result");
        assert!(!result.success);
        assert_eq!(
            result.error_code,
            Some(GoogleDriveErrorCode::InvalidResponse)
        );
    }

    #[tokio::test]
    async fn upload_song_zip_rejects_blank_simfile_id() {
        let (_credentials, drive) = connected_drive();
        let app = build_test_app(authenticated_state("user-42").await, drive);
        let result = upload_song_zip_to_google_drive(
            app,
            UploadSongZipToGoogleDriveInput {
                operation_id: Uuid::new_v4(),
                simfile_id: "  ".to_string(),
                song_relative_path: "pack/song".to_string(),
                force_create_replacement: None,
            },
        )
        .await
        .expect("upload result");
        assert!(!result.success);
        assert_eq!(
            result.error_code,
            Some(GoogleDriveErrorCode::InvalidResponse)
        );
    }

    #[tokio::test]
    async fn upload_song_zip_rejects_invalid_relative_paths() {
        let (_credentials, drive) = connected_drive();
        let app = build_test_app(authenticated_state("user-42").await, drive);
        for invalid in ["", "/song", "song/", "..", "songs/../chart", r"C:\songs"] {
            let result = upload_song_zip_to_google_drive(
                app.clone(),
                UploadSongZipToGoogleDriveInput {
                    operation_id: Uuid::new_v4(),
                    simfile_id: "sim-42".to_string(),
                    song_relative_path: invalid.to_string(),
                    force_create_replacement: None,
                },
            )
            .await
            .expect("upload result");
            assert!(
                !result.success && result.error_code == Some(GoogleDriveErrorCode::InvalidResponse),
                "{invalid:?} should be rejected"
            );
        }
    }

    #[tokio::test]
    async fn upload_song_zip_returns_not_connected_without_session() {
        let (_credentials, drive) = connected_drive();
        let app = build_test_app(AuthState::default(), drive);
        let result = upload_song_zip_to_google_drive(
            app,
            UploadSongZipToGoogleDriveInput {
                operation_id: Uuid::new_v4(),
                simfile_id: "sim-42".to_string(),
                song_relative_path: "pack/song".to_string(),
                force_create_replacement: None,
            },
        )
        .await
        .expect("upload result");
        assert!(!result.success);
        assert_eq!(result.error_code, Some(GoogleDriveErrorCode::NotConnected));
    }

    #[tokio::test]
    async fn upload_song_zip_returns_upload_in_progress_when_song_already_registered() {
        let (_credentials, drive) = connected_drive();
        // Pre-register the same (user, simfile) with a different operation id
        // and hold the lease so the song key remains claimed.
        let blocking_lease = drive
            .operation_manager
            .register("user-42", Uuid::new_v4(), "sim-42")
            .expect("blocking lease");
        let app = build_test_app(authenticated_state("user-42").await, drive);
        let result = upload_song_zip_to_google_drive(
            app,
            UploadSongZipToGoogleDriveInput {
                operation_id: Uuid::new_v4(),
                simfile_id: "sim-42".to_string(),
                song_relative_path: "pack/song".to_string(),
                force_create_replacement: None,
            },
        )
        .await
        .expect("upload result");
        assert!(!result.success);
        assert_eq!(
            result.error_code,
            Some(GoogleDriveErrorCode::UploadInProgress)
        );
        drop(blocking_lease);
    }

    #[tokio::test]
    async fn emit_progress_broadcasts_sanitized_payload_to_listeners() {
        use tauri::Listener as _;
        let (_credentials, drive) = connected_drive();
        let operation_id = Uuid::new_v4();
        let lease = drive
            .operation_manager
            .register("user-42", operation_id, "sim-42")
            .expect("operation lease");
        let app = build_test_app(AuthState::default(), drive);
        let (sender, receiver) = std::sync::mpsc::channel();
        app.listen(GOOGLE_DRIVE_UPLOAD_PROGRESS_EVENT, move |event| {
            let _ = sender.send(event.payload().to_string());
        });
        emit_progress(
            &app,
            &lease,
            "sim-42",
            GoogleDriveUploadStage::PreparingZip,
            None,
            None,
            None,
        );
        let payload = receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("progress event");
        let value: serde_json::Value = serde_json::from_str(&payload).expect("progress JSON");
        assert_eq!(value["operationId"], operation_id.to_string());
        assert_eq!(value["simfileId"], "sim-42");
        assert_eq!(value["stage"], "preparing-zip");
        assert!(value.get("bytesUploaded").is_none());
        assert!(value.get("errorCode").is_none());
    }

    #[tokio::test]
    async fn emit_transfer_progress_reports_percentage_and_finalizing_at_completion() {
        use tauri::Listener as _;
        let (_credentials, drive) = connected_drive();
        let operation_id = Uuid::new_v4();
        let lease = drive
            .operation_manager
            .register("user-42", operation_id, "sim-42")
            .expect("operation lease");
        let app = build_test_app(AuthState::default(), drive);
        let (sender, receiver) = std::sync::mpsc::channel();
        app.listen(GOOGLE_DRIVE_UPLOAD_PROGRESS_EVENT, move |event| {
            let _ = sender.send(event.payload().to_string());
        });
        // Mid-transfer: accepted < total → Uploading.
        emit_transfer_progress(&app, &lease, "sim-42", 4, 10);
        let mid = receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("mid-transfer event");
        let mid_value: serde_json::Value = serde_json::from_str(&mid).expect("mid JSON");
        assert_eq!(mid_value["stage"], "uploading");
        assert_eq!(mid_value["bytesUploaded"], 4);
        assert_eq!(mid_value["totalBytes"], 10);
        assert_eq!(mid_value["percentage"], 40);
        // Complete: accepted >= total → Finalizing.
        emit_transfer_progress(&app, &lease, "sim-42", 10, 10);
        let done = receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("completion event");
        let done_value: serde_json::Value = serde_json::from_str(&done).expect("done JSON");
        assert_eq!(done_value["stage"], "finalizing");
        assert_eq!(done_value["bytesUploaded"], 10);
        assert_eq!(done_value["totalBytes"], 10);
        assert_eq!(done_value["percentage"], 100);
    }

    #[tokio::test]
    async fn emit_progress_skips_emission_for_non_visible_operations() {
        use tauri::Listener as _;
        let (_credentials, drive) = connected_drive();
        let operation_id = Uuid::new_v4();
        let lease = drive
            .operation_manager
            .register("user-42", operation_id, "sim-42")
            .expect("operation lease");
        // Mark the operation as not visible (e.g. after disconnect clears
        // user-visible state). emit_progress must suppress the event.
        drive.operation_manager.clear_user_visible_state("user-42");
        assert!(!lease.is_visible());
        let app = build_test_app(AuthState::default(), drive);
        let (sender, receiver) = std::sync::mpsc::channel::<String>();
        app.listen(GOOGLE_DRIVE_UPLOAD_PROGRESS_EVENT, move |event| {
            let _ = sender.send(event.payload().to_string());
        });
        emit_progress(
            &app,
            &lease,
            "sim-42",
            GoogleDriveUploadStage::Uploading,
            Some(1),
            Some(2),
            None,
        );
        assert!(
            receiver.recv_timeout(Duration::from_millis(200)).is_err(),
            "non-visible operations must not emit progress"
        );
    }
}
