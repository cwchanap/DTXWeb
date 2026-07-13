use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{DesktopError, Result};

type LinkMap = HashMap<String, String>;

fn score_links_path(home: &Path) -> PathBuf {
    home.join(".dtxweb").join("score_links.json")
}

/// Returns an empty map when the file is missing or unparseable.
fn read_score_song_links_from(path: &Path) -> LinkMap {
    match fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str::<LinkMap>(&contents).unwrap_or_default(),
        Err(_) => LinkMap::new(),
    }
}

/// Creates `~/.dtxweb/` if absent, then writes the map atomically (temp + rename).
fn write_score_song_links_to(path: &Path, links: &LinkMap) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(links)?;
    let tmp = path.with_extension(format!("json.tmp.{}", std::process::id()));
    fs::write(&tmp, json)?;
    let rename_result = fs::rename(&tmp, path);
    if rename_result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    rename_result?;
    Ok(())
}

#[tauri::command]
pub fn read_score_song_links() -> LinkMap {
    match dirs::home_dir() {
        Some(home) => read_score_song_links_from(&score_links_path(&home)),
        None => LinkMap::new(),
    }
}

#[tauri::command]
pub fn write_score_song_links(links: LinkMap) -> Result<()> {
    match dirs::home_dir() {
        Some(home) => write_score_song_links_to(&score_links_path(&home), &links),
        None => Err(DesktopError::Message(
            "Could not resolve home directory".to_string(),
        )),
    }
}

#[cfg(test)]
#[path = "tests/score_links_tests.rs"]
mod tests;
