use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, Weak};

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex as AsyncMutex;

use crate::error::DesktopError;
use crate::native_persistence::{app_data_file, lock_unpoisoned, write_json_atomic};

const PENDING_BINDINGS_FILE_NAME: &str = "google-drive-pending-bindings.json";
const PENDING_BINDINGS_SCHEMA_VERSION: u8 = 1;
const MAX_NATIVE_ID_BYTES: usize = 512;
const MAX_CREATED_AT_BYTES: usize = 128;
type BindingTransactionKey = (String, String);
type BindingTransactionLock = AsyncMutex<()>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum PendingBindingKind {
    FirstUpload,
    ExplicitReplacement,
}

/// The Drive file ID the owner row was expected to reference (or not
/// reference) at the time a pending binding was created. Used as an
/// optimistic-concurrency guard when the binding is later reconciled: the
/// metadata mutation only applies when the server-side row still matches
/// this expectation, preventing a stale recovery from overwriting a newer
/// binding established by another device.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum ExpectedPreviousDriveFile {
    /// Expect `google_drive_file_id` to be NULL (FirstUpload).
    None,
    /// Expect `google_drive_file_id` to equal this ID (ExplicitReplacement).
    DriveFile(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PendingGoogleDriveBinding {
    pub(crate) user_id: String,
    pub(crate) simfile_id: String,
    pub(crate) drive_file_id: String,
    pub(crate) kind: PendingBindingKind,
    pub(crate) created_at: String,
    /// When `None` (legacy bindings persisted before this field existed), no
    /// optimistic-concurrency guard is applied. New bindings always set this.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) expected_previous_drive_file: Option<ExpectedPreviousDriveFile>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GoogleDrivePendingBindings {
    schema_version: u8,
    bindings_by_user: HashMap<String, HashMap<String, PendingGoogleDriveBinding>>,
}

impl Default for GoogleDrivePendingBindings {
    fn default() -> Self {
        Self {
            schema_version: PENDING_BINDINGS_SCHEMA_VERSION,
            bindings_by_user: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PendingBindingStoreError {
    InsufficientDiskSpace,
    LocalState,
}

fn pending_bindings_write_lock() -> &'static OnceLock<Mutex<()>> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    &LOCK
}

pub(crate) fn google_drive_pending_bindings_path(data_dir: &Path) -> PathBuf {
    app_data_file(data_dir, PENDING_BINDINGS_FILE_NAME)
}

#[derive(Debug, Clone)]
pub(crate) struct GoogleDrivePendingBindingStore {
    data_dir: PathBuf,
    transaction_locks: Arc<BindingTransactionLockRegistry>,
}

#[derive(Debug, Default)]
struct BindingTransactionLockRegistry {
    by_key: Mutex<HashMap<BindingTransactionKey, Weak<BindingTransactionLock>>>,
}

impl GoogleDrivePendingBindingStore {
    pub(crate) fn new(data_dir: PathBuf) -> Self {
        Self {
            data_dir,
            transaction_locks: Arc::new(BindingTransactionLockRegistry::default()),
        }
    }

    pub(crate) fn transaction_lock(
        &self,
        user_id: &str,
        simfile_id: &str,
    ) -> Arc<BindingTransactionLock> {
        let key = (user_id.to_string(), simfile_id.to_string());
        let mut locks = self
            .transaction_locks
            .by_key
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(lock) = locks.get(&key).and_then(Weak::upgrade) {
            return lock;
        }
        locks.retain(|_, lock| lock.strong_count() > 0);
        let lock = Arc::new(BindingTransactionLock::new(()));
        locks.insert(key, Arc::downgrade(&lock));
        lock
    }

    pub(crate) fn get(
        &self,
        user_id: &str,
        simfile_id: &str,
    ) -> Result<Option<PendingGoogleDriveBinding>, PendingBindingStoreError> {
        // Reads take the same exclusive `pending_bindings_write_lock()` as
        // writes. `write_json_atomic` already does an atomic temp-file +
        // rename, so this is not about torn reads at the FS level; it
        // serializes against the read-modify-write transactions in `replace`
        // and `remove_if_matches` so a reader sees a consistent snapshot
        // rather than a state mid-transaction. The store is a low-volume
        // local-state file (one entry per pending upload), so the contention
        // cost of an exclusive lock is negligible versus the complexity of a
        // read/write lock split.
        let _guard = lock_unpoisoned(pending_bindings_write_lock());
        let bindings = self.read_validated()?;
        Ok(bindings
            .bindings_by_user
            .get(user_id)
            .and_then(|by_simfile| by_simfile.get(simfile_id))
            .cloned())
    }

    pub(crate) fn all(&self) -> Result<Vec<PendingGoogleDriveBinding>, PendingBindingStoreError> {
        // See `get` for why reads take the exclusive write lock.
        let _guard = lock_unpoisoned(pending_bindings_write_lock());
        let bindings = self.read_validated()?;
        let mut result = bindings
            .bindings_by_user
            .into_values()
            .flat_map(HashMap::into_values)
            .collect::<Vec<_>>();
        result.sort_by(|left, right| {
            (&left.user_id, &left.simfile_id).cmp(&(&right.user_id, &right.simfile_id))
        });
        Ok(result)
    }

    pub(crate) fn replace(
        &self,
        binding: PendingGoogleDriveBinding,
    ) -> Result<(), PendingBindingStoreError> {
        validate_binding(&binding)?;
        let _guard = lock_unpoisoned(pending_bindings_write_lock());
        let mut bindings = self.read_validated()?;
        bindings
            .bindings_by_user
            .entry(binding.user_id.clone())
            .or_default()
            .insert(binding.simfile_id.clone(), binding);
        self.write(&bindings)
    }

    pub(crate) fn remove_if_matches(
        &self,
        user_id: &str,
        simfile_id: &str,
        drive_file_id: &str,
    ) -> Result<bool, PendingBindingStoreError> {
        validate_identifier(user_id)?;
        validate_identifier(simfile_id)?;
        validate_identifier(drive_file_id)?;
        let _guard = lock_unpoisoned(pending_bindings_write_lock());
        let mut bindings = self.read_validated()?;
        let matches = bindings
            .bindings_by_user
            .get(user_id)
            .and_then(|by_simfile| by_simfile.get(simfile_id))
            .is_some_and(|binding| binding.drive_file_id == drive_file_id);
        if !matches {
            return Ok(false);
        }

        let remove_user = if let Some(by_simfile) = bindings.bindings_by_user.get_mut(user_id) {
            by_simfile.remove(simfile_id);
            by_simfile.is_empty()
        } else {
            false
        };
        if remove_user {
            bindings.bindings_by_user.remove(user_id);
        }
        self.write(&bindings)?;
        Ok(true)
    }

    fn read_validated(&self) -> Result<GoogleDrivePendingBindings, PendingBindingStoreError> {
        let path = google_drive_pending_bindings_path(&self.data_dir);
        let contents = match fs::read_to_string(&path) {
            Ok(contents) => contents,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(GoogleDrivePendingBindings::default());
            }
            Err(_) => return Err(PendingBindingStoreError::LocalState),
        };
        let bindings: GoogleDrivePendingBindings = match serde_json::from_str(&contents) {
            Ok(bindings) => bindings,
            Err(_) => {
                quarantine_corrupt_pending_bindings(&path);
                return Ok(GoogleDrivePendingBindings::default());
            }
        };
        if validate_document(&bindings).is_err() {
            quarantine_corrupt_pending_bindings(&path);
            return Ok(GoogleDrivePendingBindings::default());
        }
        Ok(bindings)
    }

    fn write(&self, bindings: &GoogleDrivePendingBindings) -> Result<(), PendingBindingStoreError> {
        write_json_atomic(
            &google_drive_pending_bindings_path(&self.data_dir),
            bindings,
        )
        .map_err(classify_persistence_error)
    }
}

fn quarantine_corrupt_pending_bindings(path: &Path) {
    let corrupt_path = path.with_extension("json.corrupt");
    // fs::rename fails on Windows when the target already exists, so remove a
    // previously quarantined file first. Both calls are best-effort: if they
    // fail the corrupt payload is left in place and the next load will retry.
    let _ = fs::remove_file(&corrupt_path);
    let _ = fs::rename(path, &corrupt_path);
}

fn validate_document(
    bindings: &GoogleDrivePendingBindings,
) -> Result<(), PendingBindingStoreError> {
    if bindings.schema_version != PENDING_BINDINGS_SCHEMA_VERSION {
        return Err(PendingBindingStoreError::LocalState);
    }
    for (user_key, by_simfile) in &bindings.bindings_by_user {
        validate_identifier(user_key)?;
        for (simfile_key, binding) in by_simfile {
            validate_identifier(simfile_key)?;
            validate_binding(binding)?;
            if binding.user_id != *user_key || binding.simfile_id != *simfile_key {
                return Err(PendingBindingStoreError::LocalState);
            }
        }
    }
    Ok(())
}

fn validate_binding(binding: &PendingGoogleDriveBinding) -> Result<(), PendingBindingStoreError> {
    validate_identifier(&binding.user_id)?;
    validate_identifier(&binding.simfile_id)?;
    validate_identifier(&binding.drive_file_id)?;
    if binding.created_at.trim() != binding.created_at
        || binding.created_at.is_empty()
        || binding.created_at.len() > MAX_CREATED_AT_BYTES
        || binding.created_at.chars().any(char::is_control)
    {
        return Err(PendingBindingStoreError::LocalState);
    }
    if let Some(ExpectedPreviousDriveFile::DriveFile(id)) = &binding.expected_previous_drive_file {
        validate_identifier(id)?;
    }
    Ok(())
}

fn validate_identifier(value: &str) -> Result<(), PendingBindingStoreError> {
    if value.is_empty()
        || value.len() > MAX_NATIVE_ID_BYTES
        || value.trim() != value
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(PendingBindingStoreError::LocalState);
    }
    Ok(())
}

fn classify_persistence_error(error: DesktopError) -> PendingBindingStoreError {
    match error {
        DesktopError::Io(error) if is_insufficient_disk_space(&error) => {
            PendingBindingStoreError::InsufficientDiskSpace
        }
        _ => PendingBindingStoreError::LocalState,
    }
}

// Disk-full errno codes are platform-specific: a single cross-platform
// match would misclassify unrelated errnos (e.g. 112 is ERROR_DISK_FULL on
// Windows but EHOSTUNREACH on Linux). Gate each code to the platform that
// actually defines it as a storage-exhaustion signal.
#[cfg(windows)]
pub(crate) fn is_insufficient_disk_space(error: &std::io::Error) -> bool {
    // ERROR_DISK_FULL
    matches!(error.raw_os_error(), Some(112))
}

#[cfg(target_os = "linux")]
pub(crate) fn is_insufficient_disk_space(error: &std::io::Error) -> bool {
    // ENOSPC (28) and EDQUOT (122) on Linux.
    matches!(error.raw_os_error(), Some(28) | Some(122))
}

#[cfg(all(unix, not(target_os = "linux")))]
pub(crate) fn is_insufficient_disk_space(error: &std::io::Error) -> bool {
    // ENOSPC (28) is POSIX; EDQUOT is 69 on macOS/BSD.
    matches!(error.raw_os_error(), Some(28) | Some(69))
}

#[cfg(not(any(windows, unix)))]
pub(crate) fn is_insufficient_disk_space(_error: &std::io::Error) -> bool {
    false
}

#[cfg(test)]
#[path = "../tests/google_drive_pending_bindings_tests.rs"]
mod tests;
