use crate::auth::{AuthSessionEpoch, AuthState};
use crate::error::{DesktopError, Result};
use async_trait::async_trait;
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::sync::{Notify, OwnedSemaphorePermit, Semaphore};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;
use zeroize::Zeroizing;

use super::drive_client::{
    DriveApiError, DriveChunkResult, DriveCreateMetadata, DriveFile, DriveUpdateMetadata,
    GoogleDriveApi, PublicPermissionStatus,
};
use super::pending_bindings::{
    ExpectedPreviousDriveFile, GoogleDrivePendingBindingStore, PendingBindingKind,
    PendingBindingStoreError, PendingGoogleDriveBinding,
};
use super::{DriveMetadataClient, DriveMetadataError, OwnerDriveSimfile};

const UPLOAD_CACHE_NAMESPACE: &str = "google-drive-uploads";
const UPLOAD_ARCHIVE_NAME: &str = "upload.zip";
const MAX_UPLOAD_RETRIES: usize = 4;
const MAX_FINAL_METADATA_ATTEMPTS: usize = 3;
const RETRY_BASE_DELAY: Duration = Duration::from_millis(100);
const MAX_RETRY_DELAY: Duration = Duration::from_secs(5);
/// Provider-requested Retry-After delays are honored up to this ceiling, which
/// is intentionally larger than `MAX_RETRY_DELAY`: the server explicitly asked
/// us to wait, so we respect that up to a safety bound rather than collapsing
/// it onto the exponential-backoff cap.
const MAX_PROVIDER_RETRY_DELAY: Duration = Duration::from_secs(60);
const MAX_DOWNLOAD_URL_BYTES: usize = 8 * 1024;

pub(crate) const DRIVE_UPLOAD_CHUNK_SIZE: usize = 8 * 1024 * 1024;
const MAX_RESOURCE_USING_OPERATIONS: usize = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DriveOperationPhase {
    Waiting,
    Preparing,
    Connecting,
    Transferring,
    Finalizing,
    Synchronizing,
}

impl DriveOperationPhase {
    fn cancellation_is_allowed(self) -> bool {
        matches!(
            self,
            Self::Waiting | Self::Preparing | Self::Connecting | Self::Transferring
        )
    }
}

struct ActiveDriveOperation {
    user_id: String,
    simfile_id: String,
    cancellation: CancellationToken,
    phase: DriveOperationPhase,
    visible: bool,
    completion: Arc<DriveOperationCompletion>,
}

struct DriveOperationCompletion {
    finished: AtomicBool,
    notify: Notify,
}

impl Default for DriveOperationCompletion {
    fn default() -> Self {
        Self {
            finished: AtomicBool::new(false),
            notify: Notify::new(),
        }
    }
}

impl DriveOperationCompletion {
    fn finish(&self) {
        self.finished.store(true, Ordering::Release);
        self.notify.notify_waiters();
    }

    async fn wait(&self, timeout: Duration) -> bool {
        if self.finished.load(Ordering::Acquire) {
            return true;
        }
        let notified = self.notify.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        if self.finished.load(Ordering::Acquire) {
            return true;
        }
        tokio::time::timeout(timeout, notified).await.is_ok()
            && self.finished.load(Ordering::Acquire)
    }
}

#[derive(Default)]
struct DriveOperationRegistry {
    by_id: HashMap<Uuid, ActiveDriveOperation>,
    songs: HashSet<(String, String)>,
}

/// Process-wide upload admission and cancellation state. `Semaphore`'s queued
/// acquisition is FIFO, and the permit is acquired before any temp directory,
/// resumable session, or chunk buffer is allocated.
pub(crate) struct DriveOperationManager {
    registry: StdMutex<DriveOperationRegistry>,
    resource_slots: Arc<Semaphore>,
}

impl Default for DriveOperationManager {
    fn default() -> Self {
        Self {
            registry: StdMutex::new(DriveOperationRegistry::default()),
            resource_slots: Arc::new(Semaphore::new(MAX_RESOURCE_USING_OPERATIONS)),
        }
    }
}

pub(crate) struct DriveOperationLease {
    manager: Arc<DriveOperationManager>,
    operation_id: Uuid,
    cancellation: CancellationToken,
}

pub(crate) struct DriveFinalizationGate {
    manager: Arc<DriveOperationManager>,
    operation_id: Uuid,
}

impl DriveOperationLease {
    pub(crate) fn operation_id(&self) -> Uuid {
        self.operation_id
    }

    pub(crate) fn cancellation(&self) -> &CancellationToken {
        &self.cancellation
    }

    pub(crate) fn set_phase(&self, phase: DriveOperationPhase) {
        self.manager.set_phase(self.operation_id, phase);
    }

    pub(crate) fn is_visible(&self) -> bool {
        self.manager.is_visible(self.operation_id)
    }

    pub(crate) fn finalization_gate(&self) -> DriveFinalizationGate {
        DriveFinalizationGate {
            manager: self.manager.clone(),
            operation_id: self.operation_id,
        }
    }

    pub(crate) async fn acquire_resource_slot(
        &self,
    ) -> std::result::Result<OwnedSemaphorePermit, DriveApiError> {
        tokio::select! {
            permit = self.manager.resource_slots.clone().acquire_owned() => {
                permit.map_err(|_| DriveApiError::LocalState)
            }
            _ = self.cancellation.cancelled() => Err(DriveApiError::Canceled),
        }
    }
}

impl Drop for DriveOperationLease {
    fn drop(&mut self) {
        self.manager.finish(self.operation_id);
    }
}

impl DriveOperationManager {
    pub(crate) fn register(
        self: &Arc<Self>,
        user_id: &str,
        operation_id: Uuid,
        simfile_id: &str,
    ) -> std::result::Result<DriveOperationLease, DriveApiError> {
        let mut registry = self
            .registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let song_key = (user_id.to_string(), simfile_id.to_string());
        if registry.by_id.contains_key(&operation_id) || registry.songs.contains(&song_key) {
            return Err(DriveApiError::UploadInProgress);
        }
        let cancellation = CancellationToken::new();
        let completion = Arc::new(DriveOperationCompletion::default());
        registry.songs.insert(song_key);
        registry.by_id.insert(
            operation_id,
            ActiveDriveOperation {
                user_id: user_id.to_string(),
                simfile_id: simfile_id.to_string(),
                cancellation: cancellation.clone(),
                phase: DriveOperationPhase::Waiting,
                visible: true,
                completion,
            },
        );
        Ok(DriveOperationLease {
            manager: self.clone(),
            operation_id,
            cancellation,
        })
    }

    pub(crate) fn cancel(&self, user_id: &str, operation_id: Uuid) -> bool {
        let registry = self
            .registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(operation) = registry.by_id.get(&operation_id) else {
            return false;
        };
        if !operation.visible
            || operation.user_id != user_id
            || !operation.phase.cancellation_is_allowed()
        {
            return false;
        }
        operation.cancellation.cancel();
        true
    }

    pub(crate) async fn cancel_and_wait(
        &self,
        user_id: &str,
        operation_id: Uuid,
        timeout: Duration,
    ) -> bool {
        let completion = {
            let registry = self
                .registry
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let Some(operation) = registry.by_id.get(&operation_id) else {
                return false;
            };
            if !operation.visible
                || operation.user_id != user_id
                || !operation.phase.cancellation_is_allowed()
            {
                return false;
            }
            operation.cancellation.cancel();
            operation.completion.clone()
        };
        completion.wait(timeout).await
    }

    pub(crate) fn clear_user_visible_state(&self, user_id: &str) {
        let mut registry = self
            .registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        for operation in registry
            .by_id
            .values_mut()
            .filter(|operation| operation.user_id == user_id)
        {
            operation.visible = false;
            if operation.phase.cancellation_is_allowed() {
                operation.cancellation.cancel();
            }
        }
    }

    fn set_phase(&self, operation_id: Uuid, phase: DriveOperationPhase) {
        if let Some(operation) = self
            .registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .by_id
            .get_mut(&operation_id)
        {
            operation.phase = phase;
        }
    }

    fn is_visible(&self, operation_id: Uuid) -> bool {
        self.registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .by_id
            .get(&operation_id)
            .is_some_and(|operation| operation.visible)
    }

    fn begin_finalization(&self, operation_id: Uuid) -> bool {
        let mut registry = self
            .registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(operation) = registry.by_id.get_mut(&operation_id) else {
            return false;
        };
        if matches!(
            operation.phase,
            DriveOperationPhase::Finalizing | DriveOperationPhase::Synchronizing
        ) {
            return true;
        }
        if operation.cancellation.is_cancelled() {
            return false;
        }
        operation.phase = DriveOperationPhase::Finalizing;
        true
    }

    fn finish(&self, operation_id: Uuid) {
        let mut registry = self
            .registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(operation) = registry.by_id.remove(&operation_id) {
            registry
                .songs
                .remove(&(operation.user_id, operation.simfile_id));
            operation.completion.finish();
        }
    }

    #[cfg(test)]
    pub(crate) fn active_count(&self) -> usize {
        self.registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .by_id
            .len()
    }

    #[cfg(test)]
    pub(crate) fn available_resource_slots(&self) -> usize {
        self.resource_slots.available_permits()
    }
}

impl DriveFinalizationGate {
    fn try_enter(&self) -> bool {
        self.manager.begin_finalization(self.operation_id)
    }
}

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

#[derive(Debug, Default)]
pub(crate) struct MonotonicDriveProgress {
    last_emitted: Option<(u64, u64)>,
}

impl MonotonicDriveProgress {
    pub(crate) fn should_emit(&mut self, accepted: u64, total: u64) -> bool {
        if total == 0 || accepted > total {
            return false;
        }
        if self.last_emitted.is_some_and(|(previous, previous_total)| {
            total != previous_total || accepted <= previous
        }) {
            return false;
        }
        self.last_emitted = Some((accepted, total));
        true
    }
}

pub(crate) async fn run_with_single_access_token_refresh<
    T,
    Run,
    RunFuture,
    BeforeRefresh,
    Refresh,
    RefreshFuture,
>(
    initial_access_token: Zeroizing<String>,
    mut run: Run,
    mut before_refresh: BeforeRefresh,
    mut refresh: Refresh,
) -> std::result::Result<T, DriveUploadFailure>
where
    Run: FnMut(Zeroizing<String>) -> RunFuture,
    RunFuture: Future<Output = std::result::Result<T, DriveUploadFailure>>,
    BeforeRefresh: FnMut(),
    Refresh: FnMut(Zeroizing<String>) -> RefreshFuture,
    RefreshFuture: Future<Output = std::result::Result<Zeroizing<String>, DriveApiError>>,
{
    let first_result = run(Zeroizing::new(initial_access_token.to_string())).await;
    let first_failure = match first_result {
        Ok(value) => return Ok(value),
        Err(failure) if failure.error == DriveApiError::TokenExpired => failure,
        Err(failure) => return Err(failure),
    };
    before_refresh();
    let replacement = refresh(initial_access_token)
        .await
        .map_err(|error| DriveUploadFailure {
            error,
            pending_binding: first_failure.pending_binding,
        })?;
    run(replacement).await
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CrashSafeCreateRequest {
    pub(crate) simfile_id: String,
    pub(crate) archive_path: PathBuf,
    pub(crate) folder_id: String,
    pub(crate) kind: PendingBindingKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub(crate) enum CreateCrashPoint {
    AfterBindingPersisted,
    AfterFreshIdPersisted,
    AfterUploadValidated,
    BeforeMetadataPatchRetry,
    AfterMetadataPatch,
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
        None,
        None,
        on_progress,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_crash_safe_create_cancelable<A, S, F>(
    api: &A,
    sleeper: &S,
    pending_store: &GoogleDrivePendingBindingStore,
    metadata_client: &dyn DriveMetadataClient,
    auth: &AuthState,
    access_token: &str,
    request: CrashSafeCreateRequest,
    cancellation: &CancellationToken,
    finalization_gate: &DriveFinalizationGate,
    on_progress: F,
) -> std::result::Result<DriveUploadOutcome, DriveUploadFailure>
where
    A: GoogleDriveApi + ?Sized,
    S: DriveSleeper + ?Sized,
    F: FnMut(u64, u64),
{
    run_crash_safe_create_with_chunk_size(
        api,
        sleeper,
        pending_store,
        metadata_client,
        auth,
        access_token,
        request,
        DRIVE_UPLOAD_CHUNK_SIZE,
        None,
        Some(cancellation),
        Some(finalization_gate),
        on_progress,
    )
    .await
}

pub(crate) async fn run_resumable_upload_cancelable<A, S, F>(
    api: &A,
    sleeper: &S,
    access_token: &str,
    request: DriveUploadRequest,
    cancellation: &CancellationToken,
    finalization_gate: &DriveFinalizationGate,
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
        Some(cancellation),
        Some(finalization_gate),
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
        None,
        None,
        on_progress,
    )
    .await
}

#[allow(dead_code)]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_crash_safe_create<A, S, F>(
    api: &A,
    sleeper: &S,
    pending_store: &GoogleDrivePendingBindingStore,
    metadata_client: &dyn DriveMetadataClient,
    auth: &AuthState,
    access_token: &str,
    request: CrashSafeCreateRequest,
    on_progress: F,
) -> std::result::Result<DriveUploadOutcome, DriveUploadFailure>
where
    A: GoogleDriveApi + ?Sized,
    S: DriveSleeper + ?Sized,
    F: FnMut(u64, u64),
{
    run_crash_safe_create_with_chunk_size(
        api,
        sleeper,
        pending_store,
        metadata_client,
        auth,
        access_token,
        request,
        DRIVE_UPLOAD_CHUNK_SIZE,
        None,
        None,
        None,
        on_progress,
    )
    .await
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_crash_safe_create_for_test<A, S, F>(
    api: &A,
    sleeper: &S,
    pending_store: &GoogleDrivePendingBindingStore,
    metadata_client: &dyn DriveMetadataClient,
    auth: &AuthState,
    access_token: &str,
    request: CrashSafeCreateRequest,
    chunk_size: usize,
    crash_at: Option<CreateCrashPoint>,
    on_progress: F,
) -> std::result::Result<DriveUploadOutcome, DriveUploadFailure>
where
    A: GoogleDriveApi + ?Sized,
    S: DriveSleeper + ?Sized,
    F: FnMut(u64, u64),
{
    run_crash_safe_create_with_chunk_size(
        api,
        sleeper,
        pending_store,
        metadata_client,
        auth,
        access_token,
        request,
        chunk_size,
        crash_at,
        None,
        None,
        on_progress,
    )
    .await
}

#[allow(dead_code)]
pub(crate) async fn reconcile_pending_bindings_for_current_user<A>(
    api: &A,
    pending_store: &GoogleDrivePendingBindingStore,
    metadata_client: &dyn DriveMetadataClient,
    auth: &AuthState,
    access_token: &str,
) where
    A: GoogleDriveApi + ?Sized,
{
    let Some(expected_epoch) = auth.current_session_epoch().await else {
        return;
    };
    reconcile_pending_bindings_for_session(
        api,
        pending_store,
        metadata_client,
        auth,
        &expected_epoch,
        access_token,
    )
    .await;
}

pub(crate) async fn reconcile_pending_bindings_for_session<A>(
    api: &A,
    pending_store: &GoogleDrivePendingBindingStore,
    metadata_client: &dyn DriveMetadataClient,
    auth: &AuthState,
    expected_epoch: &AuthSessionEpoch,
    access_token: &str,
) where
    A: GoogleDriveApi + ?Sized,
{
    if !auth.matches_session_epoch(expected_epoch).await {
        return;
    }
    let user_id = expected_epoch.user_id();
    let Ok(bindings) = pending_store.all() else {
        return;
    };
    for pending in bindings
        .into_iter()
        .filter(|pending| pending.user_id == user_id)
    {
        let transaction_lock =
            pending_store.transaction_lock(&pending.user_id, &pending.simfile_id);
        let _transaction_guard = transaction_lock.lock().await;
        if !auth.matches_session_epoch(expected_epoch).await {
            return;
        }
        let pending = match pending_store.get(&pending.user_id, &pending.simfile_id) {
            Ok(Some(pending)) => pending,
            Ok(None) | Err(_) => continue,
        };
        let owner_result = metadata_client
            .fetch_owner_simfile(auth, &pending.simfile_id)
            .await;
        if !auth.matches_session_epoch(expected_epoch).await {
            return;
        }
        let owner = match owner_result {
            Ok(owner) if owner.id == pending.simfile_id => owner,
            Ok(_) => continue,
            Err(DriveMetadataError::DefinitiveUnavailable) => {
                let _ = compensate_lost_owner(
                    api,
                    pending_store,
                    access_token,
                    Some(&pending),
                    Some((auth, expected_epoch)),
                )
                .await;
                if !auth.matches_session_epoch(expected_epoch).await {
                    return;
                }
                continue;
            }
            Err(_) => continue,
        };

        if owner.google_drive_file_id.as_deref() == Some(pending.drive_file_id.as_str())
            && validated_download_url(owner.download_url.as_deref())
                .is_ok_and(|value| value.is_some())
        {
            if !auth.matches_session_epoch(expected_epoch).await {
                return;
            }
            let _ = remove_pending_binding(pending_store, &pending);
            continue;
        }

        let file_result = api.get_file(access_token, &pending.drive_file_id).await;
        if !auth.matches_session_epoch(expected_epoch).await {
            return;
        }
        let file = match file_result {
            Ok(file) => file,
            Err(_) => continue,
        };
        // Resolve the optimistic-concurrency guard for the metadata patch.
        // Legacy pending bindings (persisted before the
        // `expected_previous_drive_file` field existed) have `None` here.
        // For legacy FirstUpload records, safely infer `None` (expect no
        // existing Drive file ID). For legacy ExplicitReplacement records,
        // the original file ID cannot be reconstructed in general, so we
        // cannot guard the patch — fail closed by compensating (delete the
        // orphaned Drive file and remove the pending binding) rather than
        // issuing an unconditional patch that could overwrite a newer binding
        // established by another device.
        //
        // Exception: when the owner's current `google_drive_file_id` already
        // matches the pending `drive_file_id`, the replacement already
        // happened (possibly on another device) and the file is actively
        // referenced. Deleting it would break the existing binding. In that
        // case, infer the guard as `DriveFile(pending.drive_file_id)` — the
        // patch only succeeds if the server's binding still matches, making
        // it a safe URL-only update. If the binding changed in the meantime,
        // the guarded patch fails and `patch_and_finish` compensates.
        let inferred_none = ExpectedPreviousDriveFile::None;
        let inferred_already_referenced = owner_references_pending_file(&owner, &pending)
            .then(|| ExpectedPreviousDriveFile::DriveFile(pending.drive_file_id.clone()));
        let resolved_expected_previous: Option<&ExpectedPreviousDriveFile> =
            match pending.expected_previous_drive_file.as_ref() {
                Some(expected) => Some(expected),
                None => match pending.kind {
                    PendingBindingKind::FirstUpload => Some(&inferred_none),
                    PendingBindingKind::ExplicitReplacement => match &inferred_already_referenced {
                        Some(referenced) => Some(referenced),
                        None => {
                            let _ = compensate_pending_failure(
                                api,
                                pending_store,
                                access_token,
                                &pending,
                                DriveApiError::MetadataSync,
                                Some((auth, expected_epoch)),
                            )
                            .await;
                            if !auth.matches_session_epoch(expected_epoch).await {
                                return;
                            }
                            continue;
                        }
                    },
                },
            };
        let _ = finish_existing_pending_file(
            api,
            pending_store,
            metadata_client,
            auth,
            access_token,
            &pending.simfile_id,
            &pending,
            &owner,
            resolved_expected_previous,
            file,
            None,
            Some((auth, expected_epoch)),
        )
        .await;
        if !auth.matches_session_epoch(expected_epoch).await {
            return;
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_crash_safe_create_with_chunk_size<A, S, F>(
    api: &A,
    sleeper: &S,
    pending_store: &GoogleDrivePendingBindingStore,
    metadata_client: &dyn DriveMetadataClient,
    auth: &AuthState,
    access_token: &str,
    request: CrashSafeCreateRequest,
    chunk_size: usize,
    crash_at: Option<CreateCrashPoint>,
    cancellation: Option<&CancellationToken>,
    finalization_gate: Option<&DriveFinalizationGate>,
    mut on_progress: F,
) -> std::result::Result<DriveUploadOutcome, DriveUploadFailure>
where
    A: GoogleDriveApi + ?Sized,
    S: DriveSleeper + ?Sized,
    F: FnMut(u64, u64),
{
    ensure_not_canceled(cancellation).map_err(create_failure)?;
    let user_id = auth
        .current_user_id()
        .await
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| create_failure(DriveApiError::SimfileUnavailable))?;
    let transaction_lock = pending_store.transaction_lock(&user_id, &request.simfile_id);
    let _transaction_guard = transaction_lock.lock().await;
    let pending = pending_store
        .get(&user_id, &request.simfile_id)
        .map_err(pending_store_failure)?;
    let had_pending_binding = pending.is_some();

    // Re-fetch owner metadata inside the transaction lock. The caller
    // (commands.rs) already fetched this to choose between Update and Create,
    // but that read happened before lock acquisition. Re-validating here is
    // intentional defense-in-depth: it guards against the owner row changing
    // between the routing decision and the critical section, and lets us
    // re-check `owner.id == request.simfile_id` and run
    // `compensate_lost_owner` on `DefinitiveUnavailable` while holding the lock.
    let owner = match metadata_client
        .fetch_owner_simfile(auth, &request.simfile_id)
        .await
    {
        Ok(owner) if owner.id == request.simfile_id => owner,
        Ok(_) => return Err(create_failure(DriveApiError::InvalidResponse)),
        Err(DriveMetadataError::DefinitiveUnavailable) => {
            return compensate_lost_owner(api, pending_store, access_token, pending.as_ref(), None)
                .await;
        }
        Err(error) => return Err(create_failure(metadata_error(error))),
    };
    ensure_not_canceled(cancellation).map_err(create_failure)?;

    let pending = match pending {
        Some(pending) => pending,
        None => {
            if request.kind == PendingBindingKind::FirstUpload
                && owner
                    .google_drive_file_id
                    .as_deref()
                    .is_some_and(|id| !id.trim().is_empty())
            {
                return Err(create_failure(DriveApiError::InvalidResponse));
            }
            let generated_id = await_cancelable(api.generate_id(access_token), cancellation)
                .await
                .map_err(create_failure)?;
            ensure_not_canceled(cancellation).map_err(create_failure)?;
            let expected_previous_drive_file = match request.kind {
                PendingBindingKind::FirstUpload => Some(ExpectedPreviousDriveFile::None),
                PendingBindingKind::ExplicitReplacement => owner
                    .google_drive_file_id
                    .as_deref()
                    .filter(|id| !id.trim().is_empty())
                    .map(|id| ExpectedPreviousDriveFile::DriveFile(id.to_string())),
            };
            let pending = PendingGoogleDriveBinding {
                user_id: user_id.clone(),
                simfile_id: request.simfile_id.clone(),
                drive_file_id: generated_id,
                kind: request.kind,
                created_at: pending_created_at(),
                expected_previous_drive_file,
            };
            pending_store
                .replace(pending.clone())
                .map_err(pending_store_failure)?;
            maybe_inject_crash(crash_at, CreateCrashPoint::AfterBindingPersisted)?;
            pending
        }
    };

    if had_pending_binding {
        ensure_not_canceled(cancellation).map_err(create_failure)?;
        if owner.google_drive_file_id.as_deref() == Some(pending.drive_file_id.as_str()) {
            if let Ok(Some(download_url)) = validated_download_url(owner.download_url.as_deref()) {
                enter_finalization(finalization_gate, cancellation).map_err(create_failure)?;
                remove_pending_binding(pending_store, &pending)?;
                return Ok(DriveUploadOutcome {
                    file_id: pending.drive_file_id,
                    file_name: sanitize_drive_zip_name(&owner.title, &request.simfile_id),
                    download_url,
                });
            }
        }

        match await_cancelable(
            api.get_file(access_token, &pending.drive_file_id),
            cancellation,
        )
        .await
        {
            Ok(file) => {
                enter_finalization(finalization_gate, cancellation).map_err(create_failure)?;
                return finish_existing_pending_file(
                    api,
                    pending_store,
                    metadata_client,
                    auth,
                    access_token,
                    &request.simfile_id,
                    &pending,
                    &owner,
                    pending.expected_previous_drive_file.as_ref(),
                    file,
                    crash_at,
                    None,
                )
                .await;
            }
            Err(DriveApiError::NotFound) => {}
            Err(error) => return Err(create_failure(error)),
        }
    }

    create_from_pending(
        api,
        sleeper,
        pending_store,
        metadata_client,
        auth,
        access_token,
        &request,
        pending,
        owner,
        chunk_size,
        crash_at,
        cancellation,
        finalization_gate,
        &mut on_progress,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn create_from_pending<A, S, F>(
    api: &A,
    sleeper: &S,
    pending_store: &GoogleDrivePendingBindingStore,
    metadata_client: &dyn DriveMetadataClient,
    auth: &AuthState,
    access_token: &str,
    request: &CrashSafeCreateRequest,
    mut pending: PendingGoogleDriveBinding,
    owner: OwnerDriveSimfile,
    chunk_size: usize,
    crash_at: Option<CreateCrashPoint>,
    cancellation: Option<&CancellationToken>,
    finalization_gate: Option<&DriveFinalizationGate>,
    on_progress: &mut F,
) -> std::result::Result<DriveUploadOutcome, DriveUploadFailure>
where
    A: GoogleDriveApi + ?Sized,
    S: DriveSleeper + ?Sized,
    F: FnMut(u64, u64),
{
    let mut rotated = false;
    loop {
        ensure_not_canceled(cancellation).map_err(create_failure)?;
        let upload = run_resumable_upload_with_chunk_size(
            api,
            sleeper,
            access_token,
            DriveUploadRequest {
                simfile_id: request.simfile_id.clone(),
                saved_title: owner.title.clone(),
                archive_path: request.archive_path.clone(),
                target: DriveUploadTarget::Create {
                    generated_id: pending.drive_file_id.clone(),
                    folder_id: request.folder_id.clone(),
                },
            },
            chunk_size,
            cancellation,
            finalization_gate,
            &mut *on_progress,
        )
        .await;
        let outcome = match upload {
            Ok(outcome) => outcome,
            Err(failure) if failure.error == DriveApiError::InvalidGeneratedId && !rotated => {
                match await_cancelable(
                    api.get_file(access_token, &pending.drive_file_id),
                    cancellation,
                )
                .await
                {
                    Ok(file) => {
                        enter_finalization(finalization_gate, cancellation)
                            .map_err(create_failure)?;
                        return finish_existing_pending_file(
                            api,
                            pending_store,
                            metadata_client,
                            auth,
                            access_token,
                            &request.simfile_id,
                            &pending,
                            &owner,
                            pending.expected_previous_drive_file.as_ref(),
                            file,
                            crash_at,
                            None,
                        )
                        .await;
                    }
                    Err(DriveApiError::NotFound) => {
                        let fresh_id =
                            await_cancelable(api.generate_id(access_token), cancellation)
                                .await
                                .map_err(create_failure)?;
                        ensure_not_canceled(cancellation).map_err(create_failure)?;
                        pending.drive_file_id = fresh_id;
                        pending.created_at = pending_created_at();
                        pending_store
                            .replace(pending.clone())
                            .map_err(pending_store_failure)?;
                        maybe_inject_crash(crash_at, CreateCrashPoint::AfterFreshIdPersisted)?;
                        rotated = true;
                        continue;
                    }
                    Err(error) => return Err(create_failure(error)),
                }
            }
            Err(failure) => {
                if failure.pending_binding == PendingBindingDisposition::DeleteConfirmed {
                    remove_pending_binding(pending_store, &pending)?;
                }
                return Err(failure);
            }
        };

        maybe_inject_crash(crash_at, CreateCrashPoint::AfterUploadValidated)?;
        return patch_and_finish(
            api,
            pending_store,
            metadata_client,
            auth,
            access_token,
            &request.simfile_id,
            &pending,
            &owner,
            pending.expected_previous_drive_file.as_ref(),
            outcome,
            crash_at,
            None,
        )
        .await;
    }
}

#[allow(clippy::too_many_arguments)]
async fn finish_existing_pending_file<A>(
    api: &A,
    pending_store: &GoogleDrivePendingBindingStore,
    metadata_client: &dyn DriveMetadataClient,
    auth: &AuthState,
    access_token: &str,
    simfile_id: &str,
    pending: &PendingGoogleDriveBinding,
    prior_owner: &OwnerDriveSimfile,
    expected_previous: Option<&ExpectedPreviousDriveFile>,
    file: DriveFile,
    crash_at: Option<CreateCrashPoint>,
    reconciliation_session: Option<(&AuthState, &AuthSessionEpoch)>,
) -> std::result::Result<DriveUploadOutcome, DriveUploadFailure>
where
    A: GoogleDriveApi + ?Sized,
{
    ensure_reconciliation_session(reconciliation_session).await?;
    let validation = match validate_final_file_shape(&file, &pending.drive_file_id).and_then(|()| {
        validated_download_url(file.web_content_link.as_deref())?
            .ok_or(DriveApiError::InvalidResponse)
    }) {
        Ok(download_url) => require_public_permission(api, access_token, &pending.drive_file_id)
            .await
            .map(|()| download_url),
        Err(error) => Err(error),
    };
    ensure_reconciliation_session(reconciliation_session).await?;
    let download_url = match validation {
        Ok(download_url) => download_url,
        Err(DriveApiError::TokenExpired) => {
            return Err(create_failure(DriveApiError::TokenExpired));
        }
        Err(error) => {
            if owner_references_pending_file(prior_owner, pending) {
                return Err(create_failure(error));
            }
            return compensate_pending_failure(
                api,
                pending_store,
                access_token,
                pending,
                error,
                reconciliation_session,
            )
            .await;
        }
    };
    patch_and_finish(
        api,
        pending_store,
        metadata_client,
        auth,
        access_token,
        simfile_id,
        pending,
        prior_owner,
        expected_previous,
        DriveUploadOutcome {
            file_id: pending.drive_file_id.clone(),
            file_name: file.name,
            download_url,
        },
        crash_at,
        reconciliation_session,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn patch_and_finish<A>(
    api: &A,
    pending_store: &GoogleDrivePendingBindingStore,
    metadata_client: &dyn DriveMetadataClient,
    auth: &AuthState,
    access_token: &str,
    simfile_id: &str,
    pending: &PendingGoogleDriveBinding,
    prior_owner: &OwnerDriveSimfile,
    expected_previous: Option<&ExpectedPreviousDriveFile>,
    outcome: DriveUploadOutcome,
    crash_at: Option<CreateCrashPoint>,
    reconciliation_session: Option<(&AuthState, &AuthSessionEpoch)>,
) -> std::result::Result<DriveUploadOutcome, DriveUploadFailure>
where
    A: GoogleDriveApi + ?Sized,
{
    for attempt in 0..2 {
        ensure_reconciliation_session(reconciliation_session).await?;
        let patch_result = metadata_client
            .update_drive_file(
                auth,
                simfile_id,
                &outcome.file_id,
                &outcome.download_url,
                expected_previous,
            )
            .await;
        ensure_reconciliation_session(reconciliation_session).await?;
        if patch_result.as_ref().is_ok_and(|updated| {
            owner_has_drive_binding(updated, simfile_id, &outcome.file_id, &outcome.download_url)
        }) {
            maybe_inject_crash(crash_at, CreateCrashPoint::AfterMetadataPatch)?;
            ensure_reconciliation_session(reconciliation_session).await?;
            remove_pending_binding(pending_store, pending)?;
            return Ok(outcome);
        }

        let current_owner = metadata_client.fetch_owner_simfile(auth, simfile_id).await;
        ensure_reconciliation_session(reconciliation_session).await?;
        match current_owner {
            Ok(current)
                if owner_has_drive_binding(
                    &current,
                    simfile_id,
                    &outcome.file_id,
                    &outcome.download_url,
                ) =>
            {
                maybe_inject_crash(crash_at, CreateCrashPoint::AfterMetadataPatch)?;
                ensure_reconciliation_session(reconciliation_session).await?;
                remove_pending_binding(pending_store, pending)?;
                return Ok(outcome);
            }
            Ok(current) if owner_binding_matches(&current, prior_owner) => {}
            Ok(_) => {
                // The owner's Drive binding changed since prior_owner was
                // fetched — another device established a newer binding. The
                // pending file is superseded; compensate (delete the orphaned
                // Drive file and remove the pending binding) rather than
                // overwriting the newer binding.
                return compensate_pending_failure(
                    api,
                    pending_store,
                    access_token,
                    pending,
                    DriveApiError::MetadataSync,
                    reconciliation_session,
                )
                .await;
            }
            Err(DriveMetadataError::DefinitiveUnavailable) => {
                if owner_references_pending_file(prior_owner, pending) {
                    return Err(create_failure(DriveApiError::SimfileUnavailable));
                }
                return compensate_lost_owner(
                    api,
                    pending_store,
                    access_token,
                    Some(pending),
                    reconciliation_session,
                )
                .await;
            }
            Err(_) => return Err(create_failure(DriveApiError::MetadataSync)),
        }
        let transient = matches!(
            patch_result,
            Err(DriveMetadataError::Network | DriveMetadataError::ServiceUnavailable)
        );
        if attempt == 0 && transient {
            maybe_inject_crash(crash_at, CreateCrashPoint::BeforeMetadataPatchRetry)?;
            continue;
        }
        break;
    }

    if owner_references_pending_file(prior_owner, pending) {
        return Err(create_failure(DriveApiError::MetadataSync));
    }
    compensate_pending_failure(
        api,
        pending_store,
        access_token,
        pending,
        DriveApiError::MetadataSync,
        reconciliation_session,
    )
    .await
}

pub(crate) async fn patch_existing_upload(
    metadata_client: &dyn DriveMetadataClient,
    auth: &AuthState,
    prior_owner: &OwnerDriveSimfile,
    outcome: DriveUploadOutcome,
) -> std::result::Result<DriveUploadOutcome, DriveUploadFailure> {
    // Guard the in-place update against a concurrent replacement: only
    // apply the patch if the server-side Drive binding still matches what
    // we observed before the upload. Without this, a second device that
    // replaced the file while we were uploading would have its newer
    // binding overwritten by our stale download URL.
    let expected_previous = prior_owner
        .google_drive_file_id
        .as_deref()
        .filter(|id| !id.trim().is_empty())
        .map(|id| ExpectedPreviousDriveFile::DriveFile(id.to_string()));
    for attempt in 0..2 {
        let patch = metadata_client
            .update_drive_file(
                auth,
                &prior_owner.id,
                &outcome.file_id,
                &outcome.download_url,
                expected_previous.as_ref(),
            )
            .await;
        if patch.as_ref().is_ok_and(|updated| {
            owner_has_drive_binding(
                updated,
                &prior_owner.id,
                &outcome.file_id,
                &outcome.download_url,
            )
        }) {
            return Ok(outcome);
        }

        match metadata_client
            .fetch_owner_simfile(auth, &prior_owner.id)
            .await
        {
            Ok(current)
                if owner_has_drive_binding(
                    &current,
                    &prior_owner.id,
                    &outcome.file_id,
                    &outcome.download_url,
                ) =>
            {
                return Ok(outcome);
            }
            Ok(current) if owner_binding_matches(&current, prior_owner) => {}
            Ok(_) | Err(DriveMetadataError::DefinitiveUnavailable) => {
                return Err(upload_failure(
                    DriveApiError::MetadataSync,
                    &DriveUploadTarget::Update {
                        file_id: outcome.file_id.clone(),
                    },
                ));
            }
            Err(_) => {}
        }

        let transient = matches!(
            patch,
            Err(DriveMetadataError::Network | DriveMetadataError::ServiceUnavailable)
        );
        if attempt == 0 && transient {
            continue;
        }
        return Err(upload_failure(
            DriveApiError::MetadataSync,
            &DriveUploadTarget::Update {
                file_id: outcome.file_id.clone(),
            },
        ));
    }
    Err(upload_failure(
        DriveApiError::MetadataSync,
        &DriveUploadTarget::Update {
            file_id: outcome.file_id.clone(),
        },
    ))
}

fn owner_references_pending_file(
    owner: &OwnerDriveSimfile,
    pending: &PendingGoogleDriveBinding,
) -> bool {
    owner.google_drive_file_id.as_deref() == Some(pending.drive_file_id.as_str())
}

fn owner_has_drive_binding(
    owner: &OwnerDriveSimfile,
    simfile_id: &str,
    drive_file_id: &str,
    download_url: &str,
) -> bool {
    owner.id == simfile_id
        && owner.google_drive_file_id.as_deref() == Some(drive_file_id)
        && owner.download_url.as_deref() == Some(download_url)
}

fn owner_binding_matches(current: &OwnerDriveSimfile, prior_owner: &OwnerDriveSimfile) -> bool {
    current.id == prior_owner.id
        && current.google_drive_file_id == prior_owner.google_drive_file_id
        && current.download_url == prior_owner.download_url
}

async fn compensate_lost_owner<A>(
    api: &A,
    pending_store: &GoogleDrivePendingBindingStore,
    access_token: &str,
    pending: Option<&PendingGoogleDriveBinding>,
    reconciliation_session: Option<(&AuthState, &AuthSessionEpoch)>,
) -> std::result::Result<DriveUploadOutcome, DriveUploadFailure>
where
    A: GoogleDriveApi + ?Sized,
{
    ensure_reconciliation_session(reconciliation_session).await?;
    let Some(pending) = pending else {
        return Err(create_failure(DriveApiError::SimfileUnavailable));
    };
    compensate_pending_failure(
        api,
        pending_store,
        access_token,
        pending,
        DriveApiError::SimfileUnavailable,
        reconciliation_session,
    )
    .await
}

async fn compensate_pending_failure<A>(
    api: &A,
    pending_store: &GoogleDrivePendingBindingStore,
    access_token: &str,
    pending: &PendingGoogleDriveBinding,
    error: DriveApiError,
    reconciliation_session: Option<(&AuthState, &AuthSessionEpoch)>,
) -> std::result::Result<DriveUploadOutcome, DriveUploadFailure>
where
    A: GoogleDriveApi + ?Sized,
{
    ensure_reconciliation_session(reconciliation_session).await?;
    let delete_result = api.delete_file(access_token, &pending.drive_file_id).await;
    ensure_reconciliation_session(reconciliation_session).await?;
    let disposition = match delete_result {
        Ok(()) | Err(DriveApiError::NotFound) => {
            ensure_reconciliation_session(reconciliation_session).await?;
            remove_pending_binding(pending_store, pending)?;
            PendingBindingDisposition::DeleteConfirmed
        }
        Err(_) => PendingBindingDisposition::Retain,
    };
    Err(DriveUploadFailure {
        error,
        pending_binding: disposition,
    })
}

async fn ensure_reconciliation_session(
    reconciliation_session: Option<(&AuthState, &AuthSessionEpoch)>,
) -> std::result::Result<(), DriveUploadFailure> {
    let Some((auth, expected_epoch)) = reconciliation_session else {
        return Ok(());
    };
    if auth.matches_session_epoch(expected_epoch).await {
        Ok(())
    } else {
        Err(create_failure(DriveApiError::LocalState))
    }
}

fn remove_pending_binding(
    pending_store: &GoogleDrivePendingBindingStore,
    pending: &PendingGoogleDriveBinding,
) -> std::result::Result<(), DriveUploadFailure> {
    match pending_store.remove_if_matches(
        &pending.user_id,
        &pending.simfile_id,
        &pending.drive_file_id,
    ) {
        Ok(true) => Ok(()),
        Ok(false) => Err(create_failure(DriveApiError::LocalState)),
        Err(error) => Err(pending_store_failure(error)),
    }
}

fn pending_store_failure(error: PendingBindingStoreError) -> DriveUploadFailure {
    create_failure(match error {
        PendingBindingStoreError::InsufficientDiskSpace => DriveApiError::InsufficientDiskSpace,
        PendingBindingStoreError::LocalState => DriveApiError::LocalState,
    })
}

fn metadata_error(error: DriveMetadataError) -> DriveApiError {
    match error {
        DriveMetadataError::DefinitiveUnavailable => DriveApiError::SimfileUnavailable,
        DriveMetadataError::Authentication => DriveApiError::TokenExpired,
        DriveMetadataError::Network => DriveApiError::Network,
        DriveMetadataError::ServiceUnavailable => DriveApiError::MetadataSync,
        DriveMetadataError::InvalidResponse => DriveApiError::InvalidResponse,
        DriveMetadataError::LocalState => DriveApiError::LocalState,
    }
}

fn create_failure(error: DriveApiError) -> DriveUploadFailure {
    DriveUploadFailure {
        error,
        pending_binding: PendingBindingDisposition::Retain,
    }
}

fn maybe_inject_crash(
    crash_at: Option<CreateCrashPoint>,
    boundary: CreateCrashPoint,
) -> std::result::Result<(), DriveUploadFailure> {
    if crash_at == Some(boundary) {
        return Err(create_failure(DriveApiError::LocalState));
    }
    Ok(())
}

fn pending_created_at() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

#[allow(clippy::too_many_arguments)]
async fn run_resumable_upload_with_chunk_size<A, S, F>(
    api: &A,
    sleeper: &S,
    access_token: &str,
    request: DriveUploadRequest,
    chunk_size: usize,
    cancellation: Option<&CancellationToken>,
    finalization_gate: Option<&DriveFinalizationGate>,
    mut on_progress: F,
) -> std::result::Result<DriveUploadOutcome, DriveUploadFailure>
where
    A: GoogleDriveApi + ?Sized,
    S: DriveSleeper + ?Sized,
    F: FnMut(u64, u64),
{
    ensure_not_canceled(cancellation).map_err(|error| upload_failure(error, &request.target))?;
    if chunk_size == 0 || request.simfile_id.trim().is_empty() {
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
            let folder =
                await_cancelable(api.validate_folder(access_token, folder_id), cancellation)
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
            let session = start_create_with_retry(
                api,
                sleeper,
                access_token,
                &metadata,
                total_bytes,
                cancellation,
            )
            .await
            .map_err(|error| upload_failure(error, &request.target))?;
            (generated_id.clone(), session)
        }
        DriveUploadTarget::Update { file_id } => {
            let existing =
                await_cancelable(api.get_file_for_update(access_token, file_id), cancellation)
                    .await
                    .map_err(|error| upload_failure(error, &request.target))?;
            if existing.id != *file_id || existing.trashed || !existing.can_edit {
                return Err(upload_failure(
                    DriveApiError::PermissionDenied,
                    &request.target,
                ));
            }
            await_cancelable(
                require_public_permission(api, access_token, file_id),
                cancellation,
            )
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
                cancellation,
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
        cancellation,
        finalization_gate,
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
    cancellation: Option<&CancellationToken>,
) -> std::result::Result<super::drive_client::ResumableUploadSession, DriveApiError>
where
    A: GoogleDriveApi + ?Sized,
    S: DriveSleeper + ?Sized,
{
    for attempt in 0..=MAX_UPLOAD_RETRIES {
        match await_cancelable(
            api.start_resumable_create(access_token, metadata, total_bytes),
            cancellation,
        )
        .await
        {
            Ok(session) => return Ok(session),
            Err(DriveApiError::Network) if attempt < MAX_UPLOAD_RETRIES => {
                sleep_cancelable(sleeper, bounded_retry_delay(attempt, None), cancellation).await?;
            }
            Err(DriveApiError::Transient(retry_after)) if attempt < MAX_UPLOAD_RETRIES => {
                sleep_cancelable(
                    sleeper,
                    bounded_retry_delay(attempt, retry_after),
                    cancellation,
                )
                .await?;
            }
            Err(DriveApiError::RateLimited(retry_after)) if attempt < MAX_UPLOAD_RETRIES => {
                sleep_cancelable(
                    sleeper,
                    bounded_retry_delay(attempt, retry_after),
                    cancellation,
                )
                .await?;
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
    cancellation: Option<&CancellationToken>,
) -> std::result::Result<super::drive_client::ResumableUploadSession, DriveApiError>
where
    A: GoogleDriveApi + ?Sized,
    S: DriveSleeper + ?Sized,
{
    for attempt in 0..=MAX_UPLOAD_RETRIES {
        match await_cancelable(
            api.start_resumable_update(access_token, file_id, metadata, total_bytes),
            cancellation,
        )
        .await
        {
            Ok(session) => return Ok(session),
            Err(DriveApiError::Network) if attempt < MAX_UPLOAD_RETRIES => {
                sleep_cancelable(sleeper, bounded_retry_delay(attempt, None), cancellation).await?;
            }
            Err(DriveApiError::Transient(retry_after)) if attempt < MAX_UPLOAD_RETRIES => {
                sleep_cancelable(
                    sleeper,
                    bounded_retry_delay(attempt, retry_after),
                    cancellation,
                )
                .await?;
            }
            Err(DriveApiError::RateLimited(retry_after)) if attempt < MAX_UPLOAD_RETRIES => {
                sleep_cancelable(
                    sleeper,
                    bounded_retry_delay(attempt, retry_after),
                    cancellation,
                )
                .await?;
            }
            Err(error) => return Err(error),
        }
    }
    Err(DriveApiError::Network)
}

#[allow(clippy::too_many_arguments)]
async fn transfer_archive<A, S, F>(
    api: &A,
    sleeper: &S,
    access_token: &str,
    session: &super::drive_client::ResumableUploadSession,
    archive: &mut DiskArchiveSource,
    chunk_size: usize,
    cancellation: Option<&CancellationToken>,
    finalization_gate: Option<&DriveFinalizationGate>,
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
        ensure_not_canceled(cancellation)?;
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
        let result = if let Some(cancellation) = cancellation {
            tokio::select! {
                result = api.upload_chunk(access_token, session, accepted, &chunk, total_bytes) => result,
                _ = cancellation.cancelled() => return Err(DriveApiError::Canceled),
            }
        } else {
            api.upload_chunk(access_token, session, accepted, &chunk, total_bytes)
                .await
        };
        let acknowledgement = match result {
            Ok(acknowledgement) => acknowledgement,
            Err(DriveApiError::Network) => {
                query_status_with_retry(
                    api,
                    sleeper,
                    access_token,
                    session,
                    total_bytes,
                    cancellation,
                )
                .await?
            }
            Err(DriveApiError::Transient(retry_after)) => {
                if let Some(retry_after) = retry_after {
                    sleep_cancelable(
                        sleeper,
                        bounded_retry_delay(0, Some(retry_after)),
                        cancellation,
                    )
                    .await?;
                }
                query_status_with_retry(
                    api,
                    sleeper,
                    access_token,
                    session,
                    total_bytes,
                    cancellation,
                )
                .await?
            }
            Err(DriveApiError::RateLimited(retry_after)) => {
                if rate_retry_attempt >= MAX_UPLOAD_RETRIES {
                    return Err(DriveApiError::RateLimited(retry_after));
                }
                sleep_cancelable(
                    sleeper,
                    bounded_retry_delay(rate_retry_attempt, retry_after),
                    cancellation,
                )
                .await?;
                rate_retry_attempt += 1;
                continue;
            }
            Err(error) => return Err(error),
        };

        match validate_acknowledgement(accepted, attempted_end, total_bytes, acknowledgement)? {
            Acknowledgement::Progress(confirmed) => {
                if confirmed == total_bytes {
                    enter_finalization(finalization_gate, cancellation)?;
                }
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
                sleep_cancelable(
                    sleeper,
                    bounded_retry_delay(stalled_recovery_attempts, None),
                    cancellation,
                )
                .await?;
                stalled_recovery_attempts += 1;
            }
            Acknowledgement::Complete => {
                enter_finalization(finalization_gate, cancellation)?;
                accepted = total_bytes;
                on_progress(accepted, total_bytes);
            }
        }
    }
    Ok(())
}

fn ensure_not_canceled(
    cancellation: Option<&CancellationToken>,
) -> std::result::Result<(), DriveApiError> {
    if cancellation.is_some_and(CancellationToken::is_cancelled) {
        Err(DriveApiError::Canceled)
    } else {
        Ok(())
    }
}

fn enter_finalization(
    finalization_gate: Option<&DriveFinalizationGate>,
    cancellation: Option<&CancellationToken>,
) -> std::result::Result<(), DriveApiError> {
    if let Some(finalization_gate) = finalization_gate {
        if finalization_gate.try_enter() {
            Ok(())
        } else {
            Err(DriveApiError::Canceled)
        }
    } else {
        ensure_not_canceled(cancellation)
    }
}

async fn await_cancelable<T, F>(
    future: F,
    cancellation: Option<&CancellationToken>,
) -> std::result::Result<T, DriveApiError>
where
    F: Future<Output = std::result::Result<T, DriveApiError>>,
{
    if let Some(cancellation) = cancellation {
        tokio::select! {
            result = future => result,
            _ = cancellation.cancelled() => Err(DriveApiError::Canceled),
        }
    } else {
        future.await
    }
}

async fn sleep_cancelable<S>(
    sleeper: &S,
    duration: Duration,
    cancellation: Option<&CancellationToken>,
) -> std::result::Result<(), DriveApiError>
where
    S: DriveSleeper + ?Sized,
{
    if let Some(cancellation) = cancellation {
        tokio::select! {
            _ = sleeper.sleep(duration) => Ok(()),
            _ = cancellation.cancelled() => Err(DriveApiError::Canceled),
        }
    } else {
        sleeper.sleep(duration).await;
        Ok(())
    }
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
    cancellation: Option<&CancellationToken>,
) -> std::result::Result<DriveChunkResult, DriveApiError>
where
    A: GoogleDriveApi + ?Sized,
    S: DriveSleeper + ?Sized,
{
    for attempt in 0..=MAX_UPLOAD_RETRIES {
        match await_cancelable(
            api.query_session_status(access_token, session, total_bytes),
            cancellation,
        )
        .await
        {
            Ok(status) => return Ok(status),
            Err(DriveApiError::Network) if attempt < MAX_UPLOAD_RETRIES => {
                sleep_cancelable(sleeper, bounded_retry_delay(attempt, None), cancellation).await?;
            }
            Err(DriveApiError::Transient(retry_after)) if attempt < MAX_UPLOAD_RETRIES => {
                sleep_cancelable(
                    sleeper,
                    bounded_retry_delay(attempt, retry_after),
                    cancellation,
                )
                .await?;
            }
            Err(DriveApiError::RateLimited(retry_after)) if attempt < MAX_UPLOAD_RETRIES => {
                sleep_cancelable(
                    sleeper,
                    bounded_retry_delay(attempt, retry_after),
                    cancellation,
                )
                .await?;
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
    if error == DriveApiError::TokenExpired {
        return upload_failure(error, target);
    }
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
        .unwrap_or(MAX_RETRY_DELAY)
        .min(MAX_RETRY_DELAY);
    match retry_after {
        Some(provider) => provider.min(MAX_PROVIDER_RETRY_DELAY),
        None => exponential,
    }
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
