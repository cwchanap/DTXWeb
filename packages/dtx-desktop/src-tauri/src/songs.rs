use crate::error::{DesktopError, Result};
use crate::workspace::WorkspaceRootState;
use async_recursion::async_recursion;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use encoding_rs::{Encoding, SHIFT_JIS, UTF_16BE, UTF_16LE, UTF_8};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::io::{copy, ErrorKind};
use std::path::{Component, Path, PathBuf};
use tauri::{path::BaseDirectory, AppHandle, Manager, State};
use tokio::{fs, task};
use zip::write::SimpleFileOptions;

const VALID_DTX_FILE_EXTENSIONS: &[&str] = &[
    ".dtx", ".def", ".wav", ".mp3", ".ogg", ".flac", ".m4a", ".aac", ".xa", ".png", ".jpg",
    ".jpeg", ".gif", ".bmp", ".tiff", ".tga",
];
static SET_DEF_DECODING_PRIORITY: [&Encoding; 4] = [UTF_8, SHIFT_JIS, UTF_16LE, UTF_16BE];
static DTX_DECODING_PRIORITY: [&Encoding; 4] = [SHIFT_JIS, UTF_8, UTF_16LE, UTF_16BE];

#[derive(Debug, Clone, Copy)]
enum HomeDirPlatform {
    Posix,
    Windows,
}

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
pub async fn create_song(
    options: CreateSongOptions,
    state: State<'_, WorkspaceRootState>,
) -> Result<CreateSongResult> {
    create_song_with_workspace_state(options, &state).await
}

pub(crate) async fn create_song_with_workspace_state(
    options: CreateSongOptions,
    state: &WorkspaceRootState,
) -> Result<CreateSongResult> {
    let workspace_root = state.current()?;
    create_song_with_workspace_root(options, &workspace_root).await
}

pub(crate) async fn create_song_with_workspace_root(
    mut options: CreateSongOptions,
    workspace_root: &Path,
) -> Result<CreateSongResult> {
    // Resolve all caller-controlled source/destination roots before mutation.
    // `create_song_folder` receives canonical paths, so a selected-path or
    // template symlink cannot redirect mkdir, copy, or SET.def writes outside
    // the trusted workspace after this boundary check.
    let workspace_root = workspace_root.to_string_lossy();
    let selected_path = crate::filesystem::canonicalize_within_workspace(
        &options.selected_path,
        Some(&workspace_root),
    )
    .await?;
    let template_folder_path = match options.template_folder_path.as_deref() {
        Some(template_folder_path) => Some(
            crate::filesystem::canonicalize_within_workspace(
                template_folder_path,
                Some(&workspace_root),
            )
            .await?,
        ),
        None => None,
    };

    options.selected_path = selected_path.to_string_lossy().into_owned();
    options.template_folder_path = template_folder_path
        .map(|template_folder_path| template_folder_path.to_string_lossy().into_owned());
    create_song_folder(options).await
}

pub async fn create_song_folder(options: CreateSongOptions) -> Result<CreateSongResult> {
    validate_safe_file_name(&options.sanitized_folder_name, "song folder name")?;

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
    state: State<'_, WorkspaceRootState>,
) -> Result<ExportSongResult> {
    export_song_to_zip_with_workspace_state(song_path, song_title, export_directory, &state).await
}

pub(crate) async fn export_song_to_zip_with_workspace_state(
    song_path: String,
    song_title: Option<String>,
    export_directory: Option<String>,
    state: &WorkspaceRootState,
) -> Result<ExportSongResult> {
    let workspace_root = state.current()?;
    export_song_to_zip_with_workspace_root(song_path, song_title, export_directory, &workspace_root)
        .await
}

pub(crate) async fn export_song_to_zip_with_workspace_root(
    song_path: String,
    song_title: Option<String>,
    export_directory: Option<String>,
    workspace_root: &Path,
) -> Result<ExportSongResult> {
    // Workspace containment is mandatory: refuse to read a song folder outside
    // the workspace — mirroring every other file-access command so export can't
    // be used to zip arbitrary paths the user never selected in-tree. Routes
    // through the single canonical containment primitive
    // (`canonicalize_within_workspace`) so the symlink-safe invariant isn't
    // re-implemented here. The root comes from managed native state, never a
    // renderer-supplied parameter.
    //
    // Use the returned canonical path (symlinks resolved at validation time)
    // for the export itself — passing the original `song_path` here would
    // re-introduce a TOCTOU window where a symlink could be repointed outside
    // the workspace between validation and use.
    let canonical_song_path = crate::filesystem::canonicalize_within_workspace(
        &song_path,
        Some(&workspace_root.to_string_lossy()),
    )
    .await?;
    let export_directory = resolve_export_directory(export_directory.as_deref());
    let song_title = song_title
        .as_deref()
        .filter(|title| !title.trim().is_empty())
        .unwrap_or("song");

    match export_song_folder_to_zip_in_workspace(
        &canonical_song_path,
        song_title,
        &export_directory,
        workspace_root,
    )
    .await
    {
        // Keep the established IPC contract: once the managed workspace path
        // has passed its security boundary, export failures are returned as a
        // structured result for the renderer rather than rejected commands.
        Ok(result) => Ok(result),
        Err(error) => Ok(ExportSongResult::failure(error.to_string())),
    }
}

pub async fn export_song_folder_to_zip(
    song_path: &Path,
    song_title: &str,
    export_directory: &Path,
) -> Result<ExportSongResult> {
    // This public helper is used by local callers/tests that have no separate
    // workspace state. The IPC command above supplies the managed workspace
    // root. Keeping this wrapper preserves its existing behavior while all
    // collection still flows through the same symlink-safe helper.
    match export_song_folder_to_zip_in_workspace(song_path, song_title, export_directory, song_path)
        .await
    {
        Ok(result) => Ok(result),
        Err(error) => Ok(ExportSongResult::failure(error.to_string())),
    }
}

async fn export_song_folder_to_zip_in_workspace(
    song_path: &Path,
    song_title: &str,
    export_directory: &Path,
    workspace_root: &Path,
) -> Result<ExportSongResult> {
    export_song_folder_to_zip_inner(song_path, song_title, export_directory, workspace_root).await
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
        match fs::read(&candidate).await {
            Ok(bytes) => {
                let data_url = data_url_for_asset(asset_path, &bytes);
                return Ok(json!({
                    "success": true,
                    "dataUrl": data_url
                }));
            }
            // Distinguish "absent" (try the next candidate) from a real I/O
            // error (permission denied, etc.) so the latter isn't masked as a
            // generic "not found". Non-not-found errors are logged and we keep
            // scanning the remaining candidates.
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                eprintln!("[songs] get_skin_asset: read {candidate:?} failed: {error}");
                continue;
            }
        }
    }

    Ok(json!({
        "success": false,
        "error": format!("Skin asset not found: {asset_path}")
    }))
}

#[tauri::command]
pub async fn parse_dtx_files(
    folder_path: String,
    state: State<'_, WorkspaceRootState>,
) -> Result<DtxParseResult> {
    parse_dtx_files_with_workspace_state(folder_path, &state).await
}

pub(crate) async fn parse_dtx_files_with_workspace_state(
    folder_path: String,
    state: &WorkspaceRootState,
) -> Result<DtxParseResult> {
    let workspace_root = state.current()?;
    parse_dtx_files_with_workspace_root(folder_path, &workspace_root).await
}

pub(crate) async fn parse_dtx_files_with_workspace_root(
    folder_path: String,
    workspace_root: &Path,
) -> Result<DtxParseResult> {
    // Enforce workspace containment at the IPC boundary so a compromised
    // renderer can't enumerate metadata (titles/levels/artists) for arbitrary
    // folders outside the workspace. Routes through the canonical containment
    // primitive; the inner helper still accepts a canonical path for tests.
    let canonical = crate::filesystem::canonicalize_within_workspace(
        &folder_path,
        Some(&workspace_root.to_string_lossy()),
    )
    .await?;
    // Propagate I/O errors (non-existent path, permission denied, etc.) to the
    // caller instead of silently returning an empty result. The renderer's
    // caller already catches errors and degrades gracefully. Genuinely empty
    // folders (no .dtx files) are handled inside parse_dtx_folder itself.
    parse_dtx_folder(&canonical).await
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

        if let Some(level) = metadata.level.filter(|level| *level != 0.0) {
            levels.push(DtxLevel {
                label: label_from_set_def.unwrap_or_else(|| fallback_level_label(&file_name)),
                level,
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
    workspace_root: &Path,
) -> Result<ExportSongResult> {
    ensure_export_directory(export_directory).await?;
    validate_safe_file_name(song_title, "zip file name")?;

    let valid_files = match collect_valid_song_files(song_path, workspace_root).await {
        Ok(files) => files,
        Err(DesktopError::Message(error)) if error == "NO_VALID_SONG_FILES" => {
            return Ok(ExportSongResult::failure(
                "No valid files found to export".to_string(),
            ));
        }
        Err(error) => return Err(error),
    };

    let zip_path = export_directory.join(format!("{song_title}.zip"));
    let zip_path_for_archive = zip_path.clone();
    let files_count = valid_files.len();
    task::spawn_blocking(move || write_song_zip(&zip_path_for_archive, &valid_files))
        .await
        .map_err(|error| DesktopError::Message(error.to_string()))??;

    Ok(ExportSongResult {
        success: true,
        zip_path: Some(zip_path.to_string_lossy().into_owned()),
        files_count: Some(files_count),
        error: None,
    })
}

/// Collects the top-level DTX asset files used by both manual export and Drive
/// upload. The caller supplies the managed workspace root so a symlinked song
/// directory cannot escape it. Symlink entries are deliberately excluded,
/// matching the historic manual export behavior.
pub(crate) async fn collect_valid_song_files(
    song_path: &Path,
    workspace_root: &Path,
) -> Result<Vec<PathBuf>> {
    let canonical_song_path = crate::filesystem::canonicalize_within_workspace(
        &song_path.to_string_lossy(),
        Some(&workspace_root.to_string_lossy()),
    )
    .await?;
    let canonical_workspace_root = fs::canonicalize(workspace_root).await?;
    let mut files = Vec::new();
    let mut entries = fs::read_dir(&canonical_song_path).await?;

    while let Some(entry) = entries.next_entry().await? {
        let file_type = entry.file_type().await?;
        if !file_type.is_file() {
            continue;
        }

        let file_name = entry.file_name().to_string_lossy().into_owned();
        if !is_valid_export_file_name(&file_name) {
            continue;
        }

        // Re-canonicalize the entry before handing it to the blocking ZIP
        // writer. This keeps an entry that was swapped for an escaping link
        // between directory enumeration and collection out of the archive.
        let canonical_file = match fs::canonicalize(entry.path()).await {
            Ok(file) => file,
            Err(_) => continue,
        };
        if !canonical_file.starts_with(&canonical_song_path)
            || !canonical_file.starts_with(&canonical_workspace_root)
        {
            continue;
        }
        files.push(canonical_file);
    }

    files.sort_by(|left, right| {
        left.file_name()
            .map(|name| name.to_string_lossy())
            .cmp(&right.file_name().map(|name| name.to_string_lossy()))
    });
    if files.is_empty() {
        return Err(DesktopError::Message("NO_VALID_SONG_FILES".to_string()));
    }
    Ok(files)
}

/// Creates a ZIP from already validated, top-level files. If any write fails,
/// remove the incomplete destination so neither manual export nor a future
/// upload can accidentally consume a partial archive.
pub(crate) fn write_song_zip(output_path: &Path, files: &[PathBuf]) -> Result<usize> {
    write_song_zip_with_copy(output_path, files, |file_path, zip| {
        let mut source = std::fs::File::open(file_path)?;
        copy(&mut source, zip)?;
        Ok(())
    })
}

fn write_song_zip_with_copy<F>(
    output_path: &Path,
    files: &[PathBuf],
    mut copy_file: F,
) -> Result<usize>
where
    F: FnMut(&Path, &mut zip::ZipWriter<std::fs::File>) -> Result<()>,
{
    let result = (|| -> Result<usize> {
        let file = std::fs::File::create(output_path)?;
        let mut zip = zip::ZipWriter::new(file);

        for file_path in files {
            let file_name = file_path
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(|| DesktopError::Message("Invalid song file name".to_string()))?;
            zip.start_file(file_name, SimpleFileOptions::default())?;
            copy_file(file_path, &mut zip)?;
        }

        zip.finish()?;
        Ok(files.len())
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(output_path);
    }
    result
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
    let files = collect_valid_song_files(song_path, song_path).await?;
    Ok(files
        .into_iter()
        .filter_map(|path| {
            let file_name = path.file_name()?.to_string_lossy().into_owned();
            Some((file_name, path))
        })
        .collect())
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
        // Default and explicit "~/Downloads": resolve through the SAME
        // dirs-based resolver the renderer's displayed default uses
        // (`default_downloads_dir`), so the displayed default and the real
        // write target can never diverge (e.g. on XDG-configured Linux, where
        // $HOME/Downloads != $XDG_DOWNLOAD_DIR). Falls back to $HOME/Downloads
        // when dirs can't resolve one (headless/sandboxed envs).
        None | Some("~/Downloads") => crate::filesystem::default_downloads_dir()
            .map(PathBuf::from)
            .or_else(|| home_dir().map(|home| home.join("Downloads")))
            .unwrap_or_else(|| PathBuf::from(".")),
        Some(path) if path.starts_with("~/") => home_dir()
            .map(|home| home.join(&path[2..]))
            .unwrap_or_else(|| PathBuf::from(&path[2..])),
        Some(path) => PathBuf::from(path),
    }
}

fn home_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(|value| value.to_string_lossy().into_owned());
    let userprofile =
        std::env::var_os("USERPROFILE").map(|value| value.to_string_lossy().into_owned());
    let homedrive = std::env::var_os("HOMEDRIVE").map(|value| value.to_string_lossy().into_owned());
    let homepath = std::env::var_os("HOMEPATH").map(|value| value.to_string_lossy().into_owned());

    home_dir_from_env(
        current_home_dir_platform(),
        home.as_deref(),
        userprofile.as_deref(),
        homedrive.as_deref(),
        homepath.as_deref(),
    )
}

fn current_home_dir_platform() -> HomeDirPlatform {
    if cfg!(windows) {
        HomeDirPlatform::Windows
    } else {
        HomeDirPlatform::Posix
    }
}

fn home_dir_from_env(
    platform: HomeDirPlatform,
    home: Option<&str>,
    userprofile: Option<&str>,
    homedrive: Option<&str>,
    homepath: Option<&str>,
) -> Option<PathBuf> {
    match platform {
        HomeDirPlatform::Posix => non_empty_path(home)
            .or_else(|| windows_home_dir_fallback(userprofile, homedrive, homepath)),
        HomeDirPlatform::Windows => windows_home_dir_fallback(userprofile, homedrive, homepath)
            .or_else(|| non_empty_path(home)),
    }
}

fn windows_home_dir_fallback(
    userprofile: Option<&str>,
    homedrive: Option<&str>,
    homepath: Option<&str>,
) -> Option<PathBuf> {
    non_empty_path(userprofile).or_else(|| {
        match (non_empty_value(homedrive), non_empty_value(homepath)) {
            (Some(drive), Some(path)) => Some(PathBuf::from(format!("{drive}{path}"))),
            _ => None,
        }
    })
}

fn non_empty_path(value: Option<&str>) -> Option<PathBuf> {
    non_empty_value(value).map(PathBuf::from)
}

fn non_empty_value(value: Option<&str>) -> Option<&str> {
    value.filter(|value| !value.trim().is_empty())
}

fn validate_safe_file_name(file_name: &str, description: &str) -> Result<()> {
    if is_safe_file_name(file_name) {
        return Ok(());
    }

    Err(DesktopError::Message(format!("Invalid {description}")))
}

fn is_safe_file_name(file_name: &str) -> bool {
    if file_name.is_empty() || Path::new(file_name).is_absolute() {
        return false;
    }

    if file_name.contains('/') || file_name.contains('\\') {
        return false;
    }

    let Some(first_character) = file_name.chars().next() else {
        return false;
    };
    let Some(last_character) = file_name.chars().last() else {
        return false;
    };
    if matches!(first_character, '.' | ' ') || matches!(last_character, '.' | ' ') {
        return false;
    }

    if file_name.chars().any(|character| {
        character.is_control()
            || matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            )
    }) {
        return false;
    }

    let mut components = Path::new(file_name).components();
    if !matches!(components.next(), Some(Component::Normal(_))) || components.next().is_some() {
        return false;
    }

    !is_reserved_windows_file_name(file_name)
}

fn is_reserved_windows_file_name(file_name: &str) -> bool {
    let stem = file_name
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();

    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || is_reserved_windows_numbered_name(&stem, "COM")
        || is_reserved_windows_numbered_name(&stem, "LPT")
}

fn is_reserved_windows_numbered_name(stem: &str, prefix: &str) -> bool {
    let Some(number) = stem.strip_prefix(prefix) else {
        return false;
    };

    number.len() == 1 && matches!(number, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
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
#[path = "tests/songs_tests.rs"]
mod tests;
