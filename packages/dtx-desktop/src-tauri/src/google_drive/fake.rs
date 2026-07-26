use std::collections::HashMap;
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::drive_client::{
    DriveApiError, DriveChunkResult, DriveCreateMetadata, DriveFile, DriveUpdateMetadata,
    GoogleDriveApi, PublicPermissionStatus, ResumableUploadSession, ValidatedFolder,
};
use super::oauth::{
    GoogleDriveOAuthError, GoogleOAuthProvider, OAuthProviderError, OAuthTokenResponse,
    PickerFolderValidator, TokenExchangeRequest, GOOGLE_DRIVE_FILE_SCOPE,
};
use super::settings::GoogleDriveFolderSetting;
use super::{DriveMetadataClient, DriveMetadataError, OwnerDriveSimfile};
use crate::auth::AuthState;
use crate::error::{DesktopError, Result};
use crate::models::{
    E2eDriveCallSnapshot, E2eDriveControl, E2eDriveMetadataMutationSnapshot,
    E2eDriveObjectSnapshot, E2eDriveOwnerSeed, E2eDriveProgressSnapshot, E2eDriveSnapshot,
    E2eDriveZipEntrySnapshot, E2eExistingFileFailure,
};
use crate::native_persistence::write_json_atomic;

pub(crate) const E2E_DEFAULT_SIMFILE_ID: &str = "311001";
pub(crate) const E2E_DEFAULT_CLOUD_TITLE: &str = "Critical Workspace Song";
pub(crate) const E2E_PUBLIC_FOLDER_ID: &str = "e2e-public-folder";
const E2E_ACCESS_TOKEN: &str = "e2e-google-drive-access-token";
const E2E_STATE_FILE: &str = "state.json";
const E2E_NAMESPACE: &str = "google-drive-e2e-fake";

#[derive(Debug, Clone)]
pub(crate) struct E2eDriveScenario {
    owner: OwnerDriveSimfile,
    pub(crate) existing_file_failure: Option<E2eExistingFileFailure>,
    pub(crate) public_permission: bool,
    terminate_before_metadata_patch: bool,
}

impl E2eDriveScenario {
    pub(crate) fn new(owner: OwnerDriveSimfile) -> Self {
        Self {
            owner,
            existing_file_failure: None,
            public_permission: true,
            terminate_before_metadata_patch: false,
        }
    }
}

impl Default for E2eDriveScenario {
    fn default() -> Self {
        Self::new(OwnerDriveSimfile {
            id: E2E_DEFAULT_SIMFILE_ID.to_string(),
            title: E2E_DEFAULT_CLOUD_TITLE.to_string(),
            google_drive_file_id: None,
            download_url: None,
        })
    }
}

#[derive(Debug, Default)]
struct RuntimeState {
    scenario: E2eDriveScenario,
    sessions: HashMap<String, InFlightUpload>,
    calls: Vec<E2eDriveCallSnapshot>,
    metadata_mutations: Vec<E2eDriveMetadataMutationSnapshot>,
    progress: Vec<E2eDriveProgressSnapshot>,
    generate_count: u64,
    create_count: u64,
    update_count: u64,
    delete_count: u64,
    session_sequence: u64,
}

#[derive(Debug)]
struct InFlightUpload {
    file_id: String,
    parent_id: String,
    name: String,
    total_bytes: u64,
    bytes: Vec<u8>,
    create: bool,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistentDriveState {
    next_id: u64,
    objects: HashMap<String, PersistentDriveObject>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistentDriveObject {
    file_id: String,
    parent_id: String,
    name: String,
    web_content_link: String,
    creation_count: u64,
}

pub(crate) struct E2eGoogleDriveFake {
    data_dir: PathBuf,
    runtime: Mutex<RuntimeState>,
}

impl E2eGoogleDriveFake {
    pub(crate) fn new(data_dir: PathBuf) -> Result<Self> {
        let fake = Self {
            data_dir,
            runtime: Mutex::new(RuntimeState {
                scenario: E2eDriveScenario::default(),
                ..RuntimeState::default()
            }),
        };
        // Reject corrupt persisted fake state instead of silently creating a
        // second object. The file is scoped to the E2E data directory.
        let _ = fake.read_persistent_state()?;
        Ok(fake)
    }

    pub(crate) fn configure(&self, control: E2eDriveControl) -> Result<()> {
        let owner = control.owner.map(owner_from_seed);
        if control.reset {
            let mut scenario = E2eDriveScenario::default();
            if let Some(owner) = owner {
                scenario.owner = owner;
            }
            scenario.existing_file_failure = failure_from_wire(control.existing_file_failure);
            if let Some(public) = control.public_permission {
                scenario.public_permission = public;
            }
            scenario.terminate_before_metadata_patch =
                control.terminate_before_metadata_patch.unwrap_or(false);
            return self.reset(scenario);
        }

        let mut runtime = self.lock_runtime();
        if let Some(owner) = owner {
            runtime.scenario.owner = owner;
        }
        runtime.scenario.existing_file_failure = failure_from_wire(control.existing_file_failure);
        if let Some(public) = control.public_permission {
            runtime.scenario.public_permission = public;
        }
        if let Some(terminate) = control.terminate_before_metadata_patch {
            runtime.scenario.terminate_before_metadata_patch = terminate;
        }
        Ok(())
    }

    pub(crate) fn reset(&self, scenario: E2eDriveScenario) -> Result<()> {
        let namespace = self.namespace();
        match fs::remove_dir_all(&namespace) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        *self.lock_runtime() = RuntimeState {
            scenario,
            ..RuntimeState::default()
        };
        self.write_persistent_state(&PersistentDriveState {
            next_id: 1,
            objects: HashMap::new(),
        })
    }

    pub(crate) fn snapshot(&self) -> Result<E2eDriveSnapshot> {
        let persistent = self.read_persistent_state()?;
        let runtime = self.lock_runtime();
        let mut objects = persistent
            .objects
            .values()
            .map(|object| {
                let zip_entries = zip_entries(&self.object_path(&object.file_id));
                E2eDriveObjectSnapshot {
                    file_id: object.file_id.clone(),
                    name: object.name.clone(),
                    web_content_link: object.web_content_link.clone(),
                    zip_entries,
                    creation_count: object.creation_count,
                }
            })
            .collect::<Vec<_>>();
        objects.sort_by(|left, right| left.file_id.cmp(&right.file_id));
        let lifetime_create_count = objects.iter().map(|object| object.creation_count).sum();
        Ok(E2eDriveSnapshot {
            owner: seed_from_owner(&runtime.scenario.owner),
            objects,
            calls: runtime.calls.clone(),
            metadata_mutations: runtime.metadata_mutations.clone(),
            progress: runtime.progress.clone(),
            generate_count: runtime.generate_count,
            create_count: runtime.create_count,
            update_count: runtime.update_count,
            delete_count: runtime.delete_count,
            lifetime_create_count,
            public_permission: runtime.scenario.public_permission,
        })
    }

    pub(crate) fn record_progress(&self, progress: E2eDriveProgressSnapshot) {
        self.lock_runtime().progress.push(progress);
    }

    pub(crate) fn object_path(&self, file_id: &str) -> PathBuf {
        self.namespace()
            .join("objects")
            .join(format!("{file_id}.zip"))
    }

    pub(crate) fn seed_object(&self, file_id: &str, name: &str, bytes: Vec<u8>) -> Result<()> {
        validate_e2e_identifier(file_id)?;
        let mut persistent = self.read_persistent_state()?;
        persistent.objects.insert(
            file_id.to_string(),
            PersistentDriveObject {
                file_id: file_id.to_string(),
                parent_id: E2E_PUBLIC_FOLDER_ID.to_string(),
                name: name.to_string(),
                web_content_link: download_url(file_id),
                // A seeded pre-existing object was not created by this run.
                creation_count: 0,
            },
        );
        self.write_object_bytes(file_id, &bytes)?;
        self.write_persistent_state(&persistent)
    }

    fn namespace(&self) -> PathBuf {
        self.data_dir.join("dtxweb").join(E2E_NAMESPACE)
    }

    fn state_path(&self) -> PathBuf {
        self.namespace().join(E2E_STATE_FILE)
    }

    fn lock_runtime(&self) -> std::sync::MutexGuard<'_, RuntimeState> {
        self.runtime
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn read_persistent_state(&self) -> Result<PersistentDriveState> {
        match fs::read_to_string(self.state_path()) {
            Ok(contents) => serde_json::from_str(&contents)
                .map_err(|_| DesktopError::Message("LOCAL_STATE".to_string())),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(PersistentDriveState {
                    next_id: 1,
                    objects: HashMap::new(),
                })
            }
            Err(error) => Err(error.into()),
        }
    }

    fn write_persistent_state(&self, state: &PersistentDriveState) -> Result<()> {
        write_json_atomic(&self.state_path(), state)
    }

    fn write_object_bytes(&self, file_id: &str, bytes: &[u8]) -> Result<()> {
        validate_e2e_identifier(file_id)?;
        let path = self.object_path(file_id);
        let parent = path
            .parent()
            .ok_or_else(|| DesktopError::Message("LOCAL_STATE".to_string()))?;
        fs::create_dir_all(parent)?;
        fs::write(path, bytes)?;
        Ok(())
    }

    fn record_call(&self, operation: &str, file_id: Option<&str>, name: Option<&str>) {
        self.lock_runtime().calls.push(E2eDriveCallSnapshot {
            operation: operation.to_string(),
            file_id: file_id.map(str::to_string),
            name: name.map(str::to_string),
        });
    }

    fn start_session(
        &self,
        file_id: &str,
        parent_id: &str,
        name: &str,
        total_bytes: u64,
        create: bool,
    ) -> std::result::Result<ResumableUploadSession, DriveApiError> {
        if total_bytes == 0 {
            return Err(DriveApiError::InvalidResponse);
        }
        validate_e2e_identifier(file_id).map_err(|_| DriveApiError::InvalidResponse)?;
        let mut runtime = self.lock_runtime();
        runtime.session_sequence = runtime.session_sequence.saturating_add(1);
        let session_url = format!(
            "https://e2e-drive.invalid/upload/{file_id}/{}",
            runtime.session_sequence
        );
        let session = ResumableUploadSession::for_e2e(&session_url)?;
        runtime.sessions.insert(
            session.as_str().to_string(),
            InFlightUpload {
                file_id: file_id.to_string(),
                parent_id: parent_id.to_string(),
                name: name.to_string(),
                total_bytes,
                bytes: Vec::new(),
                create,
            },
        );
        if create {
            runtime.create_count = runtime.create_count.saturating_add(1);
        } else {
            runtime.update_count = runtime.update_count.saturating_add(1);
        }
        runtime.calls.push(E2eDriveCallSnapshot {
            operation: if create {
                "startResumableCreate"
            } else {
                "startResumableUpdate"
            }
            .to_string(),
            file_id: Some(file_id.to_string()),
            name: Some(name.to_string()),
        });
        Ok(session)
    }

    fn complete_session(&self, session: &str) -> std::result::Result<(), DriveApiError> {
        let upload = self
            .lock_runtime()
            .sessions
            .remove(session)
            .ok_or(DriveApiError::SessionExpired)?;
        let mut persistent = self
            .read_persistent_state()
            .map_err(|_| DriveApiError::LocalState)?;
        if upload.create && persistent.objects.contains_key(&upload.file_id) {
            return Err(DriveApiError::InvalidGeneratedId);
        }
        let creation_count = if upload.create {
            1
        } else {
            persistent
                .objects
                .get(&upload.file_id)
                .map(|object| object.creation_count)
                .ok_or(DriveApiError::NotFound)?
        };
        persistent.objects.insert(
            upload.file_id.clone(),
            PersistentDriveObject {
                file_id: upload.file_id.clone(),
                parent_id: upload.parent_id,
                name: upload.name,
                web_content_link: download_url(&upload.file_id),
                creation_count,
            },
        );
        self.write_object_bytes(&upload.file_id, &upload.bytes)
            .map_err(|_| DriveApiError::LocalState)?;
        self.write_persistent_state(&persistent)
            .map_err(|_| DriveApiError::LocalState)
    }

    fn drive_file(&self, file_id: &str) -> std::result::Result<DriveFile, DriveApiError> {
        let persistent = self
            .read_persistent_state()
            .map_err(|_| DriveApiError::LocalState)?;
        let object = persistent
            .objects
            .get(file_id)
            .ok_or(DriveApiError::NotFound)?;
        Ok(DriveFile {
            id: object.file_id.clone(),
            name: object.name.clone(),
            mime_type: "application/zip".to_string(),
            trashed: false,
            can_edit: true,
            can_download: true,
            web_content_link: Some(object.web_content_link.clone()),
        })
    }
}

#[async_trait]
impl GoogleDriveApi for E2eGoogleDriveFake {
    async fn generate_id(&self, _access_token: &str) -> std::result::Result<String, DriveApiError> {
        let mut persistent = self
            .read_persistent_state()
            .map_err(|_| DriveApiError::LocalState)?;
        let sequence = persistent.next_id.max(1);
        persistent.next_id = sequence.saturating_add(1);
        self.write_persistent_state(&persistent)
            .map_err(|_| DriveApiError::LocalState)?;
        let id = format!("e2e-drive-file-{sequence:04}");
        let mut runtime = self.lock_runtime();
        runtime.generate_count = runtime.generate_count.saturating_add(1);
        runtime.calls.push(E2eDriveCallSnapshot {
            operation: "generateId".to_string(),
            file_id: Some(id.clone()),
            name: None,
        });
        Ok(id)
    }

    async fn get_file(
        &self,
        _access_token: &str,
        file_id: &str,
    ) -> std::result::Result<DriveFile, DriveApiError> {
        self.record_call("getFile", Some(file_id), None);
        self.drive_file(file_id)
    }

    async fn get_file_for_update(
        &self,
        _access_token: &str,
        file_id: &str,
    ) -> std::result::Result<DriveFile, DriveApiError> {
        self.record_call("getFileForUpdate", Some(file_id), None);
        match self.lock_runtime().scenario.existing_file_failure {
            Some(E2eExistingFileFailure::NotFound) => Err(DriveApiError::NotFound),
            Some(E2eExistingFileFailure::PermissionDenied) => Err(DriveApiError::PermissionDenied),
            _ => self.drive_file(file_id),
        }
    }

    async fn validate_folder(
        &self,
        _access_token: &str,
        folder_id: &str,
    ) -> std::result::Result<ValidatedFolder, DriveApiError> {
        self.record_call("validateFolder", Some(folder_id), None);
        if folder_id != E2E_PUBLIC_FOLDER_ID {
            return Err(DriveApiError::FolderUnavailable);
        }
        Ok(ValidatedFolder {
            id: folder_id.to_string(),
            name: "E2E Public Folder".to_string(),
        })
    }

    async fn validate_public_permission(
        &self,
        _access_token: &str,
        item_id: &str,
    ) -> std::result::Result<PublicPermissionStatus, DriveApiError> {
        self.record_call("validatePublicPermission", Some(item_id), None);
        Ok(if self.lock_runtime().scenario.public_permission {
            PublicPermissionStatus::Public
        } else {
            PublicPermissionStatus::NotPublic
        })
    }

    async fn start_resumable_create(
        &self,
        _access_token: &str,
        metadata: &DriveCreateMetadata,
        total_bytes: u64,
    ) -> std::result::Result<ResumableUploadSession, DriveApiError> {
        self.start_session(
            &metadata.id,
            &metadata.parent_id,
            &metadata.name,
            total_bytes,
            true,
        )
    }

    async fn start_resumable_update(
        &self,
        _access_token: &str,
        file_id: &str,
        metadata: &DriveUpdateMetadata,
        total_bytes: u64,
    ) -> std::result::Result<ResumableUploadSession, DriveApiError> {
        self.start_session(
            file_id,
            E2E_PUBLIC_FOLDER_ID,
            &metadata.name,
            total_bytes,
            false,
        )
    }

    async fn upload_chunk(
        &self,
        _access_token: &str,
        session: &ResumableUploadSession,
        start: u64,
        bytes: &[u8],
        total_bytes: u64,
    ) -> std::result::Result<DriveChunkResult, DriveApiError> {
        let complete = {
            let mut runtime = self.lock_runtime();
            let upload = runtime
                .sessions
                .get_mut(session.as_str())
                .ok_or(DriveApiError::SessionExpired)?;
            if upload.total_bytes != total_bytes
                || start != upload.bytes.len() as u64
                || bytes.is_empty()
                || start.saturating_add(bytes.len() as u64) > total_bytes
            {
                return Err(DriveApiError::InvalidResponse);
            }
            upload.bytes.extend_from_slice(bytes);
            upload.bytes.len() as u64 == total_bytes
        };
        self.record_call("uploadChunk", None, None);
        if complete {
            self.complete_session(session.as_str())?;
            Ok(DriveChunkResult::Complete)
        } else {
            Ok(DriveChunkResult::Accepted(
                start.saturating_add(bytes.len() as u64),
            ))
        }
    }

    async fn query_session_status(
        &self,
        _access_token: &str,
        session: &ResumableUploadSession,
        total_bytes: u64,
    ) -> std::result::Result<DriveChunkResult, DriveApiError> {
        let runtime = self.lock_runtime();
        let upload = runtime
            .sessions
            .get(session.as_str())
            .ok_or(DriveApiError::SessionExpired)?;
        if upload.total_bytes != total_bytes {
            return Err(DriveApiError::InvalidResponse);
        }
        Ok(DriveChunkResult::Accepted(upload.bytes.len() as u64))
    }

    async fn delete_file(
        &self,
        _access_token: &str,
        file_id: &str,
    ) -> std::result::Result<(), DriveApiError> {
        self.record_call("deleteFile", Some(file_id), None);
        let mut persistent = self
            .read_persistent_state()
            .map_err(|_| DriveApiError::LocalState)?;
        if persistent.objects.remove(file_id).is_none() {
            return Err(DriveApiError::NotFound);
        }
        let _ = fs::remove_file(self.object_path(file_id));
        self.write_persistent_state(&persistent)
            .map_err(|_| DriveApiError::LocalState)?;
        let mut runtime = self.lock_runtime();
        runtime.delete_count = runtime.delete_count.saturating_add(1);
        Ok(())
    }
}

#[async_trait]
impl DriveMetadataClient for E2eGoogleDriveFake {
    async fn fetch_owner_simfile(
        &self,
        _auth: &AuthState,
        simfile_id: &str,
    ) -> std::result::Result<OwnerDriveSimfile, DriveMetadataError> {
        self.record_call("fetchOwnerSimfile", None, None);
        let owner = self.lock_runtime().scenario.owner.clone();
        if owner.id != simfile_id {
            return Err(DriveMetadataError::DefinitiveUnavailable);
        }
        Ok(owner)
    }

    async fn update_drive_file(
        &self,
        _auth: &AuthState,
        simfile_id: &str,
        drive_file_id: &str,
        download_url: &str,
    ) -> std::result::Result<OwnerDriveSimfile, DriveMetadataError> {
        let mut runtime = self.lock_runtime();
        if runtime.scenario.owner.id != simfile_id {
            return Err(DriveMetadataError::DefinitiveUnavailable);
        }
        if runtime.scenario.terminate_before_metadata_patch {
            // Intentional process-level crash seam. It is compiled only into
            // debug E2E binaries and exits before mutating metadata, leaving
            // the persisted fake Drive object plus native pending binding for
            // the relaunch reconciliation path.
            std::process::exit(86);
        }
        runtime.scenario.owner.google_drive_file_id = Some(drive_file_id.to_string());
        runtime.scenario.owner.download_url = Some(download_url.to_string());
        runtime
            .metadata_mutations
            .push(E2eDriveMetadataMutationSnapshot {
                mutation: "updateDriveFile".to_string(),
                simfile_id: simfile_id.to_string(),
                drive_file_id: drive_file_id.to_string(),
                download_url: download_url.to_string(),
            });
        runtime.calls.push(E2eDriveCallSnapshot {
            operation: "updateDriveFile".to_string(),
            file_id: Some(drive_file_id.to_string()),
            name: None,
        });
        Ok(runtime.scenario.owner.clone())
    }
}

#[async_trait]
impl GoogleOAuthProvider for E2eGoogleDriveFake {
    async fn exchange_code(
        &self,
        _request: TokenExchangeRequest,
    ) -> std::result::Result<OAuthTokenResponse, OAuthProviderError> {
        Err(OAuthProviderError::InvalidResponse)
    }

    async fn refresh_access_token(
        &self,
        _refresh_token: &str,
    ) -> std::result::Result<OAuthTokenResponse, OAuthProviderError> {
        Ok(OAuthTokenResponse {
            access_token: E2E_ACCESS_TOKEN.to_string(),
            refresh_token: None,
            expires_in: 60 * 60,
            scope: Some(GOOGLE_DRIVE_FILE_SCOPE.to_string()),
        })
    }

    async fn revoke_refresh_token(
        &self,
        _refresh_token: &str,
    ) -> std::result::Result<(), OAuthProviderError> {
        Ok(())
    }
}

#[async_trait]
impl PickerFolderValidator for E2eGoogleDriveFake {
    async fn validate_folder(
        &self,
        _access_token: &str,
        folder_id: &str,
    ) -> std::result::Result<GoogleDriveFolderSetting, GoogleDriveOAuthError> {
        if folder_id != E2E_PUBLIC_FOLDER_ID {
            return Err(GoogleDriveOAuthError::FolderUnavailable);
        }
        if !self.lock_runtime().scenario.public_permission {
            return Err(GoogleDriveOAuthError::DownloadNotPublic);
        }
        Ok(GoogleDriveFolderSetting {
            id: folder_id.to_string(),
            name: "E2E Public Folder".to_string(),
        })
    }
}

fn failure_from_wire(value: E2eExistingFileFailure) -> Option<E2eExistingFileFailure> {
    match value {
        E2eExistingFileFailure::None => None,
        value => Some(value),
    }
}

fn owner_from_seed(seed: E2eDriveOwnerSeed) -> OwnerDriveSimfile {
    OwnerDriveSimfile {
        id: seed.simfile_id,
        title: seed.cloud_title,
        google_drive_file_id: seed.google_drive_file_id,
        download_url: seed.download_url,
    }
}

fn seed_from_owner(owner: &OwnerDriveSimfile) -> E2eDriveOwnerSeed {
    E2eDriveOwnerSeed {
        simfile_id: owner.id.clone(),
        cloud_title: owner.title.clone(),
        google_drive_file_id: owner.google_drive_file_id.clone(),
        download_url: owner.download_url.clone(),
    }
}

fn validate_e2e_identifier(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 512
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(DesktopError::Message("LOCAL_STATE".to_string()));
    }
    Ok(())
}

fn download_url(file_id: &str) -> String {
    format!("https://drive.google.test/download/{file_id}")
}

fn zip_entries(path: &Path) -> Vec<E2eDriveZipEntrySnapshot> {
    let Ok(bytes) = fs::read(path) else {
        return Vec::new();
    };
    let Ok(mut archive) = zip::ZipArchive::new(Cursor::new(bytes)) else {
        return Vec::new();
    };
    let mut entries = Vec::new();
    for index in 0..archive.len() {
        let Ok(mut entry) = archive.by_index(index) else {
            continue;
        };
        if entry.is_dir() {
            continue;
        }
        let mut contents = Vec::new();
        if entry.read_to_end(&mut contents).is_err() {
            continue;
        }
        entries.push(E2eDriveZipEntrySnapshot {
            name: entry.name().to_string(),
            size: contents.len() as u64,
            sha256: format!("{:x}", Sha256::digest(&contents)),
        });
    }
    entries.sort_by(|left, right| left.name.cmp(&right.name));
    entries
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;
    use crate::auth::AuthState;
    use crate::google_drive::drive_client::{
        DriveChunkResult, DriveCreateMetadata, DriveUpdateMetadata, GoogleDriveApi,
        PublicPermissionStatus,
    };
    use crate::google_drive::{DriveMetadataClient, OwnerDriveSimfile};

    const USER_ID: &str = "e2e-user";
    const SIMFILE_ID: &str = "sim-e2e-1";

    fn owner(file_id: Option<&str>, download_url: Option<&str>) -> OwnerDriveSimfile {
        OwnerDriveSimfile {
            id: SIMFILE_ID.to_string(),
            title: "Saved Cloud Title".to_string(),
            google_drive_file_id: file_id.map(str::to_string),
            download_url: download_url.map(str::to_string),
        }
    }

    #[tokio::test]
    async fn deterministic_create_persists_uploaded_object_and_restores_it_after_restart() {
        let data = tempfile::tempdir().unwrap();
        let fake = E2eGoogleDriveFake::new(data.path().to_path_buf()).unwrap();
        fake.reset(E2eDriveScenario::new(owner(None, None)))
            .unwrap();

        let id = fake.generate_id("ignored-e2e-access-token").await.unwrap();
        assert_eq!(id, "e2e-drive-file-0001");
        let session = fake
            .start_resumable_create(
                "ignored-e2e-access-token",
                &DriveCreateMetadata {
                    id: id.clone(),
                    parent_id: "e2e-public-folder".to_string(),
                    name: "Saved Cloud Title.zip".to_string(),
                },
                4,
            )
            .await
            .unwrap();
        assert_eq!(
            fake.upload_chunk("ignored-e2e-access-token", &session, 0, b"PK12", 4)
                .await
                .unwrap(),
            DriveChunkResult::Complete
        );

        let restored = E2eGoogleDriveFake::new(data.path().to_path_buf()).unwrap();
        let object = restored
            .get_file("ignored-e2e-access-token", &id)
            .await
            .unwrap();
        assert_eq!(object.id, id);
        assert_eq!(object.name, "Saved Cloud Title.zip");
        assert_eq!(
            object.web_content_link.as_deref(),
            Some("https://drive.google.test/download/e2e-drive-file-0001")
        );
        assert_eq!(fs::read(restored.object_path(&id)).unwrap(), b"PK12");
        assert!(restored.object_path(&id).starts_with(data.path()));
    }

    #[tokio::test]
    async fn same_file_update_preserves_identity_and_uses_the_new_cloud_title() {
        let data = tempfile::tempdir().unwrap();
        let fake = E2eGoogleDriveFake::new(data.path().to_path_buf()).unwrap();
        fake.reset(E2eDriveScenario::new(owner(
            Some("e2e-drive-file-0001"),
            Some("https://drive.google.test/download/e2e-drive-file-0001"),
        )))
        .unwrap();
        fake.seed_object("e2e-drive-file-0001", "Old title.zip", b"old".to_vec())
            .unwrap();

        let session = fake
            .start_resumable_update(
                "ignored-e2e-access-token",
                "e2e-drive-file-0001",
                &DriveUpdateMetadata {
                    name: "Saved Cloud Title.zip".to_string(),
                },
                3,
            )
            .await
            .unwrap();
        fake.upload_chunk("ignored-e2e-access-token", &session, 0, b"new", 3)
            .await
            .unwrap();

        let snapshot = fake.snapshot().unwrap();
        assert_eq!(snapshot.objects.len(), 1);
        assert_eq!(snapshot.objects[0].file_id, "e2e-drive-file-0001");
        assert_eq!(snapshot.objects[0].name, "Saved Cloud Title.zip");
        assert_eq!(
            fs::read(fake.object_path("e2e-drive-file-0001")).unwrap(),
            b"new"
        );
        assert_eq!(snapshot.create_count, 0);
        assert_eq!(snapshot.update_count, 1);
    }

    #[tokio::test]
    async fn scenario_controls_permanent_existing_failure_and_public_permission() {
        let data = tempfile::tempdir().unwrap();
        let fake = E2eGoogleDriveFake::new(data.path().to_path_buf()).unwrap();
        let mut scenario = E2eDriveScenario::new(owner(
            Some("e2e-drive-file-0001"),
            Some("https://drive.google.test/download/e2e-drive-file-0001"),
        ));
        scenario.existing_file_failure = Some(E2eExistingFileFailure::NotFound);
        scenario.public_permission = false;
        fake.reset(scenario).unwrap();

        assert_eq!(
            fake.get_file_for_update("ignored-e2e-access-token", "e2e-drive-file-0001")
                .await
                .unwrap_err(),
            crate::google_drive::drive_client::DriveApiError::NotFound
        );
        assert_eq!(
            fake.validate_public_permission("ignored-e2e-access-token", "e2e-drive-file-0001")
                .await
                .unwrap(),
            PublicPermissionStatus::NotPublic
        );
    }

    #[tokio::test]
    async fn metadata_fake_records_only_the_dedicated_drive_patch_mutation() {
        let data = tempfile::tempdir().unwrap();
        let fake = E2eGoogleDriveFake::new(data.path().to_path_buf()).unwrap();
        fake.reset(E2eDriveScenario::new(owner(None, None)))
            .unwrap();
        let auth = AuthState::default();

        let before = fake.fetch_owner_simfile(&auth, SIMFILE_ID).await.unwrap();
        assert_eq!(before.google_drive_file_id, None);
        let updated = fake
            .update_drive_file(
                &auth,
                SIMFILE_ID,
                "e2e-drive-file-0001",
                "https://drive.google.test/download/e2e-drive-file-0001",
            )
            .await
            .unwrap();

        assert_eq!(
            updated.google_drive_file_id.as_deref(),
            Some("e2e-drive-file-0001")
        );
        let snapshot = fake.snapshot().unwrap();
        assert_eq!(snapshot.metadata_mutations.len(), 1);
        assert_eq!(snapshot.metadata_mutations[0].mutation, "updateDriveFile");
        assert_eq!(snapshot.metadata_mutations[0].simfile_id, SIMFILE_ID);
    }
}
