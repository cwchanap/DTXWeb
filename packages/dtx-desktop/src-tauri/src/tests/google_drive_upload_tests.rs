use super::*;
use crate::auth::AuthState;
use crate::google_drive::drive_client::{
    DriveApiError, DriveChunkResult, DriveCreateMetadata, DriveFile, DriveUpdateMetadata,
    GoogleDriveApi, PublicPermissionStatus, ResumableUploadSession, ValidatedFolder,
};
use crate::google_drive::pending_bindings::{
    ExpectedPreviousDriveFile, GoogleDrivePendingBindingStore, PendingBindingKind,
};
use crate::google_drive::{DriveMetadataClient, DriveMetadataError, OwnerDriveSimfile};
use async_trait::async_trait;
use std::collections::VecDeque;
#[cfg(unix)]
use std::os::unix::fs::symlink;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tempfile::{tempdir, TempDir};
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};
use zeroize::Zeroizing;

const ACCESS_TOKEN: &str = "drive-access-token";
type DriveResult<T> = std::result::Result<T, DriveApiError>;

#[derive(Default)]
struct ScriptedDriveApi {
    generated_ids: Mutex<VecDeque<DriveResult<String>>>,
    files: Mutex<VecDeque<DriveResult<DriveFile>>>,
    permissions: Mutex<VecDeque<DriveResult<PublicPermissionStatus>>>,
    chunks: Mutex<VecDeque<DriveResult<DriveChunkResult>>>,
    statuses: Mutex<VecDeque<DriveResult<DriveChunkResult>>>,
    starts: Mutex<VecDeque<DriveResult<ResumableUploadSession>>>,
    deletes: Mutex<VecDeque<DriveResult<()>>>,
    uploaded_ranges: Mutex<Vec<(u64, u64)>>,
    create_metadata: Mutex<Vec<DriveCreateMetadata>>,
    update_metadata: Mutex<Vec<(String, DriveUpdateMetadata)>>,
    start_tokens: Mutex<Vec<String>>,
    generated_count: Mutex<usize>,
    get_file_ids: Mutex<Vec<String>>,
    get_file_requests: Mutex<Vec<(String, String)>>,
    permission_requests: Mutex<Vec<(String, String)>>,
    delete_count: Mutex<usize>,
    delete_ids: Mutex<Vec<String>>,
    truncate_after_first_chunk: Mutex<Option<PathBuf>>,
    start_create_gate: Mutex<Option<Arc<AsyncGate>>>,
    get_file_gate: Mutex<Option<Arc<AsyncGate>>>,
    permission_gate: Mutex<Option<Arc<AsyncGate>>>,
    upload_chunk_gate: Mutex<Option<Arc<AsyncGate>>>,
    query_status_gate: Mutex<Option<Arc<AsyncGate>>>,
}

struct AsyncGate {
    entered: Semaphore,
    release: Semaphore,
}

impl Default for AsyncGate {
    fn default() -> Self {
        Self {
            entered: Semaphore::new(0),
            release: Semaphore::new(0),
        }
    }
}

impl ScriptedDriveApi {
    fn valid_file(id: &str, link: Option<&str>) -> DriveFile {
        DriveFile {
            id: id.to_string(),
            name: "Cloud title.zip".to_string(),
            mime_type: "application/zip".to_string(),
            trashed: false,
            can_edit: true,
            can_download: true,
            web_content_link: link.map(str::to_string),
        }
    }

    fn take<T>(queue: &Mutex<VecDeque<DriveResult<T>>>) -> DriveResult<T> {
        queue
            .lock()
            .expect("script queue")
            .pop_front()
            .expect("scripted response")
    }
}

#[async_trait]
impl GoogleDriveApi for ScriptedDriveApi {
    async fn generate_id(&self, _access_token: &str) -> DriveResult<String> {
        *self.generated_count.lock().expect("generated count") += 1;
        Self::take(&self.generated_ids)
    }

    async fn get_file(&self, access_token: &str, file_id: &str) -> DriveResult<DriveFile> {
        self.get_file_ids
            .lock()
            .expect("get file ids")
            .push(file_id.to_string());
        self.get_file_requests
            .lock()
            .expect("get file requests")
            .push((access_token.to_string(), file_id.to_string()));
        let gate = self.get_file_gate.lock().expect("get file gate").take();
        if let Some(gate) = gate {
            gate.entered.add_permits(1);
            gate.release
                .acquire()
                .await
                .expect("get file release")
                .forget();
        }
        Self::take(&self.files)
    }

    async fn validate_folder(
        &self,
        _access_token: &str,
        folder_id: &str,
    ) -> DriveResult<ValidatedFolder> {
        Ok(ValidatedFolder {
            id: folder_id.to_string(),
            name: "Public uploads".to_string(),
        })
    }

    async fn validate_public_permission(
        &self,
        access_token: &str,
        item_id: &str,
    ) -> DriveResult<PublicPermissionStatus> {
        self.permission_requests
            .lock()
            .expect("permission requests")
            .push((access_token.to_string(), item_id.to_string()));
        let gate = self.permission_gate.lock().expect("permission gate").take();
        if let Some(gate) = gate {
            gate.entered.add_permits(1);
            gate.release
                .acquire()
                .await
                .expect("permission release")
                .forget();
        }
        Self::take(&self.permissions)
    }

    async fn start_resumable_create(
        &self,
        access_token: &str,
        metadata: &DriveCreateMetadata,
        _total_bytes: u64,
    ) -> DriveResult<ResumableUploadSession> {
        self.start_tokens
            .lock()
            .expect("start tokens")
            .push(access_token.to_string());
        self.create_metadata
            .lock()
            .expect("create metadata")
            .push(metadata.clone());
        let gate = self
            .start_create_gate
            .lock()
            .expect("start create gate")
            .clone();
        if let Some(gate) = gate {
            gate.entered.add_permits(1);
            gate.release
                .acquire()
                .await
                .expect("start create release")
                .forget();
        }
        let mut starts = self.starts.lock().expect("start responses");
        if let Some(result) = starts.pop_front() {
            result
        } else {
            ResumableUploadSession::for_test("https://upload.test/create")
        }
    }

    async fn start_resumable_update(
        &self,
        access_token: &str,
        file_id: &str,
        metadata: &DriveUpdateMetadata,
        _total_bytes: u64,
    ) -> DriveResult<ResumableUploadSession> {
        self.start_tokens
            .lock()
            .expect("start tokens")
            .push(access_token.to_string());
        self.update_metadata
            .lock()
            .expect("update metadata")
            .push((file_id.to_string(), metadata.clone()));
        let mut starts = self.starts.lock().expect("start responses");
        if let Some(result) = starts.pop_front() {
            result
        } else {
            ResumableUploadSession::for_test("https://upload.test/update")
        }
    }

    async fn upload_chunk(
        &self,
        _access_token: &str,
        _session: &ResumableUploadSession,
        start: u64,
        bytes: &[u8],
        _total_bytes: u64,
    ) -> DriveResult<DriveChunkResult> {
        self.uploaded_ranges
            .lock()
            .expect("uploaded ranges")
            .push((start, start + bytes.len() as u64));
        if start == 0 {
            if let Some(path) = self
                .truncate_after_first_chunk
                .lock()
                .expect("truncate path")
                .take()
            {
                std::fs::OpenOptions::new()
                    .write(true)
                    .open(path)
                    .expect("archive to truncate")
                    .set_len(1)
                    .expect("truncate archive");
            }
        }
        let gate = self
            .upload_chunk_gate
            .lock()
            .expect("upload chunk gate")
            .take();
        if let Some(gate) = gate {
            gate.entered.add_permits(1);
            gate.release
                .acquire()
                .await
                .expect("upload chunk release")
                .forget();
        }
        Self::take(&self.chunks)
    }

    async fn query_session_status(
        &self,
        _access_token: &str,
        _session: &ResumableUploadSession,
        _total_bytes: u64,
    ) -> DriveResult<DriveChunkResult> {
        let gate = self
            .query_status_gate
            .lock()
            .expect("query status gate")
            .take();
        if let Some(gate) = gate {
            gate.entered.add_permits(1);
            gate.release
                .acquire()
                .await
                .expect("query status release")
                .forget();
        }
        Self::take(&self.statuses)
    }

    async fn delete_file(&self, _access_token: &str, file_id: &str) -> DriveResult<()> {
        *self.delete_count.lock().expect("delete count") += 1;
        self.delete_ids
            .lock()
            .expect("delete ids")
            .push(file_id.to_string());
        Self::take(&self.deletes)
    }
}

#[derive(Default)]
struct ScriptedMetadataClient {
    fetches: Mutex<VecDeque<std::result::Result<OwnerDriveSimfile, DriveMetadataError>>>,
    patches: Mutex<VecDeque<std::result::Result<OwnerDriveSimfile, DriveMetadataError>>>,
    patch_inputs: Mutex<Vec<(String, String, Option<ExpectedPreviousDriveFile>)>>,
}

impl ScriptedMetadataClient {
    fn owner_for(
        simfile_id: &str,
        file_id: Option<&str>,
        download_url: Option<&str>,
    ) -> OwnerDriveSimfile {
        OwnerDriveSimfile {
            id: simfile_id.to_string(),
            title: format!("Saved cloud title {simfile_id}"),
            google_drive_file_id: file_id.map(str::to_string),
            download_url: download_url.map(str::to_string),
        }
    }

    fn owner(file_id: Option<&str>, download_url: Option<&str>) -> OwnerDriveSimfile {
        Self::owner_for("42", file_id, download_url)
    }

    fn take(
        queue: &Mutex<VecDeque<std::result::Result<OwnerDriveSimfile, DriveMetadataError>>>,
    ) -> std::result::Result<OwnerDriveSimfile, DriveMetadataError> {
        queue
            .lock()
            .expect("metadata script")
            .pop_front()
            .expect("scripted metadata response")
    }
}

#[async_trait]
impl DriveMetadataClient for ScriptedMetadataClient {
    async fn fetch_owner_simfile(
        &self,
        _auth: &AuthState,
        _simfile_id: &str,
    ) -> std::result::Result<OwnerDriveSimfile, DriveMetadataError> {
        Self::take(&self.fetches)
    }

    async fn update_drive_file(
        &self,
        _auth: &AuthState,
        _simfile_id: &str,
        drive_file_id: &str,
        download_url: &str,
        expected_previous: Option<&ExpectedPreviousDriveFile>,
    ) -> std::result::Result<OwnerDriveSimfile, DriveMetadataError> {
        self.patch_inputs.lock().expect("patch inputs").push((
            drive_file_id.to_string(),
            download_url.to_string(),
            expected_previous.cloned(),
        ));
        Self::take(&self.patches)
    }
}

struct BlockingStatefulMetadataClient {
    owner: Mutex<OwnerDriveSimfile>,
    fetch_count: AtomicUsize,
    patch_count: AtomicUsize,
    first_fetch_entered: Semaphore,
    first_fetch_release: Semaphore,
}

impl BlockingStatefulMetadataClient {
    fn unbound() -> Self {
        Self {
            owner: Mutex::new(ScriptedMetadataClient::owner(None, None)),
            fetch_count: AtomicUsize::new(0),
            patch_count: AtomicUsize::new(0),
            first_fetch_entered: Semaphore::new(0),
            first_fetch_release: Semaphore::new(0),
        }
    }
}

#[async_trait]
impl DriveMetadataClient for BlockingStatefulMetadataClient {
    async fn fetch_owner_simfile(
        &self,
        _auth: &AuthState,
        _simfile_id: &str,
    ) -> std::result::Result<OwnerDriveSimfile, DriveMetadataError> {
        let owner = self.owner.lock().expect("owner").clone();
        if self.fetch_count.fetch_add(1, Ordering::SeqCst) == 0 {
            self.first_fetch_entered.add_permits(1);
            self.first_fetch_release
                .acquire()
                .await
                .expect("first fetch release")
                .forget();
        }
        Ok(owner)
    }

    async fn update_drive_file(
        &self,
        _auth: &AuthState,
        simfile_id: &str,
        drive_file_id: &str,
        download_url: &str,
        _expected_previous: Option<&ExpectedPreviousDriveFile>,
    ) -> std::result::Result<OwnerDriveSimfile, DriveMetadataError> {
        self.patch_count.fetch_add(1, Ordering::SeqCst);
        let updated =
            ScriptedMetadataClient::owner_for(simfile_id, Some(drive_file_id), Some(download_url));
        *self.owner.lock().expect("owner") = updated.clone();
        Ok(updated)
    }
}

struct ProductionOwnerMetadataClient {
    base_url: String,
}

#[async_trait]
impl DriveMetadataClient for ProductionOwnerMetadataClient {
    async fn fetch_owner_simfile(
        &self,
        _auth: &AuthState,
        simfile_id: &str,
    ) -> std::result::Result<OwnerDriveSimfile, DriveMetadataError> {
        crate::api::fetch_owner_drive_simfile_impl(
            &self.base_url,
            "opaque-session-token",
            simfile_id,
            "user-42",
        )
        .await
    }

    async fn update_drive_file(
        &self,
        _auth: &AuthState,
        _simfile_id: &str,
        _drive_file_id: &str,
        _download_url: &str,
        _expected_previous: Option<&ExpectedPreviousDriveFile>,
    ) -> std::result::Result<OwnerDriveSimfile, DriveMetadataError> {
        Err(DriveMetadataError::LocalState)
    }
}

#[derive(Default)]
struct RecordingSleeper {
    delays: Mutex<Vec<Duration>>,
}

#[async_trait]
impl DriveSleeper for RecordingSleeper {
    async fn sleep(&self, duration: Duration) {
        self.delays.lock().expect("delays").push(duration);
    }
}

#[derive(Default)]
struct BlockingSleeper {
    gate: AsyncGate,
}

#[async_trait]
impl DriveSleeper for BlockingSleeper {
    async fn sleep(&self, _duration: Duration) {
        self.gate.entered.add_permits(1);
        self.gate
            .release
            .acquire()
            .await
            .expect("sleep release")
            .forget();
    }
}

struct UploadRequestFixture {
    _directory: TempDir,
    request: DriveUploadRequest,
}

fn request_fixture(bytes: &[u8], target: DriveUploadTarget, title: &str) -> UploadRequestFixture {
    let directory = tempdir().expect("archive directory");
    let archive_path = directory.path().join("upload.zip");
    std::fs::write(&archive_path, bytes).expect("archive fixture");
    UploadRequestFixture {
        _directory: directory,
        request: DriveUploadRequest {
            simfile_id: "sim-42".to_string(),
            saved_title: title.to_string(),
            archive_path,
            target,
        },
    }
}

fn create_request(bytes: &[u8]) -> UploadRequestFixture {
    request_fixture(
        bytes,
        DriveUploadTarget::Create {
            generated_id: "generated-file-id".to_string(),
            folder_id: "folder-42".to_string(),
        },
        "AC/DC",
    )
}

fn update_request(bytes: &[u8]) -> UploadRequestFixture {
    request_fixture(
        bytes,
        DriveUploadTarget::Update {
            file_id: "existing-file".to_string(),
        },
        "Song: Reprise",
    )
}

#[test]
fn operation_manager_rejects_same_song_duplicates_and_releases_key_on_drop() {
    let manager = Arc::new(DriveOperationManager::default());
    let first = manager
        .register("user-1", Uuid::new_v4(), "sim-1")
        .expect("first operation");
    assert_eq!(
        manager.register("user-1", Uuid::new_v4(), "sim-1").err(),
        Some(DriveApiError::UploadInProgress)
    );
    assert!(manager.register("user-1", Uuid::new_v4(), "sim-2").is_ok());
    assert!(manager.register("user-2", Uuid::new_v4(), "sim-1").is_ok());

    drop(first);
    assert!(manager.register("user-1", Uuid::new_v4(), "sim-1").is_ok());
}

#[tokio::test]
async fn operation_manager_admits_two_resource_users_and_queues_fifo_without_allocating_a_slot() {
    let manager = Arc::new(DriveOperationManager::default());
    let first = manager
        .register("user", Uuid::new_v4(), "sim-1")
        .expect("first");
    let second = manager
        .register("user", Uuid::new_v4(), "sim-2")
        .expect("second");
    let third = manager
        .register("user", Uuid::new_v4(), "sim-3")
        .expect("third");
    let fourth = manager
        .register("user", Uuid::new_v4(), "sim-4")
        .expect("fourth");
    let first_permit = first.acquire_resource_slot().await.expect("first permit");
    let second_permit = second.acquire_resource_slot().await.expect("second permit");
    assert_eq!(manager.available_resource_slots(), 0);
    let cache = tempdir().expect("cache");
    let cache_path = cache.path().to_path_buf();

    let (admitted_tx, mut admitted_rx) = tokio::sync::mpsc::unbounded_channel();
    let (third_release_tx, third_release_rx) = tokio::sync::oneshot::channel();
    let third_task = tokio::spawn({
        let admitted_tx = admitted_tx.clone();
        let cache_path = cache_path.clone();
        async move {
            let permit = third.acquire_resource_slot().await.expect("third permit");
            let _archive = create_upload_archive(&cache_path).expect("post-admission archive");
            admitted_tx.send(3).unwrap();
            let _ = third_release_rx.await;
            drop(permit);
        }
    });
    tokio::task::yield_now().await;
    let fourth_task = tokio::spawn(async move {
        let _permit = fourth.acquire_resource_slot().await.expect("fourth permit");
        admitted_tx.send(4).unwrap();
    });
    tokio::task::yield_now().await;
    assert!(
        admitted_rx.try_recv().is_err(),
        "queued work consumed no slot"
    );
    assert!(
        !cache.path().join("google-drive-uploads").exists(),
        "queued work allocated no temp namespace or directory"
    );

    drop(first_permit);
    assert_eq!(admitted_rx.recv().await, Some(3));
    assert!(admitted_rx.try_recv().is_err(), "FIFO keeps fourth queued");
    third_release_tx.send(()).unwrap();
    assert_eq!(admitted_rx.recv().await, Some(4));

    drop(second_permit);
    third_task.await.unwrap();
    fourth_task.await.unwrap();
}

#[tokio::test]
async fn queued_cancellation_releases_song_and_operation_state_without_consuming_resources() {
    let manager = Arc::new(DriveOperationManager::default());
    let first = manager
        .register("user", Uuid::new_v4(), "sim-1")
        .expect("first");
    let second = manager
        .register("user", Uuid::new_v4(), "sim-2")
        .expect("second");
    let queued_id = Uuid::new_v4();
    let queued = manager
        .register("user", queued_id, "sim-3")
        .expect("queued");
    let _first_permit = first.acquire_resource_slot().await.expect("first permit");
    let _second_permit = second.acquire_resource_slot().await.expect("second permit");
    assert_eq!(manager.available_resource_slots(), 0);

    let task = tokio::spawn(async move { queued.acquire_resource_slot().await });
    tokio::task::yield_now().await;
    assert!(manager.cancel("user", queued_id));
    assert_eq!(task.await.unwrap().err(), Some(DriveApiError::Canceled));
    assert_eq!(manager.active_count(), 2);
    assert_eq!(manager.available_resource_slots(), 0);
    assert!(manager.register("user", Uuid::new_v4(), "sim-3").is_ok());
}

#[tokio::test]
async fn preparing_cancellation_cleans_staging_and_releases_resource_and_song_locks() {
    let manager = Arc::new(DriveOperationManager::default());
    let operation_id = Uuid::new_v4();
    let operation = manager
        .register("user", operation_id, "sim-prepare")
        .expect("operation");
    let permit = operation
        .acquire_resource_slot()
        .await
        .expect("resource permit");
    operation.set_phase(DriveOperationPhase::Preparing);
    let cache = tempdir().expect("cache");
    let archive = create_upload_archive(cache.path()).expect("archive");
    let zip_path = archive.zip_path().to_path_buf();
    std::fs::write(&zip_path, b"partial").expect("partial archive");

    assert!(manager.cancel("user", operation_id));
    drop(archive);
    drop(permit);
    drop(operation);

    assert!(!zip_path.exists());
    assert_eq!(manager.available_resource_slots(), 2);
    assert_eq!(manager.active_count(), 0);
    assert!(manager
        .register("user", Uuid::new_v4(), "sim-prepare")
        .is_ok());
}

#[test]
fn cancellation_is_refused_after_drive_finalization_and_logout_hides_visible_operations() {
    let manager = Arc::new(DriveOperationManager::default());
    let finalizing_id = Uuid::new_v4();
    let finalizing = manager
        .register("user", finalizing_id, "sim-final")
        .expect("finalizing");
    finalizing.set_phase(DriveOperationPhase::Finalizing);
    assert!(!manager.cancel("user", finalizing_id));

    let transferring_id = Uuid::new_v4();
    let transferring = manager
        .register("user", transferring_id, "sim-transfer")
        .expect("transferring");
    transferring.set_phase(DriveOperationPhase::Transferring);
    manager.clear_user_visible_state("user");
    assert!(transferring.cancellation().is_cancelled());
    assert!(!manager.cancel("user", transferring_id));
    assert!(
        !finalizing.cancellation().is_cancelled(),
        "finalized transaction must finish metadata sync/compensation"
    );
}

#[tokio::test]
async fn transferring_cancellation_aborts_session_initialization_before_any_chunk_buffer_is_used() {
    let api = Arc::new(ScriptedDriveApi::default());
    let start_gate = Arc::new(AsyncGate::default());
    *api.start_create_gate.lock().unwrap() = Some(start_gate.clone());
    let manager = Arc::new(DriveOperationManager::default());
    let operation_id = Uuid::new_v4();
    let lease = manager
        .register("user", operation_id, "sim-cancel-start")
        .expect("operation");
    lease.set_phase(DriveOperationPhase::Transferring);
    let cancellation = lease.cancellation().clone();
    let finalization_gate = lease.finalization_gate();
    let fixture = create_request(b"archive");
    let UploadRequestFixture {
        _directory,
        request,
    } = fixture;
    let task = tokio::spawn({
        let api = api.clone();
        let cancellation = cancellation.clone();
        async move {
            let _directory = _directory;
            let _lease = lease;
            run_resumable_upload_cancelable(
                api.as_ref(),
                &RecordingSleeper::default(),
                ACCESS_TOKEN,
                request,
                &cancellation,
                &finalization_gate,
                |_, _| {},
            )
            .await
        }
    });
    start_gate
        .entered
        .acquire()
        .await
        .expect("start entered")
        .forget();

    assert!(manager.cancel("user", operation_id));
    let failure = task.await.unwrap().expect_err("canceled start");

    assert_eq!(failure.error, DriveApiError::Canceled);
    assert!(api.uploaded_ranges.lock().unwrap().is_empty());
}

#[test]
fn drive_name_sanitizes_metadata_without_using_local_filename_rules() {
    assert_eq!(sanitize_drive_zip_name("AC/DC", "sim-42"), "AC-DC.zip");
    assert_eq!(
        sanitize_drive_zip_name("Song: Reprise", "sim-42"),
        "Song: Reprise.zip"
    );
    assert_eq!(
        sanitize_drive_zip_name("  AC\u{0000}///DC  ", "sim-42"),
        "AC-DC.zip"
    );
    assert_eq!(
        sanitize_drive_zip_name(" \n\t\u{0000} ", "sim-42"),
        "simfile-sim-42.zip"
    );
}

#[test]
fn drive_upload_cache_path_is_native_random_and_never_uses_renderer_metadata() {
    let cache = tempdir().expect("cache");
    let first = create_upload_archive(cache.path()).expect("first archive");
    let second = create_upload_archive(cache.path()).expect("second archive");

    let namespace = cache.path().join("google-drive-uploads");
    assert!(first.zip_path().starts_with(&namespace));
    assert!(second.zip_path().starts_with(&namespace));
    assert_eq!(first.zip_path().file_name().unwrap(), "upload.zip");
    assert_ne!(first.zip_path(), second.zip_path());
    assert_eq!(
        first.zip_path().parent().unwrap().parent().unwrap(),
        namespace
    );
}

#[test]
fn drive_upload_cache_cleanup_is_restricted_to_its_namespace() {
    let cache = tempdir().expect("cache");
    let stale = cache.path().join("google-drive-uploads/stale");
    let sibling = cache.path().join("keep-me");
    std::fs::create_dir_all(&stale).expect("stale");
    std::fs::write(stale.join("upload.zip"), b"partial").expect("partial archive");
    std::fs::create_dir(&sibling).expect("sibling");
    std::fs::write(sibling.join("not-a-drive-upload"), b"keep").expect("sibling file");

    cleanup_stale_upload_archives(cache.path());

    assert!(!stale.exists());
    assert!(sibling.join("not-a-drive-upload").exists());
}

#[test]
fn drive_upload_archive_cleans_up_on_drop_and_explicit_cleanup() {
    let cache = tempdir().expect("cache");
    let zip_path = {
        let archive = create_upload_archive(cache.path()).expect("archive");
        let zip_path = archive.zip_path().to_path_buf();
        std::fs::write(&zip_path, b"archive").expect("archive content");
        zip_path
    };
    assert!(
        !zip_path.exists(),
        "drop must remove the per-upload directory"
    );

    let mut archive = create_upload_archive(cache.path()).expect("archive");
    let zip_path = archive.zip_path().to_path_buf();
    std::fs::write(&zip_path, b"archive").expect("archive content");
    archive.cleanup();
    assert!(
        !zip_path.exists(),
        "explicit cancellation/failure cleanup must remove it"
    );
}

#[cfg(unix)]
#[test]
fn drive_upload_staging_rejects_a_namespace_symlink_without_writing_outside_cache() {
    let cache = tempdir().expect("cache");
    let outside = tempdir().expect("outside");
    let namespace = cache.path().join("google-drive-uploads");
    symlink(outside.path(), &namespace).expect("namespace symlink");

    let error = match create_upload_archive(cache.path()) {
        Ok(_) => panic!("symlinked namespace must reject"),
        Err(error) => error,
    };

    assert!(error.to_string().contains("Google Drive upload cache"));
    assert!(std::fs::read_dir(outside.path())
        .expect("outside entries")
        .next()
        .is_none());
}

#[cfg(unix)]
#[test]
fn drive_upload_startup_cleanup_does_not_traverse_a_namespace_symlink() {
    let cache = tempdir().expect("cache");
    let outside = tempdir().expect("outside");
    let stale = outside.path().join("stale");
    std::fs::create_dir(&stale).expect("outside stale");
    std::fs::write(stale.join("upload.zip"), b"keep").expect("outside archive");
    symlink(outside.path(), cache.path().join("google-drive-uploads")).expect("namespace symlink");

    cleanup_stale_upload_archives(cache.path());

    assert!(stale.join("upload.zip").exists());
}

#[test]
fn production_chunk_size_is_eight_mib_and_drive_aligned() {
    assert_eq!(DRIVE_UPLOAD_CHUNK_SIZE, 8 * 1024 * 1024);
    assert_eq!(DRIVE_UPLOAD_CHUNK_SIZE % (256 * 1024), 0);
}

#[tokio::test]
async fn resumable_create_validates_folder_and_uses_generated_identity_and_sanitized_name() {
    let api = ScriptedDriveApi::default();
    api.chunks.lock().unwrap().extend([
        Ok(DriveChunkResult::Accepted(4)),
        Ok(DriveChunkResult::Complete),
    ]);
    api.files
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedDriveApi::valid_file(
            "generated-file-id",
            Some("  https://drive.google.com/uc?id=generated-file-id  "),
        )));
    api.permissions
        .lock()
        .unwrap()
        .push_back(Ok(PublicPermissionStatus::Public));
    let sleeper = RecordingSleeper::default();
    let mut progress = Vec::new();
    let fixture = create_request(b"archive");

    let result = run_resumable_upload_for_test(
        &api,
        &sleeper,
        ACCESS_TOKEN,
        fixture.request.clone(),
        4,
        |accepted, total| progress.push((accepted, total)),
    )
    .await
    .expect("create upload");

    assert_eq!(result.file_id, "generated-file-id");
    assert_eq!(result.file_name, "AC-DC.zip");
    assert_eq!(
        result.download_url,
        "https://drive.google.com/uc?id=generated-file-id"
    );
    assert_eq!(
        api.create_metadata.lock().unwrap().as_slice(),
        &[DriveCreateMetadata {
            id: "generated-file-id".to_string(),
            parent_id: "folder-42".to_string(),
            name: "AC-DC.zip".to_string(),
        }]
    );
    assert_eq!(progress, vec![(4, 7), (7, 7)]);
}

#[tokio::test]
async fn resumable_create_uses_the_simfile_fallback_for_titles_without_printable_content() {
    for (title, expected_name) in [
        ("", "simfile-sim-42.zip"),
        (" \t\r\n ", "simfile-sim-42.zip"),
        ("\u{0000}\u{0007}", "simfile-sim-42.zip"),
        ("  AC\u{0000}///DC  ", "AC-DC.zip"),
    ] {
        let api = ScriptedDriveApi::default();
        api.chunks
            .lock()
            .unwrap()
            .push_back(Ok(DriveChunkResult::Complete));
        api.files
            .lock()
            .unwrap()
            .push_back(Ok(ScriptedDriveApi::valid_file(
                "generated-file-id",
                Some("https://drive.google.com/download"),
            )));
        api.permissions
            .lock()
            .unwrap()
            .push_back(Ok(PublicPermissionStatus::Public));
        let fixture = request_fixture(
            b"archive",
            DriveUploadTarget::Create {
                generated_id: "generated-file-id".to_string(),
                folder_id: "folder-42".to_string(),
            },
            title,
        );

        let outcome = run_resumable_upload_for_test(
            &api,
            &RecordingSleeper::default(),
            ACCESS_TOKEN,
            fixture.request,
            64,
            |_, _| {},
        )
        .await
        .expect("title fallback is a valid upload transaction");

        assert_eq!(outcome.file_name, expected_name);
        assert_eq!(
            api.create_metadata.lock().unwrap()[0].name,
            expected_name,
            "Drive receives the sanitized transaction filename for {title:?}"
        );
    }
}

#[tokio::test]
async fn resumable_update_requires_fresh_edit_access_and_never_changes_parent() {
    let api = ScriptedDriveApi::default();
    api.files.lock().unwrap().extend([
        Ok(ScriptedDriveApi::valid_file("existing-file", None)),
        Ok(ScriptedDriveApi::valid_file(
            "existing-file",
            Some("https://drive.google.com/open?id=existing-file"),
        )),
    ]);
    api.permissions.lock().unwrap().extend([
        Ok(PublicPermissionStatus::Public),
        Ok(PublicPermissionStatus::Public),
    ]);
    api.chunks.lock().unwrap().extend([
        Ok(DriveChunkResult::Accepted(4)),
        Ok(DriveChunkResult::Accepted(8)),
        Ok(DriveChunkResult::Complete),
    ]);
    let sleeper = RecordingSleeper::default();
    let fixture = update_request(b"replacement");

    let result = run_resumable_upload_for_test(
        &api,
        &sleeper,
        ACCESS_TOKEN,
        fixture.request.clone(),
        4,
        |_, _| {},
    )
    .await
    .expect("replacement");

    assert_eq!(result.file_id, "existing-file");
    assert_eq!(
        api.update_metadata.lock().unwrap().as_slice(),
        &[(
            "existing-file".to_string(),
            DriveUpdateMetadata {
                name: "Song: Reprise.zip".to_string(),
            }
        )]
    );
    assert_eq!(*api.delete_count.lock().unwrap(), 0);
}

#[tokio::test]
async fn resumable_update_refreshes_once_reuses_the_file_id_and_keeps_progress_monotonic() {
    let api = ScriptedDriveApi::default();
    api.files.lock().unwrap().extend([
        Ok(ScriptedDriveApi::valid_file("existing-file", None)),
        Ok(ScriptedDriveApi::valid_file("existing-file", None)),
        Ok(ScriptedDriveApi::valid_file(
            "existing-file",
            Some("https://drive.google.com/download"),
        )),
    ]);
    api.permissions.lock().unwrap().extend([
        Ok(PublicPermissionStatus::Public),
        Ok(PublicPermissionStatus::Public),
        Ok(PublicPermissionStatus::Public),
    ]);
    api.chunks.lock().unwrap().extend([
        Ok(DriveChunkResult::Accepted(4)),
        Err(DriveApiError::TokenExpired),
        Ok(DriveChunkResult::Accepted(4)),
        Ok(DriveChunkResult::Complete),
    ]);
    let fixture = update_request(b"archive");
    let progress = Arc::new(Mutex::new(Vec::new()));
    let monotonic = Arc::new(Mutex::new(MonotonicDriveProgress::default()));
    let refreshes = Arc::new(AtomicUsize::new(0));
    let api_ref = &api;

    let outcome = run_with_single_access_token_refresh(
        Zeroizing::new("expired-token".to_string()),
        |access_token| {
            let progress = progress.clone();
            let monotonic = monotonic.clone();
            let request = fixture.request.clone();
            let api = api_ref;
            async move {
                run_resumable_upload_for_test(
                    api,
                    &RecordingSleeper::default(),
                    &access_token,
                    request,
                    4,
                    |accepted, total| {
                        if monotonic.lock().unwrap().should_emit(accepted, total) {
                            progress.lock().unwrap().push((accepted, total));
                        }
                    },
                )
                .await
            }
        },
        || {},
        |expired_token| {
            let refreshes = refreshes.clone();
            async move {
                assert_eq!(expired_token.as_str(), "expired-token");
                refreshes.fetch_add(1, Ordering::SeqCst);
                Ok(Zeroizing::new("fresh-token".to_string()))
            }
        },
    )
    .await
    .expect("retry succeeds");

    assert_eq!(outcome.file_id, "existing-file");
    assert_eq!(refreshes.load(Ordering::SeqCst), 1);
    assert_eq!(
        api.start_tokens.lock().unwrap().as_slice(),
        &["expired-token", "fresh-token"]
    );
    assert!(api
        .update_metadata
        .lock()
        .unwrap()
        .iter()
        .all(|(file_id, _)| file_id == "existing-file"));
    assert_eq!(progress.lock().unwrap().as_slice(), &[(4, 7), (7, 7)]);
}

#[tokio::test]
async fn token_refresh_failure_and_second_expiry_stop_after_one_retry_as_reconnect_required() {
    let attempts = Arc::new(AtomicUsize::new(0));
    let refreshes = Arc::new(AtomicUsize::new(0));
    let failure = run_with_single_access_token_refresh(
        Zeroizing::new("expired-token".to_string()),
        |_| {
            let attempts = attempts.clone();
            async move {
                attempts.fetch_add(1, Ordering::SeqCst);
                Err::<(), _>(DriveUploadFailure {
                    error: DriveApiError::TokenExpired,
                    pending_binding: PendingBindingDisposition::NotApplicable,
                })
            }
        },
        || {},
        |_| {
            let refreshes = refreshes.clone();
            async move {
                refreshes.fetch_add(1, Ordering::SeqCst);
                Ok(Zeroizing::new("fresh-token".to_string()))
            }
        },
    )
    .await
    .expect_err("second expiry");
    assert_eq!(failure.error, DriveApiError::TokenExpired);
    assert_eq!(attempts.load(Ordering::SeqCst), 2);
    assert_eq!(refreshes.load(Ordering::SeqCst), 1);

    let attempts = Arc::new(AtomicUsize::new(0));
    let refreshes = Arc::new(AtomicUsize::new(0));
    let failure = run_with_single_access_token_refresh(
        Zeroizing::new("expired-token".to_string()),
        |_| {
            let attempts = attempts.clone();
            async move {
                attempts.fetch_add(1, Ordering::SeqCst);
                Err::<(), _>(DriveUploadFailure {
                    error: DriveApiError::TokenExpired,
                    pending_binding: PendingBindingDisposition::NotApplicable,
                })
            }
        },
        || {},
        |_| {
            let refreshes = refreshes.clone();
            async move {
                refreshes.fetch_add(1, Ordering::SeqCst);
                Err(DriveApiError::Network)
            }
        },
    )
    .await
    .expect_err("refresh failure");
    assert_eq!(failure.error, DriveApiError::Network);
    assert_eq!(attempts.load(Ordering::SeqCst), 1);
    assert_eq!(refreshes.load(Ordering::SeqCst), 1);

    let attempts = Arc::new(AtomicUsize::new(0));
    let failure = run_with_single_access_token_refresh(
        Zeroizing::new("expired-token".to_string()),
        |_| {
            let attempts = attempts.clone();
            async move {
                attempts.fetch_add(1, Ordering::SeqCst);
                Err::<(), _>(DriveUploadFailure {
                    error: DriveApiError::TokenExpired,
                    pending_binding: PendingBindingDisposition::Retain,
                })
            }
        },
        || {},
        |_| async { Err(DriveApiError::Canceled) },
    )
    .await
    .expect_err("cancellation preempts refresh retry");
    assert_eq!(failure.error, DriveApiError::Canceled);
    assert_eq!(failure.pending_binding, PendingBindingDisposition::Retain);
    assert_eq!(attempts.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn token_refresh_restores_a_cancellable_transfer_phase_before_refresh_starts() {
    // Break caught: a late expiry after accepted upload progress leaves the
    // lease in Synchronizing, which makes cancel requests fail while the
    // credential refresh or recovered-object probe is still in flight.
    let manager = Arc::new(DriveOperationManager::default());
    let operation_id = Uuid::new_v4();
    let lease = Arc::new(
        manager
            .register("user-42", operation_id, "42")
            .expect("operation"),
    );
    lease.set_phase(DriveOperationPhase::Transferring);
    let refresh_gate = Arc::new(AsyncGate::default());
    let attempts = Arc::new(AtomicUsize::new(0));
    let task = tokio::spawn({
        let lease_for_run = lease.clone();
        let lease_for_reset = lease.clone();
        let cancellation = lease.cancellation().clone();
        let refresh_gate = refresh_gate.clone();
        let attempts = attempts.clone();
        async move {
            run_with_single_access_token_refresh(
                Zeroizing::new("expired-token".to_string()),
                move |_| {
                    let lease = lease_for_run.clone();
                    let attempts = attempts.clone();
                    async move {
                        attempts.fetch_add(1, Ordering::SeqCst);
                        lease.set_phase(DriveOperationPhase::Synchronizing);
                        Err::<(), _>(DriveUploadFailure {
                            error: DriveApiError::TokenExpired,
                            pending_binding: PendingBindingDisposition::Retain,
                        })
                    }
                },
                move || lease_for_reset.set_phase(DriveOperationPhase::Transferring),
                move |_| {
                    let cancellation = cancellation.clone();
                    let refresh_gate = refresh_gate.clone();
                    async move {
                        refresh_gate.entered.add_permits(1);
                        cancellation.cancelled().await;
                        Err(DriveApiError::Canceled)
                    }
                },
            )
            .await
        }
    });
    refresh_gate
        .entered
        .acquire()
        .await
        .expect("refresh entered")
        .forget();

    assert!(
        manager.cancel("user-42", operation_id),
        "refresh must restore the cancellable transfer phase"
    );
    let failure = task.await.unwrap().expect_err("refresh cancellation");
    assert_eq!(failure.error, DriveApiError::Canceled);
    assert_eq!(failure.pending_binding, PendingBindingDisposition::Retain);
    assert_eq!(attempts.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn uncertain_chunk_failure_probes_and_resumes_from_confirmed_byte() {
    let api = ScriptedDriveApi::default();
    api.chunks.lock().unwrap().extend([
        Err(DriveApiError::Network),
        Ok(DriveChunkResult::Accepted(4)),
        Ok(DriveChunkResult::Accepted(8)),
        Ok(DriveChunkResult::Complete),
    ]);
    api.statuses
        .lock()
        .unwrap()
        .push_back(Ok(DriveChunkResult::Accepted(2)));
    api.files
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedDriveApi::valid_file(
            "generated-file-id",
            Some("https://drive.google.com/file.zip"),
        )));
    api.permissions
        .lock()
        .unwrap()
        .push_back(Ok(PublicPermissionStatus::Public));
    let sleeper = RecordingSleeper::default();
    let mut progress = Vec::new();
    let fixture = create_request(b"0123456789");

    run_resumable_upload_for_test(
        &api,
        &sleeper,
        ACCESS_TOKEN,
        fixture.request.clone(),
        4,
        |accepted, _| progress.push(accepted),
    )
    .await
    .expect("resumed upload");

    assert_eq!(
        api.uploaded_ranges.lock().unwrap().as_slice(),
        &[(0, 4), (2, 6), (4, 8), (8, 10)]
    );
    assert_eq!(progress, vec![2, 4, 8, 10]);
}

#[tokio::test]
async fn missing_final_link_retries_with_bounded_backoff_and_never_synthesizes_a_url() {
    let api = ScriptedDriveApi::default();
    api.chunks
        .lock()
        .unwrap()
        .push_back(Ok(DriveChunkResult::Complete));
    api.files.lock().unwrap().extend([
        Ok(ScriptedDriveApi::valid_file("generated-file-id", None)),
        Ok(ScriptedDriveApi::valid_file(
            "generated-file-id",
            Some(" \t "),
        )),
        Ok(ScriptedDriveApi::valid_file(
            "generated-file-id",
            Some("https://drive.google.com/authoritative"),
        )),
    ]);
    api.permissions
        .lock()
        .unwrap()
        .push_back(Ok(PublicPermissionStatus::Public));
    let sleeper = RecordingSleeper::default();
    let fixture = create_request(b"zip");

    let result = run_resumable_upload_for_test(
        &api,
        &sleeper,
        ACCESS_TOKEN,
        fixture.request.clone(),
        4,
        |_, _| {},
    )
    .await
    .expect("bounded link retry");

    assert_eq!(
        result.download_url,
        "https://drive.google.com/authoritative"
    );
    assert_eq!(
        sleeper.delays.lock().unwrap().as_slice(),
        &[Duration::from_millis(100), Duration::from_millis(200)]
    );
}

#[tokio::test]
async fn existing_file_metadata_patch_retries_once_only_for_transient_failure() {
    let metadata = ScriptedMetadataClient::default();
    let prior =
        ScriptedMetadataClient::owner(Some("existing-file"), Some("https://drive.google.com/old"));
    metadata.patches.lock().unwrap().extend([
        Err(DriveMetadataError::Network),
        Ok(ScriptedMetadataClient::owner(
            Some("existing-file"),
            Some("https://drive.google.com/new"),
        )),
    ]);
    metadata
        .fetches
        .lock()
        .unwrap()
        .push_back(Ok(prior.clone()));
    let outcome = DriveUploadOutcome {
        file_id: "existing-file".to_string(),
        file_name: "Saved.zip".to_string(),
        download_url: "https://drive.google.com/new".to_string(),
    };

    let result = patch_existing_upload(&metadata, &AuthState::default(), &prior, outcome.clone())
        .await
        .expect("transient retry");

    assert_eq!(result, outcome);
    assert_eq!(metadata.patch_inputs.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn existing_file_metadata_patch_failure_preserves_prior_binding_and_does_not_over_retry() {
    let metadata = ScriptedMetadataClient::default();
    let prior = ScriptedMetadataClient::owner(
        Some("existing-file"),
        Some("https://drive.google.com/still-working"),
    );
    metadata
        .patches
        .lock()
        .unwrap()
        .push_back(Err(DriveMetadataError::InvalidResponse));
    metadata
        .fetches
        .lock()
        .unwrap()
        .push_back(Ok(prior.clone()));
    let outcome = DriveUploadOutcome {
        file_id: "existing-file".to_string(),
        file_name: "Saved.zip".to_string(),
        download_url: "https://drive.google.com/new".to_string(),
    };

    let failure = patch_existing_upload(&metadata, &AuthState::default(), &prior, outcome)
        .await
        .expect_err("permanent metadata failure");

    assert_eq!(failure.error, DriveApiError::MetadataSync);
    assert_eq!(metadata.patch_inputs.lock().unwrap().len(), 1);
    assert_eq!(
        prior.download_url.as_deref(),
        Some("https://drive.google.com/still-working")
    );
}

#[tokio::test]
async fn new_validation_failure_compensates_but_existing_failure_never_deletes() {
    for delete_result in [
        Ok(()),
        Err(DriveApiError::NotFound),
        Err(DriveApiError::Network),
    ] {
        let api = ScriptedDriveApi::default();
        api.chunks
            .lock()
            .unwrap()
            .push_back(Ok(DriveChunkResult::Complete));
        api.files
            .lock()
            .unwrap()
            .push_back(Ok(ScriptedDriveApi::valid_file(
                "generated-file-id",
                Some("https://drive.google.com/private"),
            )));
        api.permissions
            .lock()
            .unwrap()
            .push_back(Ok(PublicPermissionStatus::NotPublic));
        api.deletes.lock().unwrap().push_back(delete_result.clone());
        let fixture = create_request(b"zip");

        let failure = run_resumable_upload_for_test(
            &api,
            &RecordingSleeper::default(),
            ACCESS_TOKEN,
            fixture.request.clone(),
            4,
            |_, _| {},
        )
        .await
        .expect_err("private created file");

        assert_eq!(
            failure.pending_binding,
            if matches!(delete_result, Ok(()) | Err(DriveApiError::NotFound)) {
                PendingBindingDisposition::DeleteConfirmed
            } else {
                PendingBindingDisposition::Retain
            }
        );
        assert_eq!(*api.delete_count.lock().unwrap(), 1);
    }

    let api = ScriptedDriveApi::default();
    api.files.lock().unwrap().extend([
        Ok(ScriptedDriveApi::valid_file("existing-file", None)),
        Ok(ScriptedDriveApi::valid_file(
            "existing-file",
            Some("https://drive.google.com/private"),
        )),
    ]);
    api.permissions.lock().unwrap().extend([
        Ok(PublicPermissionStatus::Public),
        Ok(PublicPermissionStatus::NotPublic),
    ]);
    api.chunks
        .lock()
        .unwrap()
        .push_back(Ok(DriveChunkResult::Complete));
    let fixture = update_request(b"zip");

    let failure = run_resumable_upload_for_test(
        &api,
        &RecordingSleeper::default(),
        ACCESS_TOKEN,
        fixture.request.clone(),
        4,
        |_, _| {},
    )
    .await
    .expect_err("private existing file");

    assert_eq!(
        failure.pending_binding,
        PendingBindingDisposition::NotApplicable
    );
    assert_eq!(*api.delete_count.lock().unwrap(), 0);
}

#[tokio::test]
async fn transient_rate_limits_use_bounded_backoff_without_reporting_unaccepted_bytes() {
    let api = ScriptedDriveApi::default();
    api.chunks.lock().unwrap().extend([
        Err(DriveApiError::RateLimited(None)),
        Err(DriveApiError::RateLimited(Some(Duration::from_secs(30)))),
        Ok(DriveChunkResult::Complete),
    ]);
    api.files
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedDriveApi::valid_file(
            "generated-file-id",
            Some("https://drive.google.com/file.zip"),
        )));
    api.permissions
        .lock()
        .unwrap()
        .push_back(Ok(PublicPermissionStatus::Public));
    let sleeper = RecordingSleeper::default();
    let mut progress = Vec::new();
    let fixture = create_request(b"zip");

    run_resumable_upload_for_test(
        &api,
        &sleeper,
        ACCESS_TOKEN,
        fixture.request.clone(),
        4,
        |accepted, _| progress.push(accepted),
    )
    .await
    .expect("retry succeeds");

    assert_eq!(progress, vec![3]);
    assert_eq!(
        sleeper.delays.lock().unwrap().as_slice(),
        &[Duration::from_millis(100), Duration::from_secs(30)]
    );
}

#[tokio::test]
async fn final_metadata_rejects_wrong_identity_mime_download_capability_or_non_https_link() {
    let mut invalid_files = vec![
        {
            let mut file = ScriptedDriveApi::valid_file(
                "wrong-file",
                Some("https://drive.google.com/file.zip"),
            );
            file.id = "wrong-file".to_string();
            file
        },
        {
            let mut file = ScriptedDriveApi::valid_file(
                "generated-file-id",
                Some("https://drive.google.com/file.zip"),
            );
            file.mime_type = "application/octet-stream".to_string();
            file
        },
        {
            let mut file = ScriptedDriveApi::valid_file(
                "generated-file-id",
                Some("https://drive.google.com/file.zip"),
            );
            file.can_download = false;
            file
        },
        ScriptedDriveApi::valid_file(
            "generated-file-id",
            Some("http://drive.google.com/insecure"),
        ),
    ];

    for file in invalid_files.drain(..) {
        let api = ScriptedDriveApi::default();
        api.chunks
            .lock()
            .unwrap()
            .push_back(Ok(DriveChunkResult::Complete));
        api.files.lock().unwrap().push_back(Ok(file));
        api.deletes.lock().unwrap().push_back(Ok(()));
        let fixture = create_request(b"zip");

        let failure = run_resumable_upload_for_test(
            &api,
            &RecordingSleeper::default(),
            ACCESS_TOKEN,
            fixture.request.clone(),
            4,
            |_, _| {},
        )
        .await
        .expect_err("invalid final metadata");

        assert_eq!(failure.error, DriveApiError::InvalidResponse);
        assert_eq!(
            failure.pending_binding,
            PendingBindingDisposition::DeleteConfirmed
        );
    }
}

#[tokio::test]
async fn existing_update_without_fresh_edit_capability_stops_before_resumable_session() {
    let api = ScriptedDriveApi::default();
    let mut inaccessible = ScriptedDriveApi::valid_file("existing-file", None);
    inaccessible.can_edit = false;
    api.files.lock().unwrap().push_back(Ok(inaccessible));
    let fixture = update_request(b"replacement");

    let failure = run_resumable_upload_for_test(
        &api,
        &RecordingSleeper::default(),
        ACCESS_TOKEN,
        fixture.request.clone(),
        4,
        |_, _| {},
    )
    .await
    .expect_err("edit access required");

    assert_eq!(failure.error, DriveApiError::PermissionDenied);
    assert!(api.update_metadata.lock().unwrap().is_empty());
    assert_eq!(
        failure.pending_binding,
        PendingBindingDisposition::NotApplicable
    );
}

#[tokio::test]
async fn resumable_session_initiation_retries_transient_and_rate_limited_responses() {
    let api = ScriptedDriveApi::default();
    api.starts.lock().unwrap().extend([
        Err(DriveApiError::Transient(Some(Duration::from_secs(2)))),
        Err(DriveApiError::RateLimited(Some(Duration::from_secs(30)))),
        ResumableUploadSession::for_test("https://upload.test/create"),
    ]);
    api.chunks
        .lock()
        .unwrap()
        .push_back(Ok(DriveChunkResult::Complete));
    api.files
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedDriveApi::valid_file(
            "generated-file-id",
            Some("https://drive.google.com/file.zip"),
        )));
    api.permissions
        .lock()
        .unwrap()
        .push_back(Ok(PublicPermissionStatus::Public));
    let sleeper = RecordingSleeper::default();
    let fixture = create_request(b"zip");

    run_resumable_upload_for_test(
        &api,
        &sleeper,
        ACCESS_TOKEN,
        fixture.request.clone(),
        4,
        |_, _| {},
    )
    .await
    .expect("session retry");

    assert_eq!(api.create_metadata.lock().unwrap().len(), 3);
    assert_eq!(
        sleeper.delays.lock().unwrap().as_slice(),
        &[Duration::from_secs(2), Duration::from_secs(30)]
    );
}

#[tokio::test]
async fn final_metadata_retries_transient_fetch_without_synthesizing_state() {
    let api = ScriptedDriveApi::default();
    api.chunks
        .lock()
        .unwrap()
        .push_back(Ok(DriveChunkResult::Complete));
    api.files.lock().unwrap().extend([
        Err(DriveApiError::Transient(Some(Duration::from_secs(2)))),
        Ok(ScriptedDriveApi::valid_file(
            "generated-file-id",
            Some("https://drive.google.com/authoritative"),
        )),
    ]);
    api.permissions
        .lock()
        .unwrap()
        .push_back(Ok(PublicPermissionStatus::Public));
    api.deletes
        .lock()
        .unwrap()
        .push_back(Err(DriveApiError::Network));
    let sleeper = RecordingSleeper::default();
    let fixture = create_request(b"zip");

    let result = run_resumable_upload_for_test(
        &api,
        &sleeper,
        ACCESS_TOKEN,
        fixture.request.clone(),
        4,
        |_, _| {},
    )
    .await
    .expect("final metadata retry");

    assert_eq!(
        result.download_url,
        "https://drive.google.com/authoritative"
    );
    assert_eq!(
        sleeper.delays.lock().unwrap().as_slice(),
        &[Duration::from_secs(2)]
    );
}

#[tokio::test]
async fn stalled_status_recovery_is_bounded_and_never_reports_progress() {
    let api = ScriptedDriveApi::default();
    api.chunks
        .lock()
        .unwrap()
        .extend((0..5).map(|_| Err(DriveApiError::Network)));
    api.statuses
        .lock()
        .unwrap()
        .extend((0..5).map(|_| Ok(DriveChunkResult::Accepted(0))));
    let sleeper = RecordingSleeper::default();
    let fixture = create_request(b"01234567");
    let mut progress = Vec::new();

    let failure = run_resumable_upload_for_test(
        &api,
        &sleeper,
        ACCESS_TOKEN,
        fixture.request.clone(),
        4,
        |accepted, _| progress.push(accepted),
    )
    .await
    .expect_err("same confirmed offset must terminate");

    assert_eq!(failure.error, DriveApiError::InvalidResponse);
    assert_eq!(api.uploaded_ranges.lock().unwrap().len(), 5);
    assert!(progress.is_empty());
    assert_eq!(
        sleeper.delays.lock().unwrap().as_slice(),
        &[
            Duration::from_millis(100),
            Duration::from_millis(200),
            Duration::from_millis(400),
            Duration::from_millis(800),
        ]
    );
}

#[tokio::test]
async fn same_offset_direct_acks_are_bounded_and_reset_only_after_forward_progress() {
    let api = ScriptedDriveApi::default();
    api.chunks
        .lock()
        .unwrap()
        .extend((0..5).map(|_| Ok(DriveChunkResult::Accepted(0))));
    let sleeper = RecordingSleeper::default();
    let fixture = create_request(b"01234567");

    let failure = run_resumable_upload_for_test(
        &api,
        &sleeper,
        ACCESS_TOKEN,
        fixture.request.clone(),
        4,
        |_, _| {},
    )
    .await
    .expect_err("same-offset acknowledgements must terminate");

    assert_eq!(failure.error, DriveApiError::InvalidResponse);
    assert_eq!(api.uploaded_ranges.lock().unwrap().len(), 5);
    assert_eq!(sleeper.delays.lock().unwrap().len(), 4);
}

#[tokio::test]
async fn chunk_acknowledgements_must_stay_inside_the_attempted_window() {
    for (name, chunks, statuses) in [
        (
            "forward beyond attempted end",
            vec![Ok(DriveChunkResult::Accepted(5))],
            vec![],
        ),
        (
            "regression behind prior confirmed offset",
            vec![
                Ok(DriveChunkResult::Accepted(4)),
                Ok(DriveChunkResult::Accepted(3)),
            ],
            vec![],
        ),
        (
            "early direct completion",
            vec![Ok(DriveChunkResult::Complete)],
            vec![],
        ),
        (
            "early status completion",
            vec![Err(DriveApiError::Network)],
            vec![Ok(DriveChunkResult::Complete)],
        ),
    ] {
        let api = ScriptedDriveApi::default();
        api.chunks.lock().unwrap().extend(chunks);
        api.statuses.lock().unwrap().extend(statuses);
        let fixture = create_request(b"01234567");

        let failure = run_resumable_upload_for_test(
            &api,
            &RecordingSleeper::default(),
            ACCESS_TOKEN,
            fixture.request.clone(),
            4,
            |_, _| {},
        )
        .await
        .expect_err(name);

        assert_eq!(failure.error, DriveApiError::InvalidResponse, "{name}");
    }
}

#[tokio::test]
async fn status_retry_honors_classified_retry_after_before_resuming() {
    let api = ScriptedDriveApi::default();
    api.chunks
        .lock()
        .unwrap()
        .extend([Err(DriveApiError::Network), Ok(DriveChunkResult::Complete)]);
    api.statuses.lock().unwrap().extend([
        Err(DriveApiError::Transient(Some(Duration::from_secs(3)))),
        Ok(DriveChunkResult::Accepted(2)),
    ]);
    api.files
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedDriveApi::valid_file(
            "generated-file-id",
            Some("https://drive.google.com/file.zip"),
        )));
    api.permissions
        .lock()
        .unwrap()
        .push_back(Ok(PublicPermissionStatus::Public));
    let sleeper = RecordingSleeper::default();
    let fixture = create_request(b"zip");

    run_resumable_upload_for_test(
        &api,
        &sleeper,
        ACCESS_TOKEN,
        fixture.request.clone(),
        4,
        |_, _| {},
    )
    .await
    .expect("status retry");

    assert_eq!(
        sleeper.delays.lock().unwrap().as_slice(),
        &[Duration::from_secs(3)]
    );
}

#[tokio::test]
async fn disk_backed_upload_reads_only_bounded_chunks_from_a_large_sparse_archive() {
    let directory = tempdir().expect("sparse directory");
    let archive_path = directory.path().join("large.zip");
    let total = 10 * 1024 * 1024 + 3;
    std::fs::File::create(&archive_path)
        .expect("sparse archive")
        .set_len(total)
        .expect("sparse length");
    let request = DriveUploadRequest {
        simfile_id: "sim-42".to_string(),
        saved_title: "Sparse".to_string(),
        archive_path,
        target: DriveUploadTarget::Create {
            generated_id: "generated-file-id".to_string(),
            folder_id: "folder-42".to_string(),
        },
    };
    let api = ScriptedDriveApi::default();
    api.chunks.lock().unwrap().extend([
        Ok(DriveChunkResult::Accepted(4 * 1024 * 1024)),
        Ok(DriveChunkResult::Accepted(8 * 1024 * 1024)),
        Ok(DriveChunkResult::Complete),
    ]);
    api.files
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedDriveApi::valid_file(
            "generated-file-id",
            Some("https://drive.google.com/file.zip"),
        )));
    api.permissions
        .lock()
        .unwrap()
        .push_back(Ok(PublicPermissionStatus::Public));

    run_resumable_upload_for_test(
        &api,
        &RecordingSleeper::default(),
        ACCESS_TOKEN,
        request,
        4 * 1024 * 1024,
        |_, _| {},
    )
    .await
    .expect("sparse upload");

    assert_eq!(
        api.uploaded_ranges.lock().unwrap().as_slice(),
        &[
            (0, 4 * 1024 * 1024),
            (4 * 1024 * 1024, 8 * 1024 * 1024),
            (8 * 1024 * 1024, total),
        ]
    );
}

#[tokio::test]
async fn archive_open_and_short_read_fail_safely_without_loading_or_contacting_further() {
    let missing = create_request(b"zip");
    std::fs::remove_file(&missing.request.archive_path).expect("remove archive");
    let missing_api = ScriptedDriveApi::default();
    let failure = run_resumable_upload_for_test(
        &missing_api,
        &RecordingSleeper::default(),
        ACCESS_TOKEN,
        missing.request.clone(),
        4,
        |_, _| {},
    )
    .await
    .expect_err("missing archive");
    assert_eq!(failure.error, DriveApiError::LocalState);
    assert!(missing_api.create_metadata.lock().unwrap().is_empty());

    let shortened = create_request(b"01234567");
    let shortened_api = ScriptedDriveApi::default();
    shortened_api
        .chunks
        .lock()
        .unwrap()
        .push_back(Ok(DriveChunkResult::Accepted(4)));
    *shortened_api.truncate_after_first_chunk.lock().unwrap() =
        Some(shortened.request.archive_path.clone());

    let failure = run_resumable_upload_for_test(
        &shortened_api,
        &RecordingSleeper::default(),
        ACCESS_TOKEN,
        shortened.request.clone(),
        4,
        |_, _| {},
    )
    .await
    .expect_err("shortened archive");
    assert_eq!(failure.error, DriveApiError::LocalState);
    assert_eq!(
        shortened_api.uploaded_ranges.lock().unwrap().as_slice(),
        &[(0, 4)]
    );
}

async fn authenticated_user(user_id: &str) -> AuthState {
    let auth = AuthState::default();
    auth.set_current_session(Some(serde_json::json!({
        "user": { "id": user_id },
        "sessionToken": "opaque-session-token"
    })))
    .await;
    auth
}

fn crash_safe_request(archive_path: PathBuf, kind: PendingBindingKind) -> CrashSafeCreateRequest {
    CrashSafeCreateRequest {
        simfile_id: "42".to_string(),
        archive_path,
        folder_id: "folder-42".to_string(),
        kind,
    }
}

fn pending_store(data_dir: &TempDir) -> GoogleDrivePendingBindingStore {
    GoogleDrivePendingBindingStore::new(data_dir.path().to_path_buf())
}

fn seed_pending_binding(
    store: &GoogleDrivePendingBindingStore,
    drive_file_id: &str,
    kind: PendingBindingKind,
) {
    seed_pending_binding_for(store, "user-42", "42", drive_file_id, kind);
}

fn seed_pending_binding_for(
    store: &GoogleDrivePendingBindingStore,
    user_id: &str,
    simfile_id: &str,
    drive_file_id: &str,
    kind: PendingBindingKind,
) {
    store
        .replace(
            crate::google_drive::pending_bindings::PendingGoogleDriveBinding {
                user_id: user_id.to_string(),
                simfile_id: simfile_id.to_string(),
                drive_file_id: drive_file_id.to_string(),
                kind,
                created_at: "2026-07-26T00:00:00Z".to_string(),
                expected_previous_drive_file: None,
            },
        )
        .expect("pending binding");
}

fn script_successful_create(api: &ScriptedDriveApi, file_id: &str, download_url: &str) {
    api.chunks
        .lock()
        .unwrap()
        .push_back(Ok(DriveChunkResult::Complete));
    api.files
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedDriveApi::valid_file(
            file_id,
            Some(download_url),
        )));
    api.permissions
        .lock()
        .unwrap()
        .push_back(Ok(PublicPermissionStatus::Public));
}

fn script_successful_patch(metadata: &ScriptedMetadataClient, file_id: &str, download_url: &str) {
    metadata
        .patches
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedMetadataClient::owner(
            Some(file_id),
            Some(download_url),
        )));
}

#[tokio::test]
async fn crash_safe_create_refreshes_once_and_reuses_one_persisted_generated_id() {
    let data_dir = tempdir().expect("data dir");
    let archive_dir = tempdir().expect("archive dir");
    let archive_path = archive_dir.path().join("upload.zip");
    std::fs::write(&archive_path, b"archive").expect("archive");
    let store = pending_store(&data_dir);
    let api = ScriptedDriveApi::default();
    api.generated_ids
        .lock()
        .unwrap()
        .push_back(Ok("stable-generated-id".to_string()));
    api.files.lock().unwrap().extend([
        Err(DriveApiError::NotFound),
        Ok(ScriptedDriveApi::valid_file(
            "stable-generated-id",
            Some("https://drive.google.com/download"),
        )),
    ]);
    api.permissions
        .lock()
        .unwrap()
        .push_back(Ok(PublicPermissionStatus::Public));
    api.chunks.lock().unwrap().extend([
        Ok(DriveChunkResult::Accepted(4)),
        Err(DriveApiError::TokenExpired),
        Ok(DriveChunkResult::Accepted(4)),
        Ok(DriveChunkResult::Complete),
    ]);
    let metadata = ScriptedMetadataClient::default();
    metadata.fetches.lock().unwrap().extend([
        Ok(ScriptedMetadataClient::owner(None, None)),
        Ok(ScriptedMetadataClient::owner(None, None)),
    ]);
    script_successful_patch(
        &metadata,
        "stable-generated-id",
        "https://drive.google.com/download",
    );
    let auth = authenticated_user("user-42").await;
    let request = crash_safe_request(archive_path, PendingBindingKind::FirstUpload);
    let progress = Arc::new(Mutex::new(Vec::new()));
    let monotonic = Arc::new(Mutex::new(MonotonicDriveProgress::default()));
    let refreshes = Arc::new(AtomicUsize::new(0));
    let api_ref = &api;
    let store_ref = &store;
    let metadata_ref = &metadata;
    let auth_ref = &auth;

    let outcome = run_with_single_access_token_refresh(
        Zeroizing::new("expired-token".to_string()),
        |access_token| {
            let request = request.clone();
            let progress = progress.clone();
            let monotonic = monotonic.clone();
            let api = api_ref;
            let store = store_ref;
            let metadata = metadata_ref;
            let auth = auth_ref;
            async move {
                run_crash_safe_create_for_test(
                    api,
                    &RecordingSleeper::default(),
                    store,
                    metadata,
                    auth,
                    &access_token,
                    request,
                    4,
                    None,
                    |accepted, total| {
                        if monotonic.lock().unwrap().should_emit(accepted, total) {
                            progress.lock().unwrap().push((accepted, total));
                        }
                    },
                )
                .await
            }
        },
        || {},
        |_| {
            let refreshes = refreshes.clone();
            async move {
                refreshes.fetch_add(1, Ordering::SeqCst);
                Ok(Zeroizing::new("fresh-token".to_string()))
            }
        },
    )
    .await
    .expect("create retry succeeds");

    assert_eq!(outcome.file_id, "stable-generated-id");
    assert_eq!(*api.generated_count.lock().unwrap(), 1);
    assert_eq!(refreshes.load(Ordering::SeqCst), 1);
    assert_eq!(
        api.start_tokens.lock().unwrap().as_slice(),
        &["expired-token", "fresh-token"]
    );
    assert_eq!(
        api.create_metadata
            .lock()
            .unwrap()
            .iter()
            .map(|metadata| metadata.id.as_str())
            .collect::<Vec<_>>(),
        vec!["stable-generated-id", "stable-generated-id"]
    );
    assert_eq!(progress.lock().unwrap().as_slice(), &[(4, 7), (7, 7)]);
    assert_eq!(store.get("user-42", "42").unwrap(), None);
}

#[derive(Clone, Copy)]
enum LateCreateExpiry {
    FinalGetFile,
    FinalPublicPermission,
}

async fn assert_late_create_expiry_reuses_persisted_identity(stage: LateCreateExpiry) {
    // Break caught: compensating a late TokenExpired deletes the completed
    // object and journal before the one allowed credential refresh can
    // reconcile the same durable Drive identity.
    let data_dir = tempdir().expect("data dir");
    let store = pending_store(&data_dir);
    let archive = create_request(b"archive");
    let api = ScriptedDriveApi::default();
    api.generated_ids
        .lock()
        .unwrap()
        .push_back(Ok("stable-generated-id".to_string()));
    api.chunks
        .lock()
        .unwrap()
        .push_back(Ok(DriveChunkResult::Complete));
    api.deletes.lock().unwrap().push_back(Ok(()));
    match stage {
        LateCreateExpiry::FinalGetFile => {
            api.files.lock().unwrap().extend([
                Err(DriveApiError::TokenExpired),
                Ok(ScriptedDriveApi::valid_file(
                    "stable-generated-id",
                    Some("https://drive.google.com/late-get"),
                )),
            ]);
            api.permissions
                .lock()
                .unwrap()
                .push_back(Ok(PublicPermissionStatus::Public));
        }
        LateCreateExpiry::FinalPublicPermission => {
            api.files.lock().unwrap().extend([
                Ok(ScriptedDriveApi::valid_file(
                    "stable-generated-id",
                    Some("https://drive.google.com/late-permission"),
                )),
                Ok(ScriptedDriveApi::valid_file(
                    "stable-generated-id",
                    Some("https://drive.google.com/late-permission"),
                )),
            ]);
            api.permissions.lock().unwrap().extend([
                Err(DriveApiError::TokenExpired),
                Ok(PublicPermissionStatus::Public),
            ]);
        }
    }
    let expected_url = match stage {
        LateCreateExpiry::FinalGetFile => "https://drive.google.com/late-get",
        LateCreateExpiry::FinalPublicPermission => "https://drive.google.com/late-permission",
    };
    let metadata = ScriptedMetadataClient::default();
    metadata.fetches.lock().unwrap().extend([
        Ok(ScriptedMetadataClient::owner(None, None)),
        Ok(ScriptedMetadataClient::owner(None, None)),
    ]);
    script_successful_patch(&metadata, "stable-generated-id", expected_url);
    let auth = authenticated_user("user-42").await;
    let request = crash_safe_request(
        archive.request.archive_path.clone(),
        PendingBindingKind::FirstUpload,
    );
    let progress = Arc::new(Mutex::new(Vec::new()));
    let monotonic = Arc::new(Mutex::new(MonotonicDriveProgress::default()));
    let refreshes = Arc::new(AtomicUsize::new(0));
    let api_ref = &api;
    let store_ref = &store;
    let metadata_ref = &metadata;
    let auth_ref = &auth;

    let outcome = run_with_single_access_token_refresh(
        Zeroizing::new("expired-token".to_string()),
        |access_token| {
            let request = request.clone();
            let progress = progress.clone();
            let monotonic = monotonic.clone();
            async move {
                run_crash_safe_create_for_test(
                    api_ref,
                    &RecordingSleeper::default(),
                    store_ref,
                    metadata_ref,
                    auth_ref,
                    &access_token,
                    request,
                    16,
                    None,
                    |accepted, total| {
                        if monotonic.lock().unwrap().should_emit(accepted, total) {
                            progress.lock().unwrap().push((accepted, total));
                        }
                    },
                )
                .await
            }
        },
        || {},
        |_| {
            let refreshes = refreshes.clone();
            async move {
                refreshes.fetch_add(1, Ordering::SeqCst);
                let pending = store_ref
                    .get("user-42", "42")
                    .expect("pending read")
                    .expect("late expiry must retain the pending binding");
                assert_eq!(pending.drive_file_id, "stable-generated-id");
                assert!(
                    api_ref.delete_ids.lock().unwrap().is_empty(),
                    "an expired credential must never be used for compensation"
                );
                Ok(Zeroizing::new("fresh-token".to_string()))
            }
        },
    )
    .await
    .expect("refreshed transaction reconciles");

    assert_eq!(outcome.file_id, "stable-generated-id");
    assert_eq!(outcome.download_url, expected_url);
    assert_eq!(*api.generated_count.lock().unwrap(), 1);
    assert_eq!(refreshes.load(Ordering::SeqCst), 1);
    assert_eq!(
        api.start_tokens.lock().unwrap().as_slice(),
        &["expired-token"]
    );
    assert_eq!(
        api.create_metadata
            .lock()
            .unwrap()
            .iter()
            .map(|metadata| metadata.id.as_str())
            .collect::<Vec<_>>(),
        vec!["stable-generated-id"]
    );
    assert_eq!(
        api.get_file_requests.lock().unwrap().as_slice(),
        &[
            (
                "expired-token".to_string(),
                "stable-generated-id".to_string()
            ),
            ("fresh-token".to_string(), "stable-generated-id".to_string())
        ]
    );
    let expected_permission_requests = match stage {
        LateCreateExpiry::FinalGetFile => {
            vec![("fresh-token".to_string(), "stable-generated-id".to_string())]
        }
        LateCreateExpiry::FinalPublicPermission => vec![
            (
                "expired-token".to_string(),
                "stable-generated-id".to_string(),
            ),
            ("fresh-token".to_string(), "stable-generated-id".to_string()),
        ],
    };
    assert_eq!(
        *api.permission_requests.lock().unwrap(),
        expected_permission_requests
    );
    assert_eq!(progress.lock().unwrap().as_slice(), &[(7, 7)]);
    assert!(api.delete_ids.lock().unwrap().is_empty());
    assert_eq!(store.get("user-42", "42").unwrap(), None);
}

#[tokio::test]
async fn final_get_file_token_expiry_refreshes_without_deleting_or_rotating_the_drive_id() {
    assert_late_create_expiry_reuses_persisted_identity(LateCreateExpiry::FinalGetFile).await;
}

#[tokio::test]
async fn final_public_permission_token_expiry_refreshes_without_deleting_or_rotating_the_drive_id()
{
    assert_late_create_expiry_reuses_persisted_identity(LateCreateExpiry::FinalPublicPermission)
        .await;
}

#[tokio::test]
async fn existing_pending_probe_token_expiry_refreshes_and_reconciles_the_same_drive_id() {
    // Break caught: swallowing an expired existing-object probe or treating
    // it as absence can start a duplicate create instead of retrying the
    // persisted identity with the replacement credential.
    let data_dir = tempdir().expect("data dir");
    let store = pending_store(&data_dir);
    seed_pending_binding(&store, "stable-pending-id", PendingBindingKind::FirstUpload);
    let archive = create_request(b"unused");
    let api = ScriptedDriveApi::default();
    api.files.lock().unwrap().extend([
        Err(DriveApiError::TokenExpired),
        Ok(ScriptedDriveApi::valid_file(
            "stable-pending-id",
            Some("https://drive.google.com/pending"),
        )),
    ]);
    api.permissions
        .lock()
        .unwrap()
        .push_back(Ok(PublicPermissionStatus::Public));
    let metadata = ScriptedMetadataClient::default();
    metadata.fetches.lock().unwrap().extend([
        Ok(ScriptedMetadataClient::owner(None, None)),
        Ok(ScriptedMetadataClient::owner(None, None)),
    ]);
    script_successful_patch(
        &metadata,
        "stable-pending-id",
        "https://drive.google.com/pending",
    );
    let auth = authenticated_user("user-42").await;
    let request = crash_safe_request(
        archive.request.archive_path.clone(),
        PendingBindingKind::FirstUpload,
    );
    let refreshes = Arc::new(AtomicUsize::new(0));
    let api_ref = &api;
    let store_ref = &store;
    let metadata_ref = &metadata;
    let auth_ref = &auth;

    let outcome = run_with_single_access_token_refresh(
        Zeroizing::new("expired-token".to_string()),
        |access_token| {
            let request = request.clone();
            async move {
                run_crash_safe_create_for_test(
                    api_ref,
                    &RecordingSleeper::default(),
                    store_ref,
                    metadata_ref,
                    auth_ref,
                    &access_token,
                    request,
                    16,
                    None,
                    |_, _| {},
                )
                .await
            }
        },
        || {},
        |_| {
            let refreshes = refreshes.clone();
            async move {
                refreshes.fetch_add(1, Ordering::SeqCst);
                assert_eq!(
                    store_ref
                        .get("user-42", "42")
                        .unwrap()
                        .expect("pending retained")
                        .drive_file_id,
                    "stable-pending-id"
                );
                Ok(Zeroizing::new("fresh-token".to_string()))
            }
        },
    )
    .await
    .expect("pending reconciliation succeeds");

    assert_eq!(outcome.file_id, "stable-pending-id");
    assert_eq!(refreshes.load(Ordering::SeqCst), 1);
    assert_eq!(*api.generated_count.lock().unwrap(), 0);
    assert!(api.create_metadata.lock().unwrap().is_empty());
    assert_eq!(
        api.get_file_requests.lock().unwrap().as_slice(),
        &[
            ("expired-token".to_string(), "stable-pending-id".to_string()),
            ("fresh-token".to_string(), "stable-pending-id".to_string())
        ]
    );
    assert!(api.delete_ids.lock().unwrap().is_empty());
    assert_eq!(store.get("user-42", "42").unwrap(), None);
}

#[tokio::test]
async fn late_create_second_expiry_stops_after_one_refresh_without_delete_or_identity_rotation() {
    let data_dir = tempdir().expect("data dir");
    let store = pending_store(&data_dir);
    let archive = create_request(b"archive");
    let api = ScriptedDriveApi::default();
    api.generated_ids
        .lock()
        .unwrap()
        .push_back(Ok("stable-second-expiry-id".to_string()));
    api.chunks
        .lock()
        .unwrap()
        .push_back(Ok(DriveChunkResult::Complete));
    api.files.lock().unwrap().extend([
        Err(DriveApiError::TokenExpired),
        Err(DriveApiError::TokenExpired),
    ]);
    let metadata = ScriptedMetadataClient::default();
    metadata.fetches.lock().unwrap().extend([
        Ok(ScriptedMetadataClient::owner(None, None)),
        Ok(ScriptedMetadataClient::owner(None, None)),
    ]);
    let auth = authenticated_user("user-42").await;
    let request = crash_safe_request(
        archive.request.archive_path.clone(),
        PendingBindingKind::FirstUpload,
    );
    let refreshes = Arc::new(AtomicUsize::new(0));
    let api_ref = &api;
    let store_ref = &store;
    let metadata_ref = &metadata;
    let auth_ref = &auth;

    let failure = run_with_single_access_token_refresh(
        Zeroizing::new("expired-token".to_string()),
        |access_token| {
            let request = request.clone();
            async move {
                run_crash_safe_create_for_test(
                    api_ref,
                    &RecordingSleeper::default(),
                    store_ref,
                    metadata_ref,
                    auth_ref,
                    &access_token,
                    request,
                    16,
                    None,
                    |_, _| {},
                )
                .await
            }
        },
        || {},
        |_| {
            let refreshes = refreshes.clone();
            async move {
                refreshes.fetch_add(1, Ordering::SeqCst);
                Ok(Zeroizing::new("fresh-token".to_string()))
            }
        },
    )
    .await
    .expect_err("second expiry is terminal");

    assert_eq!(failure.error, DriveApiError::TokenExpired);
    assert_eq!(failure.pending_binding, PendingBindingDisposition::Retain);
    assert_eq!(refreshes.load(Ordering::SeqCst), 1);
    assert_eq!(*api.generated_count.lock().unwrap(), 1);
    assert_eq!(api.get_file_requests.lock().unwrap().len(), 2);
    assert!(api.delete_ids.lock().unwrap().is_empty());
    assert_eq!(
        store
            .get("user-42", "42")
            .unwrap()
            .expect("terminal expiry retains pending")
            .drive_file_id,
        "stable-second-expiry-id"
    );
}

#[tokio::test]
async fn cancellation_during_refreshed_pending_probe_retains_identity_and_emits_no_duplicate_progress(
) {
    let data_dir = tempdir().expect("data dir");
    let store = Arc::new(pending_store(&data_dir));
    let archive = create_request(b"archive");
    let api = Arc::new(ScriptedDriveApi::default());
    api.generated_ids
        .lock()
        .unwrap()
        .push_back(Ok("stable-cancel-id".to_string()));
    api.chunks
        .lock()
        .unwrap()
        .push_back(Ok(DriveChunkResult::Complete));
    api.files.lock().unwrap().extend([
        Err(DriveApiError::TokenExpired),
        Ok(ScriptedDriveApi::valid_file(
            "stable-cancel-id",
            Some("https://drive.google.com/should-not-bind"),
        )),
    ]);
    let metadata = Arc::new(ScriptedMetadataClient::default());
    metadata.fetches.lock().unwrap().extend([
        Ok(ScriptedMetadataClient::owner(None, None)),
        Ok(ScriptedMetadataClient::owner(None, None)),
    ]);
    let auth = Arc::new(authenticated_user("user-42").await);
    let request = crash_safe_request(
        archive.request.archive_path.clone(),
        PendingBindingKind::FirstUpload,
    );
    let manager = Arc::new(DriveOperationManager::default());
    let operation_id = Uuid::new_v4();
    let lease = Arc::new(
        manager
            .register("user-42", operation_id, "42")
            .expect("operation"),
    );
    lease.set_phase(DriveOperationPhase::Transferring);
    let finalization_gate = Arc::new(lease.finalization_gate());
    let cancellation = lease.cancellation().clone();
    let retry_get_file_gate = Arc::new(AsyncGate::default());
    let progress = Arc::new(Mutex::new(Vec::new()));
    let monotonic = Arc::new(Mutex::new(MonotonicDriveProgress::default()));
    let refreshes = Arc::new(AtomicUsize::new(0));

    let task = tokio::spawn({
        let api = api.clone();
        let store = store.clone();
        let metadata = metadata.clone();
        let auth = auth.clone();
        let lease_for_progress = lease.clone();
        let lease_for_reset = lease.clone();
        let retry_get_file_gate = retry_get_file_gate.clone();
        let progress = progress.clone();
        let monotonic = monotonic.clone();
        let refreshes = refreshes.clone();
        async move {
            let _archive = archive;
            run_with_single_access_token_refresh(
                Zeroizing::new("expired-token".to_string()),
                |access_token| {
                    let request = request.clone();
                    let progress = progress.clone();
                    let monotonic = monotonic.clone();
                    let lease = lease_for_progress.clone();
                    let api = api.clone();
                    let store = store.clone();
                    let metadata = metadata.clone();
                    let auth = auth.clone();
                    let cancellation = cancellation.clone();
                    let finalization_gate = finalization_gate.clone();
                    async move {
                        run_crash_safe_create_cancelable(
                            api.as_ref(),
                            &RecordingSleeper::default(),
                            store.as_ref(),
                            metadata.as_ref(),
                            auth.as_ref(),
                            &access_token,
                            request,
                            &cancellation,
                            finalization_gate.as_ref(),
                            |accepted, total| {
                                if monotonic.lock().unwrap().should_emit(accepted, total) {
                                    progress.lock().unwrap().push((accepted, total));
                                    if accepted >= total {
                                        lease.set_phase(DriveOperationPhase::Synchronizing);
                                    }
                                }
                            },
                        )
                        .await
                    }
                },
                || lease_for_reset.set_phase(DriveOperationPhase::Transferring),
                |_| {
                    refreshes.fetch_add(1, Ordering::SeqCst);
                    *api.get_file_gate.lock().unwrap() = Some(retry_get_file_gate.clone());
                    async { Ok(Zeroizing::new("fresh-token".to_string())) }
                },
            )
            .await
        }
    });
    retry_get_file_gate
        .entered
        .acquire()
        .await
        .expect("refreshed pending probe entered")
        .forget();

    assert!(manager.cancel("user-42", operation_id));
    let failure = task.await.unwrap().expect_err("retry cancellation");
    assert_eq!(failure.error, DriveApiError::Canceled);
    assert_eq!(failure.pending_binding, PendingBindingDisposition::Retain);
    assert_eq!(refreshes.load(Ordering::SeqCst), 1);
    assert_eq!(*api.generated_count.lock().unwrap(), 1);
    assert_eq!(progress.lock().unwrap().as_slice(), &[(7, 7)]);
    assert!(api.delete_ids.lock().unwrap().is_empty());
    assert!(metadata.patch_inputs.lock().unwrap().is_empty());
    assert_eq!(
        store
            .get("user-42", "42")
            .unwrap()
            .expect("cancellation retains pending")
            .drive_file_id,
        "stable-cancel-id"
    );
}

#[tokio::test]
async fn concurrent_direct_creates_serialize_the_complete_binding_lifecycle() {
    let data_dir = tempdir().expect("data dir");
    let store = Arc::new(pending_store(&data_dir));
    let api = Arc::new(ScriptedDriveApi::default());
    api.generated_ids.lock().unwrap().extend([
        Ok("shared-generated-id".to_string()),
        Ok("shared-generated-id".to_string()),
    ]);
    script_successful_create(
        &api,
        "shared-generated-id",
        "https://drive.google.com/shared",
    );
    script_successful_create(
        &api,
        "shared-generated-id",
        "https://drive.google.com/shared",
    );
    let metadata = Arc::new(BlockingStatefulMetadataClient::unbound());
    let auth = Arc::new(authenticated_user("user-42").await);
    let archive = create_request(b"zip");
    let request = crash_safe_request(
        archive.request.archive_path,
        PendingBindingKind::FirstUpload,
    );

    let first = {
        let api = Arc::clone(&api);
        let store = Arc::clone(&store);
        let metadata = Arc::clone(&metadata);
        let auth = Arc::clone(&auth);
        let request = request.clone();
        tokio::spawn(async move {
            run_crash_safe_create_for_test(
                api.as_ref(),
                &RecordingSleeper::default(),
                store.as_ref(),
                metadata.as_ref(),
                auth.as_ref(),
                ACCESS_TOKEN,
                request,
                4,
                None,
                |_, _| {},
            )
            .await
        })
    };
    metadata
        .first_fetch_entered
        .acquire()
        .await
        .expect("first fetch entered")
        .forget();
    let second = {
        let api = Arc::clone(&api);
        let store = Arc::clone(&store);
        let metadata = Arc::clone(&metadata);
        let auth = Arc::clone(&auth);
        tokio::spawn(async move {
            run_crash_safe_create_for_test(
                api.as_ref(),
                &RecordingSleeper::default(),
                store.as_ref(),
                metadata.as_ref(),
                auth.as_ref(),
                ACCESS_TOKEN,
                request,
                4,
                None,
                |_, _| {},
            )
            .await
        })
    };
    // Give the second task enough scheduling rounds to progress through
    // ensure_not_canceled, auth.current_user_id, and reach the
    // transaction-lock wait before we release the first fetch. A single
    // yield_now is not enough because current_user_id is async and needs at
    // least one additional scheduling round to resolve.
    for _ in 0..20 {
        tokio::task::yield_now().await;
    }
    metadata.first_fetch_release.add_permits(1);

    let results = [
        first.await.expect("first task"),
        second.await.expect("second task"),
    ];
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(*api.generated_count.lock().unwrap(), 1);
    assert_eq!(api.create_metadata.lock().unwrap().len(), 1);
    assert_eq!(metadata.patch_count.load(Ordering::SeqCst), 1);
    assert!(api.delete_ids.lock().unwrap().is_empty());
    assert_eq!(store.get("user-42", "42").expect("pending"), None);
}

#[tokio::test]
async fn direct_create_and_auth_sweep_share_the_same_binding_lifecycle_lock() {
    let data_dir = tempdir().expect("data dir");
    let store = Arc::new(pending_store(&data_dir));
    let api = Arc::new(ScriptedDriveApi::default());
    api.generated_ids
        .lock()
        .unwrap()
        .push_back(Ok("direct-sweep-id".to_string()));
    script_successful_create(
        &api,
        "direct-sweep-id",
        "https://drive.google.com/direct-sweep",
    );
    let start_gate = Arc::new(AsyncGate::default());
    *api.start_create_gate.lock().unwrap() = Some(Arc::clone(&start_gate));
    let metadata = Arc::new(ScriptedMetadataClient::default());
    metadata.fetches.lock().unwrap().extend([
        Ok(ScriptedMetadataClient::owner(None, None)),
        Err(DriveMetadataError::Network),
    ]);
    script_successful_patch(
        &metadata,
        "direct-sweep-id",
        "https://drive.google.com/direct-sweep",
    );
    let auth = Arc::new(authenticated_user("user-42").await);
    let archive = create_request(b"zip");
    let request = crash_safe_request(
        archive.request.archive_path,
        PendingBindingKind::FirstUpload,
    );

    let direct = {
        let api = Arc::clone(&api);
        let store = Arc::clone(&store);
        let metadata = Arc::clone(&metadata);
        let auth = Arc::clone(&auth);
        tokio::spawn(async move {
            run_crash_safe_create_for_test(
                api.as_ref(),
                &RecordingSleeper::default(),
                store.as_ref(),
                metadata.as_ref(),
                auth.as_ref(),
                ACCESS_TOKEN,
                request,
                4,
                None,
                |_, _| {},
            )
            .await
        })
    };
    start_gate
        .entered
        .acquire()
        .await
        .expect("direct create entered")
        .forget();
    let sweep = {
        let api = Arc::clone(&api);
        let store = Arc::clone(&store);
        let metadata = Arc::clone(&metadata);
        let auth = Arc::clone(&auth);
        tokio::spawn(async move {
            reconcile_pending_bindings_for_current_user(
                api.as_ref(),
                store.as_ref(),
                metadata.as_ref(),
                auth.as_ref(),
                ACCESS_TOKEN,
                &CancellationToken::new(),
            )
            .await;
        })
    };
    tokio::task::yield_now().await;
    start_gate.release.add_permits(1);

    direct.await.expect("direct task").expect("direct create");
    sweep.await.expect("sweep task");
    assert_eq!(*api.generated_count.lock().unwrap(), 1);
    assert_eq!(api.create_metadata.lock().unwrap().len(), 1);
    assert_eq!(metadata.patch_inputs.lock().unwrap().len(), 1);
    assert_eq!(
        metadata.fetches.lock().unwrap().len(),
        1,
        "the sweep must re-read the removed binding after taking the shared lock"
    );
    assert!(api.delete_ids.lock().unwrap().is_empty());
    assert_eq!(store.get("user-42", "42").expect("pending"), None);
}

#[tokio::test]
async fn reconciliation_after_crash_before_create_reuses_the_persisted_identity() {
    // Break caught: contacting files.create before committing the generated ID,
    // or generating a second ID after a pre-create process crash.
    let api = ScriptedDriveApi::default();
    api.generated_ids
        .lock()
        .unwrap()
        .push_back(Ok("generated-original".to_string()));
    let metadata = ScriptedMetadataClient::default();
    metadata
        .fetches
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedMetadataClient::owner(None, None)));
    let auth = authenticated_user("user-42").await;
    let data_dir = tempdir().expect("data dir");
    let store = pending_store(&data_dir);
    let archive = request_fixture(
        b"zip",
        DriveUploadTarget::Create {
            generated_id: "unused".to_string(),
            folder_id: "unused".to_string(),
        },
        "renderer title must not be used",
    );
    let request = crash_safe_request(
        archive.request.archive_path.clone(),
        PendingBindingKind::FirstUpload,
    );

    let failure = run_crash_safe_create_for_test(
        &api,
        &RecordingSleeper::default(),
        &store,
        &metadata,
        &auth,
        ACCESS_TOKEN,
        request.clone(),
        4,
        Some(CreateCrashPoint::AfterBindingPersisted),
        |_, _| {},
    )
    .await
    .expect_err("injected process boundary");

    assert_eq!(failure.error, DriveApiError::LocalState);
    assert!(api.create_metadata.lock().unwrap().is_empty());
    assert_eq!(
        store
            .get("user-42", "42")
            .expect("pending read")
            .expect("pending binding")
            .drive_file_id,
        "generated-original"
    );

    metadata
        .fetches
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedMetadataClient::owner(None, None)));
    api.files
        .lock()
        .unwrap()
        .push_back(Err(DriveApiError::NotFound));
    script_successful_create(
        &api,
        "generated-original",
        "https://drive.google.com/original",
    );
    script_successful_patch(
        &metadata,
        "generated-original",
        "https://drive.google.com/original",
    );

    run_crash_safe_create_for_test(
        &api,
        &RecordingSleeper::default(),
        &store,
        &metadata,
        &auth,
        ACCESS_TOKEN,
        request,
        4,
        None,
        |_, _| {},
    )
    .await
    .expect("recovered create");

    assert_eq!(*api.generated_count.lock().unwrap(), 1);
    assert_eq!(
        api.create_metadata
            .lock()
            .unwrap()
            .iter()
            .map(|entry| entry.id.as_str())
            .collect::<Vec<_>>(),
        vec!["generated-original"]
    );
    assert_eq!(store.get("user-42", "42").expect("pending read"), None);
}

#[tokio::test]
async fn reconciliation_binds_an_existing_public_zip_and_never_starts_a_duplicate_create() {
    // Break caught: treating every pending record as unused instead of first
    // probing the durable Drive identity after restart.
    let data_dir = tempdir().expect("data dir");
    let store = pending_store(&data_dir);
    store
        .replace(
            crate::google_drive::pending_bindings::PendingGoogleDriveBinding {
                user_id: "user-42".to_string(),
                simfile_id: "42".to_string(),
                drive_file_id: "generated-existing".to_string(),
                kind: PendingBindingKind::FirstUpload,
                created_at: "2000-01-01T00:00:00Z".to_string(),
                expected_previous_drive_file: None,
            },
        )
        .expect("old pending binding");
    let api = ScriptedDriveApi::default();
    api.files
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedDriveApi::valid_file(
            "generated-existing",
            Some("https://drive.google.com/existing"),
        )));
    api.permissions
        .lock()
        .unwrap()
        .push_back(Ok(PublicPermissionStatus::Public));
    let metadata = ScriptedMetadataClient::default();
    metadata
        .fetches
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedMetadataClient::owner(None, None)));
    script_successful_patch(
        &metadata,
        "generated-existing",
        "https://drive.google.com/existing",
    );
    let archive = create_request(b"zip");

    let outcome = run_crash_safe_create_for_test(
        &api,
        &RecordingSleeper::default(),
        &store,
        &metadata,
        &authenticated_user("user-42").await,
        ACCESS_TOKEN,
        crash_safe_request(
            archive.request.archive_path,
            PendingBindingKind::FirstUpload,
        ),
        4,
        None,
        |_, _| {},
    )
    .await
    .expect("reconciled binding");

    assert_eq!(outcome.file_id, "generated-existing");
    assert!(api.create_metadata.lock().unwrap().is_empty());
    assert_eq!(*api.generated_count.lock().unwrap(), 0);
    assert_eq!(store.get("user-42", "42").expect("pending read"), None);
}

#[tokio::test]
async fn already_referenced_pending_file_is_retained_when_drive_validation_fails() {
    for auth_sweep in [false, true] {
        let data_dir = tempdir().expect("data dir");
        let store = pending_store(&data_dir);
        seed_pending_binding(
            &store,
            "already-referenced-id",
            PendingBindingKind::FirstUpload,
        );
        let api = ScriptedDriveApi::default();
        api.files
            .lock()
            .unwrap()
            .push_back(Ok(ScriptedDriveApi::valid_file(
                "already-referenced-id",
                Some("https://drive.google.com/already-referenced"),
            )));
        api.permissions
            .lock()
            .unwrap()
            .push_back(Err(DriveApiError::PermissionDenied));
        api.deletes.lock().unwrap().push_back(Ok(()));
        let metadata = ScriptedMetadataClient::default();
        metadata
            .fetches
            .lock()
            .unwrap()
            .push_back(Ok(ScriptedMetadataClient::owner(
                Some("already-referenced-id"),
                None,
            )));
        let auth = authenticated_user("user-42").await;

        if auth_sweep {
            reconcile_pending_bindings_for_current_user(
                &api,
                &store,
                &metadata,
                &auth,
                ACCESS_TOKEN,
                &CancellationToken::new(),
            )
            .await;
        } else {
            let archive = create_request(b"zip");
            run_crash_safe_create_for_test(
                &api,
                &RecordingSleeper::default(),
                &store,
                &metadata,
                &auth,
                ACCESS_TOKEN,
                crash_safe_request(
                    archive.request.archive_path,
                    PendingBindingKind::FirstUpload,
                ),
                4,
                None,
                |_, _| {},
            )
            .await
            .expect_err("Drive validation remains repairable");
        }

        assert!(api.delete_ids.lock().unwrap().is_empty());
        assert!(store.get("user-42", "42").expect("pending").is_some());
        assert!(metadata.patch_inputs.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn already_referenced_pending_file_is_retained_after_repeated_patch_failure() {
    for auth_sweep in [false, true] {
        let data_dir = tempdir().expect("data dir");
        let store = pending_store(&data_dir);
        seed_pending_binding(
            &store,
            "already-referenced-id",
            PendingBindingKind::ExplicitReplacement,
        );
        let api = ScriptedDriveApi::default();
        api.files
            .lock()
            .unwrap()
            .push_back(Ok(ScriptedDriveApi::valid_file(
                "already-referenced-id",
                Some("https://drive.google.com/repaired"),
            )));
        api.permissions
            .lock()
            .unwrap()
            .push_back(Ok(PublicPermissionStatus::Public));
        api.deletes.lock().unwrap().push_back(Ok(()));
        let metadata = ScriptedMetadataClient::default();
        let invalid_owner = ScriptedMetadataClient::owner(
            Some("already-referenced-id"),
            Some("http://invalid.example/not-stable"),
        );
        metadata.fetches.lock().unwrap().extend([
            Ok(invalid_owner.clone()),
            Ok(invalid_owner.clone()),
            Ok(invalid_owner),
        ]);
        metadata.patches.lock().unwrap().extend([
            Err(DriveMetadataError::Network),
            Err(DriveMetadataError::Network),
        ]);
        let auth = authenticated_user("user-42").await;

        if auth_sweep {
            reconcile_pending_bindings_for_current_user(
                &api,
                &store,
                &metadata,
                &auth,
                ACCESS_TOKEN,
                &CancellationToken::new(),
            )
            .await;
        } else {
            let archive = create_request(b"zip");
            run_crash_safe_create_for_test(
                &api,
                &RecordingSleeper::default(),
                &store,
                &metadata,
                &auth,
                ACCESS_TOKEN,
                crash_safe_request(
                    archive.request.archive_path,
                    PendingBindingKind::ExplicitReplacement,
                ),
                4,
                None,
                |_, _| {},
            )
            .await
            .expect_err("metadata repair remains pending");
        }

        assert_eq!(metadata.patch_inputs.lock().unwrap().len(), 2);
        assert!(api.delete_ids.lock().unwrap().is_empty());
        assert!(store.get("user-42", "42").expect("pending").is_some());
    }
}

#[tokio::test]
async fn reconciliation_retains_on_403_network_and_other_indeterminate_file_probes() {
    // Break caught: rotating or creating after a probe that does not prove the
    // old generated identity is absent.
    for error in [DriveApiError::PermissionDenied, DriveApiError::Network] {
        let data_dir = tempdir().expect("data dir");
        let store = pending_store(&data_dir);
        store
            .replace(
                crate::google_drive::pending_bindings::PendingGoogleDriveBinding {
                    user_id: "user-42".to_string(),
                    simfile_id: "42".to_string(),
                    drive_file_id: "possibly-created".to_string(),
                    kind: PendingBindingKind::FirstUpload,
                    created_at: "1999-01-01T00:00:00Z".to_string(),
                    expected_previous_drive_file: None,
                },
            )
            .expect("pending binding");
        let api = ScriptedDriveApi::default();
        api.files.lock().unwrap().push_back(Err(error.clone()));
        let metadata = ScriptedMetadataClient::default();
        metadata
            .fetches
            .lock()
            .unwrap()
            .push_back(Ok(ScriptedMetadataClient::owner(None, None)));
        let archive = create_request(b"zip");

        let failure = run_crash_safe_create_for_test(
            &api,
            &RecordingSleeper::default(),
            &store,
            &metadata,
            &authenticated_user("user-42").await,
            ACCESS_TOKEN,
            crash_safe_request(
                archive.request.archive_path,
                PendingBindingKind::FirstUpload,
            ),
            4,
            None,
            |_, _| {},
        )
        .await
        .expect_err("indeterminate probe");

        assert_eq!(failure.error, error);
        assert_eq!(failure.pending_binding, PendingBindingDisposition::Retain);
        assert!(api.create_metadata.lock().unwrap().is_empty());
        assert_eq!(
            store
                .get("user-42", "42")
                .expect("pending read")
                .expect("retained")
                .drive_file_id,
            "possibly-created"
        );
    }
}

#[tokio::test]
async fn definitive_invalid_generated_id_rotates_once_only_after_a_confirmed_404() {
    // Break caught: rotating on the create error alone, or looping through
    // fresh IDs without a definitive files.get absence proof.
    let data_dir = tempdir().expect("data dir");
    let store = pending_store(&data_dir);
    store
        .replace(
            crate::google_drive::pending_bindings::PendingGoogleDriveBinding {
                user_id: "user-42".to_string(),
                simfile_id: "42".to_string(),
                drive_file_id: "expired-generated-id".to_string(),
                kind: PendingBindingKind::FirstUpload,
                created_at: "2026-01-01T00:00:00Z".to_string(),
                expected_previous_drive_file: None,
            },
        )
        .expect("pending binding");
    let api = ScriptedDriveApi::default();
    api.files
        .lock()
        .unwrap()
        .extend([Err(DriveApiError::NotFound), Err(DriveApiError::NotFound)]);
    api.starts
        .lock()
        .unwrap()
        .push_back(Err(DriveApiError::InvalidGeneratedId));
    api.generated_ids
        .lock()
        .unwrap()
        .push_back(Ok("fresh-generated-id".to_string()));
    script_successful_create(&api, "fresh-generated-id", "https://drive.google.com/fresh");
    let metadata = ScriptedMetadataClient::default();
    metadata
        .fetches
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedMetadataClient::owner(None, None)));
    script_successful_patch(
        &metadata,
        "fresh-generated-id",
        "https://drive.google.com/fresh",
    );
    let archive = create_request(b"zip");

    run_crash_safe_create_for_test(
        &api,
        &RecordingSleeper::default(),
        &store,
        &metadata,
        &authenticated_user("user-42").await,
        ACCESS_TOKEN,
        crash_safe_request(
            archive.request.archive_path,
            PendingBindingKind::FirstUpload,
        ),
        4,
        None,
        |_, _| {},
    )
    .await
    .expect("one confirmed rotation");

    assert_eq!(*api.generated_count.lock().unwrap(), 1);
    assert_eq!(
        api.get_file_ids.lock().unwrap().as_slice(),
        &[
            "expired-generated-id".to_string(),
            "expired-generated-id".to_string(),
            "fresh-generated-id".to_string(),
        ]
    );
    assert_eq!(
        api.create_metadata
            .lock()
            .unwrap()
            .iter()
            .map(|entry| entry.id.as_str())
            .collect::<Vec<_>>(),
        vec!["expired-generated-id", "fresh-generated-id"]
    );
    assert_eq!(store.get("user-42", "42").expect("pending read"), None);
}

#[tokio::test]
async fn fresh_id_rewrite_is_durable_before_the_replacement_create_can_start() {
    // Break caught: beginning a create with the fresh ID while the durable key
    // still names the definitively invalid old identity.
    let data_dir = tempdir().expect("data dir");
    let store = pending_store(&data_dir);
    store
        .replace(
            crate::google_drive::pending_bindings::PendingGoogleDriveBinding {
                user_id: "user-42".to_string(),
                simfile_id: "42".to_string(),
                drive_file_id: "expired-generated-id".to_string(),
                kind: PendingBindingKind::ExplicitReplacement,
                created_at: "2026-01-01T00:00:00Z".to_string(),
                expected_previous_drive_file: None,
            },
        )
        .expect("pending binding");
    let api = ScriptedDriveApi::default();
    api.files
        .lock()
        .unwrap()
        .extend([Err(DriveApiError::NotFound), Err(DriveApiError::NotFound)]);
    api.starts
        .lock()
        .unwrap()
        .push_back(Err(DriveApiError::InvalidGeneratedId));
    api.generated_ids
        .lock()
        .unwrap()
        .push_back(Ok("fresh-generated-id".to_string()));
    let metadata = ScriptedMetadataClient::default();
    metadata
        .fetches
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedMetadataClient::owner(
            Some("old-cloud-id"),
            Some("https://drive.google.com/old"),
        )));
    let archive = create_request(b"zip");

    run_crash_safe_create_for_test(
        &api,
        &RecordingSleeper::default(),
        &store,
        &metadata,
        &authenticated_user("user-42").await,
        ACCESS_TOKEN,
        crash_safe_request(
            archive.request.archive_path,
            PendingBindingKind::ExplicitReplacement,
        ),
        4,
        Some(CreateCrashPoint::AfterFreshIdPersisted),
        |_, _| {},
    )
    .await
    .expect_err("fresh-ID crash boundary");

    let rewritten = store
        .get("user-42", "42")
        .expect("pending read")
        .expect("rewritten binding");
    assert_eq!(rewritten.user_id, "user-42");
    assert_eq!(rewritten.simfile_id, "42");
    assert_eq!(rewritten.drive_file_id, "fresh-generated-id");
    assert_eq!(rewritten.kind, PendingBindingKind::ExplicitReplacement);
    assert!(!rewritten.created_at.is_empty());
    assert_eq!(
        api.create_metadata
            .lock()
            .unwrap()
            .iter()
            .map(|entry| entry.id.as_str())
            .collect::<Vec<_>>(),
        vec!["expired-generated-id"],
        "fresh create must not begin before the rewritten key is durable"
    );
}

#[tokio::test]
async fn ambiguous_create_response_retains_one_identity_across_all_retries() {
    // Break caught: generating a fresh ID for each retry after an uncertain
    // files.create response.
    let data_dir = tempdir().expect("data dir");
    let store = pending_store(&data_dir);
    let api = ScriptedDriveApi::default();
    api.generated_ids
        .lock()
        .unwrap()
        .push_back(Ok("stable-generated-id".to_string()));
    api.starts
        .lock()
        .unwrap()
        .extend((0..5).map(|_| Err(DriveApiError::Network)));
    let metadata = ScriptedMetadataClient::default();
    metadata
        .fetches
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedMetadataClient::owner(None, None)));
    let archive = create_request(b"zip");

    let failure = run_crash_safe_create_for_test(
        &api,
        &RecordingSleeper::default(),
        &store,
        &metadata,
        &authenticated_user("user-42").await,
        ACCESS_TOKEN,
        crash_safe_request(
            archive.request.archive_path,
            PendingBindingKind::FirstUpload,
        ),
        4,
        None,
        |_, _| {},
    )
    .await
    .expect_err("ambiguous create");

    assert_eq!(failure.error, DriveApiError::Network);
    assert_eq!(*api.generated_count.lock().unwrap(), 1);
    assert_eq!(
        api.create_metadata
            .lock()
            .unwrap()
            .iter()
            .map(|entry| entry.id.as_str())
            .collect::<Vec<_>>(),
        vec!["stable-generated-id"; 5]
    );
    assert_eq!(
        store
            .get("user-42", "42")
            .expect("pending read")
            .expect("retained")
            .drive_file_id,
        "stable-generated-id"
    );
}

#[tokio::test]
async fn crash_after_create_validation_reconciles_without_a_second_create() {
    // Break caught: losing the pending identity between Drive completion and
    // the cloud metadata patch.
    let data_dir = tempdir().expect("data dir");
    let store = pending_store(&data_dir);
    let api = ScriptedDriveApi::default();
    api.generated_ids
        .lock()
        .unwrap()
        .push_back(Ok("created-before-crash".to_string()));
    script_successful_create(
        &api,
        "created-before-crash",
        "https://drive.google.com/crash",
    );
    let metadata = ScriptedMetadataClient::default();
    metadata
        .fetches
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedMetadataClient::owner(None, None)));
    let auth = authenticated_user("user-42").await;
    let archive = create_request(b"zip");
    let request = crash_safe_request(
        archive.request.archive_path,
        PendingBindingKind::FirstUpload,
    );

    run_crash_safe_create_for_test(
        &api,
        &RecordingSleeper::default(),
        &store,
        &metadata,
        &auth,
        ACCESS_TOKEN,
        request.clone(),
        4,
        Some(CreateCrashPoint::AfterUploadValidated),
        |_, _| {},
    )
    .await
    .expect_err("post-create crash");
    assert!(metadata.patch_inputs.lock().unwrap().is_empty());
    assert!(store.get("user-42", "42").expect("pending").is_some());

    metadata
        .fetches
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedMetadataClient::owner(None, None)));
    api.files
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedDriveApi::valid_file(
            "created-before-crash",
            Some("https://drive.google.com/crash"),
        )));
    api.permissions
        .lock()
        .unwrap()
        .push_back(Ok(PublicPermissionStatus::Public));
    script_successful_patch(
        &metadata,
        "created-before-crash",
        "https://drive.google.com/crash",
    );
    run_crash_safe_create_for_test(
        &api,
        &RecordingSleeper::default(),
        &store,
        &metadata,
        &auth,
        ACCESS_TOKEN,
        request,
        4,
        None,
        |_, _| {},
    )
    .await
    .expect("restart reconciliation");

    assert_eq!(
        api.create_metadata
            .lock()
            .unwrap()
            .iter()
            .map(|entry| entry.id.as_str())
            .collect::<Vec<_>>(),
        vec!["created-before-crash"]
    );
    assert_eq!(store.get("user-42", "42").expect("pending"), None);
}

#[tokio::test]
async fn lost_metadata_patch_response_is_confirmed_by_a_fresh_owner_read() {
    let data_dir = tempdir().expect("data dir");
    let store = pending_store(&data_dir);
    let api = ScriptedDriveApi::default();
    api.generated_ids
        .lock()
        .unwrap()
        .push_back(Ok("committed-patch-id".to_string()));
    script_successful_create(
        &api,
        "committed-patch-id",
        "https://drive.google.com/committed-patch",
    );
    let metadata = ScriptedMetadataClient::default();
    metadata.fetches.lock().unwrap().extend([
        Ok(ScriptedMetadataClient::owner(None, None)),
        Ok(ScriptedMetadataClient::owner(
            Some("committed-patch-id"),
            Some("https://drive.google.com/committed-patch"),
        )),
    ]);
    metadata
        .patches
        .lock()
        .unwrap()
        .push_back(Err(DriveMetadataError::Network));
    let archive = create_request(b"zip");

    let outcome = run_crash_safe_create_for_test(
        &api,
        &RecordingSleeper::default(),
        &store,
        &metadata,
        &authenticated_user("user-42").await,
        ACCESS_TOKEN,
        crash_safe_request(
            archive.request.archive_path,
            PendingBindingKind::FirstUpload,
        ),
        4,
        None,
        |_, _| {},
    )
    .await
    .expect("fresh read confirms committed patch");

    assert_eq!(outcome.file_id, "committed-patch-id");
    assert_eq!(metadata.patch_inputs.lock().unwrap().len(), 1);
    assert!(api.delete_ids.lock().unwrap().is_empty());
    assert_eq!(store.get("user-42", "42").expect("pending"), None);
}

#[tokio::test]
async fn ambiguous_metadata_patch_confirmation_retains_the_binding_without_compensation() {
    let data_dir = tempdir().expect("data dir");
    let store = pending_store(&data_dir);
    let api = ScriptedDriveApi::default();
    api.generated_ids
        .lock()
        .unwrap()
        .push_back(Ok("ambiguous-patch-id".to_string()));
    script_successful_create(
        &api,
        "ambiguous-patch-id",
        "https://drive.google.com/ambiguous-patch",
    );
    let metadata = ScriptedMetadataClient::default();
    metadata.fetches.lock().unwrap().extend([
        Ok(ScriptedMetadataClient::owner(None, None)),
        Err(DriveMetadataError::Network),
    ]);
    metadata
        .patches
        .lock()
        .unwrap()
        .push_back(Err(DriveMetadataError::Network));
    let archive = create_request(b"zip");

    let failure = run_crash_safe_create_for_test(
        &api,
        &RecordingSleeper::default(),
        &store,
        &metadata,
        &authenticated_user("user-42").await,
        ACCESS_TOKEN,
        crash_safe_request(
            archive.request.archive_path,
            PendingBindingKind::FirstUpload,
        ),
        4,
        None,
        |_, _| {},
    )
    .await
    .expect_err("confirmation remains ambiguous");

    assert_eq!(failure.pending_binding, PendingBindingDisposition::Retain);
    assert_eq!(metadata.patch_inputs.lock().unwrap().len(), 1);
    assert!(api.delete_ids.lock().unwrap().is_empty());
    assert!(store.get("user-42", "42").expect("pending").is_some());
}

#[tokio::test]
async fn confirmed_unchanged_explicit_replacement_retries_then_compensates() {
    let data_dir = tempdir().expect("data dir");
    let store = pending_store(&data_dir);
    let api = ScriptedDriveApi::default();
    api.generated_ids
        .lock()
        .unwrap()
        .push_back(Ok("replacement-patch-id".to_string()));
    script_successful_create(
        &api,
        "replacement-patch-id",
        "https://drive.google.com/replacement-patch",
    );
    api.deletes.lock().unwrap().push_back(Ok(()));
    let metadata = ScriptedMetadataClient::default();
    let prior = ScriptedMetadataClient::owner(
        Some("prior-drive-id"),
        Some("https://drive.google.com/prior"),
    );
    metadata
        .fetches
        .lock()
        .unwrap()
        .extend([Ok(prior.clone()), Ok(prior.clone()), Ok(prior)]);
    metadata.patches.lock().unwrap().extend([
        Err(DriveMetadataError::Network),
        Err(DriveMetadataError::Network),
    ]);
    let archive = create_request(b"zip");

    let failure = run_crash_safe_create_for_test(
        &api,
        &RecordingSleeper::default(),
        &store,
        &metadata,
        &authenticated_user("user-42").await,
        ACCESS_TOKEN,
        crash_safe_request(
            archive.request.archive_path,
            PendingBindingKind::ExplicitReplacement,
        ),
        4,
        None,
        |_, _| {},
    )
    .await
    .expect_err("unchanged owner binding confirms patch failure");

    assert_eq!(
        failure.pending_binding,
        PendingBindingDisposition::DeleteConfirmed
    );
    assert_eq!(metadata.patch_inputs.lock().unwrap().len(), 2);
    assert_eq!(
        api.delete_ids.lock().unwrap().as_slice(),
        &["replacement-patch-id".to_string()]
    );
    assert_eq!(store.get("user-42", "42").expect("pending"), None);
}

#[tokio::test]
async fn patch_retry_and_compensation_failures_never_drop_recoverable_binding() {
    // Break caught: clearing the pending record when metadata sync and
    // compensation deletion are both unconfirmed.
    let data_dir = tempdir().expect("data dir");
    let store = pending_store(&data_dir);
    let api = ScriptedDriveApi::default();
    api.generated_ids
        .lock()
        .unwrap()
        .push_back(Ok("needs-reconciliation".to_string()));
    script_successful_create(
        &api,
        "needs-reconciliation",
        "https://drive.google.com/recover",
    );
    api.deletes
        .lock()
        .unwrap()
        .push_back(Err(DriveApiError::Network));
    let metadata = ScriptedMetadataClient::default();
    metadata.fetches.lock().unwrap().extend([
        Ok(ScriptedMetadataClient::owner(None, None)),
        Ok(ScriptedMetadataClient::owner(None, None)),
        Ok(ScriptedMetadataClient::owner(None, None)),
    ]);
    metadata.patches.lock().unwrap().extend([
        Err(DriveMetadataError::Network),
        Err(DriveMetadataError::Network),
    ]);
    let archive = create_request(b"zip");

    let failure = run_crash_safe_create_for_test(
        &api,
        &RecordingSleeper::default(),
        &store,
        &metadata,
        &authenticated_user("user-42").await,
        ACCESS_TOKEN,
        crash_safe_request(
            archive.request.archive_path,
            PendingBindingKind::FirstUpload,
        ),
        4,
        None,
        |_, _| {},
    )
    .await
    .expect_err("metadata sync failure");

    assert_eq!(failure.error, DriveApiError::MetadataSync);
    assert_eq!(failure.pending_binding, PendingBindingDisposition::Retain);
    assert_eq!(
        api.delete_ids.lock().unwrap().as_slice(),
        &["needs-reconciliation".to_string()]
    );
    assert_eq!(metadata.patch_inputs.lock().unwrap().len(), 2);
    assert!(store.get("user-42", "42").expect("pending").is_some());
}

#[tokio::test]
async fn crash_during_metadata_patch_retry_retains_binding_without_compensation() {
    // Break caught: deleting/forgetting the created object when the process
    // terminates between the first failed metadata patch and its retry.
    let data_dir = tempdir().expect("data dir");
    let store = pending_store(&data_dir);
    let api = ScriptedDriveApi::default();
    api.generated_ids
        .lock()
        .unwrap()
        .push_back(Ok("patch-retry-id".to_string()));
    script_successful_create(
        &api,
        "patch-retry-id",
        "https://drive.google.com/patch-retry",
    );
    let metadata = ScriptedMetadataClient::default();
    metadata.fetches.lock().unwrap().extend([
        Ok(ScriptedMetadataClient::owner(None, None)),
        Ok(ScriptedMetadataClient::owner(None, None)),
    ]);
    metadata
        .patches
        .lock()
        .unwrap()
        .push_back(Err(DriveMetadataError::Network));
    let archive = create_request(b"zip");

    run_crash_safe_create_for_test(
        &api,
        &RecordingSleeper::default(),
        &store,
        &metadata,
        &authenticated_user("user-42").await,
        ACCESS_TOKEN,
        crash_safe_request(
            archive.request.archive_path,
            PendingBindingKind::FirstUpload,
        ),
        4,
        Some(CreateCrashPoint::BeforeMetadataPatchRetry),
        |_, _| {},
    )
    .await
    .expect_err("patch retry crash");

    assert_eq!(metadata.patch_inputs.lock().unwrap().len(), 1);
    assert!(api.delete_ids.lock().unwrap().is_empty());
    assert_eq!(
        store
            .get("user-42", "42")
            .expect("pending")
            .expect("retained")
            .drive_file_id,
        "patch-retry-id"
    );
}

#[tokio::test]
async fn crash_after_patch_commit_is_cleaned_without_repatching_or_contacting_drive() {
    // Break caught: a post-commit crash causing duplicate cloud writes or a
    // second Drive create instead of recognizing the already-bound identity.
    let data_dir = tempdir().expect("data dir");
    let store = pending_store(&data_dir);
    let api = ScriptedDriveApi::default();
    api.generated_ids
        .lock()
        .unwrap()
        .push_back(Ok("bound-before-crash".to_string()));
    script_successful_create(&api, "bound-before-crash", "https://drive.google.com/bound");
    let metadata = ScriptedMetadataClient::default();
    metadata
        .fetches
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedMetadataClient::owner(None, None)));
    script_successful_patch(
        &metadata,
        "bound-before-crash",
        "https://drive.google.com/bound",
    );
    let auth = authenticated_user("user-42").await;
    let archive = create_request(b"zip");
    let request = crash_safe_request(
        archive.request.archive_path,
        PendingBindingKind::ExplicitReplacement,
    );

    run_crash_safe_create_for_test(
        &api,
        &RecordingSleeper::default(),
        &store,
        &metadata,
        &auth,
        ACCESS_TOKEN,
        request.clone(),
        4,
        Some(CreateCrashPoint::AfterMetadataPatch),
        |_, _| {},
    )
    .await
    .expect_err("post-patch crash");
    assert!(store.get("user-42", "42").expect("pending").is_some());

    metadata
        .fetches
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedMetadataClient::owner(
            Some("bound-before-crash"),
            Some("https://drive.google.com/bound"),
        )));
    let patch_count = metadata.patch_inputs.lock().unwrap().len();
    let get_count = api.get_file_ids.lock().unwrap().len();
    run_crash_safe_create_for_test(
        &api,
        &RecordingSleeper::default(),
        &store,
        &metadata,
        &auth,
        ACCESS_TOKEN,
        request,
        4,
        None,
        |_, _| {},
    )
    .await
    .expect("already-bound cleanup");

    assert_eq!(metadata.patch_inputs.lock().unwrap().len(), patch_count);
    assert_eq!(api.get_file_ids.lock().unwrap().len(), get_count);
    assert_eq!(store.get("user-42", "42").expect("pending"), None);
}

#[tokio::test]
async fn lost_owner_is_compensated_but_never_bound_and_is_retained_until_absence_is_confirmed() {
    // Break caught: binding a pending Drive object after the simfile was
    // deleted/transferred, or forgetting it after an ambiguous delete.
    let data_dir = tempdir().expect("data dir");
    let store = pending_store(&data_dir);
    store
        .replace(
            crate::google_drive::pending_bindings::PendingGoogleDriveBinding {
                user_id: "user-42".to_string(),
                simfile_id: "42".to_string(),
                drive_file_id: "orphan-candidate".to_string(),
                kind: PendingBindingKind::FirstUpload,
                created_at: "2026-07-26T00:00:00Z".to_string(),
                expected_previous_drive_file: None,
            },
        )
        .expect("pending");
    let api = ScriptedDriveApi::default();
    api.deletes
        .lock()
        .unwrap()
        .extend([Err(DriveApiError::Network), Err(DriveApiError::NotFound)]);
    let metadata = ScriptedMetadataClient::default();
    metadata.fetches.lock().unwrap().extend([
        Err(DriveMetadataError::DefinitiveUnavailable),
        Err(DriveMetadataError::DefinitiveUnavailable),
    ]);
    let auth = authenticated_user("user-42").await;
    let first_archive = create_request(b"zip");

    let first = run_crash_safe_create_for_test(
        &api,
        &RecordingSleeper::default(),
        &store,
        &metadata,
        &auth,
        ACCESS_TOKEN,
        crash_safe_request(
            first_archive.request.archive_path,
            PendingBindingKind::FirstUpload,
        ),
        4,
        None,
        |_, _| {},
    )
    .await
    .expect_err("lost owner with ambiguous delete");
    assert_eq!(first.error, DriveApiError::SimfileUnavailable);
    assert!(store.get("user-42", "42").expect("pending").is_some());
    assert!(metadata.patch_inputs.lock().unwrap().is_empty());

    let second_archive = create_request(b"zip");
    let second = run_crash_safe_create_for_test(
        &api,
        &RecordingSleeper::default(),
        &store,
        &metadata,
        &auth,
        ACCESS_TOKEN,
        crash_safe_request(
            second_archive.request.archive_path,
            PendingBindingKind::FirstUpload,
        ),
        4,
        None,
        |_, _| {},
    )
    .await
    .expect_err("lost owner");
    assert_eq!(second.error, DriveApiError::SimfileUnavailable);
    assert_eq!(store.get("user-42", "42").expect("pending"), None);
    assert_eq!(
        api.delete_ids.lock().unwrap().as_slice(),
        &[
            "orphan-candidate".to_string(),
            "orphan-candidate".to_string()
        ]
    );
}

#[tokio::test]
async fn ambiguous_owner_metadata_failures_retain_direct_reconciliation_bindings() {
    for error in [
        DriveMetadataError::Authentication,
        DriveMetadataError::Network,
        DriveMetadataError::ServiceUnavailable,
        DriveMetadataError::InvalidResponse,
        DriveMetadataError::LocalState,
    ] {
        let data_dir = tempdir().expect("data dir");
        let store = pending_store(&data_dir);
        store
            .replace(
                crate::google_drive::pending_bindings::PendingGoogleDriveBinding {
                    user_id: "user-42".to_string(),
                    simfile_id: "42".to_string(),
                    drive_file_id: "retain-on-ambiguous-owner".to_string(),
                    kind: PendingBindingKind::FirstUpload,
                    created_at: "2026-07-26T00:00:00Z".to_string(),
                    expected_previous_drive_file: None,
                },
            )
            .expect("pending");
        let api = ScriptedDriveApi::default();
        let metadata = ScriptedMetadataClient::default();
        metadata.fetches.lock().unwrap().push_back(Err(error));
        let archive = create_request(b"zip");

        let failure = run_crash_safe_create_for_test(
            &api,
            &RecordingSleeper::default(),
            &store,
            &metadata,
            &authenticated_user("user-42").await,
            ACCESS_TOKEN,
            crash_safe_request(
                archive.request.archive_path,
                PendingBindingKind::FirstUpload,
            ),
            4,
            None,
            |_, _| {},
        )
        .await
        .expect_err("ambiguous owner metadata failure");

        assert_ne!(
            failure.pending_binding,
            PendingBindingDisposition::DeleteConfirmed
        );
        assert!(
            store.get("user-42", "42").expect("pending").is_some(),
            "{error:?} must retain the pending identity"
        );
        assert!(api.delete_ids.lock().unwrap().is_empty());
        assert!(api.create_metadata.lock().unwrap().is_empty());
        assert!(metadata.patch_inputs.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn whitespace_only_owner_id_from_production_parser_retains_direct_binding() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": {
                "simfile": {
                    "id": "42",
                    "title": "Song",
                    "userId": " \t ",
                    "googleDriveFileId": null,
                    "downloadUrl": null
                }
            }
        })))
        .mount(&server)
        .await;
    let data_dir = tempdir().expect("data dir");
    let store = pending_store(&data_dir);
    seed_pending_binding(
        &store,
        "retain-blank-owner-id",
        PendingBindingKind::FirstUpload,
    );
    let api = ScriptedDriveApi::default();
    api.deletes.lock().unwrap().push_back(Ok(()));
    let metadata = ProductionOwnerMetadataClient {
        base_url: server.uri(),
    };
    let archive = create_request(b"zip");

    let failure = run_crash_safe_create_for_test(
        &api,
        &RecordingSleeper::default(),
        &store,
        &metadata,
        &authenticated_user("user-42").await,
        ACCESS_TOKEN,
        crash_safe_request(
            archive.request.archive_path,
            PendingBindingKind::FirstUpload,
        ),
        4,
        None,
        |_, _| {},
    )
    .await
    .expect_err("blank owner ID is an invalid response");

    assert_eq!(failure.error, DriveApiError::InvalidResponse);
    assert_eq!(failure.pending_binding, PendingBindingDisposition::Retain);
    assert!(api.delete_ids.lock().unwrap().is_empty());
    assert!(store.get("user-42", "42").expect("pending").is_some());
}

#[tokio::test]
async fn ambiguous_owner_metadata_failures_retain_auth_sweep_bindings() {
    for error in [
        DriveMetadataError::Authentication,
        DriveMetadataError::Network,
        DriveMetadataError::ServiceUnavailable,
        DriveMetadataError::InvalidResponse,
        DriveMetadataError::LocalState,
    ] {
        let data_dir = tempdir().expect("data dir");
        let store = pending_store(&data_dir);
        store
            .replace(
                crate::google_drive::pending_bindings::PendingGoogleDriveBinding {
                    user_id: "user-42".to_string(),
                    simfile_id: "42".to_string(),
                    drive_file_id: "retain-on-ambiguous-owner".to_string(),
                    kind: PendingBindingKind::FirstUpload,
                    created_at: "2026-07-26T00:00:00Z".to_string(),
                    expected_previous_drive_file: None,
                },
            )
            .expect("pending");
        let api = ScriptedDriveApi::default();
        let metadata = ScriptedMetadataClient::default();
        metadata.fetches.lock().unwrap().push_back(Err(error));

        reconcile_pending_bindings_for_current_user(
            &api,
            &store,
            &metadata,
            &authenticated_user("user-42").await,
            ACCESS_TOKEN,
            &CancellationToken::new(),
        )
        .await;

        assert!(
            store.get("user-42", "42").expect("pending").is_some(),
            "{error:?} must retain the pending identity"
        );
        assert!(api.delete_ids.lock().unwrap().is_empty());
        assert!(api.create_metadata.lock().unwrap().is_empty());
        assert!(metadata.patch_inputs.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn malformed_owner_identity_never_triggers_compensation() {
    for auth_sweep in [false, true] {
        let data_dir = tempdir().expect("data dir");
        let store = pending_store(&data_dir);
        store
            .replace(
                crate::google_drive::pending_bindings::PendingGoogleDriveBinding {
                    user_id: "user-42".to_string(),
                    simfile_id: "42".to_string(),
                    drive_file_id: "retain-on-wrong-owner-id".to_string(),
                    kind: PendingBindingKind::FirstUpload,
                    created_at: "2026-07-26T00:00:00Z".to_string(),
                    expected_previous_drive_file: None,
                },
            )
            .expect("pending");
        let api = ScriptedDriveApi::default();
        let metadata = ScriptedMetadataClient::default();
        metadata
            .fetches
            .lock()
            .unwrap()
            .push_back(Ok(ScriptedMetadataClient::owner_for(
                "wrong-simfile",
                None,
                None,
            )));
        let auth = authenticated_user("user-42").await;

        if auth_sweep {
            reconcile_pending_bindings_for_current_user(
                &api,
                &store,
                &metadata,
                &auth,
                ACCESS_TOKEN,
                &CancellationToken::new(),
            )
            .await;
        } else {
            let archive = create_request(b"zip");
            let failure = run_crash_safe_create_for_test(
                &api,
                &RecordingSleeper::default(),
                &store,
                &metadata,
                &auth,
                ACCESS_TOKEN,
                crash_safe_request(
                    archive.request.archive_path,
                    PendingBindingKind::FirstUpload,
                ),
                4,
                None,
                |_, _| {},
            )
            .await
            .expect_err("wrong identity is malformed, not definitive absence");
            assert_eq!(failure.error, DriveApiError::InvalidResponse);
        }

        assert!(store.get("user-42", "42").expect("pending").is_some());
        assert!(api.delete_ids.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn reconciliation_auth_restore_sweeps_only_the_current_user_without_creating_unused_ids() {
    // Break caught: startup recovery creating files, processing another
    // Drumery user's durable entries, or stopping after one unrelated failure.
    let data_dir = tempdir().expect("data dir");
    let store = pending_store(&data_dir);
    for binding in [
        crate::google_drive::pending_bindings::PendingGoogleDriveBinding {
            user_id: "user-42".to_string(),
            simfile_id: "41".to_string(),
            drive_file_id: "created-41".to_string(),
            kind: PendingBindingKind::FirstUpload,
            created_at: "2026-07-01T00:00:00Z".to_string(),
            expected_previous_drive_file: None,
        },
        crate::google_drive::pending_bindings::PendingGoogleDriveBinding {
            user_id: "user-42".to_string(),
            simfile_id: "42".to_string(),
            drive_file_id: "unused-42".to_string(),
            kind: PendingBindingKind::ExplicitReplacement,
            created_at: "2001-01-01T00:00:00Z".to_string(),
            expected_previous_drive_file: None,
        },
        crate::google_drive::pending_bindings::PendingGoogleDriveBinding {
            user_id: "other-user".to_string(),
            simfile_id: "43".to_string(),
            drive_file_id: "other-users-file".to_string(),
            kind: PendingBindingKind::FirstUpload,
            created_at: "2026-07-01T00:00:00Z".to_string(),
            expected_previous_drive_file: None,
        },
    ] {
        store.replace(binding).expect("pending binding");
    }
    let api = ScriptedDriveApi::default();
    api.files.lock().unwrap().extend([
        Ok(ScriptedDriveApi::valid_file(
            "created-41",
            Some("https://drive.google.com/created-41"),
        )),
        Err(DriveApiError::NotFound),
    ]);
    api.permissions
        .lock()
        .unwrap()
        .push_back(Ok(PublicPermissionStatus::Public));
    let metadata = ScriptedMetadataClient::default();
    metadata.fetches.lock().unwrap().extend([
        Ok(ScriptedMetadataClient::owner_for("41", None, None)),
        Ok(ScriptedMetadataClient::owner_for(
            "42",
            Some("old-cloud-id"),
            Some("https://drive.google.com/old"),
        )),
    ]);
    metadata
        .patches
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedMetadataClient::owner_for(
            "41",
            Some("created-41"),
            Some("https://drive.google.com/created-41"),
        )));

    reconcile_pending_bindings_for_current_user(
        &api,
        &store,
        &metadata,
        &authenticated_user("user-42").await,
        ACCESS_TOKEN,
        &CancellationToken::new(),
    )
    .await;

    assert_eq!(store.get("user-42", "41").expect("created entry"), None);
    assert_eq!(
        store
            .get("user-42", "42")
            .expect("unused entry")
            .expect("retained")
            .drive_file_id,
        "unused-42"
    );
    assert_eq!(
        store
            .get("other-user", "43")
            .expect("other user entry")
            .expect("untouched")
            .drive_file_id,
        "other-users-file"
    );
    assert!(api.create_metadata.lock().unwrap().is_empty());
    assert_eq!(
        api.get_file_ids.lock().unwrap().as_slice(),
        &["created-41".to_string(), "unused-42".to_string()]
    );
}

#[tokio::test]
async fn reconciliation_aborts_after_blocked_owner_fetch_when_user_switches() {
    let data_dir = tempdir().expect("data dir");
    let store = Arc::new(pending_store(&data_dir));
    seed_pending_binding_for(
        store.as_ref(),
        "user-42",
        "42",
        "user-a-file",
        PendingBindingKind::FirstUpload,
    );
    seed_pending_binding_for(
        store.as_ref(),
        "user-b",
        "99",
        "user-b-file",
        PendingBindingKind::FirstUpload,
    );
    let api = Arc::new(ScriptedDriveApi::default());
    let metadata = Arc::new(BlockingStatefulMetadataClient::unbound());
    let auth = Arc::new(authenticated_user("user-42").await);
    let epoch = auth.current_session_epoch().await.expect("session epoch");

    let sweep = {
        let api = Arc::clone(&api);
        let store = Arc::clone(&store);
        let metadata = Arc::clone(&metadata);
        let auth = Arc::clone(&auth);
        tokio::spawn(async move {
            let cancellation = CancellationToken::new();
            reconcile_pending_bindings_for_session(
                api.as_ref(),
                store.as_ref(),
                metadata.as_ref(),
                auth.as_ref(),
                &epoch,
                "access-token-a",
                &cancellation,
            )
            .await;
        })
    };
    metadata
        .first_fetch_entered
        .acquire()
        .await
        .expect("owner fetch entered")
        .forget();
    auth.set_current_session(Some(serde_json::json!({
        "user": { "id": "user-b" },
        "sessionToken": "opaque-session-token-b"
    })))
    .await;
    metadata.first_fetch_release.add_permits(1);
    sweep.await.expect("sweep task");

    assert_eq!(metadata.patch_count.load(Ordering::SeqCst), 0);
    assert!(api.get_file_requests.lock().unwrap().is_empty());
    assert!(api.delete_ids.lock().unwrap().is_empty());
    assert!(store.get("user-42", "42").unwrap().is_some());
    assert!(store.get("user-b", "99").unwrap().is_some());
}

#[tokio::test]
async fn reconciliation_aborts_after_blocked_drive_fetch_on_same_user_relogin() {
    let data_dir = tempdir().expect("data dir");
    let store = Arc::new(pending_store(&data_dir));
    seed_pending_binding_for(
        store.as_ref(),
        "user-42",
        "42",
        "old-session-file",
        PendingBindingKind::FirstUpload,
    );
    seed_pending_binding_for(
        store.as_ref(),
        "user-b",
        "99",
        "user-b-file",
        PendingBindingKind::FirstUpload,
    );
    let api = Arc::new(ScriptedDriveApi::default());
    api.files
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedDriveApi::valid_file(
            "old-session-file",
            Some("https://drive.google.com/old-session-file"),
        )));
    let get_file_gate = Arc::new(AsyncGate::default());
    *api.get_file_gate.lock().unwrap() = Some(Arc::clone(&get_file_gate));
    let metadata = Arc::new(ScriptedMetadataClient::default());
    metadata
        .fetches
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedMetadataClient::owner(None, None)));
    let auth = Arc::new(authenticated_user("user-42").await);
    let epoch = auth.current_session_epoch().await.expect("session epoch");

    let sweep = {
        let api = Arc::clone(&api);
        let store = Arc::clone(&store);
        let metadata = Arc::clone(&metadata);
        let auth = Arc::clone(&auth);
        tokio::spawn(async move {
            let cancellation = CancellationToken::new();
            reconcile_pending_bindings_for_session(
                api.as_ref(),
                store.as_ref(),
                metadata.as_ref(),
                auth.as_ref(),
                &epoch,
                "access-token-a",
                &cancellation,
            )
            .await;
        })
    };
    get_file_gate
        .entered
        .acquire()
        .await
        .expect("Drive fetch entered")
        .forget();
    auth.set_current_session(Some(serde_json::json!({
        "user": { "id": "user-42" },
        "sessionToken": "new-opaque-session-token-a"
    })))
    .await;
    get_file_gate.release.add_permits(1);
    sweep.await.expect("sweep task");

    assert_eq!(
        api.get_file_requests.lock().unwrap().as_slice(),
        &[("access-token-a".to_string(), "old-session-file".to_string())]
    );
    assert!(metadata.patch_inputs.lock().unwrap().is_empty());
    assert!(api.delete_ids.lock().unwrap().is_empty());
    assert!(store.get("user-42", "42").unwrap().is_some());
    assert!(store.get("user-b", "99").unwrap().is_some());
}

#[tokio::test]
async fn cancellation_interrupts_blocked_status_recovery_and_waits_for_cleanup() {
    let api = Arc::new(ScriptedDriveApi::default());
    api.chunks
        .lock()
        .unwrap()
        .push_back(Err(DriveApiError::Network));
    api.statuses
        .lock()
        .unwrap()
        .push_back(Ok(DriveChunkResult::Accepted(0)));
    let status_gate = Arc::new(AsyncGate::default());
    *api.query_status_gate.lock().unwrap() = Some(Arc::clone(&status_gate));
    let manager = Arc::new(DriveOperationManager::default());
    let operation_id = Uuid::new_v4();
    let lease = manager
        .register("user", operation_id, "sim-status")
        .expect("operation");
    lease.set_phase(DriveOperationPhase::Transferring);
    let cancellation = lease.cancellation().clone();
    let finalization_gate = lease.finalization_gate();
    let fixture = create_request(b"status recovery");
    let UploadRequestFixture {
        _directory,
        request,
    } = fixture;
    let task = tokio::spawn({
        let api = Arc::clone(&api);
        async move {
            let _directory = _directory;
            let _lease = lease;
            run_resumable_upload_cancelable(
                api.as_ref(),
                &RecordingSleeper::default(),
                ACCESS_TOKEN,
                request,
                &cancellation,
                &finalization_gate,
                |_, _| {},
            )
            .await
        }
    });
    status_gate
        .entered
        .acquire()
        .await
        .expect("status recovery entered")
        .forget();

    assert!(
        manager
            .cancel_and_wait("user", operation_id, Duration::from_secs(1))
            .await
    );
    let failure = task.await.unwrap().expect_err("canceled status recovery");
    assert_eq!(failure.error, DriveApiError::Canceled);
    assert_eq!(manager.active_count(), 0);
    assert_eq!(manager.available_resource_slots(), 2);
}

#[tokio::test]
async fn cancellation_interrupts_retry_backoff_sleep() {
    let api = Arc::new(ScriptedDriveApi::default());
    api.starts
        .lock()
        .unwrap()
        .push_back(Err(DriveApiError::Network));
    let sleeper = Arc::new(BlockingSleeper::default());
    let manager = Arc::new(DriveOperationManager::default());
    let operation_id = Uuid::new_v4();
    let lease = manager
        .register("user", operation_id, "sim-sleep")
        .expect("operation");
    lease.set_phase(DriveOperationPhase::Transferring);
    let cancellation = lease.cancellation().clone();
    let finalization_gate = lease.finalization_gate();
    let fixture = create_request(b"retry sleep");
    let UploadRequestFixture {
        _directory,
        request,
    } = fixture;
    let task = tokio::spawn({
        let api = Arc::clone(&api);
        let sleeper = Arc::clone(&sleeper);
        async move {
            let _directory = _directory;
            let _lease = lease;
            run_resumable_upload_cancelable(
                api.as_ref(),
                sleeper.as_ref(),
                ACCESS_TOKEN,
                request,
                &cancellation,
                &finalization_gate,
                |_, _| {},
            )
            .await
        }
    });
    sleeper
        .gate
        .entered
        .acquire()
        .await
        .expect("retry sleep entered")
        .forget();

    assert!(
        manager
            .cancel_and_wait("user", operation_id, Duration::from_secs(1))
            .await
    );
    let failure = task.await.unwrap().expect_err("canceled retry sleep");
    assert_eq!(failure.error, DriveApiError::Canceled);
}

#[tokio::test]
async fn cancellation_wins_before_complete_acknowledgement_is_observed() {
    let api = Arc::new(ScriptedDriveApi::default());
    api.chunks
        .lock()
        .unwrap()
        .push_back(Ok(DriveChunkResult::Complete));
    let chunk_gate = Arc::new(AsyncGate::default());
    *api.upload_chunk_gate.lock().unwrap() = Some(Arc::clone(&chunk_gate));
    let manager = Arc::new(DriveOperationManager::default());
    let operation_id = Uuid::new_v4();
    let lease = manager
        .register("user", operation_id, "sim-before-complete")
        .expect("operation");
    lease.set_phase(DriveOperationPhase::Transferring);
    let cancellation = lease.cancellation().clone();
    let finalization_gate = lease.finalization_gate();
    let fixture = create_request(b"complete race");
    let UploadRequestFixture {
        _directory,
        request,
    } = fixture;
    let task = tokio::spawn({
        let api = Arc::clone(&api);
        async move {
            let _directory = _directory;
            let _lease = lease;
            run_resumable_upload_cancelable(
                api.as_ref(),
                &RecordingSleeper::default(),
                ACCESS_TOKEN,
                request,
                &cancellation,
                &finalization_gate,
                |_, _| {},
            )
            .await
        }
    });
    chunk_gate
        .entered
        .acquire()
        .await
        .expect("chunk entered")
        .forget();

    assert!(
        manager
            .cancel_and_wait("user", operation_id, Duration::from_secs(1))
            .await
    );
    let failure = task.await.unwrap().expect_err("cancellation wins");
    assert_eq!(failure.error, DriveApiError::Canceled);
}

#[tokio::test]
async fn complete_acknowledgement_wins_finalization_before_late_cancellation() {
    let api = Arc::new(ScriptedDriveApi::default());
    api.chunks
        .lock()
        .unwrap()
        .push_back(Ok(DriveChunkResult::Complete));
    api.files
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedDriveApi::valid_file(
            "generated-file-id",
            Some("https://drive.google.com/complete"),
        )));
    api.permissions
        .lock()
        .unwrap()
        .push_back(Ok(PublicPermissionStatus::Public));
    let final_file_gate = Arc::new(AsyncGate::default());
    *api.get_file_gate.lock().unwrap() = Some(Arc::clone(&final_file_gate));
    let manager = Arc::new(DriveOperationManager::default());
    let operation_id = Uuid::new_v4();
    let lease = manager
        .register("user", operation_id, "sim-after-complete")
        .expect("operation");
    lease.set_phase(DriveOperationPhase::Transferring);
    let cancellation = lease.cancellation().clone();
    let finalization_gate = lease.finalization_gate();
    let fixture = create_request(b"complete race");
    let UploadRequestFixture {
        _directory,
        request,
    } = fixture;
    let task = tokio::spawn({
        let api = Arc::clone(&api);
        async move {
            let _directory = _directory;
            let _lease = lease;
            run_resumable_upload_cancelable(
                api.as_ref(),
                &RecordingSleeper::default(),
                ACCESS_TOKEN,
                request,
                &cancellation,
                &finalization_gate,
                |_, _| {},
            )
            .await
        }
    });
    final_file_gate
        .entered
        .acquire()
        .await
        .expect("final file validation entered")
        .forget();

    assert!(!manager.cancel("user", operation_id));
    final_file_gate.release.add_permits(1);
    let outcome = task.await.unwrap().expect("finalization completes");
    assert_eq!(outcome.file_id, "generated-file-id");
}

#[tokio::test]
async fn recovered_pending_file_cancel_before_gate_retains_binding_without_patch_or_delete() {
    let data_dir = tempdir().expect("data dir");
    let store = Arc::new(pending_store(&data_dir));
    seed_pending_binding(
        store.as_ref(),
        "recovered-before-gate",
        PendingBindingKind::FirstUpload,
    );
    let api = Arc::new(ScriptedDriveApi::default());
    api.files
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedDriveApi::valid_file(
            "recovered-before-gate",
            Some("https://drive.google.com/recovered-before"),
        )));
    let get_file_gate = Arc::new(AsyncGate::default());
    *api.get_file_gate.lock().unwrap() = Some(Arc::clone(&get_file_gate));
    let metadata = Arc::new(ScriptedMetadataClient::default());
    metadata
        .fetches
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedMetadataClient::owner(None, None)));
    let auth = Arc::new(authenticated_user("user-42").await);
    let archive = create_request(b"unused archive");
    let request = crash_safe_request(
        archive.request.archive_path.clone(),
        PendingBindingKind::FirstUpload,
    );
    let manager = Arc::new(DriveOperationManager::default());
    let operation_id = Uuid::new_v4();
    let lease = manager
        .register("user-42", operation_id, "42")
        .expect("operation");
    lease.set_phase(DriveOperationPhase::Transferring);
    let cancellation = lease.cancellation().clone();
    let finalization_gate = lease.finalization_gate();
    let task = tokio::spawn({
        let api = Arc::clone(&api);
        let store = Arc::clone(&store);
        let metadata = Arc::clone(&metadata);
        let auth = Arc::clone(&auth);
        async move {
            let _archive = archive;
            let _lease = lease;
            run_crash_safe_create_cancelable(
                api.as_ref(),
                &RecordingSleeper::default(),
                store.as_ref(),
                metadata.as_ref(),
                auth.as_ref(),
                ACCESS_TOKEN,
                request,
                &cancellation,
                &finalization_gate,
                |_, _| {},
            )
            .await
        }
    });
    get_file_gate
        .entered
        .acquire()
        .await
        .expect("recovered Drive fetch entered")
        .forget();

    assert!(
        manager
            .cancel_and_wait("user-42", operation_id, Duration::from_secs(1))
            .await
    );
    let failure = task.await.unwrap().expect_err("canceled recovery");
    assert_eq!(failure.error, DriveApiError::Canceled);
    assert!(store.get("user-42", "42").unwrap().is_some());
    assert!(metadata.patch_inputs.lock().unwrap().is_empty());
    assert!(api.delete_ids.lock().unwrap().is_empty());
}

#[tokio::test]
async fn recovered_pending_file_after_gate_refuses_cancel_and_finishes_patch() {
    let data_dir = tempdir().expect("data dir");
    let store = Arc::new(pending_store(&data_dir));
    seed_pending_binding(
        store.as_ref(),
        "recovered-after-gate",
        PendingBindingKind::FirstUpload,
    );
    let api = Arc::new(ScriptedDriveApi::default());
    api.files
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedDriveApi::valid_file(
            "recovered-after-gate",
            Some("https://drive.google.com/recovered-after"),
        )));
    api.permissions
        .lock()
        .unwrap()
        .push_back(Ok(PublicPermissionStatus::Public));
    let permission_gate = Arc::new(AsyncGate::default());
    *api.permission_gate.lock().unwrap() = Some(Arc::clone(&permission_gate));
    let metadata = Arc::new(ScriptedMetadataClient::default());
    metadata
        .fetches
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedMetadataClient::owner(None, None)));
    script_successful_patch(
        metadata.as_ref(),
        "recovered-after-gate",
        "https://drive.google.com/recovered-after",
    );
    let auth = Arc::new(authenticated_user("user-42").await);
    let archive = create_request(b"unused archive");
    let request = crash_safe_request(
        archive.request.archive_path.clone(),
        PendingBindingKind::FirstUpload,
    );
    let manager = Arc::new(DriveOperationManager::default());
    let operation_id = Uuid::new_v4();
    let lease = manager
        .register("user-42", operation_id, "42")
        .expect("operation");
    lease.set_phase(DriveOperationPhase::Transferring);
    let cancellation = lease.cancellation().clone();
    let finalization_gate = lease.finalization_gate();
    let task = tokio::spawn({
        let api = Arc::clone(&api);
        let store = Arc::clone(&store);
        let metadata = Arc::clone(&metadata);
        let auth = Arc::clone(&auth);
        async move {
            let _archive = archive;
            let _lease = lease;
            run_crash_safe_create_cancelable(
                api.as_ref(),
                &RecordingSleeper::default(),
                store.as_ref(),
                metadata.as_ref(),
                auth.as_ref(),
                ACCESS_TOKEN,
                request,
                &cancellation,
                &finalization_gate,
                |_, _| {},
            )
            .await
        }
    });
    permission_gate
        .entered
        .acquire()
        .await
        .expect("permission validation entered")
        .forget();

    assert!(!manager.cancel("user-42", operation_id));
    permission_gate.release.add_permits(1);
    let outcome = task.await.unwrap().expect("recovery completes");
    assert_eq!(outcome.file_id, "recovered-after-gate");
    assert_eq!(store.get("user-42", "42").unwrap(), None);
    assert_eq!(metadata.patch_inputs.lock().unwrap().len(), 1);
    assert!(api.delete_ids.lock().unwrap().is_empty());
}

#[tokio::test]
async fn cancel_ack_waits_for_real_zip_cleanup_and_resource_release() {
    let song_dir = tempdir().expect("song dir");
    let source_path = song_dir.path().join("large-audio.ogg");
    std::fs::File::create(&source_path)
        .expect("large source")
        .set_len(8 * 1024 * 1024)
        .expect("large source size");
    let source_files = crate::songs::collect_valid_song_files(song_dir.path(), song_dir.path())
        .await
        .expect("validated source");
    let cache_dir = tempdir().expect("cache dir");
    let archive = create_upload_archive(cache_dir.path()).expect("upload archive");
    let zip_path = archive.zip_path().to_path_buf();
    let task_zip_path = zip_path.clone();
    let manager = Arc::new(DriveOperationManager::default());
    let operation_id = Uuid::new_v4();
    let lease = manager
        .register("user", operation_id, "sim-large-zip")
        .expect("operation");
    lease.set_phase(DriveOperationPhase::Preparing);
    let cancellation = lease.cancellation().clone();
    let hook_cancellation = cancellation.clone();
    let (chunk_written_tx, chunk_written_rx) = tokio::sync::oneshot::channel();
    let task = tokio::spawn(async move {
        let _permit = lease.acquire_resource_slot().await.expect("resource slot");
        let mut chunk_written_tx = Some(chunk_written_tx);
        let zip_result = tokio::task::spawn_blocking(move || {
            crate::songs::write_song_zip_cancelable_with_chunk_hook(
                &task_zip_path,
                &source_files,
                &cancellation,
                || {
                    if let Some(sender) = chunk_written_tx.take() {
                        let _ = sender.send(());
                        while !hook_cancellation.is_cancelled() {
                            std::thread::yield_now();
                        }
                    }
                },
            )
        })
        .await
        .expect("ZIP worker");
        drop(archive);
        zip_result
    });
    chunk_written_rx.await.expect("real ZIP chunk written");

    assert!(
        manager
            .cancel_and_wait("user", operation_id, Duration::from_secs(2))
            .await
    );
    let error = task.await.unwrap().expect_err("ZIP canceled");
    assert!(matches!(error, crate::error::DesktopError::Message(message) if message == "CANCELED"));
    assert!(!zip_path.exists());
    assert_eq!(manager.active_count(), 0);
    assert_eq!(manager.available_resource_slots(), 2);
    assert!(manager
        .register("user", Uuid::new_v4(), "sim-large-zip")
        .is_ok());
}

#[tokio::test]
async fn run_resumable_upload_delegates_to_chunk_size_variant_with_default_chunk_size() {
    let api = ScriptedDriveApi::default();
    api.chunks
        .lock()
        .unwrap()
        .push_back(Ok(DriveChunkResult::Complete));
    api.files
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedDriveApi::valid_file(
            "generated-file-id",
            Some("https://drive.google.com/uc?id=generated-file-id"),
        )));
    api.permissions
        .lock()
        .unwrap()
        .push_back(Ok(PublicPermissionStatus::Public));
    let sleeper = RecordingSleeper::default();
    let fixture = create_request(b"archive");

    let result = run_resumable_upload(
        &api,
        &sleeper,
        ACCESS_TOKEN,
        fixture.request.clone(),
        |_, _| {},
    )
    .await
    .expect("default chunk-size create upload");

    assert_eq!(result.file_id, "generated-file-id");
    assert_eq!(result.file_name, "AC-DC.zip");
    assert_eq!(
        result.download_url,
        "https://drive.google.com/uc?id=generated-file-id"
    );
    assert_eq!(
        api.create_metadata.lock().unwrap().as_slice(),
        &[DriveCreateMetadata {
            id: "generated-file-id".to_string(),
            parent_id: "folder-42".to_string(),
            name: "AC-DC.zip".to_string(),
        }]
    );
}

#[tokio::test]
async fn run_crash_safe_create_delegates_to_chunk_size_variant_with_default_chunk_size() {
    let data_dir = tempdir().expect("data dir");
    let archive_dir = tempdir().expect("archive dir");
    let archive_path = archive_dir.path().join("upload.zip");
    std::fs::write(&archive_path, b"archive").expect("archive");
    let store = pending_store(&data_dir);
    let api = ScriptedDriveApi::default();
    api.generated_ids
        .lock()
        .unwrap()
        .push_back(Ok("generated-file-id".to_string()));
    api.chunks
        .lock()
        .unwrap()
        .push_back(Ok(DriveChunkResult::Complete));
    api.files
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedDriveApi::valid_file(
            "generated-file-id",
            Some("https://drive.google.com/uc?id=generated-file-id"),
        )));
    api.permissions
        .lock()
        .unwrap()
        .push_back(Ok(PublicPermissionStatus::Public));
    let metadata = ScriptedMetadataClient::default();
    metadata
        .fetches
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedMetadataClient::owner(None, None)));
    script_successful_patch(
        &metadata,
        "generated-file-id",
        "https://drive.google.com/uc?id=generated-file-id",
    );
    let auth = authenticated_user("user-42").await;
    let request = crash_safe_request(archive_path, PendingBindingKind::FirstUpload);

    let outcome = run_crash_safe_create(
        &api,
        &RecordingSleeper::default(),
        &store,
        &metadata,
        &auth,
        ACCESS_TOKEN,
        request,
        |_, _| {},
    )
    .await
    .expect("default chunk-size crash-safe create");

    assert_eq!(outcome.file_id, "generated-file-id");
    assert_eq!(outcome.file_name, "Saved cloud title 42.zip");
    assert_eq!(
        outcome.download_url,
        "https://drive.google.com/uc?id=generated-file-id"
    );
    assert_eq!(*api.generated_count.lock().unwrap(), 1);
    assert_eq!(store.get("user-42", "42").unwrap(), None);
}

#[tokio::test]
async fn reconciliation_does_not_overwrite_a_newer_drive_binding_established_by_another_device() {
    // Cross-device race: Device A uploaded file X as a FirstUpload (expected
    // the owner row to have no Drive binding), but its metadata patch never
    // committed and left a pending record. Device B later uploaded and
    // successfully bound file Y. When Device A relaunches and reconciles, it
    // must NOT overwrite the newer Y binding with the stale X file. The
    // optimistic-concurrency guard (expectedPreviousDriveFile = None) makes
    // the patch fail; recovery then treats the pending file as superseded
    // and compensates by deleting the orphaned Drive file X.
    let data_dir = tempdir().expect("data dir");
    let store = pending_store(&data_dir);
    store
        .replace(
            crate::google_drive::pending_bindings::PendingGoogleDriveBinding {
                user_id: "user-42".to_string(),
                simfile_id: "42".to_string(),
                drive_file_id: "device-a-file-x".to_string(),
                kind: PendingBindingKind::FirstUpload,
                created_at: "2026-07-01T00:00:00Z".to_string(),
                expected_previous_drive_file: Some(ExpectedPreviousDriveFile::None),
            },
        )
        .expect("pending binding");

    let api = ScriptedDriveApi::default();
    // The pending Drive file X still exists on Drive.
    api.files
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedDriveApi::valid_file(
            "device-a-file-x",
            Some("https://drive.google.com/uc?id=device-a-file-x"),
        )));
    api.permissions
        .lock()
        .unwrap()
        .push_back(Ok(PublicPermissionStatus::Public));
    // Reconciliation fetches the owner and sees Device B's newer binding (file Y).
    let metadata = ScriptedMetadataClient::default();
    metadata.fetches.lock().unwrap().extend([
        // First fetch: owner now references Device B's file Y (not NULL).
        Ok(ScriptedMetadataClient::owner_for(
            "42",
            Some("device-b-file-y"),
            Some("https://drive.google.com/uc?id=device-b-file-y"),
        )),
        // After the guarded patch fails, patch_and_finish re-fetches the owner
        // to decide what to do. The owner still references Y (not prior_owner,
        // which was also Y in this FirstUpload case where prior_owner is the
        // current row). The Ok(_) arm with a non-matching binding triggers
        // compensation.
        Ok(ScriptedMetadataClient::owner_for(
            "42",
            Some("device-b-file-y"),
            Some("https://drive.google.com/uc?id=device-b-file-y"),
        )),
    ]);
    // The guarded patch must fail because the server-side binding is Y, not NULL.
    metadata
        .patches
        .lock()
        .unwrap()
        .push_back(Err(DriveMetadataError::BindingMismatch));
    // Compensation deletes the orphaned Device A file X.
    api.deletes.lock().unwrap().push_back(Ok(()));

    reconcile_pending_bindings_for_current_user(
        &api,
        &store,
        &metadata,
        &authenticated_user("user-42").await,
        ACCESS_TOKEN,
        &CancellationToken::new(),
    )
    .await;

    // The pending binding is removed (compensated, not retried).
    assert_eq!(store.get("user-42", "42").expect("pending"), None);
    // The orphaned Device A file X was deleted.
    assert_eq!(
        api.delete_ids.lock().unwrap().as_slice(),
        &["device-a-file-x".to_string()],
        "the superseded pending file must be deleted, not left as an orphan"
    );
    // No new Drive file was created during reconciliation.
    assert!(api.create_metadata.lock().unwrap().is_empty());
    // The patch was attempted exactly once with the optimistic guard.
    let patch_inputs = metadata.patch_inputs.lock().unwrap();
    assert_eq!(patch_inputs.len(), 1);
    assert_eq!(patch_inputs[0].0, "device-a-file-x");
    // The optimistic-concurrency guard must be Some(ExpectedPreviousDriveFile::None),
    // not None, so the patch rejects any server-side binding that isn't NULL.
    assert_eq!(patch_inputs[0].2, Some(ExpectedPreviousDriveFile::None));
}

#[tokio::test]
async fn reconciliation_infers_expected_previous_none_for_legacy_first_upload() {
    // Legacy pending bindings persisted before the
    // `expected_previous_drive_file` field existed have `None` for that
    // field. For a legacy FirstUpload, the guard is safely inferable as
    // `ExpectedPreviousDriveFile::None` (expect no existing Drive file ID).
    // This test mirrors
    // `reconciliation_does_not_overwrite_a_newer_drive_binding_established_by_another_device`
    // but uses a legacy `None` guard instead of an explicit
    // `Some(ExpectedPreviousDriveFile::None)`. The behavior must be
    // identical: the guarded patch fails against Device B's newer binding,
    // and the orphaned Device A file is compensated.
    let data_dir = tempdir().expect("data dir");
    let store = pending_store(&data_dir);
    store
        .replace(
            crate::google_drive::pending_bindings::PendingGoogleDriveBinding {
                user_id: "user-42".to_string(),
                simfile_id: "42".to_string(),
                drive_file_id: "device-a-file-x".to_string(),
                kind: PendingBindingKind::FirstUpload,
                created_at: "2026-06-01T00:00:00Z".to_string(),
                expected_previous_drive_file: None,
            },
        )
        .expect("pending binding");

    let api = ScriptedDriveApi::default();
    api.files
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedDriveApi::valid_file(
            "device-a-file-x",
            Some("https://drive.google.com/uc?id=device-a-file-x"),
        )));
    api.permissions
        .lock()
        .unwrap()
        .push_back(Ok(PublicPermissionStatus::Public));
    let metadata = ScriptedMetadataClient::default();
    metadata.fetches.lock().unwrap().extend([
        // Owner now references Device B's file Y (not NULL).
        Ok(ScriptedMetadataClient::owner_for(
            "42",
            Some("device-b-file-y"),
            Some("https://drive.google.com/uc?id=device-b-file-y"),
        )),
        // After the guarded patch fails, patch_and_finish re-fetches the
        // owner. The binding still references Y (matches prior_owner), so
        // the loop retries once and then falls through to compensation.
        Ok(ScriptedMetadataClient::owner_for(
            "42",
            Some("device-b-file-y"),
            Some("https://drive.google.com/uc?id=device-b-file-y"),
        )),
    ]);
    // The guarded patch fails because the server-side binding is Y, not NULL.
    metadata
        .patches
        .lock()
        .unwrap()
        .push_back(Err(DriveMetadataError::BindingMismatch));
    api.deletes.lock().unwrap().push_back(Ok(()));

    reconcile_pending_bindings_for_current_user(
        &api,
        &store,
        &metadata,
        &authenticated_user("user-42").await,
        ACCESS_TOKEN,
        &CancellationToken::new(),
    )
    .await;

    // The pending binding is removed (compensated, not retried).
    assert_eq!(store.get("user-42", "42").expect("pending"), None);
    // The orphaned Device A file X was deleted.
    assert_eq!(
        api.delete_ids.lock().unwrap().as_slice(),
        &["device-a-file-x".to_string()],
        "the superseded pending file must be deleted, not left as an orphan"
    );
    // The patch was attempted (with the inferred guard), proving the legacy
    // FirstUpload was treated as ExpectedPreviousDriveFile::None rather than
    // skipped or patched unconditionally.
    let patch_inputs = metadata.patch_inputs.lock().unwrap();
    assert_eq!(patch_inputs.len(), 1);
    // The legacy `None` guard is inferred as Some(ExpectedPreviousDriveFile::None)
    // for a FirstUpload, matching the explicit-guard cross-device behavior.
    assert_eq!(patch_inputs[0].2, Some(ExpectedPreviousDriveFile::None));
}

#[tokio::test]
async fn reconciliation_fails_closed_for_legacy_explicit_replacement() {
    // Legacy ExplicitReplacement pending bindings have `None` for
    // `expected_previous_drive_file`, and the original file ID cannot be
    // reconstructed. Rather than issuing an unconditional metadata patch
    // that could overwrite a newer binding established by another device,
    // reconciliation must fail closed: compensate (delete the orphaned
    // Drive file and remove the pending binding) without attempting any
    // patch at all.
    let data_dir = tempdir().expect("data dir");
    let store = pending_store(&data_dir);
    store
        .replace(
            crate::google_drive::pending_bindings::PendingGoogleDriveBinding {
                user_id: "user-42".to_string(),
                simfile_id: "42".to_string(),
                drive_file_id: "device-a-file-x".to_string(),
                kind: PendingBindingKind::ExplicitReplacement,
                created_at: "2026-06-01T00:00:00Z".to_string(),
                expected_previous_drive_file: None,
            },
        )
        .expect("pending binding");

    let api = ScriptedDriveApi::default();
    // The pending Drive file X still exists on Drive.
    api.files
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedDriveApi::valid_file(
            "device-a-file-x",
            Some("https://drive.google.com/uc?id=device-a-file-x"),
        )));
    let metadata = ScriptedMetadataClient::default();
    // Owner references Device B's newer binding (file Y). Reconciliation
    // fetches the owner, then fail-closed compensation deletes the
    // orphaned file X.
    metadata
        .fetches
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedMetadataClient::owner_for(
            "42",
            Some("device-b-file-y"),
            Some("https://drive.google.com/uc?id=device-b-file-y"),
        )));
    // Compensation deletes the orphaned Device A file X.
    api.deletes.lock().unwrap().push_back(Ok(()));

    reconcile_pending_bindings_for_current_user(
        &api,
        &store,
        &metadata,
        &authenticated_user("user-42").await,
        ACCESS_TOKEN,
        &CancellationToken::new(),
    )
    .await;

    // The pending binding is removed (compensated).
    assert_eq!(store.get("user-42", "42").expect("pending"), None);
    // The orphaned Device A file X was deleted.
    assert_eq!(
        api.delete_ids.lock().unwrap().as_slice(),
        &["device-a-file-x".to_string()],
        "the legacy pending file must be compensated, not left as an orphan"
    );
    // No metadata patch was attempted — fail closed, not unconditional patch.
    assert!(
        metadata.patch_inputs.lock().unwrap().is_empty(),
        "legacy ExplicitReplacement must not issue an unguarded metadata patch"
    );
}

// ---------------------------------------------------------------------------
// Pure-function coverage tests for upload.rs helpers.
// ---------------------------------------------------------------------------

#[test]
fn sanitize_drive_zip_name_falls_back_to_simfile_id_for_empty_title() {
    assert_eq!(sanitize_drive_zip_name("", "abc"), "simfile-abc.zip");
}

#[test]
fn sanitize_drive_zip_name_falls_back_for_whitespace_only_title() {
    assert_eq!(sanitize_drive_zip_name("   \t\n  ", "42"), "simfile-42.zip");
}

#[test]
fn sanitize_drive_zip_name_preserves_printable_punctuation() {
    // Printable punctuation like `:` is valid in Drive display names.
    assert_eq!(
        sanitize_drive_zip_name("Song: Reprise", "1"),
        "Song: Reprise.zip"
    );
}

#[test]
fn sanitize_drive_zip_name_collapses_path_separators_to_hyphen() {
    assert_eq!(
        sanitize_drive_zip_name("AC/DC\\Live", "1"),
        "AC-DC-Live.zip"
    );
}

#[test]
fn sanitize_drive_zip_name_collapses_control_chars_to_single_hyphen() {
    // Multiple consecutive control characters collapse to a single hyphen.
    assert_eq!(sanitize_drive_zip_name("a\x01\x02b", "1"), "a-b.zip");
}

#[test]
fn sanitize_drive_zip_name_trims_leading_and_trailing_whitespace() {
    assert_eq!(sanitize_drive_zip_name("  My Song  ", "1"), "My Song.zip");
}

#[test]
fn validated_download_url_none_returns_none() {
    assert_eq!(validated_download_url(None), Ok(None));
}

#[test]
fn validated_download_url_empty_returns_none() {
    assert_eq!(validated_download_url(Some("")), Ok(None));
}

#[test]
fn validated_download_url_whitespace_only_returns_none() {
    assert_eq!(validated_download_url(Some("   ")), Ok(None));
}

#[test]
fn validated_download_url_rejects_non_https_scheme() {
    assert_eq!(
        validated_download_url(Some("http://example.com/file")),
        Err(DriveApiError::InvalidResponse)
    );
}

#[test]
fn validated_download_url_rejects_unparseable_url() {
    assert_eq!(
        validated_download_url(Some("not a url at all")),
        Err(DriveApiError::InvalidResponse)
    );
}

#[test]
fn validated_download_url_rejects_oversized_url() {
    let long = format!("https://example.com/{}", "a".repeat(MAX_DOWNLOAD_URL_BYTES));
    assert_eq!(
        validated_download_url(Some(&long)),
        Err(DriveApiError::InvalidResponse)
    );
}

#[test]
fn validated_download_url_accepts_valid_https_url() {
    let url = "https://drive.google.com/uc?id=file-1";
    assert_eq!(validated_download_url(Some(url)), Ok(Some(url.to_string())));
}

#[test]
fn validated_download_url_trims_whitespace_before_validating() {
    assert_eq!(
        validated_download_url(Some("  https://example.com/x  ")),
        Ok(Some("https://example.com/x".to_string()))
    );
}

#[test]
fn validate_final_file_shape_rejects_mismatched_id() {
    let file = ScriptedDriveApi::valid_file("wrong-id", None);
    assert_eq!(
        validate_final_file_shape(&file, "intended-id"),
        Err(DriveApiError::InvalidResponse)
    );
}

#[test]
fn validate_final_file_shape_rejects_wrong_mime_type() {
    let mut file = ScriptedDriveApi::valid_file("file-1", None);
    file.mime_type = "text/plain".to_string();
    assert_eq!(
        validate_final_file_shape(&file, "file-1"),
        Err(DriveApiError::InvalidResponse)
    );
}

#[test]
fn validate_final_file_shape_rejects_trashed_file() {
    let mut file = ScriptedDriveApi::valid_file("file-1", None);
    file.trashed = true;
    assert_eq!(
        validate_final_file_shape(&file, "file-1"),
        Err(DriveApiError::InvalidResponse)
    );
}

#[test]
fn validate_final_file_shape_rejects_non_downloadable_file() {
    let mut file = ScriptedDriveApi::valid_file("file-1", None);
    file.can_download = false;
    assert_eq!(
        validate_final_file_shape(&file, "file-1"),
        Err(DriveApiError::InvalidResponse)
    );
}

#[test]
fn validate_final_file_shape_accepts_valid_file() {
    let file = ScriptedDriveApi::valid_file("file-1", Some("https://example.com/x"));
    assert_eq!(validate_final_file_shape(&file, "file-1"), Ok(()));
}

#[test]
fn bounded_retry_delay_exponential_growth_capped_at_max() {
    // attempt 0: 100ms, attempt 1: 200ms, attempt 2: 400ms...
    assert_eq!(bounded_retry_delay(0, None), Duration::from_millis(100));
    assert_eq!(bounded_retry_delay(1, None), Duration::from_millis(200));
    assert_eq!(bounded_retry_delay(2, None), Duration::from_millis(400));
    // Large attempt should be capped at MAX_RETRY_DELAY (5s).
    assert_eq!(bounded_retry_delay(20, None), MAX_RETRY_DELAY);
}

#[test]
fn bounded_retry_delay_honors_provider_retry_after_capped() {
    // Provider retry-after is honored but capped at MAX_PROVIDER_RETRY_DELAY.
    assert_eq!(
        bounded_retry_delay(0, Some(Duration::from_secs(10))),
        Duration::from_secs(10)
    );
    // Above the provider ceiling.
    assert_eq!(
        bounded_retry_delay(0, Some(Duration::from_secs(120))),
        MAX_PROVIDER_RETRY_DELAY
    );
}

#[test]
fn bounded_retry_delay_exponential_overflows_safely() {
    // Very large attempt should not panic; saturates to MAX_RETRY_DELAY.
    let delay = bounded_retry_delay(100, None);
    assert_eq!(delay, MAX_RETRY_DELAY);
}

#[test]
fn monotonic_progress_skips_zero_total() {
    let mut progress = MonotonicDriveProgress::default();
    assert!(!progress.should_emit(0, 0));
}

#[test]
fn monotonic_progress_skips_accepted_greater_than_total() {
    let mut progress = MonotonicDriveProgress::default();
    assert!(!progress.should_emit(10, 5));
}

#[test]
fn monotonic_progress_emits_first_valid_sample() {
    let mut progress = MonotonicDriveProgress::default();
    assert!(progress.should_emit(0, 100));
}

#[test]
fn monotonic_progress_skips_non_increasing_accepted() {
    let mut progress = MonotonicDriveProgress::default();
    assert!(progress.should_emit(50, 100));
    assert!(
        !progress.should_emit(50, 100),
        "same accepted must be skipped"
    );
    assert!(
        !progress.should_emit(40, 100),
        "lower accepted must be skipped"
    );
}

#[test]
fn monotonic_progress_skips_when_total_changes() {
    let mut progress = MonotonicDriveProgress::default();
    assert!(progress.should_emit(50, 100));
    assert!(
        !progress.should_emit(60, 200),
        "different total must be skipped"
    );
}

#[test]
fn monotonic_progress_emits_strictly_increasing_accepted() {
    let mut progress = MonotonicDriveProgress::default();
    assert!(progress.should_emit(0, 100));
    assert!(progress.should_emit(1, 100));
    assert!(progress.should_emit(99, 100));
    assert!(progress.should_emit(100, 100));
}

#[test]
fn upload_failure_create_target_retains_pending_binding() {
    let target = DriveUploadTarget::Create {
        generated_id: "gen-1".to_string(),
        folder_id: "folder-1".to_string(),
    };
    let failure = upload_failure(DriveApiError::Network, &target);
    assert_eq!(failure.error, DriveApiError::Network);
    assert_eq!(failure.pending_binding, PendingBindingDisposition::Retain);
}

#[test]
fn upload_failure_update_target_is_not_applicable() {
    let target = DriveUploadTarget::Update {
        file_id: "file-1".to_string(),
    };
    let failure = upload_failure(DriveApiError::Network, &target);
    assert_eq!(failure.error, DriveApiError::Network);
    assert_eq!(
        failure.pending_binding,
        PendingBindingDisposition::NotApplicable
    );
}

#[test]
fn ensure_not_canceled_returns_ok_when_no_token() {
    assert_eq!(ensure_not_canceled(None), Ok(()));
}

#[test]
fn ensure_not_canceled_returns_ok_when_token_not_cancelled() {
    let token = CancellationToken::new();
    assert_eq!(ensure_not_canceled(Some(&token)), Ok(()));
}

#[test]
fn ensure_not_canceled_returns_canceled_when_token_cancelled() {
    let token = CancellationToken::new();
    token.cancel();
    assert_eq!(
        ensure_not_canceled(Some(&token)),
        Err(DriveApiError::Canceled)
    );
}

#[test]
fn enter_finalization_without_gate_delegates_to_cancellation_check() {
    let token = CancellationToken::new();
    assert_eq!(enter_finalization(None, Some(&token)), Ok(()));
    token.cancel();
    assert_eq!(
        enter_finalization(None, Some(&token)),
        Err(DriveApiError::Canceled)
    );
}

#[test]
fn enter_finalization_without_gate_and_no_token_returns_ok() {
    assert_eq!(enter_finalization(None, None), Ok(()));
}

#[tokio::test]
async fn operation_completion_wait_returns_true_when_already_finished() {
    let completion = Arc::new(DriveOperationCompletion::default());
    completion.finish();
    assert!(completion.wait(Duration::from_millis(10)).await);
}

#[tokio::test]
async fn operation_completion_wait_times_out_when_not_finished() {
    let completion = Arc::new(DriveOperationCompletion::default());
    assert!(!completion.wait(Duration::from_millis(10)).await);
}

#[tokio::test]
async fn operation_completion_wait_returns_true_after_concurrent_finish() {
    let completion = Arc::new(DriveOperationCompletion::default());
    let c = completion.clone();
    let handle = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(20)).await;
        c.finish();
    });
    assert!(completion.wait(Duration::from_secs(1)).await);
    handle.await.unwrap();
}

#[test]
fn operation_manager_cancel_returns_false_for_unknown_operation_id() {
    let manager = Arc::new(DriveOperationManager::default());
    assert!(!manager.cancel("user-1", Uuid::new_v4()));
}

#[tokio::test]
async fn operation_manager_cancel_returns_false_for_wrong_user_id() {
    let manager = Arc::new(DriveOperationManager::default());
    let operation_id = Uuid::new_v4();
    let operation = manager
        .register("user-1", operation_id, "sim-1")
        .expect("operation");
    assert!(!manager.cancel("user-2", operation_id));
    drop(operation);
}

#[tokio::test]
async fn operation_manager_cancel_returns_false_for_finalizing_phase() {
    let manager = Arc::new(DriveOperationManager::default());
    let operation_id = Uuid::new_v4();
    let operation = manager
        .register("user-1", operation_id, "sim-1")
        .expect("operation");
    operation.set_phase(DriveOperationPhase::Finalizing);
    assert!(!manager.cancel("user-1", operation_id));
    drop(operation);
}

#[tokio::test]
async fn operation_manager_cancel_and_wait_returns_false_for_unknown_id() {
    let manager = Arc::new(DriveOperationManager::default());
    assert!(
        !manager
            .cancel_and_wait("user-1", Uuid::new_v4(), Duration::from_millis(10))
            .await
    );
}

#[tokio::test]
async fn operation_manager_cancel_and_wait_returns_false_for_wrong_user() {
    let manager = Arc::new(DriveOperationManager::default());
    let operation_id = Uuid::new_v4();
    let operation = manager
        .register("user-1", operation_id, "sim-1")
        .expect("operation");
    assert!(
        !manager
            .cancel_and_wait("user-2", operation_id, Duration::from_millis(10))
            .await
    );
    drop(operation);
}

#[tokio::test]
async fn operation_manager_clear_user_visible_state_hides_and_cancels_allowed_phases() {
    let manager = Arc::new(DriveOperationManager::default());
    let operation_id = Uuid::new_v4();
    let operation = manager
        .register("user-1", operation_id, "sim-1")
        .expect("operation");
    assert!(operation.is_visible());
    manager.clear_user_visible_state("user-1");
    assert!(!operation.is_visible());
    // The cancellation token should be cancelled (Waiting phase is cancellable).
    assert!(operation.cancellation().is_cancelled());
    drop(operation);
}

#[tokio::test]
async fn operation_manager_clear_user_visible_state_skips_other_users() {
    let manager = Arc::new(DriveOperationManager::default());
    let op_a = manager
        .register("user-a", Uuid::new_v4(), "sim-1")
        .expect("op a");
    let op_b = manager
        .register("user-b", Uuid::new_v4(), "sim-2")
        .expect("op b");
    manager.clear_user_visible_state("user-a");
    assert!(!op_a.is_visible());
    assert!(op_b.is_visible(), "other user's state must be untouched");
}

#[tokio::test]
async fn disk_archive_source_open_rejects_symlink() {
    #[cfg(unix)]
    {
        let dir = tempdir().expect("temp dir");
        let real = dir.path().join("real.zip");
        std::fs::write(&real, b"data").expect("write real");
        let link = dir.path().join("link.zip");
        symlink(&real, &link).expect("symlink");
        assert_eq!(
            DiskArchiveSource::open(&link).await.err(),
            Some(DriveApiError::LocalState)
        );
    }
}

#[tokio::test]
async fn disk_archive_source_open_rejects_directory() {
    let dir = tempdir().expect("temp dir");
    let subdir = dir.path().join("not-a-file.zip");
    std::fs::create_dir(&subdir).expect("create dir");
    assert_eq!(
        DiskArchiveSource::open(&subdir).await.err(),
        Some(DriveApiError::LocalState)
    );
}

#[tokio::test]
async fn disk_archive_source_open_rejects_empty_file() {
    let dir = tempdir().expect("temp dir");
    let path = dir.path().join("empty.zip");
    std::fs::write(&path, b"").expect("write empty");
    assert_eq!(
        DiskArchiveSource::open(&path).await.err(),
        Some(DriveApiError::LocalState)
    );
}

#[tokio::test]
async fn disk_archive_source_open_rejects_missing_file() {
    let dir = tempdir().expect("temp dir");
    let path = dir.path().join("nope.zip");
    assert_eq!(
        DiskArchiveSource::open(&path).await.err(),
        Some(DriveApiError::LocalState)
    );
}

#[tokio::test]
async fn disk_archive_source_open_and_read_chunk_succeeds() {
    let dir = tempdir().expect("temp dir");
    let path = dir.path().join("archive.zip");
    let payload = b"hello world archive";
    std::fs::write(&path, payload).expect("write archive");
    let mut source = DiskArchiveSource::open(&path).await.expect("open");
    assert_eq!(source.len(), payload.len() as u64);
    let chunk = source.read_chunk(0, payload.len()).await.expect("read");
    assert_eq!(chunk, payload);
}

#[tokio::test]
async fn disk_archive_source_read_chunk_rejects_zero_chunk_size() {
    let dir = tempdir().expect("temp dir");
    let path = dir.path().join("archive.zip");
    std::fs::write(&path, b"abc").expect("write");
    let mut source = DiskArchiveSource::open(&path).await.expect("open");
    assert_eq!(
        source.read_chunk(0, 0).await.err(),
        Some(DriveApiError::LocalState)
    );
}

#[tokio::test]
async fn disk_archive_source_read_chunk_rejects_offset_beyond_end() {
    let dir = tempdir().expect("temp dir");
    let path = dir.path().join("archive.zip");
    std::fs::write(&path, b"abc").expect("write");
    let mut source = DiskArchiveSource::open(&path).await.expect("open");
    assert_eq!(
        source.read_chunk(100, 10).await.err(),
        Some(DriveApiError::LocalState)
    );
}

#[tokio::test]
async fn disk_archive_source_read_chunk_returns_partial_at_end() {
    let dir = tempdir().expect("temp dir");
    let path = dir.path().join("archive.zip");
    std::fs::write(&path, b"abcdef").expect("write");
    let mut source = DiskArchiveSource::open(&path).await.expect("open");
    // Request 100 bytes from offset 4; only 2 remain.
    let chunk = source.read_chunk(4, 100).await.expect("read");
    assert_eq!(chunk, b"ef");
}

#[test]
fn create_upload_archive_allocates_unique_directories() {
    let cache = tempdir().expect("cache dir");
    let archive_a = create_upload_archive(cache.path()).expect("archive a");
    let archive_b = create_upload_archive(cache.path()).expect("archive b");
    assert_ne!(archive_a.zip_path(), archive_b.zip_path());
    assert!(archive_a.zip_path().parent().unwrap().is_dir());
    assert!(archive_b.zip_path().parent().unwrap().is_dir());
}

#[test]
fn create_upload_archive_cleanup_removes_directory() {
    let cache = tempdir().expect("cache dir");
    let mut archive = create_upload_archive(cache.path()).expect("archive");
    let dir = archive.zip_path().parent().unwrap().to_path_buf();
    assert!(dir.is_dir());
    archive.cleanup();
    assert!(!dir.exists());
}

#[test]
fn create_upload_archive_drop_runs_cleanup() {
    let cache = tempdir().expect("cache dir");
    let dir = {
        let archive = create_upload_archive(cache.path()).expect("archive");
        archive.zip_path().parent().unwrap().to_path_buf()
    };
    assert!(!dir.exists(), "drop must clean up the directory");
}

#[test]
fn cleanup_stale_upload_archives_removes_subdirectories() {
    let cache = tempdir().expect("cache dir");
    let namespace = cache.path().join(UPLOAD_CACHE_NAMESPACE);
    std::fs::create_dir_all(&namespace).expect("namespace");
    std::fs::create_dir(namespace.join("stale-1")).expect("stale-1");
    std::fs::write(namespace.join("stray.txt"), b"x").expect("stray file");
    cleanup_stale_upload_archives(cache.path());
    assert!(!namespace.join("stale-1").exists());
    assert!(!namespace.join("stray.txt").exists());
}

#[test]
fn cleanup_stale_upload_archives_noop_when_namespace_missing() {
    let cache = tempdir().expect("cache dir");
    // No namespace created — should not panic.
    cleanup_stale_upload_archives(cache.path());
}

#[test]
fn validated_upload_namespace_returns_none_when_missing_and_not_creating() {
    let cache = tempdir().expect("cache dir");
    let result = validated_upload_namespace(cache.path(), false).expect("ok");
    assert_eq!(result, None);
}

#[test]
fn validated_upload_namespace_creates_when_requested() {
    let cache = tempdir().expect("cache dir");
    let result = validated_upload_namespace(cache.path(), true).expect("ok");
    assert!(result.is_some());
    assert!(result.unwrap().is_dir());
}

#[tokio::test]
async fn require_public_permission_returns_ok_for_public() {
    let api = ScriptedDriveApi::default();
    api.permissions
        .lock()
        .unwrap()
        .push_back(Ok(PublicPermissionStatus::Public));
    assert_eq!(
        require_public_permission(&api, ACCESS_TOKEN, "file-1").await,
        Ok(())
    );
}

#[tokio::test]
async fn require_public_permission_returns_download_not_public() {
    let api = ScriptedDriveApi::default();
    api.permissions
        .lock()
        .unwrap()
        .push_back(Ok(PublicPermissionStatus::NotPublic));
    assert_eq!(
        require_public_permission(&api, ACCESS_TOKEN, "file-1").await,
        Err(DriveApiError::DownloadNotPublic)
    );
}

#[tokio::test]
async fn require_public_permission_returns_sharing_check_unavailable() {
    let api = ScriptedDriveApi::default();
    api.permissions
        .lock()
        .unwrap()
        .push_back(Ok(PublicPermissionStatus::CheckUnavailable));
    assert_eq!(
        require_public_permission(&api, ACCESS_TOKEN, "file-1").await,
        Err(DriveApiError::SharingCheckUnavailable)
    );
}

#[tokio::test]
async fn compensate_after_final_validation_token_expired_create_returns_retain() {
    let api = ScriptedDriveApi::default();
    let target = DriveUploadTarget::Create {
        generated_id: "gen-1".to_string(),
        folder_id: "folder-1".to_string(),
    };
    let failure = compensate_after_final_validation(
        &api,
        ACCESS_TOKEN,
        &target,
        "file-1",
        DriveApiError::TokenExpired,
    )
    .await;
    assert_eq!(failure.error, DriveApiError::TokenExpired);
    assert_eq!(failure.pending_binding, PendingBindingDisposition::Retain);
    // No delete should be attempted for token-expired.
    assert_eq!(*api.delete_count.lock().unwrap(), 0);
}

#[tokio::test]
async fn compensate_after_final_validation_update_target_no_delete() {
    let api = ScriptedDriveApi::default();
    let target = DriveUploadTarget::Update {
        file_id: "file-1".to_string(),
    };
    let failure = compensate_after_final_validation(
        &api,
        ACCESS_TOKEN,
        &target,
        "file-1",
        DriveApiError::InvalidResponse,
    )
    .await;
    assert_eq!(failure.error, DriveApiError::InvalidResponse);
    assert_eq!(
        failure.pending_binding,
        PendingBindingDisposition::NotApplicable
    );
    assert_eq!(*api.delete_count.lock().unwrap(), 0);
}

#[tokio::test]
async fn compensate_after_final_validation_create_delete_confirmed() {
    let api = ScriptedDriveApi::default();
    api.deletes.lock().unwrap().push_back(Ok(()));
    let target = DriveUploadTarget::Create {
        generated_id: "gen-1".to_string(),
        folder_id: "folder-1".to_string(),
    };
    let failure = compensate_after_final_validation(
        &api,
        ACCESS_TOKEN,
        &target,
        "file-1",
        DriveApiError::InvalidResponse,
    )
    .await;
    assert_eq!(failure.error, DriveApiError::InvalidResponse);
    assert_eq!(
        failure.pending_binding,
        PendingBindingDisposition::DeleteConfirmed
    );
    assert_eq!(*api.delete_count.lock().unwrap(), 1);
}

#[tokio::test]
async fn compensate_after_final_validation_create_delete_not_found_confirms() {
    let api = ScriptedDriveApi::default();
    api.deletes
        .lock()
        .unwrap()
        .push_back(Err(DriveApiError::NotFound));
    let target = DriveUploadTarget::Create {
        generated_id: "gen-1".to_string(),
        folder_id: "folder-1".to_string(),
    };
    let failure = compensate_after_final_validation(
        &api,
        ACCESS_TOKEN,
        &target,
        "file-1",
        DriveApiError::InvalidResponse,
    )
    .await;
    assert_eq!(
        failure.pending_binding,
        PendingBindingDisposition::DeleteConfirmed
    );
}

#[tokio::test]
async fn compensate_after_final_validation_create_delete_failure_retains() {
    let api = ScriptedDriveApi::default();
    api.deletes
        .lock()
        .unwrap()
        .push_back(Err(DriveApiError::Network));
    let target = DriveUploadTarget::Create {
        generated_id: "gen-1".to_string(),
        folder_id: "folder-1".to_string(),
    };
    let failure = compensate_after_final_validation(
        &api,
        ACCESS_TOKEN,
        &target,
        "file-1",
        DriveApiError::InvalidResponse,
    )
    .await;
    assert_eq!(failure.pending_binding, PendingBindingDisposition::Retain);
}

#[tokio::test]
async fn validate_final_file_retries_on_network_then_succeeds() {
    let api = ScriptedDriveApi::default();
    api.files
        .lock()
        .unwrap()
        .push_back(Err(DriveApiError::Network));
    api.files
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedDriveApi::valid_file(
            "file-1",
            Some("https://example.com/x"),
        )));
    api.permissions
        .lock()
        .unwrap()
        .push_back(Ok(PublicPermissionStatus::Public));
    let sleeper = RecordingSleeper::default();
    let result = validate_final_file(&api, &sleeper, ACCESS_TOKEN, "file-1").await;
    assert_eq!(result, Ok("https://example.com/x".to_string()));
    assert!(
        !sleeper.delays.lock().unwrap().is_empty(),
        "slept between retries"
    );
}

#[tokio::test]
async fn validate_final_file_retries_when_download_url_missing() {
    let api = ScriptedDriveApi::default();
    // First attempt: valid file but no web_content_link yet.
    api.files
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedDriveApi::valid_file("file-1", None)));
    // Second attempt: now has the link.
    api.files
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedDriveApi::valid_file(
            "file-1",
            Some("https://example.com/y"),
        )));
    api.permissions
        .lock()
        .unwrap()
        .push_back(Ok(PublicPermissionStatus::Public));
    let sleeper = RecordingSleeper::default();
    let result = validate_final_file(&api, &sleeper, ACCESS_TOKEN, "file-1").await;
    assert_eq!(result, Ok("https://example.com/y".to_string()));
}

#[tokio::test]
async fn validate_final_file_returns_invalid_response_after_exhausting_attempts() {
    let api = ScriptedDriveApi::default();
    // All attempts return a valid file but never with a download URL.
    for _ in 0..MAX_FINAL_METADATA_ATTEMPTS {
        api.files
            .lock()
            .unwrap()
            .push_back(Ok(ScriptedDriveApi::valid_file("file-1", None)));
    }
    let sleeper = RecordingSleeper::default();
    let result = validate_final_file(&api, &sleeper, ACCESS_TOKEN, "file-1").await;
    assert_eq!(result, Err(DriveApiError::InvalidResponse));
}

#[tokio::test]
async fn validate_final_file_propagates_non_retryable_error() {
    let api = ScriptedDriveApi::default();
    api.files
        .lock()
        .unwrap()
        .push_back(Err(DriveApiError::TokenExpired));
    let sleeper = RecordingSleeper::default();
    let result = validate_final_file(&api, &sleeper, ACCESS_TOKEN, "file-1").await;
    assert_eq!(result, Err(DriveApiError::TokenExpired));
}

#[tokio::test]
async fn validate_final_file_retries_on_transient_then_succeeds() {
    let api = ScriptedDriveApi::default();
    api.files
        .lock()
        .unwrap()
        .push_back(Err(DriveApiError::Transient(None)));
    api.files
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedDriveApi::valid_file(
            "file-1",
            Some("https://example.com/z"),
        )));
    api.permissions
        .lock()
        .unwrap()
        .push_back(Ok(PublicPermissionStatus::Public));
    let sleeper = RecordingSleeper::default();
    let result = validate_final_file(&api, &sleeper, ACCESS_TOKEN, "file-1").await;
    assert_eq!(result, Ok("https://example.com/z".to_string()));
}

#[tokio::test]
async fn validate_final_file_retries_on_rate_limited_then_succeeds() {
    let api = ScriptedDriveApi::default();
    api.files
        .lock()
        .unwrap()
        .push_back(Err(DriveApiError::RateLimited(Some(
            Duration::from_millis(5),
        ))));
    api.files
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedDriveApi::valid_file(
            "file-1",
            Some("https://example.com/r"),
        )));
    api.permissions
        .lock()
        .unwrap()
        .push_back(Ok(PublicPermissionStatus::Public));
    let sleeper = RecordingSleeper::default();
    let result = validate_final_file(&api, &sleeper, ACCESS_TOKEN, "file-1").await;
    assert_eq!(result, Ok("https://example.com/r".to_string()));
}

#[tokio::test]
async fn validate_final_file_rejects_mismatched_id_immediately() {
    let api = ScriptedDriveApi::default();
    api.files
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedDriveApi::valid_file("other-id", None)));
    let sleeper = RecordingSleeper::default();
    let result = validate_final_file(&api, &sleeper, ACCESS_TOKEN, "file-1").await;
    assert_eq!(result, Err(DriveApiError::InvalidResponse));
}

#[tokio::test]
async fn validate_final_file_rejects_invalid_download_url() {
    let api = ScriptedDriveApi::default();
    api.files
        .lock()
        .unwrap()
        .push_back(Ok(ScriptedDriveApi::valid_file(
            "file-1",
            Some("http://not-https.com"),
        )));
    let sleeper = RecordingSleeper::default();
    let result = validate_final_file(&api, &sleeper, ACCESS_TOKEN, "file-1").await;
    assert_eq!(result, Err(DriveApiError::InvalidResponse));
}

// ---------------------------------------------------------------------------
// Helper-function mapping tests: pending_store_failure & metadata_error
// ---------------------------------------------------------------------------

#[test]
fn pending_store_failure_maps_insufficient_disk_space() {
    let failure = pending_store_failure(PendingBindingStoreError::InsufficientDiskSpace);
    assert_eq!(failure.error, DriveApiError::InsufficientDiskSpace);
    assert_eq!(failure.pending_binding, PendingBindingDisposition::Retain);
}

#[test]
fn pending_store_failure_maps_local_state() {
    let failure = pending_store_failure(PendingBindingStoreError::LocalState);
    assert_eq!(failure.error, DriveApiError::LocalState);
    assert_eq!(failure.pending_binding, PendingBindingDisposition::Retain);
}

#[test]
fn metadata_error_maps_definitive_unavailable() {
    assert_eq!(
        metadata_error(DriveMetadataError::DefinitiveUnavailable),
        DriveApiError::SimfileUnavailable
    );
}

#[test]
fn metadata_error_maps_binding_mismatch() {
    assert_eq!(
        metadata_error(DriveMetadataError::BindingMismatch),
        DriveApiError::MetadataSync
    );
}

#[test]
fn metadata_error_maps_authentication() {
    assert_eq!(
        metadata_error(DriveMetadataError::Authentication),
        DriveApiError::TokenExpired
    );
}

#[test]
fn metadata_error_maps_network() {
    assert_eq!(
        metadata_error(DriveMetadataError::Network),
        DriveApiError::Network
    );
}

#[test]
fn metadata_error_maps_service_unavailable() {
    assert_eq!(
        metadata_error(DriveMetadataError::ServiceUnavailable),
        DriveApiError::MetadataSync
    );
}

#[test]
fn metadata_error_maps_invalid_response() {
    assert_eq!(
        metadata_error(DriveMetadataError::InvalidResponse),
        DriveApiError::InvalidResponse
    );
}

#[test]
fn metadata_error_maps_local_state() {
    assert_eq!(
        metadata_error(DriveMetadataError::LocalState),
        DriveApiError::LocalState
    );
}

// ---------------------------------------------------------------------------
// Retry-loop exhaustion tests: start_update_with_retry
// ---------------------------------------------------------------------------

fn push_start_errors(api: &ScriptedDriveApi, error: DriveApiError, count: usize) {
    let mut starts = api.starts.lock().expect("start responses");
    for _ in 0..count {
        starts.push_back(Err(error.clone()));
    }
}

#[tokio::test]
async fn start_update_with_retry_exhausts_network_retries() {
    let api = ScriptedDriveApi::default();
    push_start_errors(&api, DriveApiError::Network, MAX_UPLOAD_RETRIES + 1);
    let sleeper = RecordingSleeper::default();
    let metadata = DriveUpdateMetadata {
        name: "test.zip".to_string(),
    };
    let result = start_update_with_retry(
        &api,
        &sleeper,
        ACCESS_TOKEN,
        "file-1",
        &metadata,
        1024,
        None,
    )
    .await;
    assert!(matches!(result, Err(DriveApiError::Network)));
    assert_eq!(
        api.start_tokens.lock().expect("start tokens").len(),
        MAX_UPLOAD_RETRIES + 1
    );
    assert_eq!(
        sleeper.delays.lock().expect("delays").len(),
        MAX_UPLOAD_RETRIES
    );
}

#[tokio::test]
async fn start_update_with_retry_exhausts_transient_retries() {
    let api = ScriptedDriveApi::default();
    push_start_errors(&api, DriveApiError::Transient(None), MAX_UPLOAD_RETRIES + 1);
    let sleeper = RecordingSleeper::default();
    let metadata = DriveUpdateMetadata {
        name: "test.zip".to_string(),
    };
    let result = start_update_with_retry(
        &api,
        &sleeper,
        ACCESS_TOKEN,
        "file-1",
        &metadata,
        1024,
        None,
    )
    .await;
    assert!(matches!(result, Err(DriveApiError::Transient(None))));
    assert_eq!(
        sleeper.delays.lock().expect("delays").len(),
        MAX_UPLOAD_RETRIES
    );
}

#[tokio::test]
async fn start_update_with_retry_exhausts_rate_limited_retries() {
    let api = ScriptedDriveApi::default();
    push_start_errors(
        &api,
        DriveApiError::RateLimited(None),
        MAX_UPLOAD_RETRIES + 1,
    );
    let sleeper = RecordingSleeper::default();
    let metadata = DriveUpdateMetadata {
        name: "test.zip".to_string(),
    };
    let result = start_update_with_retry(
        &api,
        &sleeper,
        ACCESS_TOKEN,
        "file-1",
        &metadata,
        1024,
        None,
    )
    .await;
    assert!(matches!(result, Err(DriveApiError::RateLimited(None))));
    assert_eq!(
        sleeper.delays.lock().expect("delays").len(),
        MAX_UPLOAD_RETRIES
    );
}

// ---------------------------------------------------------------------------
// Retry-loop exhaustion tests: query_status_with_retry
// ---------------------------------------------------------------------------

fn push_status_errors(api: &ScriptedDriveApi, error: DriveApiError, count: usize) {
    let mut statuses = api.statuses.lock().expect("status responses");
    for _ in 0..count {
        statuses.push_back(Err(error.clone()));
    }
}

#[tokio::test]
async fn query_status_with_retry_exhausts_network_retries() {
    let api = ScriptedDriveApi::default();
    push_status_errors(&api, DriveApiError::Network, MAX_UPLOAD_RETRIES + 1);
    let sleeper = RecordingSleeper::default();
    let session = ResumableUploadSession::for_test("https://upload.test/session").unwrap();
    let result = query_status_with_retry(&api, &sleeper, ACCESS_TOKEN, &session, 1024, None).await;
    assert!(matches!(result, Err(DriveApiError::Network)));
    assert_eq!(
        sleeper.delays.lock().expect("delays").len(),
        MAX_UPLOAD_RETRIES
    );
}

#[tokio::test]
async fn query_status_with_retry_exhausts_transient_retries() {
    let api = ScriptedDriveApi::default();
    push_status_errors(&api, DriveApiError::Transient(None), MAX_UPLOAD_RETRIES + 1);
    let sleeper = RecordingSleeper::default();
    let session = ResumableUploadSession::for_test("https://upload.test/session").unwrap();
    let result = query_status_with_retry(&api, &sleeper, ACCESS_TOKEN, &session, 1024, None).await;
    assert!(matches!(result, Err(DriveApiError::Transient(None))));
    assert_eq!(
        sleeper.delays.lock().expect("delays").len(),
        MAX_UPLOAD_RETRIES
    );
}

#[tokio::test]
async fn query_status_with_retry_exhausts_rate_limited_retries() {
    let api = ScriptedDriveApi::default();
    push_status_errors(
        &api,
        DriveApiError::RateLimited(None),
        MAX_UPLOAD_RETRIES + 1,
    );
    let sleeper = RecordingSleeper::default();
    let session = ResumableUploadSession::for_test("https://upload.test/session").unwrap();
    let result = query_status_with_retry(&api, &sleeper, ACCESS_TOKEN, &session, 1024, None).await;
    assert!(matches!(result, Err(DriveApiError::RateLimited(None))));
    assert_eq!(
        sleeper.delays.lock().expect("delays").len(),
        MAX_UPLOAD_RETRIES
    );
}

// ---------------------------------------------------------------------------
// Cache namespace function tests (complementing existing coverage)
// ---------------------------------------------------------------------------

#[test]
fn cleanup_stale_upload_archives_preserves_files_outside_namespace() {
    let cache = tempdir().expect("cache dir");
    let namespace = cache.path().join(UPLOAD_CACHE_NAMESPACE);
    std::fs::create_dir_all(&namespace).expect("create namespace");

    let stale_dir = namespace.join("stale-session");
    std::fs::create_dir_all(&stale_dir).expect("create stale dir");
    std::fs::write(stale_dir.join("upload.zip"), b"data").expect("write stale zip");

    let outside_file = cache.path().join("outside.txt");
    std::fs::write(&outside_file, b"outside").expect("write outside file");

    cleanup_stale_upload_archives(cache.path());

    assert!(!stale_dir.exists());
    assert!(outside_file.exists(), "file outside namespace must survive");
    assert!(namespace.exists(), "namespace itself must survive");
}

#[test]
fn remove_upload_directory_removes_directory_within_namespace() {
    let cache = tempdir().expect("cache dir");
    let namespace = cache.path().join(UPLOAD_CACHE_NAMESPACE);
    std::fs::create_dir_all(&namespace).expect("create namespace");

    let target = namespace.join("session-to-remove");
    std::fs::create_dir_all(&target).expect("create target dir");
    std::fs::write(target.join("upload.zip"), b"data").expect("write zip");

    remove_upload_directory(&target);
    assert!(
        !target.exists(),
        "directory within namespace should be removed"
    );
}

#[test]
fn remove_upload_directory_refuses_to_remove_outside_namespace() {
    let cache = tempdir().expect("cache dir");
    let namespace = cache.path().join(UPLOAD_CACHE_NAMESPACE);
    std::fs::create_dir_all(&namespace).expect("create namespace");

    let outside = cache.path().join("outside-dir");
    std::fs::create_dir_all(&outside).expect("create outside dir");

    remove_upload_directory(&outside);
    assert!(outside.exists(), "directory outside namespace must survive");
}

#[test]
fn validated_upload_namespace_errors_when_namespace_is_file() {
    let cache = tempdir().expect("cache dir");
    let namespace = cache.path().join(UPLOAD_CACHE_NAMESPACE);
    std::fs::write(&namespace, b"not a dir").expect("create file");

    let result = validated_upload_namespace(cache.path(), false);
    assert!(result.is_err(), "file in place of namespace should error");
}

#[test]
fn validated_upload_namespace_errors_when_namespace_is_file_even_if_create_requested() {
    let cache = tempdir().expect("cache dir");
    let namespace = cache.path().join(UPLOAD_CACHE_NAMESPACE);
    std::fs::write(&namespace, b"not a dir").expect("create file");

    let result = validated_upload_namespace(cache.path(), true);
    assert!(result.is_err(), "existing file should not be overwritten");
}

#[cfg(unix)]
#[test]
fn validated_upload_namespace_errors_when_namespace_is_symlink() {
    let cache = tempdir().expect("cache dir");
    let real_dir = cache.path().join("real-dir");
    std::fs::create_dir_all(&real_dir).expect("create real dir");
    let namespace = cache.path().join(UPLOAD_CACHE_NAMESPACE);
    symlink(&real_dir, &namespace).expect("create symlink");

    let result = validated_upload_namespace(cache.path(), false);
    assert!(result.is_err(), "symlink namespace should be rejected");
}
