use crate::auth::AuthState;
use crate::error::{DesktopError, Result};
use reqwest::multipart::{Form, Part};
use serde_json::{json, Map, Value};
use std::path::Path;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::fs;

const API_REQUEST_TIMEOUT_MS: u64 = 30_000;

const SIMFILE_FULL_FRAGMENT: &str = r#"
fragment SimfileFull on Simfile {
  id
  displayId
  title
  artist
  bpm
  userId
  isPublished
  downloadUrl
  previewUrl
  videoPreviewUrl
  publishDate
  createdAt
  updatedAt
  dtxFiles {
    level
    label
  }
}
"#;

const LIST_SIMFILES_QUERY: &str = r#"
query ListSimfiles($scope: SimfileScope!, $search: String, $page: Int, $pageSize: Int) {
  simfiles(scope: $scope, search: $search, page: $page, pageSize: $pageSize) {
    count
    data {
      id
      displayId
      title
      artist
      bpm
      userId
      isPublished
      downloadUrl
      previewUrl
      videoPreviewUrl
      publishDate
      dtxFiles {
        level
        label
      }
    }
  }
}
"#;

const GET_SIMFILE_QUERY: &str = r#"
query GetSimfile($id: ID!) {
  simfile(id: $id) {
    ...SimfileFull
  }
}
"#;

const GET_SIMFILE_WITH_FILES_QUERY: &str = r#"
query GetSimfileWithFiles($id: ID!) {
  simfile(id: $id) {
    ...SimfileFull
    files {
      key
      size
      uploaded
    }
  }
}
"#;

const NEXT_DISPLAY_ID_QUERY: &str = r#"
query NextDisplayId {
  nextDisplayId
}
"#;

const SIMFILE_SEARCH_QUERY: &str = r#"
query SimfileSearch($query: String!, $excludeIds: [ID!], $limit: Int) {
  simfileSearch(query: $query, excludeIds: $excludeIds, limit: $limit) {
    id
    title
    artist
    bpm
    isPublished
  }
}
"#;

const CREATE_SIMFILE_MUTATION: &str = r#"
mutation CreateSimfile($input: CreateSimfileInput!) {
  createSimfile(input: $input) {
    ...SimfileFull
  }
}
"#;

const UPDATE_SIMFILE_MUTATION: &str = r#"
mutation UpdateSimfile($id: ID!, $input: UpdateSimfileInput!) {
  updateSimfile(id: $id, input: $input) {
    ...SimfileFull
  }
}
"#;

#[derive(Debug, Clone, PartialEq)]
pub enum ApiResultValue {
    Success { data: Value },
    Failure { error: String, code: Option<String> },
}

impl ApiResultValue {
    fn success_data(self) -> std::result::Result<Value, (String, Option<String>)> {
        match self {
            ApiResultValue::Success { data } => Ok(data),
            ApiResultValue::Failure { error, code } => Err((error, code)),
        }
    }
}

pub fn api_base_url_from_values(api_url: Option<&str>) -> Result<String> {
    let url = api_url
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            DesktopError::Message("VITE_DTX_API_URL environment variable is not set".to_string())
        })?;

    Ok(url.trim().trim_end_matches('/').to_string())
}

fn api_base_url_from_env() -> Result<String> {
    api_base_url_from_values(config_env!("VITE_DTX_API_URL").as_deref())
}

fn bucket_base_url_from_env() -> Result<String> {
    let url = config_env!("PUBLIC_SIMFILE_BUCKET_URL").ok_or_else(|| {
        DesktopError::Message(
            "PUBLIC_SIMFILE_BUCKET_URL environment variable is not set".to_string(),
        )
    })?;
    Ok(url.trim().trim_end_matches('/').to_string())
}

async fn access_token_from_auth_state(state: &AuthState) -> Result<String> {
    let session = state
        .current_session()
        .await
        .ok_or_else(|| DesktopError::Message("User not authenticated".to_string()))?;
    let token = session
        .get("access_token")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| DesktopError::Message("User not authenticated".to_string()))?;
    Ok(token.to_string())
}

fn graphql_document(operation: &str) -> String {
    format!("{SIMFILE_FULL_FRAGMENT}\n{operation}")
}

fn api_failure(error: impl Into<String>) -> Value {
    json!({ "success": false, "error": error.into() })
}

fn api_success(data: Value) -> Value {
    json!({ "success": true, "data": data })
}

fn reqwest_client() -> std::result::Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .timeout(Duration::from_millis(API_REQUEST_TIMEOUT_MS))
        .build()
}

pub async fn run_graphql_value(
    base_url: &str,
    token: &str,
    query: &str,
    variables: Value,
) -> ApiResultValue {
    let client = match reqwest_client() {
        Ok(client) => client,
        Err(error) => {
            return ApiResultValue::Failure {
                error: error.to_string(),
                code: None,
            }
        }
    };

    run_graphql_value_with_client(client, base_url, token, query, variables).await
}

async fn run_graphql_value_with_client(
    client: reqwest::Client,
    base_url: &str,
    token: &str,
    query: &str,
    variables: Value,
) -> ApiResultValue {
    let endpoint = format!("{}/graphql", base_url.trim_end_matches('/'));
    let response = client
        .post(endpoint)
        .bearer_auth(token)
        .header(reqwest::header::USER_AGENT, "DTXDesktopApp")
        .header("X-Requested-With", "DTXDesktopApp")
        .json(&json!({ "query": query, "variables": variables }))
        .send()
        .await;

    let response = match response {
        Ok(response) => response,
        Err(error) if error.is_timeout() => {
            return ApiResultValue::Failure {
                error: format!("Request timed out after {API_REQUEST_TIMEOUT_MS}ms"),
                code: None,
            }
        }
        Err(error) => {
            return ApiResultValue::Failure {
                error: error.to_string(),
                code: None,
            }
        }
    };

    let status = response.status();
    let status_text = status
        .canonical_reason()
        .map(str::to_string)
        .unwrap_or_else(|| format!("HTTP {}", status.as_u16()));

    let body = match response.json::<Value>().await {
        Ok(body) => body,
        Err(_) if !status.is_success() => {
            return ApiResultValue::Failure {
                error: status_text,
                code: None,
            }
        }
        Err(error) => {
            return ApiResultValue::Failure {
                error: error.to_string(),
                code: None,
            }
        }
    };

    if !status.is_success() {
        let error = body
            .get("error")
            .and_then(Value::as_str)
            .or_else(|| body.get("message").and_then(Value::as_str))
            .map(str::to_string)
            .unwrap_or_else(|| format!("HTTP {}", status.as_u16()));
        return ApiResultValue::Failure { error, code: None };
    }

    if let Some(error) = body
        .get("errors")
        .and_then(Value::as_array)
        .and_then(|errors| errors.first())
    {
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("GraphQL error");
        let code = error
            .pointer("/extensions/code")
            .and_then(Value::as_str)
            .map(str::to_string);
        let formatted = code
            .as_ref()
            .map(|code| format!("{code}: {message}"))
            .unwrap_or_else(|| message.to_string());
        return ApiResultValue::Failure {
            error: formatted,
            code,
        };
    }

    ApiResultValue::Success {
        data: body.get("data").cloned().unwrap_or(Value::Null),
    }
}

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

pub fn renderer_simfile_from_graphql(simfile: &Value) -> Result<Value> {
    let mut mapped = Map::new();
    mapped.insert("id".to_string(), json!(number_id(&simfile["id"])?));
    mapped.insert("title".to_string(), simfile["title"].clone());
    mapped.insert("artist".to_string(), simfile["artist"].clone());
    mapped.insert("bpm".to_string(), simfile["bpm"].clone());
    mapped.insert("user_id".to_string(), simfile["userId"].clone());
    mapped.insert("is_published".to_string(), simfile["isPublished"].clone());
    mapped.insert("display_id".to_string(), simfile["displayId"].clone());
    mapped.insert("download_url".to_string(), simfile["downloadUrl"].clone());
    mapped.insert("preview_url".to_string(), simfile["previewUrl"].clone());
    mapped.insert(
        "video_preview_url".to_string(),
        simfile["videoPreviewUrl"].clone(),
    );
    mapped.insert("publish_date".to_string(), simfile["publishDate"].clone());
    mapped.insert("created_at".to_string(), simfile["createdAt"].clone());
    mapped.insert("updated_at".to_string(), simfile["updatedAt"].clone());

    let dtx_files = simfile
        .get("dtxFiles")
        .and_then(Value::as_array)
        .map(|files| {
            files
                .iter()
                .enumerate()
                .map(|(index, file)| {
                    json!({
                        "id": index + 1,
                        "level": file["level"],
                        "label": file["label"],
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    mapped.insert("dtx_files".to_string(), Value::Array(dtx_files));

    Ok(Value::Object(mapped))
}

pub fn update_input_from_renderer(update_data: Value) -> Value {
    let Some(object) = update_data.as_object() else {
        return update_data;
    };

    let mut mapped = Map::new();
    for (key, value) in object {
        let mapped_key = match key.as_str() {
            "display_id" => "displayId",
            "publish_date" => "publishDate",
            "is_published" => "isPublished",
            "download_url" => "downloadUrl",
            "video_preview_url" => "videoPreviewUrl",
            "preview_url" => "previewUrl",
            _ => key,
        };
        mapped.insert(mapped_key.to_string(), value.clone());
    }
    Value::Object(mapped)
}

fn create_input_from_renderer(simfile_data: &Value) -> Value {
    let levels = simfile_data
        .get("levels")
        .and_then(Value::as_array)
        .map(|levels| {
            levels
                .iter()
                .map(|level| {
                    json!({
                        "label": level.get("label").cloned().unwrap_or(Value::String(String::new())),
                        "level": level.get("level").cloned().unwrap_or(json!(0)),
                    })
                })
                .collect::<Vec<_>>()
        });

    json!({
        "title": simfile_data.get("title").cloned().unwrap_or(Value::String(String::new())),
        "artist": simfile_data.get("artist").cloned().unwrap_or(Value::String(String::new())),
        "bpm": simfile_data.get("bpm").cloned().unwrap_or(json!(0)),
        "displayId": simfile_data.get("displayId").cloned().unwrap_or(Value::Null),
        "isPublished": simfile_data.get("isPublished").cloned().unwrap_or(Value::Null),
        "publishDate": simfile_data.get("publishDate").cloned().unwrap_or(Value::Null),
        "downloadUrl": simfile_data.get("downloadUrl").cloned().unwrap_or(Value::Null),
        "videoPreviewUrl": simfile_data.get("videoPreviewUrl").cloned().unwrap_or(Value::Null),
        "dtxFiles": levels.map(Value::Array).unwrap_or(Value::Null),
    })
}

pub(crate) async fn graphql_data_with_url(
    base_url: &str,
    token: &str,
    query: &str,
    variables: Value,
) -> Result<Value> {
    run_graphql_value(base_url, token, query, variables)
        .await
        .success_data()
        .map_err(|(error, _)| DesktopError::Message(error))
}

pub(crate) async fn graphql_result_with_url(
    base_url: &str,
    token: &str,
    query: &str,
    variables: Value,
) -> Result<ApiResultValue> {
    Ok(run_graphql_value(base_url, token, query, variables).await)
}

async fn upload_bytes_to_api(
    base_url: &str,
    token: &str,
    bytes: Vec<u8>,
    upload_name: &str,
    simfile_id: &str,
    content_type: Option<&str>,
) -> Value {
    let mut part = Part::bytes(bytes).file_name(upload_name.to_string());
    if let Some(content_type) = content_type {
        match part.mime_str(content_type) {
            Ok(typed_part) => part = typed_part,
            Err(error) => return api_failure(error.to_string()),
        }
    }

    let form = Form::new()
        .part("file", part)
        .text("simFileId", simfile_id.to_string());

    upload_form_to_api(base_url, token, form).await
}

async fn upload_form_to_api(base_url: &str, token: &str, form: Form) -> Value {
    let client = match reqwest_client() {
        Ok(client) => client,
        Err(error) => return api_failure(error.to_string()),
    };
    let endpoint = format!("{}/upload", base_url.trim_end_matches('/'));
    let response = client
        .post(endpoint)
        .bearer_auth(token)
        .header(reqwest::header::USER_AGENT, "DTXDesktopApp")
        .header("X-Requested-With", "DTXDesktopApp")
        .multipart(form)
        .send()
        .await;

    let response = match response {
        Ok(response) => response,
        Err(error) if error.is_timeout() => {
            return api_failure(format!(
                "Request timed out after {API_REQUEST_TIMEOUT_MS}ms"
            ));
        }
        Err(error) => return api_failure(error.to_string()),
    };

    let status = response.status();
    let status_text = status
        .canonical_reason()
        .map(str::to_string)
        .unwrap_or_else(|| format!("HTTP {}", status.as_u16()));

    if !status.is_success() {
        let error = match response.json::<Value>().await {
            Ok(body) => body
                .get("error")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| format!("HTTP {}", status.as_u16())),
            Err(_) => status_text,
        };
        return api_failure(error);
    }

    match response.json::<Value>().await {
        Ok(data) => api_success(data),
        Err(error) => api_failure(error.to_string()),
    }
}

fn upload_name_from_file_name(file_name: &str) -> String {
    if file_name.contains('/') {
        let stripped = file_name.split('/').skip(1).collect::<Vec<_>>().join("/");
        if !stripped.is_empty() {
            return stripped;
        }
    }
    file_name.to_string()
}

pub async fn upload_file_to_api(
    base_url: &str,
    token: &str,
    file_name: &str,
    song_folder_path: &str,
    simfile_id: &str,
) -> Value {
    let song_folder = Path::new(song_folder_path);
    let file_path = song_folder.join(file_name);
    let canonical_song_folder = match fs::canonicalize(song_folder).await {
        Ok(path) => path,
        Err(_) => {
            return api_failure(format!("File not found: {}", song_folder.display()));
        }
    };
    let canonical_file_path = match fs::canonicalize(&file_path).await {
        Ok(path) => path,
        Err(_) => {
            return api_failure(format!("File not found: {}", file_path.display()));
        }
    };
    if !canonical_file_path.starts_with(&canonical_song_folder) {
        return api_failure("File path is outside song folder");
    }

    let bytes = match fs::read(&canonical_file_path).await {
        Ok(bytes) => bytes,
        Err(_) => {
            return api_failure(format!("File not found: {}", file_path.display()));
        }
    };
    let upload_name = upload_name_from_file_name(file_name);
    upload_bytes_to_api(base_url, token, bytes, &upload_name, simfile_id, None).await
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
/// - `Err(message)` when containment fails or the workspace root is missing.
async fn read_preview_within_workspace(
    song_path: &str,
    workspace_root: &str,
    file_name: &str,
) -> std::result::Result<Option<Vec<u8>>, String> {
    if workspace_root.trim().is_empty() {
        return Err("A workspace root is required to upload previews".to_string());
    }
    let canonical_root = fs::canonicalize(workspace_root)
        .await
        .map_err(|_| format!("Workspace root not found: {workspace_root}"))?;
    let canonical_song = fs::canonicalize(song_path)
        .await
        .map_err(|_| format!("Song folder not found: {song_path}"))?;
    if !canonical_song.starts_with(&canonical_root) {
        return Err("Song folder is outside the workspace".to_string());
    }
    match fs::read(canonical_song.join(file_name)).await {
        Ok(bytes) => Ok(Some(bytes)),
        Err(_) => Ok(None),
    }
}

pub(crate) async fn fetch_user_simfiles_impl(base_url: &str, token: &str) -> Result<Value> {
    let mut all_data = Vec::new();
    let page_size = 100;
    let mut page = 1;

    loop {
        let result = graphql_result_with_url(
            base_url,
            token,
            LIST_SIMFILES_QUERY,
            json!({ "scope": "MINE", "page": page, "pageSize": page_size }),
        )
        .await;

        let data = match result {
            Ok(ApiResultValue::Success { data }) => data,
            Ok(ApiResultValue::Failure { error, .. }) => {
                return Ok(json!({
                    "success": false,
                    "error": error,
                    "data": all_data,
                    "fromCache": false,
                }));
            }
            Err(error) => {
                return Ok(json!({
                    "success": false,
                    "error": error.to_string(),
                    "data": all_data,
                    "fromCache": false,
                }));
            }
        };

        let simfiles = &data["simfiles"];
        let page_data = simfiles
            .get("data")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for simfile in page_data {
            all_data.push(renderer_simfile_from_graphql(&simfile)?);
        }

        let count = simfiles.get("count").and_then(Value::as_i64).unwrap_or(0);
        let total_pages = ((count + page_size - 1) / page_size).max(1);
        if page >= total_pages {
            break;
        }
        page += 1;
    }

    Ok(json!({ "success": true, "data": all_data, "fromCache": false }))
}

#[tauri::command]
pub async fn fetch_user_simfiles(app: AppHandle) -> Result<Value> {
    let base_url = api_base_url_from_env()?;
    let token = access_token_from_auth_state(&app.state::<AuthState>()).await?;
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
    let token = access_token_from_auth_state(&app.state::<AuthState>()).await?;
    get_next_display_id_impl(&base_url, &token).await
}

pub(crate) async fn search_cloud_songs_impl(
    base_url: &str,
    token: &str,
    query: String,
    limit: Option<i64>,
    exclude_linked_song_ids: Option<Vec<Value>>,
) -> Result<Value> {
    let exclude_ids = exclude_linked_song_ids
        .unwrap_or_default()
        .into_iter()
        .map(|id| {
            id.as_str()
                .map(str::to_string)
                .unwrap_or_else(|| id.to_string())
        })
        .collect::<Vec<_>>();
    let variables = json!({
        "query": query,
        "limit": limit.unwrap_or(8),
        "excludeIds": if exclude_ids.is_empty() { Value::Null } else { json!(exclude_ids) },
    });

    let result = graphql_result_with_url(base_url, token, SIMFILE_SEARCH_QUERY, variables).await?;
    let data = match result.success_data() {
        Ok(data) => data,
        Err((error, _)) => return Ok(api_failure(error)),
    };

    let rows = data
        .get("simfileSearch")
        .and_then(Value::as_array)
        .map(|songs| {
            songs
                .iter()
                .map(|song| {
                    json!({
                        "id": song["id"],
                        "title": song["title"],
                        "artist": song["artist"],
                        "bpm": song["bpm"],
                        "is_published": song["isPublished"],
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(api_success(Value::Array(rows)))
}

#[tauri::command]
pub async fn search_cloud_songs(
    app: AppHandle,
    query: String,
    limit: Option<i64>,
    exclude_linked_song_ids: Option<Vec<Value>>,
) -> Result<Value> {
    let base_url = api_base_url_from_env()?;
    let token = access_token_from_auth_state(&app.state::<AuthState>()).await?;
    search_cloud_songs_impl(&base_url, &token, query, limit, exclude_linked_song_ids).await
}

pub(crate) async fn fetch_cloud_song_impl(
    base_url: &str,
    token: &str,
    cloud_song_id: Value,
) -> Result<Value> {
    let result = graphql_result_with_url(
        base_url,
        token,
        &graphql_document(GET_SIMFILE_QUERY),
        json!({ "id": cloud_song_id.to_string().trim_matches('"') }),
    )
    .await?;
    let data = match result.success_data() {
        Ok(data) => data,
        Err((error, _)) => return Ok(api_failure(error)),
    };
    let Some(simfile) = data.get("simfile").filter(|simfile| !simfile.is_null()) else {
        return Ok(api_failure("Simfile not found"));
    };

    Ok(json!({
        "success": true,
        "cloudSongData": renderer_simfile_from_graphql(simfile)?,
    }))
}

#[tauri::command]
pub async fn fetch_cloud_song(app: AppHandle, cloud_song_id: Value) -> Result<Value> {
    let base_url = api_base_url_from_env()?;
    let token = access_token_from_auth_state(&app.state::<AuthState>()).await?;
    fetch_cloud_song_impl(&base_url, &token, cloud_song_id).await
}

pub(crate) async fn update_simfile_record_impl(
    base_url: &str,
    token: &str,
    simfile_id: Value,
    update_data: Value,
) -> Result<Value> {
    let result = graphql_result_with_url(
        base_url,
        token,
        &graphql_document(UPDATE_SIMFILE_MUTATION),
        json!({
            "id": simfile_id.to_string().trim_matches('"'),
            "input": update_input_from_renderer(update_data),
        }),
    )
    .await?;
    let data = match result.success_data() {
        Ok(data) => data,
        Err((error, _)) => return Ok(api_failure(error)),
    };

    Ok(json!({
        "success": true,
        "data": renderer_simfile_from_graphql(&data["updateSimfile"])?,
    }))
}

#[tauri::command]
pub async fn update_simfile_record(
    app: AppHandle,
    simfile_id: Value,
    update_data: Value,
) -> Result<Value> {
    let base_url = api_base_url_from_env()?;
    let token = access_token_from_auth_state(&app.state::<AuthState>()).await?;
    update_simfile_record_impl(&base_url, &token, simfile_id, update_data).await
}

pub(crate) async fn create_simfile_record_impl(
    base_url: &str,
    token: &str,
    simfile_data: Value,
) -> Result<Value> {
    let input = create_input_from_renderer(&simfile_data);
    let result = run_graphql_value(
        base_url,
        token,
        &graphql_document(CREATE_SIMFILE_MUTATION),
        json!({ "input": input }),
    )
    .await;
    let data = match result.success_data() {
        Ok(data) => data,
        Err((error, _)) => return Ok(api_failure(error)),
    };

    let simfile = &data["createSimfile"];
    let simfile_id = number_id(&simfile["id"])?.to_string();
    let mut warnings = Vec::new();

    let workspace_root = simfile_data
        .get("workspaceRoot")
        .and_then(Value::as_str)
        .unwrap_or("");
    if let Some(song_path) = simfile_data.get("songPath").and_then(Value::as_str) {
        if !song_path.is_empty() {
            if let Some(error) = upload_preview_if_present(
                base_url,
                token,
                song_path,
                workspace_root,
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
                song_path,
                workspace_root,
                &simfile_id,
                "preview.mp3",
                "audio/mpeg",
            )
            .await
            {
                warnings.push(format!("Sound preview: {error}"));
            }
        }
    }

    let mut response = json!({
        "success": true,
        "simfileId": simfile_id,
        "data": renderer_simfile_from_graphql(simfile)?,
    });
    if !warnings.is_empty() {
        response["warnings"] = json!(warnings);
    }
    Ok(response)
}

#[tauri::command]
pub async fn create_simfile_record(app: AppHandle, simfile_data: Value) -> Result<Value> {
    let base_url = api_base_url_from_env()?;
    let token = access_token_from_auth_state(&app.state::<AuthState>()).await?;
    create_simfile_record_impl(&base_url, &token, simfile_data).await
}

pub(crate) async fn load_asset_files_impl(
    base_url: &str,
    token: &str,
    simfile_id: String,
) -> Result<Value> {
    if simfile_id.is_empty() || simfile_id == "0" {
        return Ok(api_success(json!([])));
    }

    let result = graphql_result_with_url(
        base_url,
        token,
        &graphql_document(GET_SIMFILE_WITH_FILES_QUERY),
        json!({ "id": simfile_id }),
    )
    .await?;
    let data = match result.success_data() {
        Ok(data) => data,
        Err((error, code)) => {
            if code.as_deref() == Some("NOT_FOUND") || error.contains("Failed to list files") {
                return Ok(api_success(json!([])));
            }
            return Ok(api_failure(error));
        }
    };

    let Some(files) = data.pointer("/simfile/files").and_then(Value::as_array) else {
        return Ok(api_success(json!([])));
    };
    let prefix = format!("{}/", simfile_id);
    let rows = files
        .iter()
        .map(|file| {
            let key = file.get("key").and_then(Value::as_str).unwrap_or_default();
            let file_name = key.strip_prefix(&prefix).unwrap_or(key);
            json!({
                "fileName": file_name,
                "size": file["size"],
                "lastModified": file["uploaded"],
                "key": file["key"],
            })
        })
        .collect::<Vec<_>>();

    Ok(api_success(Value::Array(rows)))
}

#[tauri::command]
pub async fn load_asset_files(app: AppHandle, simfile_id: String) -> Result<Value> {
    let base_url = api_base_url_from_env()?;
    let token = access_token_from_auth_state(&app.state::<AuthState>()).await?;
    load_asset_files_impl(&base_url, &token, simfile_id).await
}

#[tauri::command]
pub async fn get_preview_url(simfile_id: i64) -> Result<String> {
    if simfile_id <= 0 {
        return Err(DesktopError::Message(format!(
            "Invalid simfileId: {simfile_id} must be a positive integer"
        )));
    }
    Ok(format!(
        "{}/{simfile_id}/preview.jpg",
        bucket_base_url_from_env()?
    ))
}

#[tauri::command]
pub async fn get_sound_preview_url(simfile_id: i64) -> Result<String> {
    if simfile_id <= 0 {
        return Err(DesktopError::Message(format!(
            "Invalid simfileId: {simfile_id} must be a positive integer"
        )));
    }
    Ok(format!(
        "{}/{simfile_id}/preview.mp3",
        bucket_base_url_from_env()?
    ))
}

#[tauri::command]
pub async fn upload_file(
    app: AppHandle,
    file_name: String,
    song_folder_path: String,
    simfile_id: String,
) -> Result<Value> {
    let base_url = api_base_url_from_env()?;
    let token = access_token_from_auth_state(&app.state::<AuthState>()).await?;
    Ok(upload_file_to_api(
        &base_url,
        &token,
        &file_name,
        &song_folder_path,
        &simfile_id,
    )
    .await)
}

#[cfg(test)]
#[path = "tests/api_tests.rs"]
mod tests;
