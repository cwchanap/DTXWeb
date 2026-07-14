use super::*;
use std::collections::HashMap;
use std::fs;
use std::sync::{Mutex, OnceLock};
use tempfile::TempDir;

/// Singleton mutex serializing tests that mutate the process-global `HOME`
/// env var. Without this, parallel test runs race: one test's `set_var` is
/// visible to another test's `dirs::home_dir()` call, producing flaky failures.
fn home_env_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// RAII guard that restores the `HOME` environment variable on drop,
/// including when an assertion between construction and the end of scope
/// panics. Without this, a failing assertion leaks the temporary `HOME`
/// into subsequent tests running in the same process.
struct HomeEnvGuard {
    saved: Option<std::ffi::OsString>,
}

impl HomeEnvGuard {
    fn replace(temp_path: &std::path::Path) -> Self {
        let saved = std::env::var_os("HOME");
        std::env::set_var("HOME", temp_path);
        Self { saved }
    }
}

impl Drop for HomeEnvGuard {
    fn drop(&mut self) {
        match self.saved.take() {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
    }
}

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
            score_links: HashMap::new(),
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
fn write_is_atomic_no_temp_file_left_behind() {
    let dir = TempDir::new().unwrap();
    let path = preferences_path(dir.path());
    write_preferences_to(&path, &Preferences::default()).unwrap();
    // A successful write must rename the temp file into place, leaving no .tmp.
    let tmp = dir.path().join(".dtxweb").join("preferences.json.tmp");
    assert!(
        !tmp.exists(),
        "temp file should not linger after a clean write"
    );
    assert!(path.exists());
    // And the resulting file must be valid JSON (round-trips).
    let read = read_preferences_from(&path);
    assert_eq!(read.detail_pane_width, 420.0);
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

#[test]
fn write_clamps_out_of_range_width() {
    let dir = TempDir::new().unwrap();
    let path = preferences_path(dir.path());
    // Writing a too-large value must persist the clamped max, not the raw input.
    write_preferences_to(
        &path,
        &Preferences {
            detail_pane_width: 5000.0,
            detail_pane_visible: true,
            score_links: HashMap::new(),
        },
    )
    .unwrap();
    assert_eq!(read_preferences_from(&path).detail_pane_width, 640.0);

    // Writing a too-small value must persist the clamped min.
    write_preferences_to(
        &path,
        &Preferences {
            detail_pane_width: 10.0,
            detail_pane_visible: true,
            score_links: HashMap::new(),
        },
    )
    .unwrap();
    assert_eq!(read_preferences_from(&path).detail_pane_width, 320.0);
}

// ---------------------------------------------------------------------------
// score_links (persisted via the preferences store per spec §5.3)
// ---------------------------------------------------------------------------

#[test]
fn read_missing_file_returns_empty_score_links() {
    let dir = TempDir::new().unwrap();
    let prefs = read_preferences_from(&preferences_path(dir.path()));
    assert!(prefs.score_links.is_empty());
}

#[test]
fn write_then_read_score_links_round_trips() {
    let dir = TempDir::new().unwrap();
    let path = preferences_path(dir.path());
    let mut links = HashMap::new();
    links.insert("Played Song\u{1f}Artist A".to_string(), "42".to_string());
    write_preferences_to(
        &path,
        &Preferences {
            detail_pane_width: 420.0,
            detail_pane_visible: true,
            score_links: links,
        },
    )
    .unwrap();
    let read = read_preferences_from(&path);
    assert_eq!(
        read.score_links
            .get("Played Song\u{1f}Artist A")
            .map(String::as_str),
        Some("42")
    );
}

#[test]
fn read_score_links_tolerates_corrupt_file() {
    let dir = TempDir::new().unwrap();
    let path = preferences_path(dir.path());
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, b"{ not json").unwrap();
    let prefs = read_preferences_from(&path);
    assert!(prefs.score_links.is_empty());
}

#[test]
fn partial_json_without_score_links_field_defaults_to_empty() {
    let dir = TempDir::new().unwrap();
    let path = preferences_path(dir.path());
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    // An older preferences file without the scoreLinks field must still load.
    fs::write(
        &path,
        r#"{"detailPaneWidth": 400, "detailPaneVisible": true}"#,
    )
    .unwrap();
    let prefs = read_preferences_from(&path);
    assert!(prefs.score_links.is_empty());
    assert_eq!(prefs.detail_pane_width, 400.0);
}

#[test]
fn read_score_song_links_command_returns_empty_when_no_file() {
    let _guard = home_env_lock().lock().unwrap_or_else(|e| e.into_inner());
    let dir = TempDir::new().unwrap();
    let _home = HomeEnvGuard::replace(dir.path());
    let links = read_score_song_links();
    assert!(links.is_empty());
}

#[test]
fn write_then_read_score_song_links_command_round_trips() {
    let _guard = home_env_lock().lock().unwrap_or_else(|e| e.into_inner());
    let dir = TempDir::new().unwrap();
    let _home = HomeEnvGuard::replace(dir.path());

    let mut links = HashMap::new();
    links.insert("Song A\u{1f}Artist X".to_string(), "7".to_string());
    write_score_song_links(links).expect("write command");

    let read = read_score_song_links();
    assert_eq!(
        read.get("Song A\u{1f}Artist X").map(String::as_str),
        Some("7")
    );
}

#[test]
fn write_score_song_links_command_creates_dtxweb_dir() {
    let _guard = home_env_lock().lock().unwrap_or_else(|e| e.into_inner());
    let dir = TempDir::new().unwrap();
    let _home = HomeEnvGuard::replace(dir.path());

    assert!(!dir.path().join(".dtxweb").exists());

    let links = HashMap::from([("k".to_string(), "v".to_string())]);
    write_score_song_links(links).expect("write command");

    assert!(dir.path().join(".dtxweb").join("preferences.json").exists());
}

#[test]
fn write_score_song_links_preserves_existing_ui_prefs() {
    let _guard = home_env_lock().lock().unwrap_or_else(|e| e.into_inner());
    let dir = TempDir::new().unwrap();
    let _home = HomeEnvGuard::replace(dir.path());

    // First, write UI prefs via write_preferences.
    write_preferences(Preferences {
        detail_pane_width: 500.0,
        detail_pane_visible: false,
        score_links: HashMap::new(),
    })
    .expect("write prefs");

    // Then, write score links via write_score_song_links — must not clobber
    // the detail pane width/visibility.
    let links = HashMap::from([("k".to_string(), "v".to_string())]);
    write_score_song_links(links).expect("write links");

    let prefs = read_preferences();
    assert_eq!(prefs.detail_pane_width, 500.0);
    assert!(!prefs.detail_pane_visible);
    assert_eq!(prefs.score_links.get("k").map(String::as_str), Some("v"));
}
