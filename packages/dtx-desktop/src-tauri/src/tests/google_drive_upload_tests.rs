use super::*;
use crate::google_drive::drive_client::{
    DriveApiError, DriveChunkResult, DriveCreateMetadata, DriveFile, DriveUpdateMetadata,
    GoogleDriveApi, PublicPermissionStatus, ResumableUploadSession, ValidatedFolder,
};
use async_trait::async_trait;
use std::collections::VecDeque;
#[cfg(unix)]
use std::os::unix::fs::symlink;
use std::sync::Mutex;
use std::time::Duration;
use tempfile::tempdir;

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
    delete_count: Mutex<usize>,
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
        Self::take(&self.generated_ids)
    }

    async fn get_file(&self, _access_token: &str, _file_id: &str) -> DriveResult<DriveFile> {
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
        _access_token: &str,
        _item_id: &str,
    ) -> DriveResult<PublicPermissionStatus> {
        Self::take(&self.permissions)
    }

    async fn start_resumable_create(
        &self,
        _access_token: &str,
        metadata: &DriveCreateMetadata,
        _total_bytes: u64,
    ) -> DriveResult<ResumableUploadSession> {
        self.create_metadata
            .lock()
            .expect("create metadata")
            .push(metadata.clone());
        let mut starts = self.starts.lock().expect("start responses");
        if let Some(result) = starts.pop_front() {
            result
        } else {
            ResumableUploadSession::for_test("https://upload.test/create")
        }
    }

    async fn start_resumable_update(
        &self,
        _access_token: &str,
        file_id: &str,
        metadata: &DriveUpdateMetadata,
        _total_bytes: u64,
    ) -> DriveResult<ResumableUploadSession> {
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
        Self::take(&self.chunks)
    }

    async fn query_session_status(
        &self,
        _access_token: &str,
        _session: &ResumableUploadSession,
        _total_bytes: u64,
    ) -> DriveResult<DriveChunkResult> {
        Self::take(&self.statuses)
    }

    async fn delete_file(&self, _access_token: &str, _file_id: &str) -> DriveResult<()> {
        *self.delete_count.lock().expect("delete count") += 1;
        Self::take(&self.deletes)
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

fn create_request(bytes: &[u8]) -> DriveUploadRequest {
    DriveUploadRequest {
        simfile_id: "sim-42".to_string(),
        saved_title: "AC/DC".to_string(),
        archive: bytes.to_vec(),
        target: DriveUploadTarget::Create {
            generated_id: "generated-file-id".to_string(),
            folder_id: "folder-42".to_string(),
        },
    }
}

fn update_request(bytes: &[u8]) -> DriveUploadRequest {
    DriveUploadRequest {
        simfile_id: "sim-42".to_string(),
        saved_title: "Song: Reprise".to_string(),
        archive: bytes.to_vec(),
        target: DriveUploadTarget::Update {
            file_id: "existing-file".to_string(),
        },
    }
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
    api.chunks
        .lock()
        .unwrap()
        .push_back(Ok(DriveChunkResult::Complete));
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

    let result = run_resumable_upload_for_test(
        &api,
        &sleeper,
        ACCESS_TOKEN,
        create_request(b"archive"),
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
    assert_eq!(progress, vec![(7, 7)]);
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
    api.chunks
        .lock()
        .unwrap()
        .push_back(Ok(DriveChunkResult::Complete));
    let sleeper = RecordingSleeper::default();

    let result = run_resumable_upload_for_test(
        &api,
        &sleeper,
        ACCESS_TOKEN,
        update_request(b"replacement"),
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

    run_resumable_upload_for_test(
        &api,
        &sleeper,
        ACCESS_TOKEN,
        create_request(b"0123456789"),
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

    let result = run_resumable_upload_for_test(
        &api,
        &sleeper,
        ACCESS_TOKEN,
        create_request(b"zip"),
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

        let failure = run_resumable_upload_for_test(
            &api,
            &RecordingSleeper::default(),
            ACCESS_TOKEN,
            create_request(b"zip"),
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

    let failure = run_resumable_upload_for_test(
        &api,
        &RecordingSleeper::default(),
        ACCESS_TOKEN,
        update_request(b"zip"),
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

    run_resumable_upload_for_test(
        &api,
        &sleeper,
        ACCESS_TOKEN,
        create_request(b"zip"),
        4,
        |accepted, _| progress.push(accepted),
    )
    .await
    .expect("retry succeeds");

    assert_eq!(progress, vec![3]);
    assert_eq!(
        sleeper.delays.lock().unwrap().as_slice(),
        &[Duration::from_millis(100), Duration::from_secs(5)]
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

        let failure = run_resumable_upload_for_test(
            &api,
            &RecordingSleeper::default(),
            ACCESS_TOKEN,
            create_request(b"zip"),
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

    let failure = run_resumable_upload_for_test(
        &api,
        &RecordingSleeper::default(),
        ACCESS_TOKEN,
        update_request(b"replacement"),
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
        Err(DriveApiError::Transient(None)),
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

    run_resumable_upload_for_test(
        &api,
        &sleeper,
        ACCESS_TOKEN,
        create_request(b"zip"),
        4,
        |_, _| {},
    )
    .await
    .expect("session retry");

    assert_eq!(api.create_metadata.lock().unwrap().len(), 3);
    assert_eq!(
        sleeper.delays.lock().unwrap().as_slice(),
        &[Duration::from_millis(100), Duration::from_secs(5)]
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

    let result = run_resumable_upload_for_test(
        &api,
        &sleeper,
        ACCESS_TOKEN,
        create_request(b"zip"),
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
