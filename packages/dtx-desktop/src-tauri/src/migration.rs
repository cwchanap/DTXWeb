//! One-shot migration of legacy Electron desktop data into this Tauri app's
//! data directory.
//!
//! Legacy Electron builds persisted localStorage (workspace path, bookmarks,
//! auth tokens, caches, etc.) under a platform-specific `dtx-desktop` dir as
//! `local-storage.json`. This module imports the known keys exactly once: a
//! `migration-v1.json` marker is written after the first run, and its presence
//! short-circuits all subsequent attempts, so the migration is idempotent and
//! safe across restarts. The imported payload is returned to the renderer,
//! which hydrates its own localStorage; the raw import is also dumped to
//! `imported-local-storage.json` for debugging.
//!
//! Malformed/missing legacy storage is not fatal: the marker is still written
//! and the failure is recorded as a warning rather than an error result.

use crate::error::Result;
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tokio::fs;

const MIGRATION_MARKER: &str = "migration-v1.json";
const IMPORTED_LOCAL_STORAGE: &str = "imported-local-storage.json";
const LOCAL_STORAGE_FILE: &str = "local-storage.json";
const KEYS: &[&str] = &[
    "workspace_path",
    "workspace_bookmarks",
    "song_templates",
    "app_settings",
    "simfiles_cache",
    "simfiles_cache_timestamp",
    "dtx_linkage_cache",
    "linkage_cache",
    "editor_mapping_cache",
    "auth_access_token",
    "auth_refresh_token",
    "auth_user_data",
    "auth_session",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationResult {
    pub migrated: bool,
    pub imported_keys: Vec<String>,
    pub warnings: Vec<String>,
    pub local_storage: Map<String, Value>,
}

#[tauri::command]
pub async fn migrate_legacy_data(app: AppHandle) -> Result<MigrationResult> {
    let app_data = app.path().app_data_dir()?;
    let legacy_data = default_legacy_data_dir();
    migrate_from_paths(&legacy_data, &app_data).await
}

pub async fn migrate_from_paths(legacy_dir: &Path, tauri_dir: &Path) -> Result<MigrationResult> {
    fs::create_dir_all(tauri_dir).await?;
    let marker = tauri_dir.join(MIGRATION_MARKER);
    if marker.exists() {
        return Ok(MigrationResult {
            migrated: false,
            imported_keys: Vec::new(),
            warnings: Vec::new(),
            local_storage: Map::new(),
        });
    }

    let source = legacy_dir.join(LOCAL_STORAGE_FILE);
    let mut imported_keys = Vec::new();
    let mut warnings = Vec::new();
    let mut local_storage = Map::new();

    match fs::read_to_string(&source).await {
        Ok(text) => match serde_json::from_str::<Value>(&text) {
            Ok(Value::Object(values)) => {
                for key in KEYS {
                    if let Some(value) = values.get(*key) {
                        local_storage.insert((*key).to_string(), value.clone());
                        imported_keys.push((*key).to_string());
                    }
                }
                fs::write(
                    tauri_dir.join(IMPORTED_LOCAL_STORAGE),
                    serde_json::to_vec_pretty(&Value::Object(local_storage.clone()))?,
                )
                .await?;
            }
            Ok(_) => warnings.push(format!(
                "Legacy desktop storage at {} is not an object",
                source.display()
            )),
            Err(error) => warnings.push(format!("Failed to parse {}: {}", source.display(), error)),
        },
        Err(_) => warnings.push(format!(
            "Legacy desktop storage not found at {}",
            source.display()
        )),
    }

    fs::write(
        marker,
        serde_json::to_vec_pretty(&json!({
            "version": 1,
            "importedKeys": imported_keys,
            "warnings": warnings,
        }))?,
    )
    .await?;

    Ok(MigrationResult {
        migrated: true,
        imported_keys,
        warnings,
        local_storage,
    })
}

fn default_legacy_data_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        std::env::var("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("Library/Application Support/dtx-desktop")
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("dtx-desktop")
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        std::env::var("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(".config/dtx-desktop")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use tokio::fs;

    #[tokio::test]
    async fn migrates_known_local_storage_keys_once() {
        let legacy = tempdir().expect("legacy");
        let tauri = tempdir().expect("tauri");
        fs::write(
            legacy.path().join("local-storage.json"),
            serde_json::json!({
                "workspace_path": "\"/songs\"",
                "workspace_bookmarks": "[{\"name\":\"Songs\",\"path\":\"/songs\"}]",
                "song_templates": "[]",
                "app_settings": "{\"exportDirectory\":\"/exports\"}",
                "auth_access_token": "access",
                "ignored_key": "ignored"
            })
            .to_string(),
        )
        .await
        .expect("write");

        let result = migrate_from_paths(legacy.path(), tauri.path())
            .await
            .expect("migrate");

        assert_eq!(result.migrated, true);
        assert_eq!(
            result.imported_keys,
            vec![
                "workspace_path",
                "workspace_bookmarks",
                "song_templates",
                "app_settings",
                "auth_access_token"
            ]
        );
        assert_eq!(result.local_storage["workspace_path"], "\"/songs\"");
        assert!(result.local_storage.get("ignored_key").is_none());
        assert!(tauri.path().join("migration-v1.json").exists());

        let second = migrate_from_paths(legacy.path(), tauri.path())
            .await
            .expect("second migrate");
        assert_eq!(second.migrated, false);
        assert!(second.imported_keys.is_empty());
        assert!(second.local_storage.is_empty());
    }

    #[tokio::test]
    async fn missing_legacy_storage_records_warning_and_marker() {
        let legacy = tempdir().expect("legacy");
        let tauri = tempdir().expect("tauri");

        let result = migrate_from_paths(legacy.path(), tauri.path())
            .await
            .expect("migrate");

        assert_eq!(result.migrated, true);
        assert!(result.imported_keys.is_empty());
        assert_eq!(result.warnings.len(), 1);
        assert!(tauri.path().join("migration-v1.json").exists());
    }
}
