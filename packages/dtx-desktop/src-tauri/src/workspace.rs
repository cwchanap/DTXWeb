use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, RwLock};

#[cfg(test)]
use std::sync::{mpsc, Arc};
#[cfg(test)]
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::error::{DesktopError, Result};
use crate::models::DialogResult;
use crate::native_persistence::{
    app_data_file, read_json_or_default, resolve_dirs, write_json_atomic,
};

const WORKSPACE_ROOT_REQUIRED: &str = "A workspace root is required";

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
struct WorkspaceSettings {
    workspace_root: Option<String>,
}

#[cfg(test)]
#[derive(Debug)]
struct TestRendezvous {
    arrived: mpsc::Sender<()>,
    release: Mutex<mpsc::Receiver<()>>,
}

#[cfg(test)]
impl TestRendezvous {
    fn new(arrived: mpsc::Sender<()>, release: mpsc::Receiver<()>) -> Self {
        Self {
            arrived,
            release: Mutex::new(release),
        }
    }

    fn wait(&self, label: &str) {
        self.arrived.send(()).expect("test rendezvous receiver");
        self.release
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .recv_timeout(Duration::from_secs(1))
            .unwrap_or_else(|error| panic!("{label} was not released: {error}"));
    }
}

#[derive(Debug, Default)]
pub struct WorkspaceRootState {
    root: RwLock<Option<PathBuf>>,
    settings_path: Option<PathBuf>,
    operation_lock: Mutex<()>,
    #[cfg(test)]
    post_persist_hook: Mutex<Option<Arc<TestRendezvous>>>,
    #[cfg(test)]
    before_operation_lock_hook: Mutex<Option<Arc<TestRendezvous>>>,
}

impl WorkspaceRootState {
    pub(crate) fn load() -> Self {
        let (data_dir, _) = resolve_dirs();
        match data_dir.as_deref() {
            Some(data_dir) => Self::load_from_path(workspace_settings_path(data_dir)),
            None => Self::default(),
        }
    }

    fn load_from_path(settings_path: PathBuf) -> Self {
        let settings: WorkspaceSettings = read_json_or_default(&settings_path, "workspace");
        let root = settings
            .workspace_root
            .as_deref()
            .and_then(|root| canonical_workspace_directory(Path::new(root)));

        Self {
            root: RwLock::new(root),
            settings_path: Some(settings_path),
            operation_lock: Mutex::new(()),
            #[cfg(test)]
            post_persist_hook: Mutex::new(None),
            #[cfg(test)]
            before_operation_lock_hook: Mutex::new(None),
        }
    }

    pub(crate) fn current(&self) -> Result<PathBuf> {
        self.current_optional()
            .ok_or_else(|| DesktopError::Message(WORKSPACE_ROOT_REQUIRED.to_string()))
    }

    pub(crate) fn current_optional(&self) -> Option<PathBuf> {
        self.root
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    pub(crate) fn set_from_dialog_selection(&self, selected: &Path) -> Result<PathBuf> {
        let canonical = canonical_workspace_directory(selected).ok_or_else(|| {
            DesktopError::Message(
                "The selected workspace must be an accessible directory".to_string(),
            )
        })?;
        self.commit_transition(Some(canonical.clone()))?;
        Ok(canonical)
    }

    pub(crate) fn clear(&self) -> Result<()> {
        self.commit_transition(None)
    }

    fn commit_transition(&self, next_root: Option<PathBuf>) -> Result<()> {
        #[cfg(test)]
        self.run_test_hook(
            &self.before_operation_lock_hook,
            "operation-lock acquisition rendezvous",
        );
        let _operation = self
            .operation_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        self.persist(next_root.as_deref())?;
        #[cfg(test)]
        self.run_test_hook(&self.post_persist_hook, "post-persist rendezvous");
        *self
            .root
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = next_root;
        Ok(())
    }

    #[cfg(test)]
    fn run_test_hook(&self, hook: &Mutex<Option<Arc<TestRendezvous>>>, label: &str) {
        let rendezvous = hook
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
        if let Some(rendezvous) = rendezvous {
            rendezvous.wait(label);
        }
    }

    fn persist(&self, root: Option<&Path>) -> Result<()> {
        let settings_path = self.settings_path.as_deref().ok_or_else(|| {
            DesktopError::Message("Could not resolve app data directory".to_string())
        })?;
        let workspace_root = root
            .map(|path| {
                path.to_str().map(str::to_owned).ok_or_else(|| {
                    DesktopError::Message("Workspace root must be valid UTF-8".to_string())
                })
            })
            .transpose()?;
        write_json_atomic(settings_path, &WorkspaceSettings { workspace_root })
    }
}

pub(crate) fn workspace_settings_path(data_dir: &Path) -> PathBuf {
    app_data_file(data_dir, "workspace.json")
}

fn canonical_workspace_directory(path: &Path) -> Option<PathBuf> {
    let canonical = fs::canonicalize(path).ok()?;
    let metadata = fs::metadata(&canonical).ok()?;
    if !metadata.is_dir() {
        return None;
    }

    // Probe read/list access on the canonical directory instead of relying on
    // a Unix-only permission-bit heuristic. If we cannot enumerate entries, the
    // directory is not usable as a workspace root.
    if fs::read_dir(&canonical).is_err() {
        return None;
    }

    Some(canonical)
}

fn selection_result(state: &WorkspaceRootState, selected: Option<PathBuf>) -> Result<DialogResult> {
    let Some(selected) = selected else {
        return Ok(DialogResult {
            canceled: true,
            file_paths: Vec::new(),
        });
    };

    let canonical = state.set_from_dialog_selection(&selected)?;
    Ok(DialogResult {
        canceled: false,
        file_paths: vec![canonical.to_string_lossy().into_owned()],
    })
}

#[tauri::command]
pub async fn select_workspace_folder(
    app: AppHandle,
    state: State<'_, WorkspaceRootState>,
) -> Result<DialogResult> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |folder_path| {
        let _ = sender.send(folder_path);
    });

    let selected = receiver
        .await
        .map_err(|_| DesktopError::DialogPlugin)?
        .map(dialog_file_path_into_path)
        .transpose()?;
    selection_result(&state, selected)
}

#[tauri::command]
pub fn get_workspace_root(state: State<'_, WorkspaceRootState>) -> Option<String> {
    state
        .current_optional()
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn clear_workspace_root(state: State<'_, WorkspaceRootState>) -> Result<()> {
    state.clear()
}

fn dialog_file_path_into_path(file_path: FilePath) -> Result<PathBuf> {
    file_path
        .into_path()
        .map_err(|error| DesktopError::Message(error.to_string()))
}

#[cfg(test)]
pub(crate) mod test_support {
    use super::*;

    pub(crate) fn managed_workspace_state(root: &Path) -> WorkspaceRootState {
        WorkspaceRootState {
            root: RwLock::new(Some(
                fs::canonicalize(root).expect("canonical workspace root"),
            )),
            settings_path: None,
            operation_lock: Mutex::new(()),
            post_persist_hook: Mutex::new(None),
            before_operation_lock_hook: Mutex::new(None),
        }
    }
}

#[cfg(test)]
#[path = "tests/workspace_tests.rs"]
mod tests;
