use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{DesktopError, Result};

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
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            detail_pane_width: default_detail_pane_width(),
            detail_pane_visible: default_detail_pane_visible(),
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
fn read_preferences_from(path: &Path) -> Preferences {
    let mut prefs = match fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str::<Preferences>(&contents).unwrap_or_default(),
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
        Some(home) => write_preferences_to(&preferences_path(&home), &prefs),
        None => Err(DesktopError::Message(
            "Could not resolve home directory".to_string(),
        )),
    }
}

#[cfg(test)]
#[path = "tests/preferences_tests.rs"]
mod tests;
