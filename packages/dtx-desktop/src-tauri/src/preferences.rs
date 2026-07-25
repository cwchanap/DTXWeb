use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};

use crate::error::{DesktopError, Result};

/// Serializes read-modify-write cycles on `preferences.json`. Both
/// `write_preferences` (UI layout saves, which merge to preserve score_links)
/// and `write_score_song_links` (score-link updates/clears) do unlocked RMW on
/// the same file; without a lock, two concurrent calls can silently clobber
/// each other's updates (atomic rename prevents corruption but not lost
/// updates). The guard is held across the full RMW so the read, merge, and
/// write happen as one critical section.
///
/// `OnceLock` avoids a new dependency (available since Rust 1.70). Poisoned-
/// mutex recovery matches `DtxmaniaDbState` in `scores.rs`: a panic while
/// holding the lock is non-fatal — the next caller takes the inner value and
/// proceeds, since a stale preferences file is recoverable (defaults fallback)
/// and not worth poisoning the whole app over.
fn preferences_write_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// Resolves the data and home directories for the preferences commands.
///
/// When the `e2e` Cargo feature is active and `DTX_E2E_DATA_DIR` is set, both
/// directories are overridden to that path so e2e tests read/write preferences
/// inside an isolated temp directory instead of the developer's real per-user
/// data directory. This is necessary on Windows, where `dirs::data_dir()` uses
/// `SHGetKnownFolderPath` and ignores `APPDATA`/`USERPROFILE` env vars —
/// without this override, `bun run e2e:desktop` on Windows would touch the
/// user's real `%APPDATA%/dtxweb/preferences.json`.
///
/// When the env var is unset (normal app runs, or e2e builds without the
/// feature), falls through to `dirs::data_dir()` / `dirs::home_dir()`.
#[cfg(feature = "e2e")]
fn resolve_dirs() -> (Option<PathBuf>, Option<PathBuf>) {
    match std::env::var("DTX_E2E_DATA_DIR") {
        Ok(dir) if !dir.is_empty() => {
            let path = PathBuf::from(dir);
            (Some(path.clone()), Some(path))
        }
        _ => (dirs::data_dir(), dirs::home_dir()),
    }
}

#[cfg(not(feature = "e2e"))]
fn resolve_dirs() -> (Option<PathBuf>, Option<PathBuf>) {
    (dirs::data_dir(), dirs::home_dir())
}

const MIN_DETAIL_WIDTH: f64 = 320.0;
const MAX_DETAIL_WIDTH: f64 = 640.0;

fn default_detail_pane_width() -> f64 {
    420.0
}

fn default_detail_pane_visible() -> bool {
    true
}

/// UI preferences persisted to `<data_dir>/dtxweb/preferences.json`, where
/// `data_dir` is the platform-appropriate per-user data directory
/// (`~/Library/Application Support` on macOS, `%APPDATA%` on Windows,
/// `$XDG_DATA_HOME`/`~/.local/share` on Linux). Pre-Tauri builds used
/// `~/.dtxweb/preferences.json` (a home-dir dotfile); that path is kept as a
/// read fallback so existing users' preferences migrate on the first write.
/// Every field has a serde default so older/partial files load cleanly as the
/// schema grows.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    #[serde(default = "default_detail_pane_width")]
    pub detail_pane_width: f64,
    #[serde(default = "default_detail_pane_visible")]
    pub detail_pane_visible: bool,
    /// DTXMania-song → cloud-simfile-id mappings for the Scores view (spec §5.3).
    /// Keyed by `"{songs.db absolute path}\\u{001f}{Songs.Id}"`, matching
    /// `songKey` in Scores.svelte — `Songs.Id` is only unique within one
    /// database file, so the path scopes links when the user switches DBs.
    /// Legacy unscoped keys (bare songId / title+artist) are orphaned and
    /// pruned on the next load. Empty by default so older preferences files
    /// without this field load cleanly.
    #[serde(default)]
    pub score_links: HashMap<String, String>,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            detail_pane_width: default_detail_pane_width(),
            detail_pane_visible: default_detail_pane_visible(),
            score_links: HashMap::new(),
        }
    }
}

fn clamp_width(width: f64) -> f64 {
    width.clamp(MIN_DETAIL_WIDTH, MAX_DETAIL_WIDTH)
}

/// New platform-appropriate preferences path: `<data_dir>/dtxweb/preferences.json`.
/// `data_dir` is expected to come from `dirs::data_dir()` (or a temp dir in tests).
fn preferences_path(data_dir: &Path) -> PathBuf {
    data_dir.join("dtxweb").join("preferences.json")
}

/// Legacy pre-Tauri path: `~/.dtxweb/preferences.json`. Kept as a read
/// fallback so existing desktop users' preferences survive the path
/// migration. Writes always go to the new path; after a successful write,
/// the legacy file is best-effort removed so the migration is one-way.
fn legacy_preferences_path(home: &Path) -> PathBuf {
    home.join(".dtxweb").join("preferences.json")
}

/// Resolves the read path: tries the new `<data_dir>/dtxweb/...` path first,
/// then falls back to the legacy `~/.dtxweb/...` path. Returns `None` when
/// neither exists (first-run or fresh install). Pure function for testability
/// — the Tauri commands pass `dirs::data_dir()` / `dirs::home_dir()`.
fn resolve_read_path_from(data_dir: Option<&Path>, home: Option<&Path>) -> Option<PathBuf> {
    if let Some(dir) = data_dir {
        let new_path = preferences_path(dir);
        if new_path.exists() {
            return Some(new_path);
        }
    }
    if let Some(home) = home {
        let legacy = legacy_preferences_path(home);
        if legacy.exists() {
            return Some(legacy);
        }
    }
    None
}

/// Resolves the write path: `<data_dir>/dtxweb/...` when `data_dir` is
/// available, else falls back to the legacy `~/.dtxweb/...` path so a
/// missing data dir (rare, but possible in headless/sandboxed envs) doesn't
/// prevent writes entirely.
fn resolve_write_path_from(data_dir: Option<&Path>, home: Option<&Path>) -> Result<PathBuf> {
    if let Some(dir) = data_dir {
        return Ok(preferences_path(dir));
    }
    match home {
        Some(home) => Ok(legacy_preferences_path(home)),
        None => Err(DesktopError::Message(
            "Could not resolve data or home directory".to_string(),
        )),
    }
}

/// Best-effort cleanup of the legacy `~/.dtxweb/preferences.json` after a
/// successful write to the new path. Failure is silent — the read path
/// checks the new path first, so a lingering legacy file is harmless (just
/// dead data). Only removes the file, not the `~/.dtxweb/` directory (the
/// user may have other files there from pre-Tauri builds).
fn try_remove_legacy(home: Option<&Path>) {
    if let Some(home) = home {
        let legacy = legacy_preferences_path(home);
        if legacy.exists() {
            let _ = fs::remove_file(&legacy);
        }
    }
}

/// Returns defaults if the file is missing or unparseable; clamps width.
/// A missing file is silent (first-run). A present-but-corrupt file logs a
/// warning to stderr so the user can investigate data loss (all UI prefs +
/// score links reset to defaults) rather than silently swallowing it.
fn read_preferences_from(path: &Path) -> Preferences {
    let mut prefs = match fs::read_to_string(path) {
        Ok(contents) => match serde_json::from_str::<Preferences>(&contents) {
            Ok(parsed) => parsed,
            Err(err) => {
                eprintln!(
                    "[preferences] failed to parse {}: {err} — using defaults",
                    path.display()
                );
                Preferences::default()
            }
        },
        Err(_) => Preferences::default(),
    };
    prefs.detail_pane_width = clamp_width(prefs.detail_pane_width);
    prefs
}

/// Creates the parent directory if absent, then writes pretty JSON atomically.
///
/// Writes to a sibling temp file and renames it into place, so a crash mid-write
/// cannot leave `preferences.json` truncated/corrupt. (The read path already
/// falls back to defaults on a parse error, but losing the user's prefs on a
/// crash is still worth avoiding.)
fn write_preferences_to(path: &Path, prefs: &Preferences) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    // Mirror read_preferences_from and clamp on write so the on-disk invariant
    // (MIN_DETAIL_WIDTH..=MAX_DETAIL_WIDTH) holds regardless of the caller.
    let mut sanitized = prefs.clone();
    sanitized.detail_pane_width = clamp_width(sanitized.detail_pane_width);
    let json = serde_json::to_string_pretty(&sanitized)?;
    let mut tmp = path.to_path_buf();
    tmp.set_extension("json.tmp");
    fs::write(&tmp, json)?;
    // Rename is atomic when source and destination share a filesystem (they do:
    // both live in the same `dtxweb/` directory). On Windows, std::fs::rename
    // replaces the target.
    let rename_result = fs::rename(&tmp, path);
    if rename_result.is_err() {
        // Best-effort cleanup of the temp file so it doesn't linger on failure.
        let _ = fs::remove_file(&tmp);
    }
    rename_result?;
    Ok(())
}

#[tauri::command]
pub fn read_preferences() -> Preferences {
    let (data_dir, home) = resolve_dirs();
    match resolve_read_path_from(data_dir.as_deref(), home.as_deref()) {
        Some(path) => read_preferences_from(&path),
        None => Preferences::default(),
    }
}

#[tauri::command]
pub fn write_preferences(prefs: Preferences) -> Result<()> {
    let (data_dir, home) = resolve_dirs();
    let path = resolve_write_path_from(data_dir.as_deref(), home.as_deref())?;
    // Hold the write lock across the full read-modify-write so a
    // concurrent write_score_song_links call can't interleave: without
    // the guard, one caller's read could observe the file before the
    // other's rename, and the second rename would silently discard the
    // first's score_links update (or vice versa).
    let _guard = preferences_write_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    // Read-modify-write: the UI pref store (preferencesService) sends
    // only detailPaneWidth/Visible — it does not carry scoreLinks. A
    // blind replace would wipe the score_links map on every layout
    // save. Preserve the existing score_links when the incoming prefs
    // don't carry any (empty = not sent by the UI store). Score links
    // are managed exclusively via write_score_song_links, which does
    // its own read-modify-write, so this merge never fights a
    // deliberate clear.
    //
    // Read via the full resolution path (not just the write path) so a
    // legacy ~/.dtxweb/preferences.json is picked up during the first
    // write after migration — reading only the write path would miss
    // the legacy file and drop score_links that haven't been migrated yet.
    let existing = read_preferences();
    let mut merged = prefs;
    if merged.score_links.is_empty() {
        merged.score_links = existing.score_links;
    }
    write_preferences_to(&path, &merged)?;
    // Migration: if the write went to the new path, best-effort remove the
    // legacy ~/.dtxweb/preferences.json so the next read doesn't see a stale
    // copy. Silent on failure — a lingering legacy file is harmless.
    if data_dir.is_some() {
        try_remove_legacy(home.as_deref());
    }
    Ok(())
}

/// Returns the DTXMania-song → cloud-simfile-id link map from the preferences
/// store (spec §5.3). Empty when preferences are missing or the score_links
/// field is absent (serde default).
#[tauri::command]
pub fn read_score_song_links() -> HashMap<String, String> {
    read_preferences().score_links
}

/// Updates the score_links map in the preferences store. Reads the current
/// preferences, replaces the score_links field, and writes back atomically so
/// UI prefs (detail pane width/visibility) are preserved alongside the links.
///
/// Writes directly via `write_preferences_to` instead of `write_preferences`
/// because the latter merges an empty `score_links` map with the on-disk map
/// (to protect against the UI pref store, which doesn't send score_links,
/// accidentally wiping them). That merge would turn a deliberate clear-all
/// (`links = {}`) into a silent no-op that restores the old links. This
/// command's contract is to set `score_links` to exactly `links`, including
/// the empty case, so it must bypass the merge.
#[tauri::command]
pub fn write_score_song_links(links: HashMap<String, String>) -> Result<()> {
    // Hold the write lock across the full read-modify-write so a concurrent
    // write_preferences call can't interleave and clobber this update (or
    // vice versa). See write_preferences for the race rationale.
    let _guard = preferences_write_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let (data_dir, home) = resolve_dirs();
    let path = resolve_write_path_from(data_dir.as_deref(), home.as_deref())?;
    let mut prefs = read_preferences();
    prefs.score_links = links;
    write_preferences_to(&path, &prefs)?;
    // Migration: best-effort remove the legacy file after writing to the new
    // path. See write_preferences for the rationale.
    if data_dir.is_some() {
        try_remove_legacy(home.as_deref());
    }
    Ok(())
}

#[cfg(test)]
#[path = "tests/preferences_tests.rs"]
mod tests;
