use super::*;
use std::fs;
use std::sync::Arc;
use tempfile::tempdir;

#[test]
fn folder_settings_are_isolated_by_drumery_user() {
    let data_dir = tempdir().expect("data dir");
    let store = GoogleDriveSettingsStore::new(data_dir.path().to_path_buf());
    store
        .set_folder_for_user("user-a", folder("folder-a", "A uploads"))
        .expect("save user a folder");
    store
        .set_folder_for_user("user-b", folder("folder-b", "B uploads"))
        .expect("save user b folder");

    assert_eq!(
        store.folder_for_user("user-a"),
        Some(folder("folder-a", "A uploads"))
    );
    assert_eq!(
        store.folder_for_user("user-b"),
        Some(folder("folder-b", "B uploads"))
    );
}

#[test]
fn malformed_settings_json_loads_as_an_empty_folder_map() {
    let data_dir = tempdir().expect("data dir");
    let path = google_drive_settings_path(data_dir.path());
    fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
    fs::write(&path, "not-json").expect("write corrupt settings");
    let store = GoogleDriveSettingsStore::new(data_dir.path().to_path_buf());

    assert_eq!(store.folder_for_user("user-a"), None);
}

#[test]
fn concurrent_full_read_modify_write_preserves_each_users_folder() {
    let data_dir = tempdir().expect("data dir");
    let first = Arc::new(GoogleDriveSettingsStore::new(data_dir.path().to_path_buf()));
    let second = first.clone();

    let first_write = std::thread::spawn(move || {
        first
            .set_folder_for_user("user-a", folder("folder-a", "A uploads"))
            .expect("first write")
    });
    let second_write = std::thread::spawn(move || {
        second
            .set_folder_for_user("user-b", folder("folder-b", "B uploads"))
            .expect("second write")
    });
    first_write.join().expect("first thread");
    second_write.join().expect("second thread");

    let reopened = GoogleDriveSettingsStore::new(data_dir.path().to_path_buf());
    assert_eq!(
        reopened.folder_for_user("user-a"),
        Some(folder("folder-a", "A uploads"))
    );
    assert_eq!(
        reopened.folder_for_user("user-b"),
        Some(folder("folder-b", "B uploads"))
    );
}

#[test]
fn settings_serialization_never_contains_a_refresh_token() {
    let settings = GoogleDriveSettings {
        google_drive_folders_by_user: [("user-42".to_string(), folder("folder-42", "Uploads"))]
            .into_iter()
            .collect(),
    };

    let serialized = serde_json::to_string(&settings).expect("serialize settings");
    assert!(!serialized.contains("refresh-token-secret"));
    assert!(!serialized.contains("refreshToken"));
}

#[test]
fn clear_folder_for_user_removes_only_the_targeted_users_folder() {
    let data_dir = tempdir().expect("data dir");
    let store = GoogleDriveSettingsStore::new(data_dir.path().to_path_buf());
    store
        .set_folder_for_user("user-a", folder("folder-a", "A uploads"))
        .expect("save user a folder");
    store
        .set_folder_for_user("user-b", folder("folder-b", "B uploads"))
        .expect("save user b folder");

    store.clear_folder_for_user("user-a").expect("clear user a");

    assert_eq!(store.folder_for_user("user-a"), None);
    assert_eq!(
        store.folder_for_user("user-b"),
        Some(folder("folder-b", "B uploads"))
    );
}

#[test]
fn clear_folder_for_user_succeeds_when_no_folder_was_saved() {
    // Clearing a user that never had a folder is a no-op rather than an
    // error — logout flows call this unconditionally and must not fail.
    let data_dir = tempdir().expect("data dir");
    let store = GoogleDriveSettingsStore::new(data_dir.path().to_path_buf());

    store
        .clear_folder_for_user("never-set")
        .expect("clear absent user");

    assert_eq!(store.folder_for_user("never-set"), None);
}

#[test]
fn clear_folder_for_user_persists_removal_across_a_reopened_store() {
    let data_dir = tempdir().expect("data dir");
    let path = google_drive_settings_path(data_dir.path());
    let store = GoogleDriveSettingsStore::new(data_dir.path().to_path_buf());
    store
        .set_folder_for_user("user-a", folder("folder-a", "A uploads"))
        .expect("save user a folder");
    assert!(path.is_file());

    store.clear_folder_for_user("user-a").expect("clear user a");

    let reopened = GoogleDriveSettingsStore::new(data_dir.path().to_path_buf());
    assert_eq!(reopened.folder_for_user("user-a"), None);
}

#[test]
fn settings_access_trait_delegates_clear_to_the_store_impl() {
    // The trait impls forward to the inherent methods. Exercise the trait
    // path so the vtable dispatch (used by Drive state through the trait
    // object) is covered, not just the concrete method.
    let data_dir = tempdir().expect("data dir");
    let store = GoogleDriveSettingsStore::new(data_dir.path().to_path_buf());
    let access: &dyn GoogleDriveSettingsAccess = &store;
    access
        .set_folder_for_user("user-a", folder("folder-a", "A uploads"))
        .expect("trait set");
    assert_eq!(
        access.folder_for_user("user-a"),
        Some(folder("folder-a", "A uploads"))
    );
    access.clear_folder_for_user("user-a").expect("trait clear");
    assert_eq!(access.folder_for_user("user-a"), None);
}

fn folder(id: &str, name: &str) -> GoogleDriveFolderSetting {
    GoogleDriveFolderSetting {
        id: id.to_string(),
        name: name.to_string(),
    }
}
