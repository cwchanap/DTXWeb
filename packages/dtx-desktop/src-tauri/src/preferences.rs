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

/// Creates `~/.dtxweb/` if absent, then writes pretty JSON.
fn write_preferences_to(path: &Path, prefs: &Preferences) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(prefs)?)?;
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
