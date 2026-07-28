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
use crate::google_drive::fake::{E2eGoogleDriveFake, E2E_PUBLIC_FOLDER_ID};
use crate::google_drive::settings::GoogleDriveFolderSetting;
use crate::google_drive::GoogleDriveState;
use crate::models::{E2eDriveControl, E2eDriveOwnerSeed, E2eExistingFileFailure};
use crate::workspace::test_support::managed_workspace_state;

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
    assert_eq!(snapshot.owner.google_drive_file_id.as_deref(), Some(EXISTING_FILE_ID));
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

    assert!(connect_google_drive_and_choose_folder(fixture.app.clone())
        .await
        .is_err());
    assert!(change_google_drive_folder(fixture.app.clone())
        .await
        .is_err());
    let connection = recheck_google_drive_sharing(fixture.app)
        .await
        .expect("sharing recheck");
    assert!(connection.connected);
    assert!(connection.folder_is_public);
}
