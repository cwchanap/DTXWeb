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
use uuid::Uuid;

use crate::error::{DesktopError, Result};
use crate::models::DialogResult;
use crate::native_persistence::{
    app_data_file, read_json_or_default, resolve_dirs, write_json_atomic,
};

const WORKSPACE_ROOT_REQUIRED: &str = "A workspace root is required";
const MAX_BOOKMARKS: usize = 20;
const MAX_BOOKMARKS_MESSAGE: &str = "Maximum of 20 bookmarks reached";
const UNKNOWN_BOOKMARK_MESSAGE: &str = "Unknown workspace bookmark";

/// A native-owned bookmark: an opaque id, the canonical workspace path it
/// refers to, and a renderer-supplied display name. The id is the only value
/// the renderer is allowed to send back when switching roots; the path is
/// never accepted from the renderer as a trust anchor.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BookmarkEntry {
    id: String,
    path: String,
    name: String,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
struct WorkspaceSettings {
    workspace_root: Option<String>,
    #[serde(default)]
    bookmarks: Vec<BookmarkEntry>,
}

/// Wire shape returned by `list_bookmarks` and `bookmark_current_root`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkRef {
    pub id: String,
    pub path: String,
    pub name: String,
}

/// Structured outcome of `switch_trusted_workspace`. Only `NotAccessible`
/// carries a path (so the renderer can offer to remove a confirmed-stale
/// bookmark). `UnknownId` carries no path — the renderer already holds the
/// bookmark it tried to switch to. Transient native failures (persistence,
/// IPC) surface through the `Err` channel as a generic error string with no
/// path, so the menu never offers "Remove bookmark" for a transient failure.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "outcome")]
pub enum SwitchOutcome {
    Ok { path: String },
    UnknownId,
    NotAccessible { path: String },
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
    bookmarks: RwLock<Vec<BookmarkEntry>>,
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
            bookmarks: RwLock::new(settings.bookmarks),
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

    /// The native bookmark id of the current root, if the current root has
    /// been bookmarked. The renderer uses this to decide whether to show
    /// "Bookmark this folder" or "Bookmarked as <name>".
    pub(crate) fn current_root_id(&self) -> Option<String> {
        let root = self.current_optional()?;
        let root_string = root.to_string_lossy().into_owned();
        self.bookmarks
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .find(|bookmark| bookmark.path == root_string)
            .map(|bookmark| bookmark.id.clone())
    }

    pub(crate) fn set_from_dialog_selection(&self, selected: &Path) -> Result<PathBuf> {
        let _operation = self.lock_operation();
        let canonical = canonical_workspace_directory(selected).ok_or_else(|| {
            DesktopError::Message(
                "The selected workspace must be an accessible directory".to_string(),
            )
        })?;
        let bookmarks = self
            .bookmarks
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        self.commit_locked(Some(canonical.clone()), bookmarks)?;
        Ok(canonical)
    }

    /// Switches the trusted root to a previously-bookmarked root identified
    /// only by its opaque native id. The renderer never supplies a path here.
    pub(crate) fn switch_to_bookmark(&self, id: &str) -> Result<SwitchOutcome> {
        let _operation = self.lock_operation();
        let bookmarks = self
            .bookmarks
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        let Some(bookmark) = bookmarks.iter().find(|b| b.id == id).cloned() else {
            return Ok(SwitchOutcome::UnknownId);
        };

        let canonical = canonical_workspace_directory(Path::new(&bookmark.path));
        let Some(canonical) = canonical else {
            return Ok(SwitchOutcome::NotAccessible {
                path: bookmark.path,
            });
        };

        self.commit_locked(Some(canonical.clone()), bookmarks)?;
        Ok(SwitchOutcome::Ok {
            path: canonical.to_string_lossy().into_owned(),
        })
    }

    /// Records the current trusted root as a bookmark with the given display
    /// name. If the current root is already bookmarked, the existing entry's
    /// name is updated and returned. The native id is generated here and never
    /// supplied by the renderer.
    pub(crate) fn bookmark_current_root(&self, name: &str) -> Result<BookmarkRef> {
        let _operation = self.lock_operation();
        let canonical = self.current()?;
        let path_string = canonical.to_string_lossy().into_owned();
        let trimmed_name = name.trim();
        let final_name = if trimmed_name.is_empty() {
            basename(&path_string)
        } else {
            trimmed_name.to_string()
        };

        let mut bookmarks = self
            .bookmarks
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();

        if let Some(idx) = bookmarks.iter().position(|b| b.path == path_string) {
            let id = bookmarks[idx].id.clone();
            let path = bookmarks[idx].path.clone();
            let original_name = bookmarks[idx].name.clone();
            let changed = original_name != final_name;
            if changed {
                bookmarks[idx].name = final_name.clone();
                self.commit_locked(self.current_optional(), bookmarks)?;
            }
            let name = if changed { final_name } else { original_name };
            return Ok(BookmarkRef { id, path, name });
        }

        if bookmarks.len() >= MAX_BOOKMARKS {
            return Err(DesktopError::Message(MAX_BOOKMARKS_MESSAGE.to_string()));
        }

        let id = Uuid::new_v4().to_string();
        bookmarks.push(BookmarkEntry {
            id: id.clone(),
            path: path_string.clone(),
            name: final_name.clone(),
        });
        self.commit_locked(self.current_optional(), bookmarks)?;
        Ok(BookmarkRef {
            id,
            path: path_string,
            name: final_name,
        })
    }

    pub(crate) fn rename_bookmark(&self, id: &str, name: &str) -> Result<()> {
        let _operation = self.lock_operation();
        let mut bookmarks = self
            .bookmarks
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        let trimmed = name.trim();
        let entry = bookmarks
            .iter_mut()
            .find(|b| b.id == id)
            .ok_or_else(|| DesktopError::Message(UNKNOWN_BOOKMARK_MESSAGE.to_string()))?;
        let final_name = if trimmed.is_empty() {
            basename(&entry.path)
        } else {
            trimmed.to_string()
        };
        if entry.name == final_name {
            return Ok(());
        }
        entry.name = final_name;
        self.commit_locked(self.current_optional(), bookmarks)?;
        Ok(())
    }

    /// Removes a bookmark from the native trust pool. Idempotent: removing an
    /// unknown id succeeds without mutating state.
    pub(crate) fn remove_bookmark(&self, id: &str) -> Result<()> {
        let _operation = self.lock_operation();
        let mut bookmarks = self
            .bookmarks
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        let before = bookmarks.len();
        bookmarks.retain(|b| b.id != id);
        if bookmarks.len() == before {
            return Ok(());
        }
        self.commit_locked(self.current_optional(), bookmarks)?;
        Ok(())
    }

    pub(crate) fn list_bookmarks(&self) -> Vec<BookmarkRef> {
        self.bookmarks
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .map(|b| BookmarkRef {
                id: b.id.clone(),
                path: b.path.clone(),
                name: b.name.clone(),
            })
            .collect()
    }

    pub(crate) fn clear(&self) -> Result<()> {
        let _operation = self.lock_operation();
        let bookmarks = self
            .bookmarks
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        self.commit_locked(None, bookmarks)
    }

    /// Acquires the operation lock that serializes the full
    /// read-modify-write transaction of every mutating operation. The lock
    /// must be held before reading `root` or `bookmarks` and kept through
    /// `commit_locked` so concurrent mutations cannot interleave and lose
    /// each other's changes.
    fn lock_operation(&self) -> std::sync::MutexGuard<'_, ()> {
        #[cfg(test)]
        self.run_test_hook(
            &self.before_operation_lock_hook,
            "operation-lock acquisition rendezvous",
        );
        self.operation_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Persists the next state and replaces both in-memory fields. The
    /// caller must already hold `operation_lock` (via `lock_operation`); this
    /// helper does not attempt to reacquire it.
    fn commit_locked(
        &self,
        next_root: Option<PathBuf>,
        next_bookmarks: Vec<BookmarkEntry>,
    ) -> Result<()> {
        self.persist(next_root.as_deref(), &next_bookmarks)?;
        #[cfg(test)]
        self.run_test_hook(&self.post_persist_hook, "post-persist rendezvous");
        *self
            .root
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = next_root;
        *self
            .bookmarks
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = next_bookmarks;
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

    fn persist(&self, root: Option<&Path>, bookmarks: &[BookmarkEntry]) -> Result<()> {
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
        write_json_atomic(
            settings_path,
            &WorkspaceSettings {
                workspace_root,
                bookmarks: bookmarks.to_vec(),
            },
        )
    }
}

pub(crate) fn workspace_settings_path(data_dir: &Path) -> PathBuf {
    app_data_file(data_dir, "workspace.json")
}

fn basename(path: &str) -> String {
    let trimmed = path.trim_end_matches(['/', '\\']);
    let parts: Vec<&str> = trimmed.split(['/', '\\']).collect();
    parts
        .last()
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| trimmed.to_string())
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

/// Returns the native bookmark id of the current trusted root, or null if the
/// current root has not been bookmarked. The renderer uses this to render the
/// "Bookmark this folder" / "Bookmarked as <name>" state without ever needing
/// to send a path back to native.
#[tauri::command]
pub fn get_current_workspace_root_id(state: State<'_, WorkspaceRootState>) -> Option<String> {
    state.current_root_id()
}

/// Switches the trusted workspace root to a previously-bookmarked root
/// identified by its opaque native id. This is the only operation other than
/// the folder dialog that can change the trusted root, and it never accepts a
/// path from the renderer.
#[tauri::command]
pub fn switch_trusted_workspace(
    id: String,
    state: State<'_, WorkspaceRootState>,
) -> Result<SwitchOutcome> {
    state.switch_to_bookmark(&id)
}

/// Records the current trusted root as a bookmark. The native id is generated
/// and persisted natively; the renderer only receives the resulting id.
#[tauri::command]
pub fn bookmark_current_root(
    name: String,
    state: State<'_, WorkspaceRootState>,
) -> Result<BookmarkRef> {
    state.bookmark_current_root(&name)
}

#[tauri::command]
pub fn rename_bookmark(
    id: String,
    name: String,
    state: State<'_, WorkspaceRootState>,
) -> Result<()> {
    state.rename_bookmark(&id, &name)
}

#[tauri::command]
pub fn remove_bookmark(id: String, state: State<'_, WorkspaceRootState>) -> Result<()> {
    state.remove_bookmark(&id)
}

#[tauri::command]
pub fn list_bookmarks(state: State<'_, WorkspaceRootState>) -> Vec<BookmarkRef> {
    state.list_bookmarks()
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
            bookmarks: RwLock::new(Vec::new()),
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
