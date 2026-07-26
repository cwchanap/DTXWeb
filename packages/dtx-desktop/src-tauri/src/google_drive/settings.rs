use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::native_persistence::{
    app_data_file, lock_unpoisoned, read_json_or_default, write_json_atomic,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GoogleDriveFolderSetting {
    pub(crate) id: String,
    pub(crate) name: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct GoogleDriveSettings {
    pub(crate) google_drive_folders_by_user: HashMap<String, GoogleDriveFolderSetting>,
}

fn settings_write_lock() -> &'static OnceLock<Mutex<()>> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    &LOCK
}

pub(crate) fn google_drive_settings_path(data_dir: &Path) -> PathBuf {
    app_data_file(data_dir, "google-drive-settings.json")
}

#[derive(Debug, Clone)]
pub(crate) struct GoogleDriveSettingsStore {
    data_dir: PathBuf,
}

impl GoogleDriveSettingsStore {
    pub(crate) fn new(data_dir: PathBuf) -> Self {
        Self { data_dir }
    }

    pub(crate) fn folder_for_user(&self, user_id: &str) -> Option<GoogleDriveFolderSetting> {
        self.read()
            .google_drive_folders_by_user
            .get(user_id)
            .cloned()
    }

    pub(crate) fn set_folder_for_user(
        &self,
        user_id: &str,
        folder: GoogleDriveFolderSetting,
    ) -> Result<()> {
        let _guard = lock_unpoisoned(settings_write_lock());
        let mut settings = self.read();
        settings
            .google_drive_folders_by_user
            .insert(user_id.to_string(), folder);
        write_json_atomic(&google_drive_settings_path(&self.data_dir), &settings)
    }

    pub(crate) fn clear_folder_for_user(&self, user_id: &str) -> Result<()> {
        let _guard = lock_unpoisoned(settings_write_lock());
        let mut settings = self.read();
        settings.google_drive_folders_by_user.remove(user_id);
        write_json_atomic(&google_drive_settings_path(&self.data_dir), &settings)
    }

    fn read(&self) -> GoogleDriveSettings {
        read_json_or_default(
            &google_drive_settings_path(&self.data_dir),
            "google-drive-settings",
        )
    }
}

#[cfg(test)]
#[path = "../tests/google_drive_settings_tests.rs"]
mod tests;
