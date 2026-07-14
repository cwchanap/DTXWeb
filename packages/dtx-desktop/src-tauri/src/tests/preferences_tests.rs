use super::*;
use std::collections::HashMap;
use std::fs;
use std::sync::Arc;
use std::sync::Barrier;
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

#[test]
fn write_score_song_links_clear_all_with_empty_map() {
    let _guard = home_env_lock().lock().unwrap_or_else(|e| e.into_inner());
    let dir = TempDir::new().unwrap();
    let _home = HomeEnvGuard::replace(dir.path());

    // Seed with non-empty links.
    let links = HashMap::from([("k1".to_string(), "v1".to_string())]);
    write_score_song_links(links).expect("seed links");
    assert_eq!(
        read_score_song_links().get("k1").map(String::as_str),
        Some("v1")
    );

    // Clear-all: write an empty map. This must actually clear, not silently
    // restore the old links (regression: write_preferences merges empty
    // score_links with on-disk links, turning a clear into a no-op).
    write_score_song_links(HashMap::new()).expect("clear links");
    assert!(
        read_score_song_links().is_empty(),
        "empty write must clear score_links, not restore them"
    );
}

/// Stress test for the `preferences_write_lock` invariant: concurrent
/// `write_preferences` (UI layout saves that merge to preserve score_links)
/// and `write_score_song_links` (score-link replaces) must not lose updates.
///
/// Without the write lock, the classic lost-update race is:
///   1. write_preferences reads on-disk prefs (score_links = old)
///   2. write_score_song_links reads old prefs, sets new links, writes
///   3. write_preferences merges (empty score_links → preserve old from step 1),
///      writes stale score_links → clobbers step 2's new links
///
/// With the lock, each RMW is a critical section so both the UI prefs and the
/// score links from the respective last writes always survive. A barrier
/// synchronizes the two threads to start simultaneously, maximizing contention
/// so a missing lock would manifest as a stale clobber within the iteration
/// count. The assertion checks the end state: the last write_score_song_links
/// links must be present (not clobbered by a stale write_preferences), and the
/// last write_preferences width must be present (not clobbered by a stale
/// write_score_song_links that read old UI prefs).
#[test]
fn concurrent_write_preferences_and_score_links_no_lost_updates() {
    let _guard = home_env_lock().lock().unwrap_or_else(|e| e.into_inner());
    let dir = TempDir::new().unwrap();
    let _home = HomeEnvGuard::replace(dir.path());

    // Seed: UI prefs + one score link.
    write_preferences(Preferences {
        detail_pane_width: 400.0,
        detail_pane_visible: true,
        score_links: HashMap::new(),
    })
    .expect("seed prefs");
    write_score_song_links(HashMap::from([("seed".to_string(), "1".to_string())]))
        .expect("seed links");

    const ITERATIONS: usize = 200;
    let barrier = Arc::new(Barrier::new(2));

    let barrier_a = barrier.clone();
    let handle_a = std::thread::spawn(move || {
        barrier_a.wait();
        for i in 0..ITERATIONS {
            write_preferences(Preferences {
                // Vary width so each write is distinguishable; the last writer's
                // width is what we assert below. Empty score_links triggers the
                // merge that preserves on-disk links — the exact path that
                // clobbers a concurrent write_score_song_links without the lock.
                detail_pane_width: 400.0 + (i as f64),
                detail_pane_visible: true,
                score_links: HashMap::new(),
            })
            .expect("write_preferences in thread A");
        }
    });

    let barrier_b = barrier.clone();
    let handle_b = std::thread::spawn(move || {
        barrier_b.wait();
        for i in 0..ITERATIONS {
            // Each call replaces the entire score_links map. The last call's
            // single key is what should survive — a stale write_preferences
            // would restore an earlier key (or "seed") instead.
            let key = format!("link_{i}");
            write_score_song_links(HashMap::from([(key, i.to_string())]))
                .expect("write_score_song_links in thread B");
        }
    });

    handle_a.join().expect("thread A panicked");
    handle_b.join().expect("thread B panicked");

    // Both writers preserve the other's field:
    //   write_preferences merges (preserves score_links)
    //   write_score_song_links reads current prefs (preserves UI prefs)
    // So the final state must carry BOTH the last width AND the last links.
    // Without the lock, a stale write_preferences could clobber the latest
    // score_links with an earlier read's snapshot.
    let prefs = read_preferences();
    // Width must be > the seed 400.0 — i.e., at least one write_preferences
    // landed after the seed and was not clobbered by a stale
    // write_score_song_links that read the seed width. (write_score_song_links
    // preserves UI prefs, so this holds regardless of which thread wrote last.)
    assert!(
        prefs.detail_pane_width > 400.0,
        "write_preferences width updates were lost (width = {}, expected > 400.0)",
        prefs.detail_pane_width
    );
    // Score links must be a "link_N" key from thread B, not the stale "seed".
    // Without the lock, a stale write_preferences RMW could restore "seed".
    let links = &prefs.score_links;
    assert!(
        links.keys().any(|k| k.starts_with("link_")),
        "score links were clobbered by a stale write_preferences RMW: {:?}",
        links
    );
    assert!(
        !links.contains_key("seed"),
        "stale seed link survived — a write_preferences RMW read before the first write_score_song_links and wrote back the stale snapshot: {:?}",
        links
    );
}
