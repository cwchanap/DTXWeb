use super::*;
use std::fs;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{mpsc, Arc, TryLockError};
use std::thread::JoinHandle;
use std::time::Duration;
use tauri::Manager;
use tempfile::TempDir;

const TEST_COORDINATION_TIMEOUT: Duration = Duration::from_secs(1);

struct TransitionWorkers {
    releases: Vec<mpsc::Sender<()>>,
    selector: Option<JoinHandle<()>>,
    clearer: Option<JoinHandle<()>>,
}

impl TransitionWorkers {
    fn release_all(&self) {
        for release in &self.releases {
            let _ = release.send(());
        }
    }

    fn join(&mut self) {
        self.release_all();
        if let Some(selector) = self.selector.take() {
            selector.join().expect("selector worker");
        }
        if let Some(clearer) = self.clearer.take() {
            clearer.join().expect("clear worker");
        }
    }
}

impl Drop for TransitionWorkers {
    fn drop(&mut self) {
        self.release_all();
        if let Some(selector) = self.selector.take() {
            let _ = selector.join();
        }
        if let Some(clearer) = self.clearer.take() {
            let _ = clearer.join();
        }
    }
}

fn settings_path(data_dir: &std::path::Path) -> std::path::PathBuf {
    data_dir.join("dtxweb").join("workspace.json")
}

fn saved_state(data_dir: &std::path::Path, root: &std::path::Path) -> WorkspaceRootState {
    let path = settings_path(data_dir);
    fs::create_dir_all(path.parent().expect("settings parent")).expect("settings parent");
    fs::write(
        &path,
        format!(
            r#"{{"workspaceRoot":{}}}"#,
            serde_json::to_string(&root.to_str().expect("UTF-8 workspace path")).unwrap()
        ),
    )
    .expect("settings file");
    WorkspaceRootState::load_from_path(path)
}

#[test]
fn load_without_settings_has_no_trusted_root() {
    let data_dir = TempDir::new().expect("data dir");

    let state = WorkspaceRootState::load_from_path(settings_path(data_dir.path()));

    assert_eq!(state.current_optional(), None);
    assert_eq!(
        state.current().expect_err("missing root").to_string(),
        "A workspace root is required"
    );
}

#[test]
fn load_discards_malformed_settings() {
    let data_dir = TempDir::new().expect("data dir");
    let path = settings_path(data_dir.path());
    fs::create_dir_all(path.parent().expect("settings parent")).expect("settings parent");
    fs::write(&path, "{ malformed").expect("malformed settings");

    let state = WorkspaceRootState::load_from_path(path);

    assert_eq!(state.current_optional(), None);
}

#[test]
fn load_discards_missing_workspace_directory() {
    let data_dir = TempDir::new().expect("data dir");
    let missing = data_dir.path().join("missing-workspace");
    let state = saved_state(data_dir.path(), &missing);

    assert_eq!(state.current_optional(), None);
}

#[test]
fn load_discards_workspace_file() {
    let data_dir = TempDir::new().expect("data dir");
    let file = data_dir.path().join("not-a-directory");
    fs::write(&file, "not a workspace").expect("workspace file");
    let state = saved_state(data_dir.path(), &file);

    assert_eq!(state.current_optional(), None);
}

#[cfg(unix)]
#[test]
fn load_discards_inaccessible_workspace_directory() {
    use std::os::unix::fs::PermissionsExt;

    let data_dir = TempDir::new().expect("data dir");
    let root = data_dir.path().join("inaccessible");
    fs::create_dir(&root).expect("workspace directory");
    fs::set_permissions(&root, fs::Permissions::from_mode(0o000)).expect("remove access");

    let state = saved_state(data_dir.path(), &root);

    assert_eq!(state.current_optional(), None);
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).expect("restore access");
}

#[test]
fn load_canonicalizes_a_saved_workspace_directory() {
    let data_dir = TempDir::new().expect("data dir");
    let root = data_dir.path().join("workspace");
    fs::create_dir(&root).expect("workspace directory");
    let state = saved_state(data_dir.path(), &root.join("."));

    assert_eq!(
        state.current_optional(),
        Some(fs::canonicalize(root).expect("canonical root"))
    );
}

#[test]
fn set_persists_canonical_root_before_replacing_memory() {
    let data_dir = TempDir::new().expect("data dir");
    let root = data_dir.path().join("workspace");
    fs::create_dir(&root).expect("workspace directory");
    let path = settings_path(data_dir.path());
    let state = WorkspaceRootState::load_from_path(path.clone());

    let selected = state
        .set_from_dialog_selection(&root.join("."))
        .expect("set workspace");
    let canonical = fs::canonicalize(&root).expect("canonical root");

    assert_eq!(selected, canonical);
    assert_eq!(state.current_optional(), Some(canonical.clone()));
    assert_eq!(
        fs::read_to_string(path).expect("settings file"),
        format!(
            "{{\n  \"workspaceRoot\": \"{}\",\n  \"bookmarks\": []\n}}",
            canonical.display()
        )
    );
}

#[test]
fn set_keeps_existing_memory_when_persistence_fails() {
    let data_dir = TempDir::new().expect("data dir");
    let original = data_dir.path().join("original");
    let replacement = data_dir.path().join("replacement");
    fs::create_dir(&original).expect("original directory");
    fs::create_dir(&replacement).expect("replacement directory");
    let path = settings_path(data_dir.path());
    let state = saved_state(data_dir.path(), &original);
    fs::remove_file(&path).expect("remove settings file");
    fs::create_dir(&path).expect("block settings path");

    assert!(state.set_from_dialog_selection(&replacement).is_err());
    assert_eq!(
        state.current_optional(),
        Some(fs::canonicalize(original).expect("canonical original"))
    );
}

#[test]
fn clear_persists_an_empty_setting_before_clearing_memory() {
    let data_dir = TempDir::new().expect("data dir");
    let root = data_dir.path().join("workspace");
    fs::create_dir(&root).expect("workspace directory");
    let path = settings_path(data_dir.path());
    let state = saved_state(data_dir.path(), &root);

    state.clear().expect("clear workspace");

    assert_eq!(state.current_optional(), None);
    assert_eq!(
        fs::read_to_string(path).expect("settings file"),
        "{\n  \"workspaceRoot\": null,\n  \"bookmarks\": []\n}"
    );
}

#[test]
fn clear_keeps_existing_memory_when_persistence_fails() {
    let data_dir = TempDir::new().expect("data dir");
    let root = data_dir.path().join("workspace");
    fs::create_dir(&root).expect("workspace directory");
    let path = settings_path(data_dir.path());
    let state = saved_state(data_dir.path(), &root);
    fs::remove_file(&path).expect("remove settings file");
    fs::create_dir(&path).expect("block settings path");

    assert!(state.clear().is_err());
    assert_eq!(
        state.current_optional(),
        Some(fs::canonicalize(root).expect("canonical root"))
    );
}

#[test]
fn canceled_selection_does_not_establish_or_replace_a_workspace() {
    let data_dir = TempDir::new().expect("data dir");
    let root = data_dir.path().join("workspace");
    fs::create_dir(&root).expect("workspace directory");
    let state = saved_state(data_dir.path(), &root);

    let result = selection_result(&state, None).expect("cancel result");

    assert!(result.canceled);
    assert!(result.file_paths.is_empty());
    assert_eq!(
        state.current_optional(),
        Some(fs::canonicalize(root).expect("canonical root"))
    );

    let first_run = WorkspaceRootState::load_from_path(
        settings_path(data_dir.path()).with_file_name("first-run.json"),
    );
    let result = selection_result(&first_run, None).expect("cancel result");
    assert!(result.canceled);
    assert_eq!(first_run.current_optional(), None);
}

#[test]
fn state_recovers_after_its_lock_is_poisoned() {
    let data_dir = TempDir::new().expect("data dir");
    let state = WorkspaceRootState::load_from_path(settings_path(data_dir.path()));
    let _ = catch_unwind(AssertUnwindSafe(|| {
        let _guard = state.root.write().expect("state write lock");
        panic!("poison workspace state lock");
    }));

    assert_eq!(state.current_optional(), None);
}

#[test]
fn concurrent_clear_cannot_interleave_after_a_selector_persists() {
    let data_dir = TempDir::new().expect("data dir");
    let root = data_dir.path().join("workspace");
    fs::create_dir(&root).expect("workspace directory");
    let path = settings_path(data_dir.path());
    let state = Arc::new(WorkspaceRootState::load_from_path(path.clone()));
    let (selector_arrived_sender, selector_arrived_receiver) = mpsc::channel();
    let (selector_release_sender, selector_release_receiver) = mpsc::channel();
    let hook = Arc::new(TestRendezvous::new(
        selector_arrived_sender,
        selector_release_receiver,
    ));
    *state
        .post_persist_hook
        .lock()
        .expect("post-persist hook lock") = Some(Arc::clone(&hook));

    let mut workers = TransitionWorkers {
        releases: vec![selector_release_sender.clone()],
        selector: None,
        clearer: None,
    };
    let selecting_state = Arc::clone(&state);
    let selecting_root = root.clone();
    workers.selector = Some(std::thread::spawn(move || {
        selecting_state
            .set_from_dialog_selection(&selecting_root)
            .expect("select workspace");
    }));

    selector_arrived_receiver
        .recv_timeout(TEST_COORDINATION_TIMEOUT)
        .expect("selector post-persist rendezvous");
    let canonical_root = fs::canonicalize(&root).expect("canonical root");
    let persisted: WorkspaceSettings = read_json_or_default(&path, "workspace interleaving test");
    assert_eq!(
        persisted.workspace_root,
        Some(canonical_root.display().to_string())
    );
    assert_eq!(state.current_optional(), None);
    assert!(matches!(
        state.operation_lock.try_lock(),
        Err(TryLockError::WouldBlock)
    ));

    let (clear_arrived_sender, clear_arrived_receiver) = mpsc::channel();
    let (clear_release_sender, clear_release_receiver) = mpsc::channel();
    *state
        .before_operation_lock_hook
        .lock()
        .expect("before-operation-lock hook lock") = Some(Arc::new(TestRendezvous::new(
        clear_arrived_sender,
        clear_release_receiver,
    )));
    workers.releases.push(clear_release_sender.clone());
    let clearing_state = Arc::clone(&state);
    workers.clearer = Some(std::thread::spawn(move || {
        clearing_state.clear().expect("clear workspace");
    }));

    clear_arrived_receiver
        .recv_timeout(TEST_COORDINATION_TIMEOUT)
        .expect("clear lock-acquisition rendezvous");
    assert!(matches!(
        state.operation_lock.try_lock(),
        Err(TryLockError::WouldBlock)
    ));
    clear_release_sender
        .send(())
        .expect("release clear lock attempt");
    selector_release_sender
        .send(())
        .expect("release selector root replacement");
    workers.join();

    let persisted: WorkspaceSettings = read_json_or_default(&path, "workspace concurrency test");
    assert_eq!(
        state.current_optional(),
        persisted.workspace_root.map(std::path::PathBuf::from),
        "the in-memory trusted root must reflect the final persisted setting"
    );
}

#[test]
fn concurrent_trust_transitions_recover_when_the_operation_lock_is_poisoned() {
    let data_dir = TempDir::new().expect("data dir");
    let state = WorkspaceRootState::load_from_path(settings_path(data_dir.path()));
    let _ = catch_unwind(AssertUnwindSafe(|| {
        let _guard = state
            .operation_lock
            .lock()
            .expect("workspace operation lock");
        panic!("poison workspace operation lock");
    }));

    state.clear().expect("clear after poisoned operation lock");
    assert_eq!(state.current_optional(), None);
}

#[test]
fn set_from_dialog_selection_rejects_a_nonexistent_directory() {
    // canonical_workspace_directory returns None for a path that cannot be
    // canonicalized (doesn't exist), so set_from_dialog_selection must
    // surface the "accessible directory" error without touching persistence.
    let data_dir = TempDir::new().expect("data dir");
    let state = WorkspaceRootState::load_from_path(settings_path(data_dir.path()));
    let missing = data_dir.path().join("does-not-exist");

    let error = state
        .set_from_dialog_selection(&missing)
        .expect_err("missing directory should be rejected");

    assert!(
        error
            .to_string()
            .contains("The selected workspace must be an accessible directory"),
        "unexpected error: {error}"
    );
    assert_eq!(state.current_optional(), None);
}

#[test]
fn set_from_dialog_selection_rejects_a_file_instead_of_a_directory() {
    // canonical_workspace_directory returns None when the canonical path is
    // not a directory, so selecting a file must be rejected.
    let data_dir = TempDir::new().expect("data dir");
    let file = data_dir.path().join("not-a-dir.txt");
    fs::write(&file, "contents").expect("write file");
    let state = WorkspaceRootState::load_from_path(settings_path(data_dir.path()));

    let error = state
        .set_from_dialog_selection(&file)
        .expect_err("file should be rejected as workspace");

    assert!(
        error
            .to_string()
            .contains("The selected workspace must be an accessible directory"),
        "unexpected error: {error}"
    );
}

#[test]
fn persist_errors_when_no_settings_path_is_configured() {
    // A WorkspaceRootState constructed without a settings_path (e.g. via
    // test_support::managed_workspace_state) cannot persist transitions.
    // commit_transition must surface the "Could not resolve app data
    // directory" error without updating the in-memory root.
    let data_dir = TempDir::new().expect("data dir");
    let original = data_dir.path().join("original");
    fs::create_dir(&original).expect("original directory");
    let replacement = data_dir.path().join("replacement");
    fs::create_dir(&replacement).expect("replacement directory");

    let state = test_support::managed_workspace_state(&original);
    let canonical_original = fs::canonicalize(&original).expect("canonical original");

    let error = state
        .set_from_dialog_selection(&replacement)
        .expect_err("replacement should fail without a settings path");

    assert!(
        error
            .to_string()
            .contains("Could not resolve app data directory"),
        "unexpected error: {error}"
    );
    // The in-memory root must be unchanged because persist failed before
    // the root replacement.
    assert_eq!(state.current_optional(), Some(canonical_original));
}

#[test]
fn selection_result_returns_the_canonical_path_for_a_valid_selection() {
    // The success branch of selection_result canonicalizes the selected
    // path, persists it, and returns a DialogResult with canceled=false.
    let data_dir = TempDir::new().expect("data dir");
    let root = data_dir.path().join("workspace");
    fs::create_dir(&root).expect("workspace directory");
    let state = WorkspaceRootState::load_from_path(settings_path(data_dir.path()));
    let canonical = fs::canonicalize(&root).expect("canonical root");

    let result = selection_result(&state, Some(root)).expect("selection result");

    assert!(!result.canceled);
    assert_eq!(result.file_paths.len(), 1);
    assert_eq!(std::path::PathBuf::from(&result.file_paths[0]), canonical);
    assert_eq!(state.current_optional(), Some(canonical));
}

#[cfg(feature = "e2e")]
#[test]
fn load_reads_workspace_settings_from_the_e2e_data_directory() {
    // With the e2e feature, resolve_dirs honors DTX_E2E_DATA_DIR. load()
    // must read workspace.json from that directory and canonicalize the
    // saved root. This covers the public load() entry point (which
    // delegates to load_from_path) end-to-end.
    let _lock = crate::native_persistence::native_persistence_env_lock()
        .lock()
        .unwrap();
    let data_dir = TempDir::new().expect("data dir");
    let root = data_dir.path().join("workspace");
    fs::create_dir(&root).expect("workspace directory");
    let canonical = fs::canonicalize(&root).expect("canonical root");

    let settings = data_dir.path().join("dtxweb").join("workspace.json");
    fs::create_dir_all(settings.parent().expect("settings parent")).expect("settings parent");
    fs::write(
        &settings,
        format!(
            r#"{{"workspaceRoot":{}}}"#,
            serde_json::to_string(&canonical.to_str().expect("UTF-8 path")).unwrap()
        ),
    )
    .expect("write settings");

    let _env = crate::native_persistence::NativePersistenceEnvGuard::replace(data_dir.path());

    let state = WorkspaceRootState::load();
    assert_eq!(state.current_optional(), Some(canonical));
}

#[cfg(feature = "e2e")]
#[test]
fn load_returns_default_when_the_e2e_data_directory_has_no_settings() {
    // load() must return a default (empty) state when the resolved data
    // directory has no workspace.json, covering the NotFound branch of
    // read_json_or_default through the public load() entry point.
    let _lock = crate::native_persistence::native_persistence_env_lock()
        .lock()
        .unwrap();
    let data_dir = TempDir::new().expect("data dir");
    let _env = crate::native_persistence::NativePersistenceEnvGuard::replace(data_dir.path());

    let state = WorkspaceRootState::load();
    assert_eq!(state.current_optional(), None);
}

// ---------------------------------------------------------------------------
// Bookmark trust-pool logic. The folder dialog is the only operation that
// establishes a trusted root; bookmarks are native-owned and switched by id.
// These tests cover switch_to_bookmark, bookmark_current_root, rename,
// remove, list, and current_root_id — the surface the renderer reaches
// through the registered Tauri commands.
// ---------------------------------------------------------------------------

fn state_with_current_root(data_dir: &std::path::Path) -> (WorkspaceRootState, std::path::PathBuf) {
    let root = data_dir.join("workspace");
    fs::create_dir(&root).expect("workspace directory");
    let state = WorkspaceRootState::load_from_path(settings_path(data_dir));
    let canonical = state
        .set_from_dialog_selection(&root)
        .expect("select workspace");
    (state, canonical)
}

#[test]
fn bookmark_current_root_records_the_current_root_with_a_native_id() {
    let data_dir = TempDir::new().expect("data dir");
    let (state, canonical) = state_with_current_root(data_dir.path());

    let bookmark = state
        .bookmark_current_root("My Songs")
        .expect("bookmark current root");

    assert_eq!(bookmark.path, canonical.to_string_lossy().into_owned());
    assert_eq!(bookmark.name, "My Songs");
    assert!(!bookmark.id.is_empty());
    assert_eq!(state.list_bookmarks().len(), 1);
    assert_eq!(
        state.current_root_id().as_deref(),
        Some(bookmark.id.as_str())
    );
}

#[test]
fn bookmark_current_root_defaults_to_basename_when_name_is_blank() {
    let data_dir = TempDir::new().expect("data dir");
    let (state, _canonical) = state_with_current_root(data_dir.path());

    let bookmark = state.bookmark_current_root("   ").expect("default name");

    assert_eq!(bookmark.name, "workspace");
}

#[test]
fn bookmark_current_root_updates_the_name_when_the_root_is_already_bookmarked() {
    let data_dir = TempDir::new().expect("data dir");
    let (state, _canonical) = state_with_current_root(data_dir.path());

    let first = state
        .bookmark_current_root("First")
        .expect("first bookmark");
    let second = state
        .bookmark_current_root("Second")
        .expect("rename via re-bookmark");

    assert_eq!(first.id, second.id);
    assert_eq!(second.name, "Second");
    assert_eq!(state.list_bookmarks().len(), 1);
}

#[test]
fn bookmark_current_root_rejects_when_no_trusted_root_is_set() {
    let data_dir = TempDir::new().expect("data dir");
    let state = WorkspaceRootState::load_from_path(settings_path(data_dir.path()));

    let error = state
        .bookmark_current_root("Name")
        .expect_err("no current root");

    assert!(error.to_string().contains("A workspace root is required"));
    assert!(state.list_bookmarks().is_empty());
}

#[test]
fn bookmark_current_root_enforces_the_cap() {
    let data_dir = TempDir::new().expect("data dir");
    let (state, _canonical) = state_with_current_root(data_dir.path());

    for i in 0..MAX_BOOKMARKS {
        let dir = data_dir.path().join(format!("ws-{i}"));
        fs::create_dir(&dir).expect("workspace dir");
        state
            .set_from_dialog_selection(&dir)
            .expect("select workspace");
        state
            .bookmark_current_root(&format!("WS {i}"))
            .expect("bookmark");
    }

    // Select a new distinct directory so the next bookmark targets it
    // without disturbing the existing 20 bookmarks.
    let extra = data_dir.path().join("ws-extra");
    fs::create_dir(&extra).expect("extra workspace dir");
    state
        .set_from_dialog_selection(&extra)
        .expect("select extra");

    let error = state
        .bookmark_current_root("Extra")
        .expect_err("cap exceeded");

    assert!(error
        .to_string()
        .contains("Maximum of 20 bookmarks reached"));
    assert_eq!(state.list_bookmarks().len(), MAX_BOOKMARKS);
}

#[test]
fn switch_to_bookmark_switches_the_trusted_root_by_id() {
    let data_dir = TempDir::new().expect("data dir");
    let (state, canonical) = state_with_current_root(data_dir.path());
    let bookmark = state.bookmark_current_root("Mine").expect("bookmark");

    // Clear the current root, then switch back to the bookmarked root by id.
    state.clear().expect("clear");
    assert_eq!(state.current_optional(), None);

    let outcome = state
        .switch_to_bookmark(&bookmark.id)
        .expect("switch outcome");

    assert!(matches!(outcome, SwitchOutcome::Ok { .. }));
    if let SwitchOutcome::Ok { path } = outcome {
        assert_eq!(std::path::PathBuf::from(path), canonical);
    }
    assert_eq!(state.current_optional(), Some(canonical));
}

#[test]
fn switch_to_bookmark_returns_unknown_id_for_an_unrecognized_id() {
    let data_dir = TempDir::new().expect("data dir");
    let (state, _canonical) = state_with_current_root(data_dir.path());

    let outcome = state
        .switch_to_bookmark("not-a-real-id")
        .expect("switch outcome");

    assert!(matches!(outcome, SwitchOutcome::UnknownId));
    // UnknownId must not carry a path — the renderer already holds the
    // bookmark it tried to switch to.
}

#[test]
fn switch_to_bookmark_returns_not_accessible_when_the_path_is_missing() {
    let data_dir = TempDir::new().expect("data dir");
    let (state, canonical) = state_with_current_root(data_dir.path());
    let bookmark = state.bookmark_current_root("Gone").expect("bookmark");

    // Remove the bookmarked directory from disk.
    fs::remove_dir(&canonical).expect("remove workspace dir");

    let outcome = state
        .switch_to_bookmark(&bookmark.id)
        .expect("switch outcome");

    match outcome {
        SwitchOutcome::NotAccessible { path } => {
            assert_eq!(std::path::PathBuf::from(path), canonical);
        }
        other => panic!("expected NotAccessible, got {other:?}"),
    }
    // The trusted root must not change when the bookmark is inaccessible.
    assert_eq!(state.current_optional(), Some(canonical));
}

#[test]
fn switch_to_bookmark_does_not_accept_a_renderer_path() {
    // The only input to switch_to_bookmark is an opaque id. A path string
    // supplied as an id must resolve to UnknownId, never establish trust.
    let data_dir = TempDir::new().expect("data dir");
    let root = data_dir.path().join("sneaky");
    fs::create_dir(&root).expect("sneaky directory");
    let (state, canonical) = state_with_current_root(data_dir.path());

    let outcome = state
        .switch_to_bookmark(root.to_string_lossy().as_ref())
        .expect("switch outcome");

    assert!(matches!(outcome, SwitchOutcome::UnknownId));
    assert_eq!(state.current_optional(), Some(canonical));
    assert!(state.list_bookmarks().is_empty());
}

#[test]
fn rename_bookmark_updates_the_display_name() {
    let data_dir = TempDir::new().expect("data dir");
    let (state, _canonical) = state_with_current_root(data_dir.path());
    let bookmark = state.bookmark_current_root("Old").expect("bookmark");

    state.rename_bookmark(&bookmark.id, "New").expect("rename");

    let updated = state
        .list_bookmarks()
        .into_iter()
        .find(|b| b.id == bookmark.id)
        .expect("bookmark present");
    assert_eq!(updated.name, "New");
}

#[test]
fn rename_bookmark_rejects_an_unknown_id() {
    let data_dir = TempDir::new().expect("data dir");
    let state = WorkspaceRootState::load_from_path(settings_path(data_dir.path()));

    let error = state
        .rename_bookmark("nope", "New")
        .expect_err("unknown bookmark");

    assert!(error.to_string().contains("Unknown workspace bookmark"));
}

#[test]
fn remove_bookmark_drops_the_entry_from_the_trust_pool() {
    let data_dir = TempDir::new().expect("data dir");
    let (state, _canonical) = state_with_current_root(data_dir.path());
    let bookmark = state.bookmark_current_root("Drop").expect("bookmark");

    state.remove_bookmark(&bookmark.id).expect("remove");

    assert!(state.list_bookmarks().is_empty());
    assert_eq!(state.current_root_id(), None);
    // Removing a bookmark does not clear the current trusted root.
    assert!(state.current_optional().is_some());
}

#[test]
fn remove_bookmark_is_idempotent_for_an_unknown_id() {
    let data_dir = TempDir::new().expect("data dir");
    let state = WorkspaceRootState::load_from_path(settings_path(data_dir.path()));

    state.remove_bookmark("nope").expect("idempotent remove");
}

#[test]
fn list_bookmarks_returns_all_entries() {
    let data_dir = TempDir::new().expect("data dir");
    let (state, _canonical) = state_with_current_root(data_dir.path());
    state.bookmark_current_root("A").expect("bookmark A");

    let other = data_dir.path().join("other");
    fs::create_dir(&other).expect("other dir");
    state
        .set_from_dialog_selection(&other)
        .expect("select other");
    state.bookmark_current_root("B").expect("bookmark B");

    let names: Vec<String> = state.list_bookmarks().into_iter().map(|b| b.name).collect();
    assert_eq!(names, vec!["A".to_string(), "B".to_string()]);
}

#[test]
fn current_root_id_is_none_when_the_current_root_is_not_bookmarked() {
    let data_dir = TempDir::new().expect("data dir");
    let (state, _canonical) = state_with_current_root(data_dir.path());

    assert_eq!(state.current_root_id(), None);
}

#[test]
fn bookmarks_persist_across_a_reload() {
    let data_dir = TempDir::new().expect("data dir");
    let (state, canonical) = state_with_current_root(data_dir.path());
    let bookmark = state.bookmark_current_root("Persisted").expect("bookmark");
    drop(state);

    let reloaded = WorkspaceRootState::load_from_path(settings_path(data_dir.path()));
    assert_eq!(reloaded.current_optional(), Some(canonical));
    let reloaded_bookmark = reloaded
        .list_bookmarks()
        .into_iter()
        .find(|b| b.id == bookmark.id)
        .expect("bookmark persisted");
    assert_eq!(reloaded_bookmark.name, "Persisted");
    assert_eq!(
        reloaded.current_root_id().as_deref(),
        Some(bookmark.id.as_str())
    );
}

// ---------------------------------------------------------------------------
// Command wrappers — exercise the State<'_, WorkspaceRootState> extraction
// path via tauri::test::mock_app(). The underlying logic is tested above; these
// cover the thin command wrapper bodies (State deref + return wrapping).
// ---------------------------------------------------------------------------

fn mock_app_with_persistable_workspace(
    data_dir: &std::path::Path,
) -> tauri::App<tauri::test::MockRuntime> {
    let app = tauri::test::mock_app();
    app.manage(WorkspaceRootState::load_from_path(settings_path(data_dir)));
    app
}

#[test]
fn switch_trusted_workspace_command_wrapper_switches_by_id() {
    let data_dir = TempDir::new().expect("data dir");
    let root = data_dir.path().join("workspace");
    fs::create_dir(&root).expect("workspace directory");
    let app = mock_app_with_persistable_workspace(data_dir.path());
    let state = app.state::<WorkspaceRootState>();
    let canonical = state
        .set_from_dialog_selection(&root)
        .expect("select workspace");
    let bookmark = state
        .bookmark_current_root("Mine")
        .expect("bookmark current root");
    state.clear().expect("clear current root");

    let outcome = switch_trusted_workspace(bookmark.id.clone(), app.state::<WorkspaceRootState>())
        .expect("switch outcome");

    assert!(matches!(outcome, SwitchOutcome::Ok { .. }));
    assert_eq!(
        app.state::<WorkspaceRootState>().current_optional(),
        Some(canonical)
    );
}

#[test]
fn switch_trusted_workspace_command_wrapper_returns_unknown_id() {
    let data_dir = TempDir::new().expect("data dir");
    let app = mock_app_with_persistable_workspace(data_dir.path());

    let outcome = switch_trusted_workspace("nope".to_string(), app.state::<WorkspaceRootState>())
        .expect("switch outcome");

    assert!(matches!(outcome, SwitchOutcome::UnknownId));
}

#[test]
fn list_bookmarks_command_wrapper_returns_entries() {
    let data_dir = TempDir::new().expect("data dir");
    let root = data_dir.path().join("workspace");
    fs::create_dir(&root).expect("workspace directory");
    let app = mock_app_with_persistable_workspace(data_dir.path());
    let state = app.state::<WorkspaceRootState>();
    state.set_from_dialog_selection(&root).expect("select");
    state.bookmark_current_root("Mine").expect("bookmark");

    let bookmarks = list_bookmarks(app.state::<WorkspaceRootState>());

    assert_eq!(bookmarks.len(), 1);
    assert_eq!(bookmarks[0].name, "Mine");
}

#[test]
fn get_current_workspace_root_id_command_wrapper_returns_the_bookmark_id() {
    let data_dir = TempDir::new().expect("data dir");
    let root = data_dir.path().join("workspace");
    fs::create_dir(&root).expect("workspace directory");
    let app = mock_app_with_persistable_workspace(data_dir.path());
    let state = app.state::<WorkspaceRootState>();
    state.set_from_dialog_selection(&root).expect("select");
    let bookmark = state.bookmark_current_root("Mine").expect("bookmark");

    let id = get_current_workspace_root_id(app.state::<WorkspaceRootState>());

    assert_eq!(id.as_deref(), Some(bookmark.id.as_str()));
}

#[test]
fn bookmark_current_root_returns_the_existing_entry_without_persisting_when_the_name_is_unchanged()
{
    // Re-bookmarking the current root with the same display name must return
    // the existing entry without re-persisting (the `changed == false` path).
    let data_dir = TempDir::new().expect("data dir");
    let (state, _canonical) = state_with_current_root(data_dir.path());

    let first = state.bookmark_current_root("Same").expect("first bookmark");
    let settings_path = settings_path(data_dir.path());
    let persisted_before = fs::metadata(&settings_path)
        .expect("settings file")
        .modified()
        .expect("mtime");

    // Wait briefly so a re-persist would produce a different mtime.
    std::thread::sleep(std::time::Duration::from_millis(20));

    let second = state
        .bookmark_current_root("Same")
        .expect("re-bookmark same name");

    assert_eq!(first.id, second.id);
    assert_eq!(second.name, "Same");
    assert_eq!(state.list_bookmarks().len(), 1);
    // The settings file must not have been rewritten.
    let persisted_after = fs::metadata(&settings_path)
        .expect("settings file")
        .modified()
        .expect("mtime");
    assert_eq!(
        persisted_before, persisted_after,
        "re-bookmarking with the same name must not persist"
    );
}

#[test]
fn rename_bookmark_defaults_to_basename_when_the_new_name_is_blank() {
    let data_dir = TempDir::new().expect("data dir");
    let (state, canonical) = state_with_current_root(data_dir.path());
    let bookmark = state.bookmark_current_root("Old").expect("bookmark");

    state
        .rename_bookmark(&bookmark.id, "   ")
        .expect("rename to blank");

    let updated = state
        .list_bookmarks()
        .into_iter()
        .find(|b| b.id == bookmark.id)
        .expect("bookmark present");
    // The basename of the canonical workspace path is the last path component.
    let expected = canonical
        .file_name()
        .expect("basename")
        .to_string_lossy()
        .into_owned();
    assert_eq!(updated.name, expected);
}

#[test]
fn rename_bookmark_is_a_no_op_when_the_name_is_unchanged() {
    let data_dir = TempDir::new().expect("data dir");
    let (state, _canonical) = state_with_current_root(data_dir.path());
    let bookmark = state.bookmark_current_root("Keep").expect("bookmark");

    // Renaming to the same name must succeed without persisting.
    state
        .rename_bookmark(&bookmark.id, "Keep")
        .expect("rename same name");

    let updated = state
        .list_bookmarks()
        .into_iter()
        .find(|b| b.id == bookmark.id)
        .expect("bookmark present");
    assert_eq!(updated.name, "Keep");
}

#[test]
fn bookmark_current_root_command_wrapper_records_the_current_root() {
    let data_dir = TempDir::new().expect("data dir");
    let root = data_dir.path().join("workspace");
    fs::create_dir(&root).expect("workspace directory");
    let app = mock_app_with_persistable_workspace(data_dir.path());
    let state = app.state::<WorkspaceRootState>();
    state.set_from_dialog_selection(&root).expect("select");

    let bookmark = bookmark_current_root("Mine".to_string(), app.state::<WorkspaceRootState>())
        .expect("bookmark command");

    assert_eq!(bookmark.name, "Mine");
    assert!(!bookmark.id.is_empty());
    assert_eq!(app.state::<WorkspaceRootState>().list_bookmarks().len(), 1);
}

#[test]
fn rename_bookmark_command_wrapper_updates_the_display_name() {
    let data_dir = TempDir::new().expect("data dir");
    let root = data_dir.path().join("workspace");
    fs::create_dir(&root).expect("workspace directory");
    let app = mock_app_with_persistable_workspace(data_dir.path());
    let state = app.state::<WorkspaceRootState>();
    state.set_from_dialog_selection(&root).expect("select");
    let bookmark = bookmark_current_root("Old".to_string(), app.state::<WorkspaceRootState>())
        .expect("bookmark");

    rename_bookmark(
        bookmark.id.clone(),
        "New".to_string(),
        app.state::<WorkspaceRootState>(),
    )
    .expect("rename command");

    let updated = app
        .state::<WorkspaceRootState>()
        .list_bookmarks()
        .into_iter()
        .find(|b| b.id == bookmark.id)
        .expect("bookmark present");
    assert_eq!(updated.name, "New");
}

#[test]
fn remove_bookmark_command_wrapper_drops_the_entry() {
    let data_dir = TempDir::new().expect("data dir");
    let root = data_dir.path().join("workspace");
    fs::create_dir(&root).expect("workspace directory");
    let app = mock_app_with_persistable_workspace(data_dir.path());
    let state = app.state::<WorkspaceRootState>();
    state.set_from_dialog_selection(&root).expect("select");
    let bookmark = bookmark_current_root("Drop".to_string(), app.state::<WorkspaceRootState>())
        .expect("bookmark");

    remove_bookmark(bookmark.id.clone(), app.state::<WorkspaceRootState>())
        .expect("remove command");

    assert!(app
        .state::<WorkspaceRootState>()
        .list_bookmarks()
        .is_empty());
}
