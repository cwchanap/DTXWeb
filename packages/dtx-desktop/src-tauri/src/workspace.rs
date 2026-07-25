use std::fs;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

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

#[derive(Debug, Default)]
pub struct WorkspaceRootState {
    root: RwLock<Option<PathBuf>>,
    settings_path: Option<PathBuf>,
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
        self.persist(Some(&canonical))?;
        *self
            .root
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(canonical.clone());
        Ok(canonical)
    }

    pub(crate) fn clear(&self) -> Result<()> {
        self.persist(None)?;
        *self
            .root
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
        Ok(())
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

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 == 0 {
            return None;
        }
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
        .map_err(|error| DesktopError::Message(error.to_string()))?
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
#[path = "tests/workspace_tests.rs"]
mod tests;
