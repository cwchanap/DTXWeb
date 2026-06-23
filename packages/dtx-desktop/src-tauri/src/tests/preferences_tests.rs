use super::*;
use std::fs;
use tempfile::TempDir;

#[test]
fn read_missing_file_returns_defaults() {
    let dir = TempDir::new().unwrap();
    let prefs = read_preferences_from(&preferences_path(dir.path()));
    assert_eq!(prefs.detail_pane_width, 420.0);
    assert!(prefs.detail_pane_visible);
}

#[test]
fn write_then_read_round_trips() {
    let dir = TempDir::new().unwrap();
    let path = preferences_path(dir.path());
    write_preferences_to(
        &path,
        &Preferences {
            detail_pane_width: 500.0,
            detail_pane_visible: false,
        },
    )
    .unwrap();
    let read = read_preferences_from(&path);
    assert_eq!(read.detail_pane_width, 500.0);
    assert!(!read.detail_pane_visible);
}

#[test]
fn write_creates_dtxweb_directory_and_file() {
    let dir = TempDir::new().unwrap();
    let path = preferences_path(dir.path());
    assert!(!path.exists());
    write_preferences_to(&path, &Preferences::default()).unwrap();
    assert!(path.exists());
    assert_eq!(dir.path().join(".dtxweb").join("preferences.json"), path);
}

#[test]
fn corrupt_json_returns_defaults() {
    let dir = TempDir::new().unwrap();
    let path = preferences_path(dir.path());
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, "{ not valid json ").unwrap();
    let prefs = read_preferences_from(&path);
    assert_eq!(prefs.detail_pane_width, 420.0);
    assert!(prefs.detail_pane_visible);
}

#[test]
fn partial_json_fills_missing_field_defaults() {
    let dir = TempDir::new().unwrap();
    let path = preferences_path(dir.path());
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, r#"{"detailPaneVisible": false}"#).unwrap();
    let prefs = read_preferences_from(&path);
    assert_eq!(prefs.detail_pane_width, 420.0);
    assert!(!prefs.detail_pane_visible);
}

#[test]
fn read_clamps_out_of_range_width() {
    let dir = TempDir::new().unwrap();
    let path = preferences_path(dir.path());
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(
        &path,
        r#"{"detailPaneWidth": 5000, "detailPaneVisible": true}"#,
    )
    .unwrap();
    assert_eq!(read_preferences_from(&path).detail_pane_width, 640.0);

    fs::write(
        &path,
        r#"{"detailPaneWidth": 10, "detailPaneVisible": true}"#,
    )
    .unwrap();
    assert_eq!(read_preferences_from(&path).detail_pane_width, 320.0);
}
