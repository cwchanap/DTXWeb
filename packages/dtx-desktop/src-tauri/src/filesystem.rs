use crate::error::{DesktopError, Result};
use crate::models::{
    DialogResult, FileEntry, ListFilesResult, ListedFile, PathExistsResult, ReadFileResult,
    SuccessResult, TreeNode,
};
use encoding_rs::{Encoding, SHIFT_JIS, UTF_16BE, UTF_16LE, UTF_8};
use serde_json::json;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_opener::OpenerExt;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use tokio::fs;

const TEXT_FILE_SIZE_LIMIT: u64 = 1024 * 1024;
const AUDIO_FILE_SIZE_LIMIT: u64 = 10 * 1024 * 1024;

const ALLOWED_EXTENSIONS: &[&str] = &["dtx", "def", "xa", "ogg", "wav", "mp3"];
const AUDIO_EXTENSIONS: &[&str] = &["xa", "ogg", "wav", "mp3"];
const DTX_DECODING_PRIORITY: [&Encoding; 4] = [SHIFT_JIS, UTF_8, UTF_16LE, UTF_16BE];
const DEF_DECODING_PRIORITY: [&Encoding; 4] = [UTF_16LE, UTF_16BE, UTF_8, SHIFT_JIS];

#[tauri::command]
pub async fn select_folder(app: AppHandle) -> Result<DialogResult> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |folder_path| {
        let _ = sender.send(folder_path);
    });

    let folder_path = receiver
        .await
        .map_err(|error| DesktopError::Message(error.to_string()))?;
    let file_paths = match folder_path {
        Some(path) => vec![file_path_to_string(path)?],
        None => Vec::new(),
    };

    Ok(DialogResult {
        canceled: file_paths.is_empty(),
        file_paths,
    })
}

#[tauri::command]
pub async fn select_dtxmania_db(app: AppHandle) -> Result<DialogResult> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("DTXMania database", &["db"])
        .pick_file(move |file_path| {
            let _ = sender.send(file_path);
        });

    let picked = receiver
        .await
        .map_err(|error| DesktopError::Message(error.to_string()))?;
    let file_paths = match picked {
        Some(path) => vec![file_path_to_string(path)?],
        None => Vec::new(),
    };

    // Record the dialog-selected path so `parse_dtxmania_scores` accepts it.
    // Without this, only the default DTXMania OS data-dir path is allowed.
    if let Some(path) = file_paths.first() {
        app.state::<crate::scores::DtxmaniaDbState>()
            .set(std::path::PathBuf::from(path));
    }

    Ok(DialogResult {
        canceled: file_paths.is_empty(),
        file_paths,
    })
}

#[tauri::command]
pub async fn path_exists(
    base_path: String,
    path_parts: Vec<String>,
    workspace_root: Option<String>,
) -> PathExistsResult {
    let full_path = join_path_parts(base_path, path_parts);
    // Route through the canonical containment primitive so a compromised
    // renderer can't use path_exists as an info-disclosure oracle to probe
    // arbitrary paths outside the workspace. A missing target (or root)
    // canonicalizes to NotFound, which maps to the existing "not-found" token
    // the renderer already matches on; containment failures surface their own
    // message so the renderer can distinguish "missing" from "forbidden".
    let full_path_string = full_path.to_string_lossy().into_owned();
    match canonicalize_within_workspace(&full_path_string, workspace_root.as_deref()).await {
        Ok(_) => PathExistsResult {
            exists: true,
            error: None,
        },
        Err(DesktopError::Io(error)) if error.kind() == ErrorKind::NotFound => PathExistsResult {
            exists: false,
            error: Some("not-found".to_string()),
        },
        Err(error) => PathExistsResult {
            exists: false,
            error: Some(error.to_string()),
        },
    }
}

#[tauri::command]
pub async fn list_directories(
    dir_path: String,
    workspace_root: Option<String>,
) -> Result<Vec<String>> {
    let canonical = canonicalize_within_workspace(&dir_path, workspace_root.as_deref()).await?;
    let mut directories = Vec::new();
    let mut entries = fs::read_dir(&canonical).await?;

    while let Some(entry) = entries.next_entry().await? {
        if entry.file_type().await?.is_dir() {
            directories.push(file_name_to_string(entry.file_name()));
        }
    }

    directories.sort();
    Ok(directories)
}

#[tauri::command]
pub async fn list_directory(
    dir_path: String,
    workspace_root: Option<String>,
) -> Result<serde_json::Value> {
    let canonical = match canonicalize_within_workspace(&dir_path, workspace_root.as_deref()).await
    {
        Ok(path) => path,
        Err(error) => return Ok(list_error_value(error)),
    };
    match list_directory_entries(&canonical).await {
        Ok(files) => Ok(json!({ "files": files, "error": null })),
        Err(error) => Ok(list_error_value(error)),
    }
}

#[tauri::command]
pub async fn list_files(
    dir_path: String,
    workspace_root: Option<String>,
) -> Result<ListFilesResult> {
    let canonical = match canonicalize_within_workspace(&dir_path, workspace_root.as_deref()).await
    {
        Ok(path) => path,
        Err(error) => {
            return Ok(ListFilesResult {
                files: vec![],
                error: Some(error.to_string()),
            })
        }
    };
    match list_file_entries(&canonical).await {
        Ok(files) => Ok(ListFilesResult { files, error: None }),
        Err(error) => Ok(ListFilesResult {
            files: vec![],
            error: Some(error.to_string()),
        }),
    }
}

/// Canonicalizes `target_path` and confirms it lives inside `workspace_root`.
/// A missing workspace root is rejected outright: every canonical path
/// starts_with its own parent, so falling back to the target's parent would
/// make the containment check meaningless (mirrors `read_file_path_inner`).
///
/// This is the single canonical primitive for workspace containment — new
/// file-access commands should call it (or accept a workspace root and route
/// through it) instead of hand-writing `.starts_with` checks, so the symlink-
/// safe invariant lives in exactly one tested place.
///
/// Non-existent targets are checked against the nearest existing ancestor's
/// canonical path so a caller can't use the result as a filesystem oracle
/// (otherwise `path_exists("/etc/passwd")` vs `path_exists("/etc/no-such")`
/// would distinguish "exists outside the workspace" from "missing"). Ancestors
/// inside the workspace still surface `NotFound` so legitimate missing-file
/// probes report "not found" rather than falsely reporting existence.
pub(crate) async fn canonicalize_within_workspace(
    target_path: &str,
    workspace_root: Option<&str>,
) -> Result<PathBuf> {
    // Treat a missing OR empty/whitespace-only root as absent: the renderer
    // passes `String($workspaceStore?.path ?? '')` (empty when no workspace is
    // selected), and canonicalizing "" yields an opaque I/O error instead of
    // the actionable "workspace root is required" message.
    let root = workspace_root
        .filter(|root| !root.trim().is_empty())
        .ok_or_else(|| DesktopError::Message("A workspace root is required".to_string()))?;
    let canonical_root = fs::canonicalize(root).await?;
    let canonical_target = match fs::canonicalize(target_path).await {
        Ok(path) => path,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            // Target doesn't exist. Resolve the nearest existing ancestor so
            // we can still enforce containment without leaking whether the
            // missing path would have lived outside the workspace.
            let canonical_ancestor = canonicalize_existing_ancestor(target_path).await?;
            if !canonical_ancestor.starts_with(&canonical_root) {
                return Err(DesktopError::Message(
                    "Path is outside the workspace".to_string(),
                ));
            }
            // Containment passed for the ancestor — surface NotFound for the
            // (missing) target itself so callers like `path_exists` report
            // "not found" instead of treating a missing path as present.
            return Err(DesktopError::Io(std::io::Error::from(ErrorKind::NotFound)));
        }
        Err(error) => return Err(error.into()),
    };
    if !canonical_target.starts_with(&canonical_root) {
        return Err(DesktopError::Message(
            "Path is outside the workspace".to_string(),
        ));
    }
    Ok(canonical_target)
}

/// Walks up `target_path` until it finds an existing ancestor, then returns
/// that ancestor's canonical path (symlinks resolved). Used by
/// `canonicalize_within_workspace` to evaluate containment for not-yet-existing
/// paths without revealing whether the missing path is inside or outside the
/// workspace. Surfaces `NotFound` if no ancestor exists at all.
async fn canonicalize_existing_ancestor(target_path: &str) -> Result<PathBuf> {
    let mut current = PathBuf::from(target_path);
    loop {
        match fs::canonicalize(&current).await {
            Ok(canonical) => return Ok(canonical),
            Err(error) if error.kind() == ErrorKind::NotFound => {
                let Some(parent) = current.parent().map(Path::to_path_buf) else {
                    return Err(DesktopError::Io(std::io::Error::from(ErrorKind::NotFound)));
                };
                if parent == current {
                    return Err(DesktopError::Io(std::io::Error::from(ErrorKind::NotFound)));
                }
                current = parent;
            }
            Err(error) => return Err(error.into()),
        }
    }
}

async fn list_directory_entries(dir_path: &Path) -> Result<Vec<FileEntry>> {
    let mut files = Vec::new();
    let mut entries = fs::read_dir(dir_path).await?;

    while let Some(entry) = entries.next_entry().await? {
        let file_type = entry.file_type().await?;
        files.push(FileEntry {
            name: file_name_to_string(entry.file_name()),
            path: entry.path().to_string_lossy().into_owned(),
            entry_type: if file_type.is_dir() {
                "directory".to_string()
            } else if file_type.is_symlink() {
                "symlink".to_string()
            } else {
                "file".to_string()
            },
        });
    }

    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(files)
}

async fn list_file_entries(dir_path: &Path) -> Result<Vec<ListedFile>> {
    let mut files = Vec::new();
    let mut entries = fs::read_dir(dir_path).await?;

    while let Some(entry) = entries.next_entry().await? {
        if !entry.file_type().await?.is_file() {
            continue;
        }

        let metadata = entry.metadata().await?;
        let file_path = entry.path();
        files.push(ListedFile {
            file_name: file_name_to_string(entry.file_name()),
            size: metadata.len(),
            last_modified: format_modified_time(&metadata)?,
            key: file_path.to_string_lossy().into_owned(),
        });
    }

    files.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    Ok(files)
}

#[tauri::command]
pub async fn read_file(file_path: String, workspace_root: Option<String>) -> ReadFileResult {
    let workspace_root = workspace_root.as_deref().map(Path::new);
    read_file_path(Path::new(&file_path), workspace_root).await
}

pub async fn read_file_path(file_path: &Path, workspace_root: Option<&Path>) -> ReadFileResult {
    match read_file_path_inner(file_path, workspace_root).await {
        Ok(result) => result,
        Err(error) => ReadFileResult::Error {
            error: error.to_string(),
        },
    }
}

#[tauri::command]
pub async fn load_tree_structure(
    base_path: String,
    path_parts: Vec<String>,
    workspace_root: Option<String>,
) -> Result<Vec<TreeNode>> {
    let full_path = join_path_parts(base_path, path_parts);
    // Enforce workspace containment at the IPC boundary so a compromised
    // renderer can't enumerate arbitrary directory structures or read SET.def
    // titles outside the workspace. The inner helper still accepts a
    // canonicalized path for internal reuse and tests.
    let full_path_string = full_path.to_string_lossy().into_owned();
    let canonical =
        canonicalize_within_workspace(&full_path_string, workspace_root.as_deref()).await?;
    load_tree_structure_path(&canonical).await
}

pub async fn load_tree_structure_path(dir_path: &Path) -> Result<Vec<TreeNode>> {
    let mut nodes = Vec::new();
    let mut entries = fs::read_dir(dir_path).await?;

    while let Some(entry) = entries.next_entry().await? {
        if !entry.file_type().await?.is_dir() {
            continue;
        }

        let name = file_name_to_string(entry.file_name());
        let full_path = entry.path();
        let folder_info = inspect_tree_folder(&full_path).await;
        let should_include = name.starts_with("DTXFiles.") || folder_info.contains_dtx_files;

        if !should_include {
            continue;
        }

        nodes.push(TreeNode {
            name,
            path: full_path.to_string_lossy().into_owned(),
            is_expanded: false,
            is_loading: false,
            children: Vec::new(),
            has_children: if folder_info.contains_dtx_files {
                false
            } else {
                folder_info.has_children
            },
            contains_dtx_files: folder_info.contains_dtx_files,
            song_title: folder_info.song_title,
        });
    }

    nodes.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(nodes)
}

#[tauri::command]
pub async fn open_folder(app: AppHandle, folder_path: String) -> Result<SuccessResult> {
    app.opener()
        .open_path(folder_path, None::<String>)
        .map_err(|error| DesktopError::Message(error.to_string()))?;

    Ok(SuccessResult {
        success: true,
        error: None,
    })
}

/// Returns the user's OS-native Downloads directory (e.g.
/// `/Users/alice/Downloads` on macOS, `C:\Users\Alice\Downloads` on Windows).
/// Used by the renderer as the default export directory. Resolved in Rust so
/// the webview never needs to read env vars or expand `~` itself.
///
/// Returns `null` when the OS reports no Downloads directory (rare; usually
/// means a missing `$HOME`/`%USERPROFILE%` or a broken xdg config on Linux).
#[tauri::command]
pub async fn get_default_downloads_dir() -> Result<Option<String>> {
    Ok(default_downloads_dir())
}

/// Pure helper extracted from `get_default_downloads_dir` so the path
/// resolution can be unit-tested without spinning up a Tauri command.
pub fn default_downloads_dir() -> Option<String> {
    dirs::download_dir().and_then(|path| path.to_str().map(|s| s.to_string()))
}

async fn read_file_path_inner(
    file_path: &Path,
    workspace_root: Option<&Path>,
) -> Result<ReadFileResult> {
    let canonical_file_path = fs::canonicalize(file_path).await?;
    let allowed_root = match workspace_root {
        Some(root) => fs::canonicalize(root).await?,
        // A missing workspace root must not fall back to the file's own parent:
        // every canonical path starts_with its own parent, so that would make
        // the containment check below meaningless and allow reading any file.
        None => {
            return Err(DesktopError::Message(
                "A workspace root is required to read files".to_string(),
            ));
        }
    };

    if !canonical_file_path.starts_with(&allowed_root) {
        return Ok(ReadFileResult::Error {
            error: "Invalid file path".to_string(),
        });
    }

    let extension = normalized_extension(&canonical_file_path);
    if !ALLOWED_EXTENSIONS.contains(&extension.as_str()) {
        return Ok(ReadFileResult::Error {
            error: "File type not allowed".to_string(),
        });
    }

    let is_audio_file = AUDIO_EXTENSIONS.contains(&extension.as_str());
    let max_file_size = if is_audio_file {
        AUDIO_FILE_SIZE_LIMIT
    } else {
        TEXT_FILE_SIZE_LIMIT
    };

    let metadata = fs::metadata(&canonical_file_path).await?;
    if metadata.len() > max_file_size {
        return Ok(ReadFileResult::Error {
            error: "File too large".to_string(),
        });
    }

    let content = fs::read(&canonical_file_path).await?;

    if is_audio_file {
        return Ok(ReadFileResult::Binary { content });
    }

    Ok(ReadFileResult::Text {
        content: decode_text_content(&content, &extension),
    })
}

#[derive(Default)]
struct TreeFolderInfo {
    has_children: bool,
    contains_dtx_files: bool,
    song_title: Option<String>,
}

async fn inspect_tree_folder(folder_path: &Path) -> TreeFolderInfo {
    let mut info = TreeFolderInfo::default();
    let mut set_def_path: Option<PathBuf> = None;
    let mut entries = match fs::read_dir(folder_path).await {
        Ok(entries) => entries,
        // Log the failure (typically permission denied) so a real song folder
        // doesn't silently look empty/non-DTX and drop out of the tree. We
        // still return an empty info — the folder is unreadable, not absent.
        Err(error) => {
            eprintln!("[fs] inspect_tree_folder: read_dir {folder_path:?} failed: {error}");
            return info;
        }
    };

    loop {
        let entry = match entries.next_entry().await {
            Ok(Some(entry)) => entry,
            // Natural end of iteration.
            Ok(None) => break,
            // Log iteration failures (e.g. a transient I/O error mid-directory)
            // and stop rather than silently treating the rest of the folder as
            // absent. Matches the read_dir error handling above; we still
            // return whatever info we have gathered so far.
            Err(error) => {
                eprintln!("[fs] inspect_tree_folder: next_entry {folder_path:?} failed: {error}");
                break;
            }
        };
        let file_type = match entry.file_type().await {
            Ok(file_type) => file_type,
            // Log per-entry failures (e.g. a stale symlink, permission error)
            // and skip the entry rather than treating the whole folder empty.
            Err(error) => {
                eprintln!(
                    "[fs] inspect_tree_folder: file_type {:?} failed: {error}",
                    entry.path()
                );
                continue;
            }
        };
        let name = file_name_to_string(entry.file_name());

        if file_type.is_dir() {
            info.has_children = true;
            continue;
        }

        if !file_type.is_file() {
            continue;
        }

        if name.eq_ignore_ascii_case("SET.def") {
            set_def_path = Some(entry.path());
        }

        if name.to_lowercase().ends_with(".dtx") {
            info.contains_dtx_files = true;
        }
    }

    if info.contains_dtx_files {
        if let Some(path) = set_def_path {
            info.song_title = read_set_def_title(&path).await;
        }
    }

    info
}

async fn read_set_def_title(file_path: &Path) -> Option<String> {
    let content = match read_file_path(file_path, Some(file_path.parent()?)).await {
        ReadFileResult::Text { content } => content,
        _ => return None,
    };

    parse_title(&content)
}

fn parse_title(content: &str) -> Option<String> {
    for line in content.lines() {
        let trimmed = line.trim_start();
        let Some(title) = directive_value(trimmed, "#TITLE") else {
            continue;
        };

        let title = title.trim();
        if !title.is_empty() {
            return Some(title.to_string());
        }
    }

    None
}

fn decode_text_content(bytes: &[u8], extension: &str) -> String {
    let bytes = strip_bom_bytes(bytes);
    let encodings = text_decoding_priority(extension);
    let fallback = if extension == "dtx" { SHIFT_JIS } else { UTF_8 };

    for encoding in encodings {
        let content = decode_with_encoding(bytes, encoding);
        if validate_text_content(&content, extension) && has_acceptable_null_ratio(&content) {
            return content;
        }
    }

    decode_with_encoding(bytes, fallback)
}

fn text_decoding_priority(extension: &str) -> &'static [&'static Encoding] {
    if extension == "dtx" {
        &DTX_DECODING_PRIORITY
    } else {
        &DEF_DECODING_PRIORITY
    }
}

fn decode_with_encoding(bytes: &[u8], encoding: &'static Encoding) -> String {
    let (content, _, _) = encoding.decode(bytes);
    content.trim_start_matches('\u{feff}').to_string()
}

fn strip_bom_bytes(bytes: &[u8]) -> &[u8] {
    if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        &bytes[3..]
    } else if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        &bytes[2..]
    } else {
        bytes
    }
}

fn validate_text_content(content: &str, extension: &str) -> bool {
    if content.is_empty() {
        return false;
    }

    if extension == "def" {
        return content
            .lines()
            .any(|line| is_set_def_directive_line(line) || line.trim_start().starts_with('['));
    }

    content.contains("#TITLE:")
        || content.contains("#ARTIST:")
        || content.contains("#BPM:")
        || content.contains("#WAV")
}

fn is_set_def_directive_line(line: &str) -> bool {
    let trimmed = line.trim_start();
    if directive_value(trimmed, "#TITLE").is_some()
        || directive_value(trimmed, "#ARTIST").is_some()
        || directive_value(trimmed, "#BPM").is_some()
    {
        return true;
    }

    is_level_directive_line(trimmed)
}

fn is_level_directive_line(line: &str) -> bool {
    let uppercase = line.to_ascii_uppercase();
    let Some(after_level_prefix) = uppercase.strip_prefix("#L") else {
        return false;
    };

    let digit_count = after_level_prefix
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .count();
    if digit_count == 0 {
        return false;
    }

    let after_level_number = &after_level_prefix[digit_count..];
    if let Some(rest) = after_level_number.strip_prefix("LABEL") {
        return is_directive_boundary(rest);
    }
    if let Some(rest) = after_level_number.strip_prefix("FILE") {
        return is_directive_boundary(rest);
    }

    false
}

fn directive_value<'a>(line: &'a str, directive: &str) -> Option<&'a str> {
    if line.len() < directive.len() {
        return None;
    }

    let prefix = line.get(..directive.len())?;
    let rest = line.get(directive.len()..)?;
    if !prefix.eq_ignore_ascii_case(directive) {
        return None;
    }

    if let Some(rest) = rest.strip_prefix(':') {
        return Some(rest);
    }

    let first_character = rest.chars().next()?;
    if first_character.is_whitespace() {
        return Some(&rest[first_character.len_utf8()..]);
    }

    None
}

fn is_directive_boundary(rest: &str) -> bool {
    rest.is_empty()
        || rest.starts_with(':')
        || rest
            .chars()
            .next()
            .is_some_and(|character| character.is_whitespace())
}

fn has_acceptable_null_ratio(content: &str) -> bool {
    let total_chars = content.chars().count();
    if total_chars == 0 {
        return false;
    }

    let null_chars = content
        .chars()
        .filter(|character| *character == '\0')
        .count();
    (null_chars as f64 / total_chars as f64) < 0.1
}

fn normalized_extension(path: &Path) -> String {
    path.extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_lowercase()
}

fn join_path_parts(base_path: String, path_parts: Vec<String>) -> PathBuf {
    let mut full_path = PathBuf::from(base_path);
    for path_part in path_parts {
        full_path.push(path_part);
    }
    full_path
}

fn list_error_value(error: DesktopError) -> serde_json::Value {
    json!({ "files": [], "error": error.to_string() })
}

fn format_modified_time(metadata: &std::fs::Metadata) -> Result<String> {
    OffsetDateTime::from(metadata.modified()?)
        .format(&Rfc3339)
        .map_err(|error| DesktopError::Message(error.to_string()))
}

fn file_path_to_string(file_path: FilePath) -> Result<String> {
    let path = file_path
        .into_path()
        .map_err(|error| DesktopError::Message(error.to_string()))?;

    Ok(path.to_string_lossy().into_owned())
}

fn file_name_to_string(file_name: std::ffi::OsString) -> String {
    file_name.to_string_lossy().into_owned()
}

#[cfg(test)]
#[path = "tests/filesystem_tests.rs"]
mod tests;
