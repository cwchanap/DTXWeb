use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};

use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::error::{DesktopError, Result};

static NEXT_TEMP_FILE_ID: AtomicU64 = AtomicU64::new(0);

/// Resolves the app data and home directories. E2E builds may override both
/// through `DTX_E2E_DATA_DIR` so desktop automation cannot touch real user
/// state, while production builds always use the operating system locations.
#[cfg(feature = "e2e")]
pub(crate) fn resolve_dirs() -> (Option<PathBuf>, Option<PathBuf>) {
    match std::env::var("DTX_E2E_DATA_DIR") {
        Ok(dir) if !dir.is_empty() => {
            let path = PathBuf::from(dir);
            (Some(path.clone()), Some(path))
        }
        _ => (dirs::data_dir(), dirs::home_dir()),
    }
}

#[cfg(not(feature = "e2e"))]
pub(crate) fn resolve_dirs() -> (Option<PathBuf>, Option<PathBuf>) {
    (dirs::data_dir(), dirs::home_dir())
}

pub(crate) fn app_data_file(data_dir: &Path, file_name: &str) -> PathBuf {
    data_dir.join("dtxweb").join(file_name)
}

pub(crate) fn read_json_or_default<T>(path: &Path, label: &str) -> T
where
    T: DeserializeOwned + Default,
{
    match fs::read_to_string(path) {
        Ok(contents) => match serde_json::from_str(&contents) {
            Ok(value) => value,
            Err(error) => {
                eprintln!(
                    "[{label}] failed to parse {}: {error} — using defaults",
                    path.display()
                );
                T::default()
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => T::default(),
        Err(error) => {
            eprintln!(
                "[{label}] failed to read {}: {error} — using defaults",
                path.display()
            );
            T::default()
        }
    }
}

fn ensure_private_parent(path: &Path) -> Result<&Path> {
    let parent = path.parent().ok_or_else(|| {
        DesktopError::Message(format!(
            "Could not resolve a parent directory for {}",
            path.display()
        ))
    })?;

    fs::create_dir_all(parent)?;
    if !parent.is_dir() {
        return Err(DesktopError::Message(format!(
            "Persistence parent is not a directory: {}",
            parent.display()
        )));
    }

    #[cfg(unix)]
    fs::set_permissions(parent, std::os::unix::fs::PermissionsExt::from_mode(0o700))?;

    Ok(parent)
}

fn create_temp_file(parent: &Path, file_name: &str) -> Result<(PathBuf, File)> {
    loop {
        let id = NEXT_TEMP_FILE_ID.fetch_add(1, Ordering::Relaxed);
        let temp_path = parent.join(format!(".{file_name}.tmp-{}-{id}", std::process::id()));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&temp_path) {
            Ok(file) => return Ok((temp_path, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }
}

#[cfg(unix)]
fn replace_file(temp_path: &Path, path: &Path, parent: &Path) -> Result<()> {
    fs::rename(temp_path, path)?;
    if let Ok(directory) = File::open(parent) {
        let _ = directory.sync_all();
    }
    Ok(())
}

#[cfg(windows)]
fn replace_file(temp_path: &Path, path: &Path, _parent: &Path) -> Result<()> {
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let temp_wide: Vec<u16> = temp_path.as_os_str().encode_wide().chain(once(0)).collect();
    let path_wide: Vec<u16> = path.as_os_str().encode_wide().chain(once(0)).collect();
    let replaced = unsafe {
        MoveFileExW(
            temp_wide.as_ptr(),
            path_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if replaced == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}

#[cfg(not(any(unix, windows)))]
fn replace_file(temp_path: &Path, path: &Path, _parent: &Path) -> Result<()> {
    fs::rename(temp_path, path)?;
    Ok(())
}

pub(crate) fn write_json_atomic<T>(path: &Path, value: &T) -> Result<()>
where
    T: Serialize,
{
    let parent = ensure_private_parent(path)?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            DesktopError::Message(format!(
                "Could not resolve a file name for {}",
                path.display()
            ))
        })?;
    let json = serde_json::to_vec_pretty(value)?;
    let (temp_path, mut temp_file) = create_temp_file(parent, file_name)?;
    let write_result = (|| -> Result<()> {
        temp_file.write_all(&json)?;
        temp_file.flush()?;
        temp_file.sync_all()?;
        Ok(())
    })();
    drop(temp_file);
    let result = write_result.and_then(|()| replace_file(&temp_path, path, parent));

    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result
}

pub(crate) fn lock_unpoisoned(lock: &'static OnceLock<Mutex<()>>) -> MutexGuard<'static, ()> {
    lock.get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
#[path = "tests/native_persistence_tests.rs"]
mod tests;
