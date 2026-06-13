use crate::error::{DesktopError, Result};
use crate::models::{
    DialogResult, FileEntry, ListedFile, PathExistsResult, ReadFileResult, SuccessResult, TreeNode,
};
use encoding_rs::{Encoding, SHIFT_JIS, UTF_16BE, UTF_16LE, UTF_8};
use serde_json::json;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_opener::OpenerExt;
use tokio::fs;

const TEXT_FILE_SIZE_LIMIT: u64 = 1024 * 1024;
const AUDIO_FILE_SIZE_LIMIT: u64 = 10 * 1024 * 1024;
const PLACEHOLDER_LAST_MODIFIED: &str = "1970-01-01T00:00:00.000Z";

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
pub async fn path_exists(base_path: String, path_parts: Vec<String>) -> PathExistsResult {
    let full_path = join_path_parts(base_path, path_parts);

    match fs::metadata(full_path).await {
        Ok(_) => PathExistsResult {
            exists: true,
            error: None,
        },
        Err(error) => PathExistsResult {
            exists: false,
            error: Some(path_access_error(&error)),
        },
    }
}

#[tauri::command]
pub async fn list_directories(dir_path: String) -> Result<Vec<String>> {
    let mut directories = Vec::new();
    let mut entries = fs::read_dir(dir_path).await?;

    while let Some(entry) = entries.next_entry().await? {
        if entry.file_type().await?.is_dir() {
            directories.push(file_name_to_string(entry.file_name()));
        }
    }

    directories.sort();
    Ok(directories)
}

#[tauri::command]
pub async fn list_directory(dir_path: String) -> Result<serde_json::Value> {
    let mut files = Vec::new();
    let mut entries = fs::read_dir(&dir_path).await?;

    while let Some(entry) = entries.next_entry().await? {
        let file_type = entry.file_type().await?;
        files.push(FileEntry {
            name: file_name_to_string(entry.file_name()),
            path: entry.path().to_string_lossy().into_owned(),
            entry_type: if file_type.is_dir() {
                "directory".to_string()
            } else {
                "file".to_string()
            },
        });
    }

    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(json!({ "files": files, "error": null }))
}

#[tauri::command]
pub async fn list_files(dir_path: String) -> Result<serde_json::Value> {
    let mut files = Vec::new();
    let mut entries = fs::read_dir(&dir_path).await?;

    while let Some(entry) = entries.next_entry().await? {
        if !entry.file_type().await?.is_file() {
            continue;
        }

        let metadata = entry.metadata().await?;
        let file_path = entry.path();
        files.push(ListedFile {
            file_name: file_name_to_string(entry.file_name()),
            size: metadata.len(),
            last_modified: PLACEHOLDER_LAST_MODIFIED.to_string(),
            key: file_path.to_string_lossy().into_owned(),
        });
    }

    files.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    Ok(json!({ "files": files }))
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
            content: String::new(),
        },
    }
}

#[tauri::command]
pub async fn load_tree_structure(
    base_path: String,
    path_parts: Vec<String>,
) -> Result<Vec<TreeNode>> {
    let full_path = join_path_parts(base_path, path_parts);
    load_tree_structure_path(&full_path).await
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

async fn read_file_path_inner(
    file_path: &Path,
    workspace_root: Option<&Path>,
) -> Result<ReadFileResult> {
    let canonical_file_path = fs::canonicalize(file_path).await?;
    let allowed_root = match workspace_root {
        Some(root) => fs::canonicalize(root).await?,
        None => canonical_file_path
            .parent()
            .ok_or_else(|| DesktopError::Message("Invalid file path".to_string()))?
            .to_path_buf(),
    };

    if !canonical_file_path.starts_with(&allowed_root) {
        return Ok(ReadFileResult::Error {
            error: "Invalid file path".to_string(),
            content: String::new(),
        });
    }

    let extension = normalized_extension(&canonical_file_path);
    if !ALLOWED_EXTENSIONS.contains(&extension.as_str()) {
        return Ok(ReadFileResult::Error {
            error: "File type not allowed".to_string(),
            content: String::new(),
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
            content: String::new(),
        });
    }

    let content = fs::read(&canonical_file_path).await?;

    if is_audio_file {
        return Ok(ReadFileResult::Binary {
            error: None,
            content,
        });
    }

    Ok(ReadFileResult::Text {
        error: None,
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
        Err(_) => return info,
    };

    while let Ok(Some(entry)) = entries.next_entry().await {
        let file_type = match entry.file_type().await {
            Ok(file_type) => file_type,
            Err(_) => continue,
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
        ReadFileResult::Text {
            error: None,
            content,
        } => content,
        _ => return None,
    };

    parse_title(&content)
}

fn parse_title(content: &str) -> Option<String> {
    for line in content.lines() {
        let trimmed = line.trim_start();
        if let Some((_, title)) = trimmed.split_once(':') {
            if trimmed[..trimmed.find(':')?].eq_ignore_ascii_case("#TITLE") {
                let title = title.trim();
                if !title.is_empty() {
                    return Some(title.to_string());
                }
            }
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
        return content.contains("#TITLE:")
            || content.contains("#ARTIST:")
            || content.contains("#BPM:")
            || content.contains('[');
    }

    content.contains("#TITLE:")
        || content.contains("#ARTIST:")
        || content.contains("#BPM:")
        || content.contains("#WAV")
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

fn path_access_error(error: &std::io::Error) -> String {
    match error.kind() {
        ErrorKind::NotFound => "not-found".to_string(),
        ErrorKind::PermissionDenied => "permission-denied".to_string(),
        _ => "unknown".to_string(),
    }
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
mod tests {
    use super::*;
    use crate::models::ReadFileResult;
    use tempfile::tempdir;
    use tokio::fs;

    #[tokio::test]
    async fn read_file_rejects_path_outside_workspace() {
        let root = tempdir().expect("tempdir");
        let outside = tempdir().expect("outside");
        let file = outside.path().join("song.dtx");
        fs::write(&file, "#TITLE: Bad").await.expect("write");

        let result = read_file_path(&file, Some(root.path())).await;

        assert!(matches!(result, ReadFileResult::Error { .. }));
    }

    #[tokio::test]
    async fn read_file_rejects_unknown_extension() {
        let root = tempdir().expect("tempdir");
        let file = root.path().join("notes.txt");
        fs::write(&file, "hello").await.expect("write");

        let result = read_file_path(&file, Some(root.path())).await;

        assert_eq!(
            serde_json::to_value(result).expect("json")["error"],
            "File type not allowed"
        );
    }

    #[tokio::test]
    async fn load_tree_includes_dtx_folder_with_set_def_title() {
        let root = tempdir().expect("tempdir");
        let song = root.path().join("DTXFiles.Test");
        fs::create_dir(&song).await.expect("mkdir");
        fs::write(song.join("main.dtx"), "#TITLE: Chart")
            .await
            .expect("dtx");
        fs::write(song.join("SET.def"), "#TITLE: Song Title")
            .await
            .expect("def");

        let nodes = load_tree_structure_path(root.path()).await.expect("tree");

        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].name, "DTXFiles.Test");
        assert!(nodes[0].contains_dtx_files);
        assert_eq!(nodes[0].song_title.as_deref(), Some("Song Title"));
    }
}
