use super::*;
use std::sync::{Mutex, OnceLock};
use tempfile::tempdir;

/// Singleton mutex serializing tests that mutate the process-global `HOME`
/// env var. Without this, parallel test runs race: one test's `set_var` is
/// visible to another test's `dirs::home_dir()` call, producing flaky failures.
fn home_env_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

#[test]
fn read_missing_returns_empty_map() {
    let dir = tempdir().expect("tempdir");
    let path = dir.path().join("score_links.json");
    assert!(read_score_song_links_from(&path).is_empty());
}

#[test]
fn write_then_read_round_trips() {
    let dir = tempdir().expect("tempdir");
    let path = dir.path().join("score_links.json");

    let mut links = std::collections::HashMap::new();
    links.insert("Played Song\u{1f}Artist A".to_string(), "42".to_string());
    write_score_song_links_to(&path, &links).expect("write");

    let read = read_score_song_links_from(&path);
    assert_eq!(
        read.get("Played Song\u{1f}Artist A").map(String::as_str),
        Some("42")
    );
}

#[test]
fn read_tolerates_corrupt_file() {
    let dir = tempdir().expect("tempdir");
    let path = dir.path().join("score_links.json");
    std::fs::write(&path, b"{ not json").expect("write garbage");
    assert!(read_score_song_links_from(&path).is_empty());
}

#[test]
fn read_score_song_links_command_returns_empty_when_no_file() {
    let _guard = home_env_lock().lock().unwrap();
    let dir = tempdir().expect("tempdir");
    let original_home = std::env::var_os("HOME");
    std::env::set_var("HOME", dir.path());

    let links = read_score_song_links();
    assert!(links.is_empty());

    if let Some(home) = original_home {
        std::env::set_var("HOME", home);
    } else {
        std::env::remove_var("HOME");
    }
}

#[test]
fn write_then_read_score_song_links_command_round_trips() {
    let _guard = home_env_lock().lock().unwrap();
    let dir = tempdir().expect("tempdir");
    let original_home = std::env::var_os("HOME");
    std::env::set_var("HOME", dir.path());

    let mut links = std::collections::HashMap::new();
    links.insert("Song A\u{1f}Artist X".to_string(), "7".to_string());
    write_score_song_links(links.clone()).expect("write command");

    let read = read_score_song_links();
    assert_eq!(
        read.get("Song A\u{1f}Artist X").map(String::as_str),
        Some("7")
    );

    if let Some(home) = original_home {
        std::env::set_var("HOME", home);
    } else {
        std::env::remove_var("HOME");
    }
}

#[test]
fn write_score_song_links_command_creates_dtxweb_dir() {
    let _guard = home_env_lock().lock().unwrap();
    let dir = tempdir().expect("tempdir");
    let original_home = std::env::var_os("HOME");
    std::env::set_var("HOME", dir.path());

    // The .dtxweb directory does not exist yet.
    assert!(!dir.path().join(".dtxweb").exists());

    let links = std::collections::HashMap::from([("k".to_string(), "v".to_string())]);
    write_score_song_links(links).expect("write command");

    // The command must create .dtxweb/ and write score_links.json inside it.
    assert!(dir.path().join(".dtxweb").join("score_links.json").exists());

    if let Some(home) = original_home {
        std::env::set_var("HOME", home);
    } else {
        std::env::remove_var("HOME");
    }
}
