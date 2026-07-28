use std::ffi::OsString;
use std::sync::Arc;

use serde_json::json;
use tauri::{AppHandle, Manager};
use tempfile::TempDir;
use uuid::Uuid;

use crate::auth::AuthState;
use crate::google_drive::commands::{
    change_google_drive_folder, connect_google_drive_and_choose_folder,
    recheck_google_drive_sharing, upload_song_zip_to_google_drive, GoogleDriveErrorCode,
    UploadSongZipToGoogleDriveInput,
};
use crate::google_drive::drive_client::{
    DriveApiError, DriveChunkResult, DriveCreateMetadata, GoogleDriveApi,
};
use crate::google_drive::fake::{E2eDriveScenario, E2eGoogleDriveFake, E2E_PUBLIC_FOLDER_ID};
use crate::google_drive::oauth::{GoogleOAuthProvider, OAuthProviderError, TokenExchangeRequest};
use crate::google_drive::settings::GoogleDriveFolderSetting;
use crate::google_drive::GoogleDriveState;
use crate::models::{E2eDriveControl, E2eDriveOwnerSeed, E2eExistingFileFailure};
use crate::workspace::test_support::managed_workspace_state;
use zeroize::Zeroizing;

const USER_ID: &str = "command-coverage-user";
const SIMFILE_ID: &str = "sim-42";
const EXISTING_FILE_ID: &str = "existing-drive-file";

struct CommandFixture {
    _data_dir: TempDir,
    _workspace: TempDir,
    app: AppHandle<tauri::test::MockRuntime>,
    fake: Arc<E2eGoogleDriveFake>,
}

impl CommandFixture {
    async fn new(
        drive_file_id: Option<&str>,
        existing_file_failure: E2eExistingFileFailure,
    ) -> Self {
        let data_dir = tempfile::tempdir().expect("temporary E2E data directory");
        let workspace = tempfile::tempdir().expect("temporary workspace");
        let song = workspace.path().join("pack").join("song");
        std::fs::create_dir_all(&song).expect("song directory");
        std::fs::write(
            song.join("mas.dtx"),
            b"#TITLE: Command coverage song\n#BPM: 120\n",
        )
        .expect("DTX fixture");
        std::fs::write(song.join("bgm.ogg"), b"fixture audio").expect("audio fixture");

        let drive = GoogleDriveState::e2e_from_data_dir_value(
            USER_ID,
            Some(OsString::from(data_dir.path())),
        )
        .expect("E2E Drive state");
        drive
            .settings
            .set_folder_for_user(
                USER_ID,
                GoogleDriveFolderSetting {
                    id: E2E_PUBLIC_FOLDER_ID.to_string(),
                    name: "E2E Public Folder".to_string(),
                },
            )
            .expect("Drive folder setting");
        let fake = drive.e2e_fake.clone().expect("E2E fake");
        fake.configure(E2eDriveControl {
            reset: true,
            owner: Some(E2eDriveOwnerSeed {
                simfile_id: SIMFILE_ID.to_string(),
                cloud_title: "Command Coverage Song".to_string(),
                google_drive_file_id: drive_file_id.map(str::to_string),
                download_url: drive_file_id
                    .map(|id| format!("https://drive.google.com/uc?id={id}")),
            }),
            existing_file_failure,
            public_permission: Some(true),
            terminate_before_metadata_patch: Some(false),
        })
        .await
        .expect("configure E2E fake");
        if let Some(file_id) = drive_file_id {
            fake.seed_object(file_id, "old-song.zip", b"old archive".to_vec())
                .await
                .expect("seed existing Drive object");
        }

        let app = tauri::test::mock_app();
        app.manage(AuthState::for_e2e_user(USER_ID).expect("E2E auth"));
        app.manage(drive);
        app.manage(managed_workspace_state(workspace.path()));

        Self {
            _data_dir: data_dir,
            _workspace: workspace,
            app: app.handle().clone(),
            fake,
        }
    }

    fn input(force_create_replacement: bool) -> UploadSongZipToGoogleDriveInput {
        serde_json::from_value(json!({
            "operationId": Uuid::new_v4(),
            "simfileId": SIMFILE_ID,
            "songRelativePath": "pack/song",
            "forceCreateReplacement": force_create_replacement
        }))
        .expect("valid upload command input")
    }
}

#[tokio::test]
async fn upload_command_updates_an_existing_drive_object_and_metadata() {
    let fixture = CommandFixture::new(Some(EXISTING_FILE_ID), E2eExistingFileFailure::None).await;

    let result = upload_song_zip_to_google_drive(fixture.app.clone(), CommandFixture::input(false))
        .await
        .expect("upload command result");

    assert!(result.success);
    assert_eq!(result.file_id.as_deref(), Some(EXISTING_FILE_ID));
    assert_eq!(result.replaced_existing_file, Some(false));
    let snapshot = fixture.fake.snapshot().await.expect("Drive snapshot");
    assert_eq!(snapshot.update_count, 1);
    assert_eq!(snapshot.create_count, 0);
    assert_eq!(snapshot.metadata_mutations.len(), 1);
    assert_eq!(
        snapshot.owner.google_drive_file_id.as_deref(),
        Some(EXISTING_FILE_ID)
    );
}

#[tokio::test]
async fn upload_command_creates_a_replacement_after_a_permanent_not_found() {
    let fixture =
        CommandFixture::new(Some(EXISTING_FILE_ID), E2eExistingFileFailure::NotFound).await;

    let result = upload_song_zip_to_google_drive(fixture.app.clone(), CommandFixture::input(true))
        .await
        .expect("replacement upload result");

    assert!(result.success);
    assert_eq!(result.replaced_existing_file, Some(true));
    assert_ne!(result.file_id.as_deref(), Some(EXISTING_FILE_ID));
    let snapshot = fixture.fake.snapshot().await.expect("Drive snapshot");
    assert_eq!(snapshot.create_count, 1);
    assert_eq!(snapshot.metadata_mutations.len(), 1);
    assert_eq!(snapshot.owner.google_drive_file_id, result.file_id);
}

#[tokio::test]
async fn upload_command_preserves_the_existing_binding_when_replacement_is_not_allowed() {
    let fixture =
        CommandFixture::new(Some(EXISTING_FILE_ID), E2eExistingFileFailure::NotFound).await;

    let result = upload_song_zip_to_google_drive(fixture.app.clone(), CommandFixture::input(false))
        .await
        .expect("failed upload result");

    assert!(!result.success);
    assert_eq!(result.error_code, Some(GoogleDriveErrorCode::FileNotFound));
    let snapshot = fixture.fake.snapshot().await.expect("Drive snapshot");
    assert_eq!(snapshot.create_count, 0);
    assert!(snapshot.metadata_mutations.is_empty());
    assert_eq!(
        snapshot.owner.google_drive_file_id.as_deref(),
        Some(EXISTING_FILE_ID)
    );
}

#[tokio::test]
async fn connection_command_wrappers_preserve_adapter_results() {
    let fixture = CommandFixture::new(None, E2eExistingFileFailure::None).await;

    // The e2e fixture authenticates a user but configures the picker with
    // an empty OAuth client id, so connect_and_choose_folder fails inside
    // authorization_url with InvalidResponse. The command wrappers must
    // preserve that specific adapter classification rather than collapsing
    // it to a generic error.
    let connect_error = match connect_google_drive_and_choose_folder(fixture.app.clone()).await {
        Err(error) => error,
        Ok(_) => panic!("connect must fail without a configured OAuth client"),
    };
    assert!(
        matches!(
            connect_error,
            crate::error::DesktopError::Message(ref message)
                if message == "INVALID_RESPONSE"
        ),
        "connect wrapper must preserve the InvalidResponse adapter error, got {connect_error:?}"
    );
    let change_error = match change_google_drive_folder(fixture.app.clone()).await {
        Err(error) => error,
        Ok(_) => panic!("change folder must fail without a configured OAuth client"),
    };
    assert!(
        matches!(
            change_error,
            crate::error::DesktopError::Message(ref message)
                if message == "INVALID_RESPONSE"
        ),
        "change folder wrapper must preserve the InvalidResponse adapter error, got {change_error:?}"
    );
    let connection = recheck_google_drive_sharing(fixture.app)
        .await
        .expect("sharing recheck");
    assert!(connection.connected);
    assert!(!connection.requires_public_sharing);
}

#[tokio::test]
async fn upload_command_creates_a_new_drive_object_when_no_existing_file_is_bound() {
    let fixture = CommandFixture::new(None, E2eExistingFileFailure::None).await;

    let result = upload_song_zip_to_google_drive(fixture.app.clone(), CommandFixture::input(false))
        .await
        .expect("create upload result");

    assert!(result.success);
    assert_eq!(result.replaced_existing_file, Some(false));
    assert!(result.file_id.is_some());
    let snapshot = fixture.fake.snapshot().await.expect("Drive snapshot");
    assert_eq!(snapshot.create_count, 1);
    assert_eq!(snapshot.update_count, 0);
    assert_eq!(snapshot.metadata_mutations.len(), 1);
    assert_eq!(snapshot.owner.google_drive_file_id, result.file_id);
}

#[tokio::test]
async fn upload_command_creates_a_replacement_after_a_permanent_permission_denied() {
    let fixture = CommandFixture::new(
        Some(EXISTING_FILE_ID),
        E2eExistingFileFailure::PermissionDenied,
    )
    .await;

    let result = upload_song_zip_to_google_drive(fixture.app.clone(), CommandFixture::input(true))
        .await
        .expect("replacement upload result");

    assert!(result.success);
    assert_eq!(result.replaced_existing_file, Some(true));
    assert_ne!(result.file_id.as_deref(), Some(EXISTING_FILE_ID));
    let snapshot = fixture.fake.snapshot().await.expect("Drive snapshot");
    assert_eq!(snapshot.create_count, 1);
    assert_eq!(snapshot.metadata_mutations.len(), 1);
    assert_eq!(snapshot.owner.google_drive_file_id, result.file_id);
}

#[tokio::test]
async fn upload_command_returns_simfile_unavailable_when_owner_id_mismatches() {
    let fixture = CommandFixture::new(None, E2eExistingFileFailure::None).await;
    // Reconfigure the fake without a reset so the owner simfile id no longer
    // matches the upload input. This exercises the non-reset configure branch
    // and the owner-identity mismatch guard in the upload transaction.
    fixture
        .fake
        .configure(E2eDriveControl {
            reset: false,
            owner: Some(E2eDriveOwnerSeed {
                simfile_id: "different-simfile".to_string(),
                cloud_title: "Other Song".to_string(),
                google_drive_file_id: None,
                download_url: None,
            }),
            existing_file_failure: E2eExistingFileFailure::None,
            public_permission: Some(true),
            terminate_before_metadata_patch: Some(false),
        })
        .await
        .expect("reconfigure fake");

    let result = upload_song_zip_to_google_drive(fixture.app.clone(), CommandFixture::input(false))
        .await
        .expect("upload result");

    assert!(!result.success);
    assert_eq!(
        result.error_code,
        Some(GoogleDriveErrorCode::SimfileUnavailable)
    );
    let snapshot = fixture.fake.snapshot().await.expect("Drive snapshot");
    assert!(snapshot.metadata_mutations.is_empty());
}

#[tokio::test]
async fn fake_reset_removes_an_existing_namespace_directory_before_clearing_state() {
    let data = tempfile::tempdir().expect("data dir");
    let fake = E2eGoogleDriveFake::new(data.path().to_path_buf()).expect("fake");
    fake.seed_object("file-1", "song.zip", b"bytes".to_vec())
        .await
        .expect("seed object");
    // The namespace directory now exists, so reset takes the Ok arm of
    // remove_dir_all before clearing persistent state.
    fake.reset(E2eDriveScenario::default())
        .await
        .expect("reset");
    let snapshot = fake.snapshot().await.expect("Drive snapshot");
    assert!(snapshot.objects.is_empty());
}

#[tokio::test]
async fn fake_seed_object_rejects_an_invalid_identifier() {
    let data = tempfile::tempdir().expect("data dir");
    let fake = E2eGoogleDriveFake::new(data.path().to_path_buf()).expect("fake");
    assert!(fake
        .seed_object("bad id!", "song.zip", b"bytes".to_vec())
        .await
        .is_err());
    assert!(fake
        .seed_object("", "song.zip", b"bytes".to_vec())
        .await
        .is_err());
}

#[tokio::test]
async fn fake_start_resumable_create_rejects_a_zero_byte_upload() {
    let data = tempfile::tempdir().expect("data dir");
    let fake = E2eGoogleDriveFake::new(data.path().to_path_buf()).expect("fake");
    let error = fake
        .start_resumable_create(
            "ignored-e2e-access-token",
            &DriveCreateMetadata {
                id: "file-1".to_string(),
                parent_id: E2E_PUBLIC_FOLDER_ID.to_string(),
                name: "song.zip".to_string(),
            },
            0,
        )
        .await
        .expect_err("zero-byte create must be rejected");
    assert_eq!(error, DriveApiError::InvalidResponse);
}

#[tokio::test]
async fn fake_complete_session_rejects_a_create_that_collides_with_an_existing_object() {
    let data = tempfile::tempdir().expect("data dir");
    let fake = E2eGoogleDriveFake::new(data.path().to_path_buf()).expect("fake");
    fake.seed_object("file-1", "song.zip", b"old".to_vec())
        .await
        .expect("seed existing object");
    let session = fake
        .start_resumable_create(
            "ignored-e2e-access-token",
            &DriveCreateMetadata {
                id: "file-1".to_string(),
                parent_id: E2E_PUBLIC_FOLDER_ID.to_string(),
                name: "song.zip".to_string(),
            },
            3,
        )
        .await
        .expect("start create session");
    let error = fake
        .upload_chunk("ignored-e2e-access-token", &session, 0, b"new", 3)
        .await
        .expect_err("colliding create must be rejected");
    assert_eq!(error, DriveApiError::InvalidGeneratedId);
}

#[tokio::test]
async fn fake_query_session_status_reports_accepted_bytes_for_an_in_flight_upload() {
    let data = tempfile::tempdir().expect("data dir");
    let fake = E2eGoogleDriveFake::new(data.path().to_path_buf()).expect("fake");
    let session = fake
        .start_resumable_create(
            "ignored-e2e-access-token",
            &DriveCreateMetadata {
                id: "file-1".to_string(),
                parent_id: E2E_PUBLIC_FOLDER_ID.to_string(),
                name: "song.zip".to_string(),
            },
            10,
        )
        .await
        .expect("start create session");
    fake.upload_chunk("ignored-e2e-access-token", &session, 0, b"PK12", 10)
        .await
        .expect("partial chunk");
    let status = fake
        .query_session_status("ignored-e2e-access-token", &session, 10)
        .await
        .expect("session status");
    assert_eq!(status, DriveChunkResult::Accepted(4));
}

#[tokio::test]
async fn fake_delete_file_removes_a_seeded_object_and_increments_delete_count() {
    let data = tempfile::tempdir().expect("data dir");
    let fake = E2eGoogleDriveFake::new(data.path().to_path_buf()).expect("fake");
    fake.seed_object("file-1", "song.zip", b"bytes".to_vec())
        .await
        .expect("seed object");
    fake.delete_file("ignored-e2e-access-token", "file-1")
        .await
        .expect("delete file");
    assert!(fake
        .get_file("ignored-e2e-access-token", "file-1")
        .await
        .is_err());
    let snapshot = fake.snapshot().await.expect("Drive snapshot");
    assert_eq!(snapshot.delete_count, 1);
    assert!(snapshot.objects.is_empty());
}

#[tokio::test]
async fn fake_oauth_provider_exchange_code_always_fails_and_revoke_succeeds() {
    let data = tempfile::tempdir().expect("data dir");
    let fake = E2eGoogleDriveFake::new(data.path().to_path_buf()).expect("fake");
    assert!(matches!(
        fake.exchange_code(TokenExchangeRequest {
            code: Zeroizing::new("code".to_string()),
            pkce_verifier: Zeroizing::new("verifier".to_string()),
            redirect_uri: "http://localhost".to_string(),
        })
        .await,
        Err(OAuthProviderError::InvalidResponse)
    ));
    assert!(fake
        .revoke_refresh_token("ignored-refresh-token")
        .await
        .is_ok());
}

#[tokio::test]
async fn fake_snapshot_returns_empty_zip_entries_when_the_object_file_is_missing() {
    let data = tempfile::tempdir().expect("data dir");
    let fake = E2eGoogleDriveFake::new(data.path().to_path_buf()).expect("fake");
    fake.seed_object("file-1", "song.zip", b"bytes".to_vec())
        .await
        .expect("seed object");
    // Remove the object file from disk without going through the fake so the
    // snapshot's zip-entry reader takes the missing-file arm.
    std::fs::remove_file(fake.object_path("file-1")).expect("remove object file");
    let snapshot = fake.snapshot().await.expect("Drive snapshot");
    assert_eq!(snapshot.objects.len(), 1);
    assert!(snapshot.objects[0].zip_entries.is_empty());
}
