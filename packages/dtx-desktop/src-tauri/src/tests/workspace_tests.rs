use super::*;
use std::fs;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{mpsc, Arc, Barrier, TryLockError};
use tempfile::TempDir;

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
        format!("{{\n  \"workspaceRoot\": \"{}\"\n}}", canonical.display())
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
        "{\n  \"workspaceRoot\": null\n}"
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
    let hook = Arc::new(PostPersistHook {
        arrived: Arc::new(Barrier::new(2)),
        release: Arc::new(Barrier::new(2)),
    });
    *state
        .post_persist_hook
        .lock()
        .expect("post-persist hook lock") = Some(Arc::clone(&hook));

    let selecting_state = Arc::clone(&state);
    let selecting_root = root.clone();
    let selecting = std::thread::spawn(move || {
        selecting_state
            .set_from_dialog_selection(&selecting_root)
            .expect("select workspace");
    });

    hook.arrived.wait();
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

    let (clear_started_sender, clear_started_receiver) = mpsc::channel();
    let (clear_finished_sender, clear_finished_receiver) = mpsc::channel();
    let clearing_state = Arc::clone(&state);
    let clearing = std::thread::spawn(move || {
        clear_started_sender.send(()).expect("clear start signal");
        clearing_state.clear().expect("clear workspace");
        clear_finished_sender.send(()).expect("clear finish signal");
    });

    clear_started_receiver.recv().expect("clear worker started");
    hook.release.wait();
    selecting.join().expect("selecting worker");
    clear_finished_receiver
        .recv()
        .expect("clear worker finished");
    clearing.join().expect("clearing worker");

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
