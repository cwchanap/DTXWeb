use crate::api::{
    access_token_from_auth_state, api_base_url_from_env, graphql_data_with_url, graphql_document,
    graphql_result_with_url, run_graphql_value, upload_bytes_to_api, ApiResultValue,
};
use crate::api_contracts::{
    CreateSimfileRecordInput, CreateSimfileRecordResult, FetchCloudSongResult,
    FetchUserSimfilesResult, NativeSimfile, NativeSimfileDtxFile, UpdateSimfileRecordInput,
    UpdateSimfileRecordResult,
};
use crate::auth::AuthState;
use crate::error::{DesktopError, Result};
use crate::workspace::WorkspaceRootState;
use serde_json::{json, Value};
use std::path::Path;
use tauri::{AppHandle, Manager, State};
use tokio::fs;

const LIST_SIMFILES_QUERY: &str = include_str!("../graphql/simfiles/list-simfiles.graphql");

const GET_SIMFILE_QUERY: &str = include_str!("../graphql/simfiles/get-simfile.graphql");

const NEXT_DISPLAY_ID_QUERY: &str = include_str!("../graphql/simfiles/next-display-id.graphql");

const CREATE_SIMFILE_MUTATION: &str = include_str!("../graphql/simfiles/create-simfile.graphql");

const UPDATE_SIMFILE_MUTATION: &str = include_str!("../graphql/simfiles/update-simfile.graphql");

fn number_id(value: &Value) -> Result<i64> {
    if let Some(id) = value.as_i64() {
        return Ok(id);
    }
    if let Some(id) = value.as_u64().and_then(|id| i64::try_from(id).ok()) {
        return Ok(id);
    }
    if let Some(id) = value.as_str().and_then(|id| id.parse::<i64>().ok()) {
        return Ok(id);
    }
    Err(DesktopError::Message(format!(
        "Invalid simfile id: {value}"
    )))
}

fn field_error(value: &Value, field: &str) -> DesktopError {
    DesktopError::Message(format!(
        "Invalid simfile field {field}: {}",
        value.get(field).unwrap_or(&Value::Null)
    ))
}

fn required_string(value: &Value, field: &str) -> Result<String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| field_error(value, field))
}

fn nullable_string(value: &Value, field: &str) -> Result<Option<String>> {
    match value.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        Some(_) => Err(field_error(value, field)),
    }
}

fn nullable_i64(value: &Value, field: &str) -> Result<Option<i64>> {
    match value.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(field_value) => field_value
            .as_i64()
            .map(Some)
            .ok_or_else(|| field_error(value, field)),
    }
}

fn required_f64(value: &Value, field: &str) -> Result<f64> {
    value
        .get(field)
        .and_then(Value::as_f64)
        .ok_or_else(|| field_error(value, field))
}

fn required_bool(value: &Value, field: &str) -> Result<bool> {
    value
        .get(field)
        .and_then(Value::as_bool)
        .ok_or_else(|| field_error(value, field))
}

pub fn native_simfile_from_graphql(simfile: &Value) -> Result<NativeSimfile> {
    let dtx_files = simfile
        .get("dtxFiles")
        .and_then(Value::as_array)
        .ok_or_else(|| field_error(simfile, "dtxFiles"))?
        .iter()
        .map(|file| {
            Ok(NativeSimfileDtxFile {
                id: number_id(&file["id"])?,
                label: required_string(file, "label")?,
                level: required_f64(file, "level")?,
            })
        })
        .collect::<Result<Vec<_>>>()?;

    Ok(NativeSimfile {
        id: number_id(&simfile["id"])?,
        display_id: nullable_i64(simfile, "displayId")?,
        title: required_string(simfile, "title")?,
        artist: required_string(simfile, "artist")?,
        bpm: required_f64(simfile, "bpm")?,
        user_id: nullable_string(simfile, "userId")?,
        google_drive_file_id: nullable_string(simfile, "googleDriveFileId")?,
        is_published: required_bool(simfile, "isPublished")?,
        download_url: nullable_string(simfile, "downloadUrl")?,
        preview_url: nullable_string(simfile, "previewUrl")?,
        video_preview_url: nullable_string(simfile, "videoPreviewUrl")?,
        publish_date: required_string(simfile, "publishDate")?,
        created_at: required_string(simfile, "createdAt")?,
        updated_at: required_string(simfile, "updatedAt")?,
        dtx_files,
    })
}

async fn upload_preview_if_present(
    base_url: &str,
    token: &str,
    song_path: &str,
    workspace_root: &str,
    simfile_id: &str,
    file_name: &str,
    content_type: &str,
) -> Option<String> {
    let bytes = match read_preview_within_workspace(song_path, workspace_root, file_name).await {
        Ok(Some(bytes)) => bytes,
        Ok(None) => return None,
        Err(error) => return Some(error),
    };
    let result = upload_bytes_to_api(
        base_url,
        token,
        bytes,
        file_name,
        simfile_id,
        Some(content_type),
    )
    .await;
    if result.get("success").and_then(Value::as_bool) == Some(true) {
        None
    } else {
        Some(
            result
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("Unknown error")
                .to_string(),
        )
    }
}

/// Reads a preview file from `song_path/file_name` only after confirming
/// `song_path` is contained within `workspace_root`. Returns:
/// - `Ok(Some(bytes))` when the file exists and is within the workspace,
/// - `Ok(None)` when the file is absent (no preview to upload, not an error),
/// - `Err(message)` when containment fails, the workspace root is missing,
///   or reading the preview file fails.
async fn read_preview_within_workspace(
    song_path: &str,
    workspace_root: &str,
    file_name: &str,
) -> std::result::Result<Option<Vec<u8>>, String> {
    if workspace_root.trim().is_empty() {
        return Err("A workspace root is required to upload previews".to_string());
    }
    // Verify root exists with an actionable message before routing the
    // containment check through canonicalize_within_workspace (which would
    // surface a generic I/O error otherwise).
    if fs::canonicalize(workspace_root).await.is_err() {
        return Err(format!("Workspace root not found: {workspace_root}"));
    }
    // Route the song-folder containment check through the canonical primitive
    // so the symlink-safe invariant lives in one tested place.
    let canonical_song =
        match crate::filesystem::canonicalize_within_workspace(song_path, Some(workspace_root))
            .await
        {
            Ok(path) => path,
            Err(DesktopError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
                return Err(format!("Song folder not found: {song_path}"));
            }
            Err(error) => return Err(error.to_string()),
        };
    // Canonicalize the preview file through the same primitive so a symlinked
    // preview.jpg/mp3 cannot exfiltrate bytes from outside the workspace. A
    // missing preview is not an error — map NotFound to Ok(None).
    let preview_path = canonical_song.join(file_name);
    let preview_path_str = preview_path
        .to_str()
        .ok_or_else(|| "Preview path is not valid UTF-8".to_string())?;
    let canonical_preview = match crate::filesystem::canonicalize_within_workspace(
        preview_path_str,
        Some(workspace_root),
    )
    .await
    {
        Ok(path) => path,
        Err(DesktopError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(None);
        }
        Err(error) => return Err(error.to_string()),
    };
    match fs::read(&canonical_preview).await {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) => Err(error.to_string()),
    }
}

pub(crate) async fn fetch_user_simfiles_impl(
    base_url: &str,
    token: &str,
) -> Result<FetchUserSimfilesResult> {
    let mut all_data: Vec<NativeSimfile> = Vec::new();
    let page_size = 100;
    let mut page = 1;

    loop {
        let result = graphql_result_with_url(
            base_url,
            token,
            &graphql_document(LIST_SIMFILES_QUERY),
            json!({ "scope": "MINE", "page": page, "pageSize": page_size }),
        )
        .await;

        let data = match result {
            Ok(ApiResultValue::Success { data }) => data,
            Ok(ApiResultValue::Failure { error, .. }) => {
                return Ok(FetchUserSimfilesResult {
                    success: false,
                    data: all_data,
                    from_cache: false,
                    error: Some(error),
                });
            }
            Err(error) => {
                return Ok(FetchUserSimfilesResult {
                    success: false,
                    data: all_data,
                    from_cache: false,
                    error: Some(error.to_string()),
                });
            }
        };

        let simfiles = &data["simfiles"];
        let page_data = simfiles
            .get("data")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for simfile in page_data {
            all_data.push(native_simfile_from_graphql(&simfile)?);
        }

        let count = simfiles.get("count").and_then(Value::as_i64).unwrap_or(0);
        let total_pages = ((count + page_size - 1) / page_size).max(1);
        if page >= total_pages {
            break;
        }
        page += 1;
    }

    Ok(FetchUserSimfilesResult {
        success: true,
        data: all_data,
        from_cache: false,
        error: None,
    })
}

#[tauri::command]
pub async fn fetch_user_simfiles(app: AppHandle) -> Result<FetchUserSimfilesResult> {
    let base_url = api_base_url_from_env()?;
    let token = access_token_from_auth_state(&app.state::<AuthState>(), Some(&app)).await?;
    fetch_user_simfiles_impl(&base_url, &token).await
}

pub(crate) async fn get_next_display_id_impl(base_url: &str, token: &str) -> Result<i64> {
    let data = graphql_data_with_url(base_url, token, NEXT_DISPLAY_ID_QUERY, json!({})).await?;
    data.get("nextDisplayId")
        .and_then(Value::as_i64)
        .ok_or_else(|| DesktopError::Message("Invalid nextDisplayId in API response".to_string()))
}

#[tauri::command]
pub async fn get_next_display_id(app: AppHandle) -> Result<i64> {
    let base_url = api_base_url_from_env()?;
    let token = access_token_from_auth_state(&app.state::<AuthState>(), Some(&app)).await?;
    get_next_display_id_impl(&base_url, &token).await
}

pub(crate) async fn fetch_cloud_song_impl(
    base_url: &str,
    token: &str,
    cloud_song_id: String,
) -> Result<FetchCloudSongResult> {
    let result = graphql_result_with_url(
        base_url,
        token,
        &graphql_document(GET_SIMFILE_QUERY),
        json!({ "id": cloud_song_id }),
    )
    .await?;
    let data = match result.success_data() {
        Ok(data) => data,
        Err((error, _)) => {
            return Ok(FetchCloudSongResult {
                success: false,
                cloud_song_data: None,
                error: Some(error),
            });
        }
    };
    let Some(simfile) = data.get("simfile").filter(|simfile| !simfile.is_null()) else {
        return Ok(FetchCloudSongResult {
            success: false,
            cloud_song_data: None,
            error: Some("Simfile not found".to_string()),
        });
    };

    Ok(FetchCloudSongResult {
        success: true,
        cloud_song_data: Some(native_simfile_from_graphql(simfile)?),
        error: None,
    })
}

#[tauri::command]
pub async fn fetch_cloud_song(
    app: AppHandle,
    cloud_song_id: String,
) -> Result<FetchCloudSongResult> {
    let base_url = api_base_url_from_env()?;
    let token = access_token_from_auth_state(&app.state::<AuthState>(), Some(&app)).await?;
    fetch_cloud_song_impl(&base_url, &token, cloud_song_id).await
}

pub(crate) async fn update_simfile_record_impl(
    base_url: &str,
    token: &str,
    simfile_id: String,
    update_data: UpdateSimfileRecordInput,
) -> Result<UpdateSimfileRecordResult> {
    let input = serde_json::to_value(&update_data)?;
    let result = graphql_result_with_url(
        base_url,
        token,
        &graphql_document(UPDATE_SIMFILE_MUTATION),
        json!({
            "id": simfile_id,
            "input": input,
        }),
    )
    .await?;
    let data = match result.success_data() {
        Ok(data) => data,
        Err((error, _)) => {
            return Ok(UpdateSimfileRecordResult {
                success: false,
                data: None,
                error: Some(error),
            });
        }
    };

    Ok(UpdateSimfileRecordResult {
        success: true,
        data: Some(native_simfile_from_graphql(&data["updateSimfile"])?),
        error: None,
    })
}

#[tauri::command]
pub async fn update_simfile_record(
    app: AppHandle,
    simfile_id: String,
    update_data: UpdateSimfileRecordInput,
) -> Result<UpdateSimfileRecordResult> {
    let base_url = api_base_url_from_env()?;
    let token = access_token_from_auth_state(&app.state::<AuthState>(), Some(&app)).await?;
    update_simfile_record_impl(&base_url, &token, simfile_id, update_data).await
}

pub(crate) async fn create_simfile_record_impl(
    base_url: &str,
    token: &str,
    simfile_data: CreateSimfileRecordInput,
    workspace_root: &Path,
) -> Result<CreateSimfileRecordResult> {
    let mut input = serde_json::to_value(&simfile_data)?;
    if let Value::Object(input) = &mut input {
        input.remove("songPath");
        if let Some(levels) = input.remove("levels") {
            input.insert("dtxFiles".to_string(), levels);
        }
    }
    let result = run_graphql_value(
        base_url,
        token,
        &graphql_document(CREATE_SIMFILE_MUTATION),
        json!({ "input": input }),
    )
    .await;
    let data = match result.success_data() {
        Ok(data) => data,
        Err((error, _)) => {
            return Ok(CreateSimfileRecordResult {
                success: false,
                simfile_id: None,
                data: None,
                error: Some(error),
                warnings: None,
            });
        }
    };

    let simfile = &data["createSimfile"];
    let simfile_id = number_id(&simfile["id"])?.to_string();
    let mut warnings = Vec::new();

    let workspace_root = workspace_root.to_string_lossy();
    if !simfile_data.song_path.is_empty() {
        if let Some(error) = upload_preview_if_present(
            base_url,
            token,
            &simfile_data.song_path,
            &workspace_root,
            &simfile_id,
            "preview.jpg",
            "image/jpeg",
        )
        .await
        {
            warnings.push(format!("Preview image: {error}"));
        }
        if let Some(error) = upload_preview_if_present(
            base_url,
            token,
            &simfile_data.song_path,
            &workspace_root,
            &simfile_id,
            "preview.mp3",
            "audio/mpeg",
        )
        .await
        {
            warnings.push(format!("Sound preview: {error}"));
        }
    }

    Ok(CreateSimfileRecordResult {
        success: true,
        simfile_id: Some(simfile_id),
        data: Some(native_simfile_from_graphql(simfile)?),
        error: None,
        warnings: (!warnings.is_empty()).then_some(warnings),
    })
}

#[tauri::command]
pub async fn create_simfile_record(
    app: AppHandle,
    simfile_data: CreateSimfileRecordInput,
    state: State<'_, WorkspaceRootState>,
) -> Result<CreateSimfileRecordResult> {
    let workspace_root = state.current()?;
    let base_url = api_base_url_from_env()?;
    let token = access_token_from_auth_state(&app.state::<AuthState>(), Some(&app)).await?;
    create_simfile_record_impl(&base_url, &token, simfile_data, &workspace_root).await
}

#[cfg(test)]
pub(crate) async fn create_simfile_record_with_workspace_state(
    base_url: &str,
    token: &str,
    simfile_data: CreateSimfileRecordInput,
    state: &WorkspaceRootState,
) -> Result<CreateSimfileRecordResult> {
    let workspace_root = state.current()?;
    create_simfile_record_impl(base_url, token, simfile_data, &workspace_root).await
}

#[cfg(test)]
#[path = "tests/simfile_tests.rs"]
mod tests;
