use crate::error::{DesktopError, Result};
use std::path::{Path, PathBuf};
use uuid::Uuid;

const UPLOAD_CACHE_NAMESPACE: &str = "google-drive-uploads";
const UPLOAD_ARCHIVE_NAME: &str = "upload.zip";

/// A native-only upload staging location. Its constructor intentionally takes
/// no renderer-controlled values: operation IDs and cloud titles are metadata,
/// never local path components.
pub(crate) struct DriveUploadArchive {
    directory: PathBuf,
    zip_path: PathBuf,
}

impl DriveUploadArchive {
    pub(crate) fn zip_path(&self) -> &Path {
        &self.zip_path
    }

    /// Idempotent cleanup for upload success, failure, and cancellation.
    pub(crate) fn cleanup(&mut self) {
        remove_upload_directory(&self.directory);
    }
}

impl Drop for DriveUploadArchive {
    fn drop(&mut self) {
        self.cleanup();
    }
}

/// Allocates `<app-cache>/google-drive-uploads/<native-random-id>/upload.zip`.
pub(crate) fn create_upload_archive(app_cache_dir: &Path) -> Result<DriveUploadArchive> {
    let namespace = validated_upload_namespace(app_cache_dir, true)?.ok_or_else(|| {
        DesktopError::Message("Unable to allocate Google Drive upload cache".to_string())
    })?;

    // UUID v4 comes from the native RNG; it has no relationship to a renderer
    // operation ID, a song title, or any other user-provided metadata.
    for _ in 0..8 {
        let directory = namespace.join(Uuid::new_v4().to_string());
        match std::fs::create_dir(&directory) {
            Ok(()) => {
                let zip_path = directory.join(UPLOAD_ARCHIVE_NAME);
                return Ok(DriveUploadArchive {
                    directory,
                    zip_path,
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }

    Err(DesktopError::Message(
        "Unable to allocate Google Drive upload cache".to_string(),
    ))
}

/// Best-effort startup cleanup. This never walks outside the dedicated upload
/// namespace; malformed entries are removed as entries rather than followed.
pub(crate) fn cleanup_stale_upload_archives(app_cache_dir: &Path) {
    let Ok(Some(namespace)) = validated_upload_namespace(app_cache_dir, false) else {
        return;
    };
    let Ok(entries) = std::fs::read_dir(&namespace) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.parent() != Some(namespace.as_path()) {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            let _ = std::fs::remove_dir_all(path);
        } else {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn remove_upload_directory(directory: &Path) {
    let Some(namespace) = directory.parent() else {
        return;
    };
    let Some(app_cache_dir) = namespace.parent() else {
        return;
    };
    let Ok(Some(validated_namespace)) = validated_upload_namespace(app_cache_dir, false) else {
        return;
    };
    if namespace == validated_namespace && directory.parent() == Some(validated_namespace.as_path())
    {
        let _ = std::fs::remove_dir_all(directory);
    }
}

/// Returns a namespace only when it is an ordinary directory immediately below
/// the canonical app cache. `symlink_metadata` is deliberately non-following:
/// a stale or malicious `google-drive-uploads` link must never redirect staging
/// or cleanup outside of the app cache.
fn validated_upload_namespace(
    app_cache_dir: &Path,
    create_if_missing: bool,
) -> Result<Option<PathBuf>> {
    if create_if_missing {
        std::fs::create_dir_all(app_cache_dir)?;
    }

    let namespace = app_cache_dir.join(UPLOAD_CACHE_NAMESPACE);
    let metadata = match std::fs::symlink_metadata(&namespace) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && !create_if_missing => {
            return Ok(None);
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            match std::fs::create_dir(&namespace) {
                Ok(()) => std::fs::symlink_metadata(&namespace)?,
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    std::fs::symlink_metadata(&namespace)?
                }
                Err(error) => return Err(error.into()),
            }
        }
        Err(error) => return Err(error.into()),
    };

    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(DesktopError::Message(
            "Invalid Google Drive upload cache namespace".to_string(),
        ));
    }

    let canonical_cache = std::fs::canonicalize(app_cache_dir)?;
    let canonical_namespace = std::fs::canonicalize(&namespace)?;
    if canonical_namespace.parent() != Some(canonical_cache.as_path()) {
        return Err(DesktopError::Message(
            "Invalid Google Drive upload cache namespace".to_string(),
        ));
    }

    Ok(Some(namespace))
}

/// Produces a Drive display name from metadata only. Unlike local manual
/// export names, printable punctuation such as `:` is valid here; path
/// separators and control characters collapse to one hyphen.
pub(crate) fn sanitize_drive_zip_name(title: &str, simfile_id: &str) -> String {
    let mut sanitized = String::new();
    let mut replaced = false;
    let mut has_printable_content = false;

    for character in title.trim().chars() {
        if character.is_control() || matches!(character, '/' | '\\') {
            if !replaced {
                sanitized.push('-');
                replaced = true;
            }
        } else {
            has_printable_content |= !character.is_whitespace();
            sanitized.push(character);
            replaced = false;
        }
    }

    let sanitized = sanitized.trim();
    let base_name = if !has_printable_content || sanitized.is_empty() {
        format!("simfile-{simfile_id}")
    } else {
        sanitized.to_string()
    };
    format!("{base_name}.zip")
}

#[cfg(test)]
#[path = "../tests/google_drive_upload_tests.rs"]
mod tests;
