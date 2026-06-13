use crate::error::{DesktopError, Result};
use async_recursion::async_recursion;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use encoding_rs::{Encoding, SHIFT_JIS, UTF_16BE, UTF_16LE, UTF_8};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::io::{ErrorKind, Write};
use std::path::{Component, Path, PathBuf};
use tauri::{path::BaseDirectory, AppHandle, Manager};
use tokio::fs;
use zip::write::SimpleFileOptions;

const VALID_DTX_FILE_EXTENSIONS: &[&str] = &[
    ".dtx", ".def", ".wav", ".mp3", ".ogg", ".flac", ".m4a", ".aac", ".xa", ".png", ".jpg",
    ".jpeg", ".gif", ".bmp", ".tiff", ".tga",
];
const SET_DEF_DECODING_PRIORITY: [&Encoding; 4] = [UTF_8, SHIFT_JIS, UTF_16LE, UTF_16BE];
const DTX_DECODING_PRIORITY: [&Encoding; 4] = [SHIFT_JIS, UTF_8, UTF_16LE, UTF_16BE];

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CreateSongOptions {
    pub selected_path: String,
    pub sanitized_folder_name: String,
    pub sanitized_song_name: String,
    pub template_folder_path: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CreateSongResult {
    pub success: bool,
    pub song_folder_path: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportSongResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zip_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DtxParseResult {
    pub bpm: Option<f64>,
    pub artist: Option<String>,
    pub levels: Vec<DtxLevel>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parse_failures: Option<usize>,
}

#[derive(Debug, Serialize, Clone)]
pub struct DtxLevel {
    pub label: String,
    pub level: f64,
}

#[tauri::command]
pub async fn create_song(options: CreateSongOptions) -> Result<CreateSongResult> {
    create_song_folder(options).await
}

pub async fn create_song_folder(options: CreateSongOptions) -> Result<CreateSongResult> {
    let song_folder_path =
        PathBuf::from(&options.selected_path).join(&options.sanitized_folder_name);

    ensure_song_folder_does_not_exist(&song_folder_path, &options.sanitized_folder_name).await?;

    if let Some(template_folder_path) = options.template_folder_path.as_deref() {
        ensure_template_copy_allowed(Path::new(template_folder_path), &song_folder_path).await?;
    }

    fs::create_dir_all(&song_folder_path).await?;

    if let Some(template_folder_path) = options.template_folder_path.as_deref() {
        copy_template_recursively(Path::new(template_folder_path), &song_folder_path).await?;
    }

    let set_def_content = generate_set_def_content(&options.sanitized_song_name);
    write_utf16le_with_bom(&song_folder_path.join("SET.def"), &set_def_content).await?;

    Ok(CreateSongResult {
        success: true,
        song_folder_path: song_folder_path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub async fn export_song_to_zip(
    song_path: String,
    song_title: Option<String>,
    export_directory: Option<String>,
) -> Result<ExportSongResult> {
    let export_directory = resolve_export_directory(export_directory.as_deref());
    let song_title = song_title
        .as_deref()
        .filter(|title| !title.trim().is_empty())
        .unwrap_or("song");

    export_song_folder_to_zip(Path::new(&song_path), song_title, &export_directory).await
}

pub async fn export_song_folder_to_zip(
    song_path: &Path,
    song_title: &str,
    export_directory: &Path,
) -> Result<ExportSongResult> {
    match export_song_folder_to_zip_inner(song_path, song_title, export_directory).await {
        Ok(result) => Ok(result),
        Err(error) => Ok(ExportSongResult::failure(error.to_string())),
    }
}

#[tauri::command]
pub async fn get_skin_asset(app: AppHandle, asset_path: String) -> Result<serde_json::Value> {
    let asset_path = asset_path.trim_start_matches('/');

    if !is_safe_relative_path(asset_path) {
        return Ok(json!({
            "success": false,
            "error": "Invalid asset path"
        }));
    }

    for candidate in skin_asset_candidates(&app, asset_path) {
        if let Ok(bytes) = fs::read(&candidate).await {
            let data_url = data_url_for_asset(asset_path, &bytes);
            return Ok(json!({
                "success": true,
                "dataUrl": data_url
            }));
        }
    }

    Ok(json!({
        "success": false,
        "error": format!("Skin asset not found: {asset_path}")
    }))
}

#[tauri::command]
pub async fn parse_dtx_files(folder_path: String) -> Result<DtxParseResult> {
    match parse_dtx_folder(Path::new(&folder_path)).await {
        Ok(result) => Ok(result),
        Err(_) => Ok(DtxParseResult::empty()),
    }
}

pub async fn parse_dtx_folder(folder_path: &Path) -> Result<DtxParseResult> {
    let entries = read_top_level_files(folder_path).await?;
    let set_def_labels = read_set_def_labels(folder_path, &entries).await;
    let dtx_files = entries
        .into_iter()
        .filter(|entry| has_extension(entry, ".dtx"))
        .collect::<Vec<_>>();

    if dtx_files.is_empty() {
        return Ok(DtxParseResult::empty());
    }

    let mut parsed_bpm = None;
    let mut parsed_artist = None;
    let mut levels = Vec::new();
    let mut parse_failures = 0;

    for file_path in dtx_files {
        let file_name = file_path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        let label_from_set_def = set_def_labels.get(&file_name.to_lowercase()).cloned();

        let bytes = match fs::read(&file_path).await {
            Ok(bytes) => bytes,
            Err(_) => {
                parse_failures += 1;
                continue;
            }
        };
        let content = decode_text_content(&bytes, &DTX_DECODING_PRIORITY, is_dtx_content);
        let metadata = parse_dtx_metadata(&content);

        if !metadata.has_metadata && label_from_set_def.is_none() {
            parse_failures += 1;
            continue;
        }

        if parsed_bpm.is_none() {
            parsed_bpm = metadata.bpm;
        }
        if parsed_artist.is_none() {
            parsed_artist = metadata.artist;
        }

        if metadata.level.is_some() || label_from_set_def.is_some() {
            levels.push(DtxLevel {
                label: label_from_set_def.unwrap_or_else(|| fallback_level_label(&file_name)),
                level: metadata.level.unwrap_or(0.0),
            });
        }
    }

    Ok(DtxParseResult {
        bpm: parsed_bpm,
        artist: parsed_artist,
        levels,
        parse_failures: (parse_failures > 0).then_some(parse_failures),
    })
}

impl ExportSongResult {
    fn failure(error: String) -> Self {
        Self {
            success: false,
            zip_path: None,
            files_count: None,
            error: Some(error),
        }
    }
}

impl DtxParseResult {
    fn empty() -> Self {
        Self {
            bpm: None,
            artist: None,
            levels: Vec::new(),
            parse_failures: None,
        }
    }
}

async fn ensure_song_folder_does_not_exist(
    song_folder_path: &Path,
    sanitized_folder_name: &str,
) -> Result<()> {
    match fs::metadata(song_folder_path).await {
        Ok(_) => Err(DesktopError::Message(format!(
            "A folder named \"{sanitized_folder_name}\" already exists in the selected location"
        ))),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

async fn ensure_template_copy_allowed(template_path: &Path, destination_path: &Path) -> Result<()> {
    let canonical_source = fs::canonicalize(template_path).await?;
    let destination_parent = destination_path
        .parent()
        .ok_or_else(|| DesktopError::Message("Invalid destination path".to_string()))?;
    let destination_name = destination_path
        .file_name()
        .ok_or_else(|| DesktopError::Message("Invalid destination path".to_string()))?;
    let canonical_destination = fs::canonicalize(destination_parent)
        .await?
        .join(destination_name);

    if canonical_destination.starts_with(&canonical_source) {
        return Err(DesktopError::Message(
            "Cannot copy directory into itself or its subdirectory.".to_string(),
        ));
    }

    Ok(())
}

#[async_recursion]
async fn copy_template_recursively(source_path: &Path, destination_path: &Path) -> Result<()> {
    fs::create_dir_all(destination_path).await?;
    let mut entries = fs::read_dir(source_path).await?;

    while let Some(entry) = entries.next_entry().await? {
        let source = entry.path();
        let destination = destination_path.join(entry.file_name());
        let file_type = entry.file_type().await?;

        if file_type.is_dir() {
            copy_template_recursively(&source, &destination).await?;
        } else if file_type.is_file() {
            fs::copy(&source, &destination).await?;
        }
    }

    Ok(())
}

fn generate_set_def_content(song_title: &str) -> String {
    let mut lines = Vec::new();
    if !song_title.is_empty() {
        lines.push(format!("#TITLE {song_title}"));
    }

    for (level, label, file_name) in [
        (1, "BASIC", "bas.dtx"),
        (2, "ADVANCED", "adv.dtx"),
        (3, "EXTREME", "ext.dtx"),
        (4, "MASTER", "mas.dtx"),
        (5, "REAL", "real.dtx"),
    ] {
        lines.push(format!("#L{level}LABEL {label}"));
        lines.push(format!("#L{level}FILE {file_name}"));
    }

    lines.join("\n")
}

async fn write_utf16le_with_bom(file_path: &Path, content: &str) -> Result<()> {
    let mut bytes = vec![0xff, 0xfe];
    bytes.extend(
        content
            .encode_utf16()
            .flat_map(|unit| unit.to_le_bytes())
            .collect::<Vec<_>>(),
    );
    fs::write(file_path, bytes).await?;
    Ok(())
}

async fn export_song_folder_to_zip_inner(
    song_path: &Path,
    song_title: &str,
    export_directory: &Path,
) -> Result<ExportSongResult> {
    ensure_export_directory(export_directory).await?;

    let valid_files = valid_export_files(song_path).await?;
    if valid_files.is_empty() {
        return Ok(ExportSongResult::failure(
            "No valid files found to export".to_string(),
        ));
    }

    let zip_path = export_directory.join(format!("{song_title}.zip"));
    let file = std::fs::File::create(&zip_path)?;
    let mut zip = zip::ZipWriter::new(file);

    for (file_name, file_path) in &valid_files {
        zip.start_file(file_name, SimpleFileOptions::default())?;
        let content = std::fs::read(file_path)?;
        zip.write_all(&content)?;
    }

    zip.finish()?;

    Ok(ExportSongResult {
        success: true,
        zip_path: Some(zip_path.to_string_lossy().into_owned()),
        files_count: Some(valid_files.len()),
        error: None,
    })
}

async fn ensure_export_directory(export_directory: &Path) -> Result<()> {
    fs::create_dir_all(export_directory).await.map_err(|_| {
        DesktopError::Message(format!(
            "Cannot access or create export directory: {}",
            export_directory.display()
        ))
    })?;

    let metadata = fs::metadata(export_directory).await.map_err(|_| {
        DesktopError::Message(format!(
            "Cannot access or create export directory: {}",
            export_directory.display()
        ))
    })?;

    if !metadata.is_dir() {
        return Err(DesktopError::Message(format!(
            "Cannot access or create export directory: {}",
            export_directory.display()
        )));
    }

    Ok(())
}

async fn valid_export_files(song_path: &Path) -> Result<Vec<(String, PathBuf)>> {
    let mut files = Vec::new();
    let mut entries = fs::read_dir(song_path).await?;

    while let Some(entry) = entries.next_entry().await? {
        if !entry.file_type().await?.is_file() {
            continue;
        }

        let file_name = entry.file_name().to_string_lossy().into_owned();
        if is_valid_export_file_name(&file_name) {
            files.push((file_name, entry.path()));
        }
    }

    files.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(files)
}

fn is_valid_export_file_name(file_name: &str) -> bool {
    let Some(extension_index) = file_name.rfind('.') else {
        return false;
    };
    let extension = file_name[extension_index..].to_ascii_lowercase();
    VALID_DTX_FILE_EXTENSIONS.contains(&extension.as_str())
}

fn resolve_export_directory(export_directory: Option<&str>) -> PathBuf {
    match export_directory.filter(|path| !path.trim().is_empty()) {
        None | Some("~/Downloads") => home_dir()
            .map(|home| home.join("Downloads"))
            .unwrap_or_else(|| PathBuf::from(".")),
        Some(path) if path.starts_with("~/") => home_dir()
            .map(|home| home.join(&path[2..]))
            .unwrap_or_else(|| PathBuf::from(&path[2..])),
        Some(path) => PathBuf::from(path),
    }
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn skin_asset_candidates(app: &AppHandle, asset_path: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    for resource_path in [
        PathBuf::from("skin").join(asset_path),
        PathBuf::from("static").join("skin").join(asset_path),
    ] {
        if let Ok(path) = app.path().resolve(&resource_path, BaseDirectory::Resource) {
            candidates.push(path);
        }
    }

    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../static/skin")
            .join(asset_path),
    );
    candidates.push(PathBuf::from("../static/skin").join(asset_path));
    candidates.push(PathBuf::from("static/skin").join(asset_path));
    candidates
}

fn data_url_for_asset(asset_path: &str, bytes: &[u8]) -> String {
    let mime_type = match Path::new(asset_path)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        _ => "application/octet-stream",
    };

    format!("data:{mime_type};base64,{}", STANDARD.encode(bytes))
}

fn is_safe_relative_path(path: &str) -> bool {
    let path = Path::new(path);
    !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

async fn read_top_level_files(folder_path: &Path) -> Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    let mut entries = fs::read_dir(folder_path).await?;

    while let Some(entry) = entries.next_entry().await? {
        if entry.file_type().await?.is_file() {
            files.push(entry.path());
        }
    }

    files.sort();
    Ok(files)
}

async fn read_set_def_labels(folder_path: &Path, entries: &[PathBuf]) -> HashMap<String, String> {
    let Some(set_def_path) = entries
        .iter()
        .find(|entry| file_name_eq_ignore_ascii_case(entry, "SET.def"))
    else {
        return HashMap::new();
    };

    let Ok(bytes) = fs::read(folder_path.join(set_def_path.file_name().unwrap_or_default())).await
    else {
        return HashMap::new();
    };
    let content = decode_text_content(&bytes, &SET_DEF_DECODING_PRIORITY, is_set_def_content);
    parse_set_def_labels(&content)
}

fn parse_set_def_labels(content: &str) -> HashMap<String, String> {
    let mut labels_by_level = HashMap::new();
    let mut files_by_level = HashMap::new();

    for line in content.lines() {
        let trimmed = line.trim_start();
        for level in 1..=9 {
            if let Some(label) = directive_value(trimmed, &format!("#L{level}LABEL")) {
                labels_by_level.insert(level, label.trim().to_string());
            }
            if let Some(file_name) = directive_value(trimmed, &format!("#L{level}FILE")) {
                files_by_level.insert(level, file_name.trim().to_string());
            }
        }
    }

    let mut labels_by_file = HashMap::new();
    for (level, label) in labels_by_level {
        let Some(file_name) = files_by_level.get(&level) else {
            continue;
        };
        if !label.is_empty() && !file_name.is_empty() {
            labels_by_file.insert(file_name.to_lowercase(), label);
        }
    }

    labels_by_file
}

#[derive(Default)]
struct DtxMetadata {
    bpm: Option<f64>,
    artist: Option<String>,
    level: Option<f64>,
    has_metadata: bool,
}

fn parse_dtx_metadata(content: &str) -> DtxMetadata {
    let mut metadata = DtxMetadata::default();

    for line in content.lines() {
        let trimmed = line.trim_start();

        if let Some(value) = directive_value(trimmed, "#BPM") {
            metadata.has_metadata = true;
            if metadata.bpm.is_none() {
                metadata.bpm = parse_number(value);
            }
            continue;
        }

        if let Some(value) = directive_value(trimmed, "#ARTIST") {
            metadata.has_metadata = true;
            if metadata.artist.is_none() {
                let artist = value.trim();
                if !artist.is_empty() {
                    metadata.artist = Some(artist.to_string());
                }
            }
            continue;
        }

        if let Some(value) = directive_value(trimmed, "#DLEVEL") {
            metadata.has_metadata = true;
            if metadata.level.is_none() {
                metadata.level = parse_number(value);
            }
            continue;
        }

        if directive_value(trimmed, "#TITLE").is_some()
            || trimmed.to_ascii_uppercase().starts_with("#WAV")
        {
            metadata.has_metadata = true;
        }
    }

    metadata
}

fn decode_text_content(
    bytes: &[u8],
    encodings: &[&'static Encoding],
    validate: fn(&str) -> bool,
) -> String {
    if let Some(content) = decode_bom(bytes) {
        return content;
    }

    for encoding in encodings {
        let content = decode_with_encoding(bytes, encoding);
        if validate(&content) && has_acceptable_null_ratio(&content) {
            return content;
        }
    }

    decode_with_encoding(bytes, encodings[0])
}

fn decode_bom(bytes: &[u8]) -> Option<String> {
    if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        return Some(decode_with_encoding(&bytes[3..], UTF_8));
    }
    if bytes.starts_with(&[0xff, 0xfe]) {
        return Some(decode_with_encoding(&bytes[2..], UTF_16LE));
    }
    if bytes.starts_with(&[0xfe, 0xff]) {
        return Some(decode_with_encoding(&bytes[2..], UTF_16BE));
    }
    None
}

fn decode_with_encoding(bytes: &[u8], encoding: &'static Encoding) -> String {
    let (content, _, _) = encoding.decode(bytes);
    content.trim_start_matches('\u{feff}').to_string()
}

fn is_set_def_content(content: &str) -> bool {
    content.lines().any(|line| {
        let trimmed = line.trim_start();
        directive_value(trimmed, "#TITLE").is_some()
            || directive_value(trimmed, "#ARTIST").is_some()
            || directive_value(trimmed, "#BPM").is_some()
            || (trimmed.to_ascii_uppercase().starts_with("#L") && trimmed.contains(".dtx"))
            || trimmed.to_ascii_lowercase().contains(".dtx")
    })
}

fn is_dtx_content(content: &str) -> bool {
    content.lines().any(|line| {
        let trimmed = line.trim_start();
        directive_value(trimmed, "#TITLE").is_some()
            || directive_value(trimmed, "#ARTIST").is_some()
            || directive_value(trimmed, "#BPM").is_some()
            || directive_value(trimmed, "#DLEVEL").is_some()
            || trimmed.to_ascii_uppercase().starts_with("#WAV")
    })
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

fn parse_number(value: &str) -> Option<f64> {
    let mut number = String::new();

    for character in value.trim_start().chars() {
        if character.is_ascii_digit() || matches!(character, '.' | '-' | '+') {
            number.push(character);
        } else if number.is_empty() && character.is_whitespace() {
            continue;
        } else {
            break;
        }
    }

    number.parse::<f64>().ok()
}

fn fallback_level_label(file_name: &str) -> String {
    Path::new(file_name)
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_ascii_uppercase())
        .unwrap_or_else(|| file_name.to_ascii_uppercase())
}

fn has_extension(path: &Path, extension: &str) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{}", value.to_ascii_lowercase()) == extension)
        .unwrap_or(false)
}

fn file_name_eq_ignore_ascii_case(path: &Path, expected: &str) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case(expected))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Read;
    use tempfile::tempdir;
    use tokio::fs;
    use zip::ZipArchive;

    #[tokio::test]
    async fn create_song_writes_utf16le_set_def_with_bom() {
        let root = tempdir().expect("tempdir");
        let options = CreateSongOptions {
            selected_path: root.path().to_string_lossy().into_owned(),
            sanitized_folder_name: "DTXFiles.Song".to_string(),
            sanitized_song_name: "Song Title".to_string(),
            template_folder_path: None,
        };

        let result = create_song_folder(options).await.expect("create song");

        assert!(result.success);
        let set_def_path = root.path().join("DTXFiles.Song").join("SET.def");
        let bytes = fs::read(&set_def_path).await.expect("SET.def bytes");
        assert_eq!(&bytes[..2], &[0xff, 0xfe]);

        let units = bytes[2..]
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect::<Vec<_>>();
        let content = String::from_utf16(&units).expect("UTF-16LE content");

        assert!(content.contains("#TITLE Song Title"));
        assert!(content.contains("#L1LABEL BASIC"));
        assert!(content.contains("#L1FILE bas.dtx"));
    }

    #[tokio::test]
    async fn copy_template_rejects_copy_into_descendant() {
        let root = tempdir().expect("tempdir");
        let template = root.path().join("Template");
        fs::create_dir_all(&template).await.expect("template");

        let options = CreateSongOptions {
            selected_path: template.to_string_lossy().into_owned(),
            sanitized_folder_name: "Child".to_string(),
            sanitized_song_name: "Song Title".to_string(),
            template_folder_path: Some(template.to_string_lossy().into_owned()),
        };

        let error = create_song_folder(options)
            .await
            .expect_err("descendant copy should reject");

        assert!(error
            .to_string()
            .contains("Cannot copy directory into itself or its subdirectory"));
    }

    #[tokio::test]
    async fn export_zip_filters_invalid_files() {
        let root = tempdir().expect("tempdir");
        let song = root.path().join("Song");
        let export = root.path().join("Export");
        fs::create_dir_all(&song).await.expect("song");
        fs::create_dir_all(&export).await.expect("export");
        fs::write(song.join("main.dtx"), "#TITLE: Song")
            .await
            .expect("dtx");
        fs::write(song.join("notes.txt"), "ignore")
            .await
            .expect("txt");

        let result = export_song_folder_to_zip(&song, "Song", &export)
            .await
            .expect("export envelope");

        assert!(result.success);
        assert_eq!(result.files_count, Some(1));
        assert_zip_entries(result.zip_path.as_deref().expect("zip path"), &["main.dtx"]);
    }

    #[tokio::test]
    async fn export_zip_allows_common_valid_extensions() {
        let root = tempdir().expect("tempdir");
        let song = root.path().join("Song");
        let export = root.path().join("Export");
        fs::create_dir_all(&song).await.expect("song");
        fs::create_dir_all(&export).await.expect("export");
        fs::write(song.join("song.flac"), b"audio")
            .await
            .expect("flac");
        fs::write(song.join("jacket.gif"), b"image")
            .await
            .expect("gif");

        let result = export_song_folder_to_zip(&song, "Song", &export)
            .await
            .expect("export envelope");

        assert!(result.success);
        assert_eq!(result.files_count, Some(2));
        assert_zip_entries(
            result.zip_path.as_deref().expect("zip path"),
            &["jacket.gif", "song.flac"],
        );
    }

    #[tokio::test]
    async fn export_zip_returns_error_envelope_when_no_valid_files() {
        let root = tempdir().expect("tempdir");
        let song = root.path().join("Song");
        let export = root.path().join("Export");
        fs::create_dir_all(&song).await.expect("song");
        fs::create_dir_all(&export).await.expect("export");
        fs::write(song.join("notes.txt"), "ignore")
            .await
            .expect("txt");

        let result = export_song_folder_to_zip(&song, "Song", &export)
            .await
            .expect("export envelope");

        assert!(!result.success);
        assert_eq!(
            result.error.as_deref(),
            Some("No valid files found to export")
        );
        assert_eq!(result.zip_path, None);
        assert_eq!(result.files_count, None);
    }

    #[tokio::test]
    async fn parse_dtx_files_returns_metadata_and_set_def_labels() {
        let root = tempdir().expect("tempdir");
        fs::write(
            root.path().join("SET.def"),
            "#L1LABEL BASIC\n#L1FILE main.dtx\n",
        )
        .await
        .expect("SET.def");
        fs::write(
            root.path().join("main.dtx"),
            "#ARTIST: Test Artist\n#BPM: 142.5\n#DLEVEL: 7\n",
        )
        .await
        .expect("main.dtx");

        let result = parse_dtx_folder(root.path()).await.expect("parse result");

        assert_eq!(result.artist.as_deref(), Some("Test Artist"));
        assert_eq!(result.bpm, Some(142.5));
        assert_eq!(result.levels.len(), 1);
        assert_eq!(result.levels[0].label, "BASIC");
        assert_eq!(result.levels[0].level, 7.0);
        assert_eq!(result.parse_failures, None);
    }

    fn assert_zip_entries(zip_path: &str, expected: &[&str]) {
        let mut file = File::open(zip_path).expect("zip file");
        let mut buffer = Vec::new();
        file.read_to_end(&mut buffer).expect("read zip");
        let cursor = std::io::Cursor::new(buffer);
        let mut archive = ZipArchive::new(cursor).expect("zip archive");
        let mut names = Vec::new();
        for index in 0..archive.len() {
            names.push(archive.by_index(index).expect("entry").name().to_string());
        }
        names.sort();
        let expected = expected
            .iter()
            .map(|name| name.to_string())
            .collect::<Vec<_>>();
        assert_eq!(names, expected);
    }
}
