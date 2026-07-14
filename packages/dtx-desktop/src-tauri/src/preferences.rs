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

const MIN_DETAIL_WIDTH: f64 = 320.0;
const MAX_DETAIL_WIDTH: f64 = 640.0;

fn default_detail_pane_width() -> f64 {
    420.0
}

fn default_detail_pane_visible() -> bool {
    true
}

/// UI preferences persisted to `~/.dtxweb/preferences.json`. Every field has a
/// serde default so older/partial files load cleanly as the schema grows.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    #[serde(default = "default_detail_pane_width")]
    pub detail_pane_width: f64,
    #[serde(default = "default_detail_pane_visible")]
    pub detail_pane_visible: bool,
    /// DTXMania-song → cloud-simfile-id mappings for the Scores view (spec §5.3).
    /// Keyed by DTXMania song identity (title + "\u{0}" + artist + "\u{0}" +
    /// genre), matching `songKey` in Scores.svelte. Empty by default so older
    /// preferences files without this field load cleanly.
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

fn preferences_path(home: &Path) -> PathBuf {
    home.join(".dtxweb").join("preferences.json")
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

/// Creates `~/.dtxweb/` if absent, then writes pretty JSON atomically.
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
    // both live in ~/.dtxweb/). On Windows, std::fs::rename replaces the target.
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
    match dirs::home_dir() {
        Some(home) => read_preferences_from(&preferences_path(&home)),
        None => Preferences::default(),
    }
}

#[tauri::command]
pub fn write_preferences(prefs: Preferences) -> Result<()> {
    match dirs::home_dir() {
        Some(home) => {
            let path = preferences_path(&home);
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
            let existing = read_preferences_from(&path);
            let mut merged = prefs;
            if merged.score_links.is_empty() {
                merged.score_links = existing.score_links;
            }
            write_preferences_to(&path, &merged)
        }
        None => Err(DesktopError::Message(
            "Could not resolve home directory".to_string(),
        )),
    }
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
    let mut prefs = read_preferences();
    prefs.score_links = links;
    match dirs::home_dir() {
        Some(home) => write_preferences_to(&preferences_path(&home), &prefs),
        None => Err(DesktopError::Message(
            "Could not resolve home directory".to_string(),
        )),
    }
}

#[cfg(test)]
#[path = "tests/preferences_tests.rs"]
mod tests;
