use crate::auth::AuthState;
use crate::error::{DesktopError, Result};
use crate::google_drive::{DriveMetadataError, ExpectedPreviousDriveFile, OwnerDriveSimfile};
use crate::workspace::WorkspaceRootState;
use reqwest::multipart::{Form, Part};
use serde_json::{json, Map, Value};
use std::path::Path;
use std::time::Duration;
use tauri::{AppHandle, Manager, Runtime, State};
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
  googleDriveFileId
  isPublished
  downloadUrl
  previewUrl
  videoPreviewUrl
  publishDate
  createdAt
  updatedAt
  dtxFiles {
    id
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
      googleDriveFileId
      isPublished
      downloadUrl
      previewUrl
      videoPreviewUrl
      publishDate
      dtxFiles {
        id
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

const OWNER_DRIVE_SIMFILE_QUERY: &str = r#"
query OwnerDriveSimfile($id: ID!) {
  simfile(id: $id) {
    id
    title
    userId
    googleDriveFileId
    downloadUrl
  }
}
"#;

const UPDATE_SIMFILE_DRIVE_FILE_MUTATION: &str = r#"
mutation UpdateSimfileDriveFile($id: ID!, $googleDriveFileId: String!, $downloadUrl: String!, $expectedPreviousDriveFileId: String, $expectNoExistingDriveFile: Boolean) {
  updateSimfileDriveFile(
    id: $id
    googleDriveFileId: $googleDriveFileId
    downloadUrl: $downloadUrl
    expectedPreviousDriveFileId: $expectedPreviousDriveFileId
    expectNoExistingDriveFile: $expectNoExistingDriveFile
  ) {
    id
    title
    userId
    googleDriveFileId
    downloadUrl
  }
}
"#;

const SIMFILE_CHARTS_QUERY: &str = r#"
query SimfileCharts($id: ID!) {
  simfile(id: $id) {
    dtxFiles {
      id
      label
      level
    }
  }
}
"#;

const UPLOAD_SCORES_MUTATION: &str = r#"
mutation UploadScores($input: UploadScoresInput!) {
  uploadScores(input: $input) {
    updatedCharts
    insertedScores
    skipped {
      chartId
      reason
    }
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

async fn access_token_from_auth_state<R: Runtime>(
    state: &AuthState,
    app: Option<&AppHandle<R>>,
) -> Result<String> {
    // Delegates to `ensure_valid_access_token`, which proactively refreshes
    // the session when the access token is near expiry so long-running
    // desktop sessions keep working past the Supabase token lifetime. The
    // `AppHandle` is forwarded so a successful refresh can emit
    // `session-refreshed` and the renderer persists the rotated tokens.
    crate::auth::ensure_valid_access_token(state, app).await
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
    mapped.insert(
        "google_drive_file_id".to_string(),
        simfile["googleDriveFileId"].clone(),
    );
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
                    // Pass through the real GraphQL `dtxFiles.id` (the D1
                    // dtx_files primary key, also the chart id used by
                    // `uploadScores`). Fall back to a positional id only when
                    // the field is absent — older cached records from before
                    // the fragment requested `id` may lack it, and the
                    // renderer's `normalizeSimfile` has its own `?? index + 1`
                    // fallback for the same reason. The positional fallback is
                    // display-only and must never flow into an upload payload.
                    let id = file
                        .get("id")
                        .filter(|v| !v.is_null())
                        .cloned()
                        .unwrap_or_else(|| json!(index + 1));
                    json!({
                        "id": id,
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
            "google_drive_file_id" | "googleDriveFileId" => continue,
            _ => key,
        };
        mapped.insert(mapped_key.to_string(), value.clone());
    }
    Value::Object(mapped)
}

fn owner_drive_simfile_from_graphql(
    simfile: &Value,
    expected_simfile_id: &str,
    authenticated_user_id: &str,
) -> std::result::Result<OwnerDriveSimfile, DriveMetadataError> {
    let id = simfile
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or(DriveMetadataError::InvalidResponse)?;
    let title = simfile
        .get("title")
        .and_then(Value::as_str)
        .ok_or(DriveMetadataError::InvalidResponse)?;
    let owner_id = simfile
        .get("userId")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or(DriveMetadataError::InvalidResponse)?;
    let google_drive_file_id = required_nullable_owner_string(simfile, "googleDriveFileId")?;
    let download_url = required_nullable_owner_string(simfile, "downloadUrl")?;

    if id != expected_simfile_id {
        return Err(DriveMetadataError::InvalidResponse);
    }
    if owner_id != authenticated_user_id {
        return Err(DriveMetadataError::DefinitiveUnavailable);
    }

    Ok(OwnerDriveSimfile {
        id: id.to_string(),
        title: title.to_string(),
        google_drive_file_id,
        download_url,
    })
}

fn required_nullable_owner_string(
    simfile: &Value,
    field: &str,
) -> std::result::Result<Option<String>, DriveMetadataError> {
    match simfile.get(field) {
        Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        Some(_) | None => Err(DriveMetadataError::InvalidResponse),
    }
}

pub(crate) async fn fetch_owner_drive_simfile_impl(
    base_url: &str,
    token: &str,
    simfile_id: &str,
    authenticated_user_id: &str,
) -> std::result::Result<OwnerDriveSimfile, DriveMetadataError> {
    let data = drive_metadata_graphql_data(
        base_url,
        token,
        OWNER_DRIVE_SIMFILE_QUERY,
        json!({ "id": simfile_id }),
    )
    .await?;
    let simfile = data
        .get("simfile")
        .ok_or(DriveMetadataError::InvalidResponse)?;
    if simfile.is_null() {
        return Err(DriveMetadataError::DefinitiveUnavailable);
    }
    owner_drive_simfile_from_graphql(simfile, simfile_id, authenticated_user_id)
}

pub(crate) async fn update_drive_file_impl(
    base_url: &str,
    token: &str,
    simfile_id: &str,
    drive_file_id: &str,
    download_url: &str,
    authenticated_user_id: &str,
    expected_previous: Option<&ExpectedPreviousDriveFile>,
) -> std::result::Result<OwnerDriveSimfile, DriveMetadataError> {
    let (expected_previous_drive_file_id, expect_no_existing_drive_file) = match expected_previous {
        Some(ExpectedPreviousDriveFile::None) => (None, Some(true)),
        Some(ExpectedPreviousDriveFile::DriveFile(id)) => (Some(id.as_str()), None),
        None => (None, None),
    };
    let data = drive_metadata_graphql_data(
        base_url,
        token,
        UPDATE_SIMFILE_DRIVE_FILE_MUTATION,
        json!({
            "id": simfile_id,
            "googleDriveFileId": drive_file_id,
            "downloadUrl": download_url,
            "expectedPreviousDriveFileId": expected_previous_drive_file_id,
            "expectNoExistingDriveFile": expect_no_existing_drive_file,
        }),
    )
    .await?;
    let value = data
        .get("updateSimfileDriveFile")
        .ok_or(DriveMetadataError::InvalidResponse)?;
    if value.is_null() {
        return Err(DriveMetadataError::DefinitiveUnavailable);
    }
    let simfile = owner_drive_simfile_from_graphql(value, simfile_id, authenticated_user_id)?;

    if simfile.id != simfile_id
        || simfile.google_drive_file_id.as_deref() != Some(drive_file_id)
        || simfile.download_url.as_deref() != Some(download_url)
    {
        return Err(DriveMetadataError::InvalidResponse);
    }

    Ok(simfile)
}

async fn authenticated_user_id(
    auth: &AuthState,
) -> std::result::Result<String, DriveMetadataError> {
    auth.current_session()
        .await
        .as_ref()
        .and_then(|session| session.pointer("/user/id"))
        .and_then(Value::as_str)
        .filter(|user_id| !user_id.is_empty())
        .map(str::to_string)
        .ok_or(DriveMetadataError::Authentication)
}

pub(crate) async fn fetch_owner_drive_simfile<R: Runtime>(
    auth: &AuthState,
    app: &AppHandle<R>,
    simfile_id: &str,
) -> std::result::Result<OwnerDriveSimfile, DriveMetadataError> {
    let base_url = api_base_url_from_env().map_err(|_| DriveMetadataError::LocalState)?;
    let token = access_token_from_auth_state(auth, Some(app))
        .await
        .map_err(classify_metadata_auth_error)?;
    let user_id = authenticated_user_id(auth).await?;
    fetch_owner_drive_simfile_impl(&base_url, &token, simfile_id, &user_id).await
}

pub(crate) async fn update_drive_file<R: Runtime>(
    auth: &AuthState,
    app: &AppHandle<R>,
    simfile_id: &str,
    drive_file_id: &str,
    download_url: &str,
    expected_previous: Option<&ExpectedPreviousDriveFile>,
) -> std::result::Result<OwnerDriveSimfile, DriveMetadataError> {
    let base_url = api_base_url_from_env().map_err(|_| DriveMetadataError::LocalState)?;
    let token = access_token_from_auth_state(auth, Some(app))
        .await
        .map_err(classify_metadata_auth_error)?;
    let user_id = authenticated_user_id(auth).await?;
    update_drive_file_impl(
        &base_url,
        &token,
        simfile_id,
        drive_file_id,
        download_url,
        &user_id,
        expected_previous,
    )
    .await
}

fn classify_metadata_auth_error(error: DesktopError) -> DriveMetadataError {
    let message = error.to_string().to_ascii_lowercase();
    if message.contains("network") || message.contains("timed out") || message.contains("timeout") {
        DriveMetadataError::Network
    } else {
        DriveMetadataError::Authentication
    }
}

async fn drive_metadata_graphql_data(
    base_url: &str,
    token: &str,
    query: &str,
    variables: Value,
) -> std::result::Result<Value, DriveMetadataError> {
    let client = reqwest_client().map_err(|_| DriveMetadataError::LocalState)?;
    let endpoint = format!("{}/graphql", base_url.trim_end_matches('/'));
    let response = client
        .post(endpoint)
        .bearer_auth(token)
        .header(reqwest::header::USER_AGENT, "DTXDesktopApp")
        .header("X-Requested-With", "DTXDesktopApp")
        .json(&json!({ "query": query, "variables": variables }))
        .send()
        .await
        .map_err(|_| DriveMetadataError::Network)?;
    let status = response.status();
    if matches!(status.as_u16(), 401 | 403) {
        return Err(DriveMetadataError::Authentication);
    }
    if status.is_server_error() {
        return Err(DriveMetadataError::ServiceUnavailable);
    }
    if matches!(status.as_u16(), 429 | 408) {
        return Err(DriveMetadataError::ServiceUnavailable);
    }
    if !status.is_success() {
        return Err(DriveMetadataError::InvalidResponse);
    }
    let body = response
        .json::<Value>()
        .await
        .map_err(|_| DriveMetadataError::InvalidResponse)?;
    if let Some(error) = body
        .get("errors")
        .and_then(Value::as_array)
        .and_then(|errors| errors.first())
    {
        let code = error
            .pointer("/extensions/code")
            .and_then(Value::as_str)
            .unwrap_or_default();
        return Err(match code {
            "NOT_FOUND" => DriveMetadataError::DefinitiveUnavailable,
            "FORBIDDEN" | "UNAUTHENTICATED" => DriveMetadataError::Authentication,
            "INTERNAL_SERVER_ERROR" | "SERVICE_UNAVAILABLE" => {
                DriveMetadataError::ServiceUnavailable
            }
            _ => DriveMetadataError::InvalidResponse,
        });
    }
    body.get("data")
        .cloned()
        .filter(Value::is_object)
        .ok_or(DriveMetadataError::InvalidResponse)
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
    upload_form_to_api_with_client(client, base_url, token, form).await
}

/// Injectable-client variant of `upload_form_to_api` — mirrors the
/// `run_graphql_value` / `run_graphql_value_with_client` split so timeout
/// tests can pass a short-timeout client instead of waiting the full
/// production `API_REQUEST_TIMEOUT_MS`.
async fn upload_form_to_api_with_client(
    client: reqwest::Client,
    base_url: &str,
    token: &str,
    form: Form,
) -> Value {
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
    workspace_root: &str,
    simfile_id: &str,
) -> Value {
    // Enforce song-folder-within-workspace before any file access, mirroring
    // read_preview_within_workspace. Without this, a compromised renderer could
    // pass song_folder_path=/etc and exfiltrate arbitrary readable files to the
    // Drumery API. Routes through the canonical containment primitive so the
    // symlink-safe invariant lives in one tested place.
    let canonical_song_folder = match crate::filesystem::canonicalize_within_workspace(
        song_folder_path,
        Some(workspace_root),
    )
    .await
    {
        Ok(path) => path,
        Err(error) => return api_failure(error.to_string()),
    };
    let file_path = canonical_song_folder.join(file_name);
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
    let token = access_token_from_auth_state(&app.state::<AuthState>(), Some(&app)).await?;
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
    let token = access_token_from_auth_state(&app.state::<AuthState>(), Some(&app)).await?;
    fetch_cloud_song_impl(&base_url, &token, cloud_song_id).await
}

pub(crate) async fn fetch_cloud_song_charts_impl(
    base_url: &str,
    token: &str,
    cloud_song_id: Value,
) -> Result<Value> {
    let result = graphql_result_with_url(
        base_url,
        token,
        SIMFILE_CHARTS_QUERY,
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

    let charts = simfile
        .get("dtxFiles")
        .and_then(Value::as_array)
        .map(|files| {
            files
                .iter()
                .map(|file| {
                    json!({
                        "id": file["id"],
                        "label": file["label"],
                        "level": file["level"],
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(api_success(Value::Array(charts)))
}

#[tauri::command]
pub async fn fetch_cloud_song_charts(app: AppHandle, cloud_song_id: Value) -> Result<Value> {
    let base_url = api_base_url_from_env()?;
    let token = access_token_from_auth_state(&app.state::<AuthState>(), Some(&app)).await?;
    fetch_cloud_song_charts_impl(&base_url, &token, cloud_song_id).await
}

/// Cheap defense-in-depth validation of the upload_scores payload at the IPC
/// boundary. The server (score.ts `validateChartScores`) is the real trust
/// boundary and does full validation; these checks just short-circuit obviously
/// malformed payloads before the network round-trip so a compromised renderer
/// can't send arbitrarily large or structurally broken data to the API.
///
/// Returns `Ok(api_failure(...))` (not `Err`) on validation failure so the
/// renderer sees the same `{ success: false, error }` envelope as a server-side
/// rejection — `handleUpload` already handles that shape.
fn validate_upload_payload(payload: &Value) -> Result<()> {
    let charts = payload
        .get("charts")
        .and_then(|c| c.as_array())
        .ok_or_else(|| {
            DesktopError::Message("upload payload missing 'charts' array".to_string())
        })?;

    // Sanity cap well above the server's MAX_UPLOAD_CHARTS (100). Catches a
    // runaway/compromised renderer without rejecting legitimate large imports.
    const IPC_MAX_CHARTS: usize = 1000;
    if charts.len() > IPC_MAX_CHARTS {
        return Err(DesktopError::Message(format!(
            "upload payload has too many charts ({} > {IPC_MAX_CHARTS})",
            charts.len()
        )));
    }

    // Sanity cap on per-chart score entries. The server enforces the real
    // MAX_SCORES_PER_CHART (10); this only catches a runaway/compromised
    // renderer before the network round-trip. Kept separate from
    // IPC_MAX_CHARTS so the two caps can evolve independently.
    const IPC_MAX_SCORES_PER_CHART: usize = 1000;

    for chart in charts {
        // chartId must be a string or number (the server parses it as a number).
        let chart_id = chart
            .get("chartId")
            .ok_or_else(|| DesktopError::Message("chart payload missing 'chartId'".to_string()))?;
        if chart_id.as_str().is_none() && chart_id.as_i64().is_none() && chart_id.as_u64().is_none()
        {
            return Err(DesktopError::Message(
                "chart 'chartId' must be a string or number".to_string(),
            ));
        }
        // playCount / clearCount must be non-negative integers.
        for field in &["playCount", "clearCount"] {
            let val = chart
                .get(*field)
                .ok_or_else(|| DesktopError::Message(format!("chart payload missing '{field}'")))?;
            let n = val.as_i64().ok_or_else(|| {
                DesktopError::Message(format!("chart '{field}' must be an integer"))
            })?;
            if n < 0 {
                return Err(DesktopError::Message(format!(
                    "chart '{field}' must be non-negative (got {n})"
                )));
            }
        }
        // scores must be an array (the server validates contents).
        let scores = chart
            .get("scores")
            .and_then(|s| s.as_array())
            .ok_or_else(|| {
                DesktopError::Message("chart payload missing 'scores' array".to_string())
            })?;
        // Sanity cap on per-chart score entries (IPC_MAX_SCORES_PER_CHART).
        // The server enforces the real MAX_SCORES_PER_CHART (10); this only
        // catches a runaway/compromised renderer.
        if scores.len() > IPC_MAX_SCORES_PER_CHART {
            return Err(DesktopError::Message(format!(
                "chart has too many scores ({} > {IPC_MAX_SCORES_PER_CHART})",
                scores.len()
            )));
        }
    }
    Ok(())
}

pub(crate) async fn upload_scores_impl(
    base_url: &str,
    token: &str,
    payload: Value,
) -> Result<Value> {
    // Defense-in-depth: validate the payload shape before the network
    // round-trip. The server is the real trust boundary, but cheap sanity
    // checks here catch obviously malformed data from a compromised renderer
    // without costing a round-trip.
    if let Err(error) = validate_upload_payload(&payload) {
        return Ok(api_failure(error.to_string()));
    }
    let result = graphql_result_with_url(
        base_url,
        token,
        UPLOAD_SCORES_MUTATION,
        json!({ "input": payload }),
    )
    .await?;
    let data = match result.success_data() {
        Ok(data) => data,
        Err((error, _)) => return Ok(api_failure(error)),
    };

    Ok(api_success(
        data.get("uploadScores").cloned().unwrap_or(Value::Null),
    ))
}

#[tauri::command]
pub async fn upload_scores(app: AppHandle, payload: Value) -> Result<Value> {
    let base_url = api_base_url_from_env()?;
    let token = access_token_from_auth_state(&app.state::<AuthState>(), Some(&app)).await?;
    upload_scores_impl(&base_url, &token, payload).await
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
    let token = access_token_from_auth_state(&app.state::<AuthState>(), Some(&app)).await?;
    update_simfile_record_impl(&base_url, &token, simfile_id, update_data).await
}

pub(crate) async fn create_simfile_record_impl(
    base_url: &str,
    token: &str,
    simfile_data: Value,
    workspace_root: &Path,
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

    let workspace_root = workspace_root.to_string_lossy();
    if let Some(song_path) = simfile_data.get("songPath").and_then(Value::as_str) {
        if !song_path.is_empty() {
            if let Some(error) = upload_preview_if_present(
                base_url,
                token,
                song_path,
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
                song_path,
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
pub async fn create_simfile_record(
    app: AppHandle,
    simfile_data: Value,
    state: State<'_, WorkspaceRootState>,
) -> Result<Value> {
    let workspace_root = state.current()?;
    let base_url = api_base_url_from_env()?;
    let token = access_token_from_auth_state(&app.state::<AuthState>(), Some(&app)).await?;
    create_simfile_record_impl(&base_url, &token, simfile_data, &workspace_root).await
}

#[cfg(test)]
pub(crate) async fn create_simfile_record_with_workspace_state(
    base_url: &str,
    token: &str,
    simfile_data: Value,
    state: &WorkspaceRootState,
) -> Result<Value> {
    let workspace_root = state.current()?;
    create_simfile_record_impl(base_url, token, simfile_data, &workspace_root).await
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
    let token = access_token_from_auth_state(&app.state::<AuthState>(), Some(&app)).await?;
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
    state: State<'_, WorkspaceRootState>,
) -> Result<Value> {
    let workspace_root = state.current()?;
    let base_url = api_base_url_from_env()?;
    let token = access_token_from_auth_state(&app.state::<AuthState>(), Some(&app)).await?;
    Ok(upload_file_to_api(
        &base_url,
        &token,
        &file_name,
        &song_folder_path,
        &workspace_root.to_string_lossy(),
        &simfile_id,
    )
    .await)
}

#[cfg(test)]
pub(crate) async fn upload_file_with_workspace_state(
    base_url: &str,
    token: &str,
    file_name: String,
    song_folder_path: String,
    simfile_id: String,
    state: &WorkspaceRootState,
) -> Result<Value> {
    let workspace_root = state.current()?;
    Ok(upload_file_to_api(
        base_url,
        token,
        &file_name,
        &song_folder_path,
        &workspace_root.to_string_lossy(),
        &simfile_id,
    )
    .await)
}

#[cfg(test)]
#[path = "tests/api_tests.rs"]
mod tests;
