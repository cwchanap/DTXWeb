use crate::error::{DesktopError, Result};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Mutex as AsyncMutex, Semaphore};
use url::Url;

const AUTH_REQUEST_TIMEOUT_MS: u64 = 30_000;
const LOCAL_AUTH_READ_TIMEOUT_MS: u64 = 10_000;
const LOCAL_AUTH_CALLBACK_PATH: &str = "/auth-callback";
/// Maximum number of concurrent local auth callback connections that will be
/// serviced at once. Bounds memory/thread usage if a local process opens many
/// loopback connections. Excess connections block on the semaphore until an
/// in-flight handler completes (each handler is bounded by
/// `LOCAL_AUTH_READ_TIMEOUT_MS` and `MAX_AUTH_REQUEST_BYTES`).
const LOCAL_AUTH_CALLBACK_MAX_CONCURRENT: usize = 32;
const LOCAL_AUTH_CALLBACK_SUCCESS_HTML: &str = r##"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Return to Drumery</title>
  <style>
    :root {
      color-scheme: dark;
      font-family:
        Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #101417;
      color: #f3f6f4;
    }

    * {
      box-sizing: border-box;
    }

    body {
      min-height: 100vh;
      margin: 0;
      background:
        linear-gradient(180deg, rgba(21, 25, 29, 0.95), rgba(13, 16, 18, 1)),
        #101417;
    }

    .app-shell {
      min-height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr;
    }

    header {
      display: flex;
      align-items: center;
      gap: 12px;
      height: 64px;
      padding: 0 28px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(16, 20, 23, 0.82);
      backdrop-filter: blur(12px);
    }

    .mark {
      display: grid;
      place-items: center;
      width: 34px;
      height: 34px;
      border-radius: 8px;
      background: #f4d35e;
      color: #101417;
      font-weight: 800;
    }

    .brand {
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0;
    }

    main {
      width: min(720px, calc(100vw - 48px));
      margin: 0 auto;
      padding: 92px 0;
    }

    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 32px;
      padding: 0 12px;
      border-radius: 999px;
      background: rgba(52, 211, 153, 0.12);
      color: #b7f7dc;
      font-size: 13px;
      font-weight: 650;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: #34d399;
    }

    h1 {
      margin: 22px 0 14px;
      font-size: clamp(34px, 6vw, 56px);
      line-height: 1.02;
      letter-spacing: 0;
    }

    p {
      max-width: 620px;
      margin: 0;
      color: #c9d2ce;
      font-size: 18px;
      line-height: 1.65;
    }
  </style>
</head>
<body>
  <div class="app-shell">
    <header>
      <div class="mark">D</div>
      <div class="brand">Drumery</div>
    </header>
    <main>
      <div class="status"><span class="dot"></span>Signed in</div>
      <h1>Return to Drumery</h1>
      <p>Your desktop session has been updated. You can close this browser tab and continue in the Drumery desktop app.</p>
    </main>
  </div>
</body>
</html>
"##;

#[derive(Debug, Clone, Default)]
pub struct AuthState {
    current_session: Arc<AsyncMutex<Option<serde_json::Value>>>,
    pending_urls: Arc<StdMutex<Vec<String>>>,
}

impl AuthState {
    pub async fn current_session(&self) -> Option<serde_json::Value> {
        self.current_session.lock().await.clone()
    }

    pub async fn set_current_session(&self, session: Option<serde_json::Value>) {
        *self.current_session.lock().await = session;
    }

    fn push_pending_url(&self, raw_url: String) {
        self.pending_urls
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push(raw_url);
    }

    fn drain_pending_urls(&self) -> Vec<String> {
        self.pending_urls
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .drain(..)
            .collect()
    }
}

#[derive(Debug, Deserialize)]
pub struct SessionData {
    #[serde(default, alias = "accessToken")]
    pub access_token: Option<String>,
    #[serde(default, alias = "refreshToken")]
    pub refresh_token: Option<String>,
    #[serde(default, alias = "userData")]
    pub user: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MagicLinkResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<serde_json::Value>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct AuthCallback {
    pub magic_link: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
enum AuthEvent {
    MagicLinkResult(MagicLinkResult),
}

impl AuthEvent {
    fn name(&self) -> &'static str {
        match self {
            AuthEvent::MagicLinkResult(_) => "magic-link-result",
        }
    }

    fn payload(&self) -> serde_json::Value {
        match self {
            AuthEvent::MagicLinkResult(result) => {
                serde_json::to_value(result).unwrap_or_else(|_| json!({ "success": false }))
            }
        }
    }
}

pub fn parse_auth_callback(raw_url: &str) -> Option<AuthCallback> {
    let url = Url::parse(raw_url).ok()?;
    if !is_auth_callback_url(&url) {
        return None;
    }

    let mut magic_link = None;

    for (key, value) in url.query_pairs() {
        if key == "magic_link" {
            magic_link = Some(value.into_owned());
        }
    }

    Some(AuthCallback { magic_link })
}

fn is_auth_callback_url(url: &Url) -> bool {
    if url.scheme() == "dtx" {
        return url.host_str() == Some("auth-callback");
    }

    if url.scheme() != "http" || url.path() != LOCAL_AUTH_CALLBACK_PATH {
        return false;
    }

    matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "::1"))
}

fn session_value_from_data(session_data: SessionData) -> Option<serde_json::Value> {
    let access_token = non_empty_token(session_data.access_token)?;
    let refresh_token = non_empty_token(session_data.refresh_token)?;

    let mut session = serde_json::json!({
        "access_token": access_token,
        "refresh_token": refresh_token,
    });

    if let Some(user) = session_data.user {
        session["user"] = user;
    }

    Some(session)
}

fn non_empty_token(token: Option<String>) -> Option<String> {
    token.and_then(|token| {
        let trimmed = token.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

/// Outcome of `validate_session`. Serialized to `"valid"`, `"invalid"`, or
/// `"not-configured"` for the renderer.
///
/// `NotConfigured` is distinct from `Invalid` so the renderer can tell a
/// misconfigured build (missing Supabase env) apart from a genuinely rejected
/// session. Without that distinction the renderer would wipe a potentially-good
/// stored session on every startup of a misconfigured build, then fail to log
/// back in — an inconsistent, confusing state (see `verify_magic_link`, which
/// surfaces the same condition as an explicit error).
#[derive(Debug, Serialize, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
pub enum SessionValidationStatus {
    Valid,
    Invalid,
    NotConfigured,
}

#[tauri::command]
pub async fn validate_session(
    app: AppHandle,
    session_data: SessionData,
) -> Result<SessionValidationStatus> {
    let supabase_url = match config_env!("PUBLIC_SUPABASE_URL") {
        Some(value) => value,
        None => return Ok(SessionValidationStatus::NotConfigured),
    };
    let anon_key = match config_env!("PUBLIC_SUPABASE_ANON_KEY") {
        Some(value) => value,
        None => return Ok(SessionValidationStatus::NotConfigured),
    };
    let client = match auth_client() {
        Ok(client) => client,
        // A client-construction failure is not a config problem; preserve the
        // historical "treat as invalid" behavior rather than masking it as
        // not-configured.
        Err(_) => return Ok(SessionValidationStatus::Invalid),
    };

    let is_valid = validate_session_with_client(
        client,
        &app.state::<AuthState>(),
        &supabase_url,
        &anon_key,
        session_data,
    )
    .await;

    Ok(if is_valid {
        SessionValidationStatus::Valid
    } else {
        SessionValidationStatus::Invalid
    })
}

#[tauri::command]
pub async fn get_current_session(app: AppHandle) -> Result<Option<serde_json::Value>> {
    Ok(app.state::<AuthState>().current_session().await)
}

#[tauri::command]
pub async fn logout_session(app: AppHandle) -> Result<bool> {
    app.state::<AuthState>().set_current_session(None).await;
    Ok(true)
}

#[tauri::command]
pub async fn open_external_url(app: AppHandle, url: String) -> Result<()> {
    ensure_allowed_external_url(&url)?;

    app.opener()
        .open_url(url, None::<String>)
        .map_err(|error| DesktopError::Message(error.to_string()))
}

pub async fn handle_deep_link(app: &AppHandle, raw_url: &str) -> Result<()> {
    if let Some(event) = auth_event_from_url_with_state(&app.state::<AuthState>(), raw_url).await {
        emit_auth_event(app, &event)?;
    }

    Ok(())
}

pub fn queue_deep_link(app: &AppHandle, raw_url: &str) -> Result<()> {
    if parse_auth_callback(raw_url).is_some() {
        app.state::<AuthState>()
            .push_pending_url(raw_url.to_string());
    }

    Ok(())
}

pub fn spawn_local_auth_callback_server(app: &AppHandle) {
    let Some(port) = local_auth_callback_port() else {
        return;
    };

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = run_local_auth_callback_server(handle, port).await {
            eprintln!("Local desktop auth callback server failed: {error}");
        }
    });
}

fn local_auth_callback_port() -> Option<u16> {
    std::env::var("DTX_DESKTOP_AUTH_CALLBACK_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port > 0)
}

fn local_auth_callback_success_html() -> &'static str {
    LOCAL_AUTH_CALLBACK_SUCCESS_HTML
}

async fn run_local_auth_callback_server(app: AppHandle, port: u16) -> Result<()> {
    let v4_listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, port))).await?;

    // Also bind IPv6 loopback so callbacks work when the OS resolves
    // "localhost" to ::1. Non-fatal if it fails (e.g. port conflict on
    // dual-stack systems).
    let v6_listener = match TcpListener::bind(SocketAddr::from((Ipv6Addr::LOCALHOST, port))).await {
        Ok(listener) => Some(listener),
        Err(error) => {
            eprintln!("IPv6 loopback auth callback server not started (non-fatal): {error}");
            None
        }
    };

    // Bound concurrent handler tasks so a local process opening many loopback
    // connections cannot exhaust the runtime. The permit is moved into each
    // spawned task and released when the handler returns.
    let concurrency = Arc::new(Semaphore::new(LOCAL_AUTH_CALLBACK_MAX_CONCURRENT));

    loop {
        let (stream, _) = match &v6_listener {
            Some(v6) => tokio::select! {
                result = v4_listener.accept() => result?,
                result = v6.accept() => result?,
            },
            None => v4_listener.accept().await?,
        };
        // Hold a permit for the lifetime of the spawned task. Acquiring before
        // spawning (rather than inside the task) bounds the queue of accepted
        // but not-yet-handled connections too.
        let permit = concurrency
            .clone()
            .acquire_owned()
            .await
            .map_err(|error| DesktopError::Message(error.to_string()))?;
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            let _permit = permit;
            let _ = handle_local_auth_callback_connection(handle, stream, port).await;
        });
    }
}

async fn handle_local_auth_callback_connection(
    app: AppHandle,
    mut stream: TcpStream,
    port: u16,
) -> Result<()> {
    let Some(request_line) = read_auth_request_line(&mut stream).await? else {
        write_local_auth_callback_text_response(&mut stream, 400, "Bad Request").await?;
        return Ok(());
    };

    let Some(target) = request_line.split_whitespace().nth(1) else {
        write_local_auth_callback_text_response(&mut stream, 400, "Bad Request").await?;
        return Ok(());
    };

    let raw_url = format!("http://127.0.0.1:{port}{target}");
    if parse_auth_callback(&raw_url).is_none() {
        write_local_auth_callback_text_response(&mut stream, 404, "Not Found").await?;
        return Ok(());
    }

    handle_deep_link(&app, &raw_url).await?;
    write_local_auth_callback_html_response(&mut stream, 200, local_auth_callback_success_html())
        .await?;
    Ok(())
}

/// Maximum number of bytes read from a single local auth callback request.
const MAX_AUTH_REQUEST_BYTES: usize = 64 * 1024;

/// Reads the HTTP request line from a local auth callback connection.
///
/// The callback's `magic_link` payload travels in the request-line query
/// string, which can exceed a single fixed-size read for long URLs, so we
/// accumulate until the end of the first line (or the peer closes) instead of
/// relying on one 4 KB read. The total is capped to guard against unbounded
/// reads from a misbehaving or malicious caller.
async fn read_auth_request_line(stream: &mut TcpStream) -> Result<Option<String>> {
    let mut buf: Vec<u8> = Vec::new();
    let outcome: std::result::Result<(), DesktopError> = tokio::time::timeout(
        Duration::from_millis(LOCAL_AUTH_READ_TIMEOUT_MS),
        async {
            loop {
                if buf.len() > MAX_AUTH_REQUEST_BYTES {
                    return Err(DesktopError::Message(
                        "Auth callback request exceeded maximum size".to_string(),
                    ));
                }
                let mut chunk = [0_u8; 1024];
                match stream.read(&mut chunk).await {
                    Ok(0) => return Ok(()),
                    Ok(n) => {
                        buf.extend_from_slice(&chunk[..n]);
                        if buf.contains(&b'\n') {
                            return Ok(());
                        }
                    }
                    Err(error) => return Err(DesktopError::Message(error.to_string())),
                }
            }
        },
    )
    .await
    .map_err(|_| DesktopError::Message("Auth callback connection read timed out".to_string()))?;

    outcome?;

    if buf.is_empty() {
        return Ok(None);
    }
    let request = String::from_utf8_lossy(&buf);
    Ok(request.lines().next().map(str::to_string))
}

async fn write_local_auth_callback_text_response(
    stream: &mut TcpStream,
    status: u16,
    body: &str,
) -> Result<()> {
    write_local_auth_callback_response(stream, status, "text/plain; charset=utf-8", body).await
}

async fn write_local_auth_callback_html_response(
    stream: &mut TcpStream,
    status: u16,
    body: &str,
) -> Result<()> {
    write_local_auth_callback_response(stream, status, "text/html; charset=utf-8", body).await
}

async fn write_local_auth_callback_response(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &str,
) -> Result<()> {
    let status_text = match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        _ => "Internal Server Error",
    };
    let response = format!(
        "HTTP/1.1 {status} {status_text}\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.as_bytes().len()
    );
    stream.write_all(response.as_bytes()).await?;
    stream.shutdown().await?;
    Ok(())
}

#[tauri::command]
pub async fn drain_pending_auth_events(app: AppHandle) -> Result<usize> {
    let urls = app.state::<AuthState>().drain_pending_urls();
    let mut count = 0;

    for raw_url in urls {
        if let Some(event) =
            auth_event_from_url_with_state(&app.state::<AuthState>(), &raw_url).await
        {
            emit_auth_event(&app, &event)?;
            count += 1;
        }
    }

    Ok(count)
}

async fn auth_event_from_url_with_state(state: &AuthState, raw_url: &str) -> Option<AuthEvent> {
    let callback = parse_auth_callback(raw_url)?;
    let magic_link = callback.magic_link?;
    Some(AuthEvent::MagicLinkResult(
        verify_magic_link(state, &magic_link).await,
    ))
}

fn emit_auth_event(app: &AppHandle, event: &AuthEvent) -> Result<()> {
    app.emit(event.name(), event.payload())?;
    Ok(())
}

fn ensure_allowed_external_url(raw_url: &str) -> Result<()> {
    let url = Url::parse(raw_url)?;

    if matches!(url.scheme(), "http" | "https") {
        return Ok(());
    }

    Err(DesktopError::Message(
        "Only http and https URLs can be opened externally".to_string(),
    ))
}

fn auth_client() -> std::result::Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .timeout(Duration::from_millis(AUTH_REQUEST_TIMEOUT_MS))
        .build()
}

fn supabase_auth_url(supabase_url: &str, path: &str) -> String {
    format!(
        "{}/auth/v1/{}",
        supabase_url.trim().trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

fn auth_error_from_response_body(body: &serde_json::Value, fallback: &str) -> String {
    body.get("error_description")
        .and_then(serde_json::Value::as_str)
        .or_else(|| body.get("message").and_then(serde_json::Value::as_str))
        .or_else(|| body.get("msg").and_then(serde_json::Value::as_str))
        .or_else(|| body.get("error").and_then(serde_json::Value::as_str))
        .unwrap_or(fallback)
        .to_string()
}

fn magic_link_result_from_verify_response(response: serde_json::Value) -> Result<MagicLinkResult> {
    let mut session = response
        .get("session")
        .filter(|value| value.is_object())
        .cloned()
        .unwrap_or_else(|| {
            json!({
                "access_token": response.get("access_token").cloned().unwrap_or(serde_json::Value::Null),
                "refresh_token": response.get("refresh_token").cloned().unwrap_or(serde_json::Value::Null),
            })
        });

    let access_token = non_empty_token(
        session
            .get("access_token")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
    );
    let refresh_token = non_empty_token(
        session
            .get("refresh_token")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
    );

    let (Some(access_token), Some(refresh_token)) = (access_token, refresh_token) else {
        return Ok(MagicLinkResult {
            success: false,
            error: Some("No session created from magic link".to_string()),
            session: None,
            user: response.get("user").cloned(),
        });
    };

    session["access_token"] = json!(access_token);
    session["refresh_token"] = json!(refresh_token);

    let user = response
        .get("user")
        .cloned()
        .or_else(|| session.get("user").cloned());
    if let Some(user) = &user {
        if session.get("user").is_none() {
            session["user"] = user.clone();
        }
    }

    Ok(MagicLinkResult {
        success: true,
        error: None,
        session: Some(session),
        user,
    })
}

async fn verify_magic_link_with_client(
    client: reqwest::Client,
    state: &AuthState,
    supabase_url: &str,
    anon_key: &str,
    magic_link: &str,
) -> MagicLinkResult {
    let parsed = match Url::parse(magic_link) {
        Ok(parsed) => parsed,
        Err(_) => {
            return MagicLinkResult {
                success: false,
                error: Some("Invalid magic link".to_string()),
                session: None,
                user: None,
            };
        }
    };
    let token_hash = parsed
        .query_pairs()
        .find(|(key, _)| key == "token_hash")
        .or_else(|| parsed.query_pairs().find(|(key, _)| key == "token"))
        .map(|(_, value)| value.into_owned());
    let Some(token_hash) = non_empty_token(token_hash) else {
        return MagicLinkResult {
            success: false,
            error: Some("No token found in magic link".to_string()),
            session: None,
            user: None,
        };
    };

    let response = client
        .post(supabase_auth_url(supabase_url, "verify"))
        .header("apikey", anon_key)
        .bearer_auth(anon_key)
        .json(&json!({
            "token_hash": token_hash,
            "type": "magiclink",
        }))
        .send()
        .await;

    let response = match response {
        Ok(response) => response,
        Err(_) => {
            return MagicLinkResult {
                success: false,
                error: Some("Failed to verify magic link".to_string()),
                session: None,
                user: None,
            };
        }
    };

    let status = response.status();
    let body = match response.json::<serde_json::Value>().await {
        Ok(body) => body,
        Err(_) => {
            return MagicLinkResult {
                success: false,
                error: Some("Failed to verify magic link".to_string()),
                session: None,
                user: None,
            };
        }
    };

    if !status.is_success() {
        return MagicLinkResult {
            success: false,
            error: Some(auth_error_from_response_body(
                &body,
                "Failed to verify magic link",
            )),
            session: None,
            user: body.get("user").cloned(),
        };
    }

    let result = match magic_link_result_from_verify_response(body) {
        Ok(result) => result,
        Err(error) => {
            return MagicLinkResult {
                success: false,
                error: Some(error.to_string()),
                session: None,
                user: None,
            };
        }
    };

    if result.success {
        state.set_current_session(result.session.clone()).await;
    }

    result
}

async fn validate_session_with_client(
    client: reqwest::Client,
    state: &AuthState,
    supabase_url: &str,
    anon_key: &str,
    session_data: SessionData,
) -> bool {
    let Some(mut session) = session_value_from_data(session_data) else {
        state.set_current_session(None).await;
        return false;
    };
    let Some(access_token) = session
        .get("access_token")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
    else {
        state.set_current_session(None).await;
        return false;
    };
    let refresh_token = session
        .get("refresh_token")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);

    let response = client
        .get(supabase_auth_url(supabase_url, "user"))
        .header("apikey", anon_key)
        .bearer_auth(access_token)
        .send()
        .await;

    let response = match response {
        Ok(response) => response,
        Err(_) => {
            state.set_current_session(None).await;
            return false;
        }
    };

    if !response.status().is_success() {
        return refresh_session_with_client(&client, state, supabase_url, anon_key, refresh_token)
            .await;
    }

    let user = match response.json::<serde_json::Value>().await {
        Ok(user) if user.get("id").and_then(serde_json::Value::as_str).is_some() => user,
        _ => {
            state.set_current_session(None).await;
            return false;
        }
    };

    session["user"] = user;
    state.set_current_session(Some(session)).await;
    true
}

async fn refresh_session_with_client(
    client: &reqwest::Client,
    state: &AuthState,
    supabase_url: &str,
    anon_key: &str,
    refresh_token: Option<String>,
) -> bool {
    let Some(refresh_token) = non_empty_token(refresh_token) else {
        state.set_current_session(None).await;
        return false;
    };

    let response = client
        .post(format!(
            "{}?grant_type=refresh_token",
            supabase_auth_url(supabase_url, "token")
        ))
        .header("apikey", anon_key)
        .bearer_auth(anon_key)
        .json(&json!({ "refresh_token": refresh_token }))
        .send()
        .await;

    let response = match response {
        Ok(response) => response,
        Err(_) => {
            state.set_current_session(None).await;
            return false;
        }
    };

    if !response.status().is_success() {
        state.set_current_session(None).await;
        return false;
    }

    let body = match response.json::<serde_json::Value>().await {
        Ok(body) => body,
        Err(_) => {
            state.set_current_session(None).await;
            return false;
        }
    };

    let result = match magic_link_result_from_verify_response(body) {
        Ok(result) if result.success => result,
        _ => {
            state.set_current_session(None).await;
            return false;
        }
    };

    state.set_current_session(result.session).await;
    true
}

async fn verify_magic_link(state: &AuthState, magic_link: &str) -> MagicLinkResult {
    let supabase_url = match config_env!("PUBLIC_SUPABASE_URL") {
        Some(value) => value,
        None => {
            return MagicLinkResult {
                success: false,
                error: Some("Magic link verification is not configured".to_string()),
                session: None,
                user: None,
            };
        }
    };
    let anon_key = match config_env!("PUBLIC_SUPABASE_ANON_KEY") {
        Some(value) => value,
        None => {
            return MagicLinkResult {
                success: false,
                error: Some("Magic link verification is not configured".to_string()),
                session: None,
                user: None,
            };
        }
    };
    let client = match auth_client() {
        Ok(client) => client,
        Err(_) => {
            return MagicLinkResult {
                success: false,
                error: Some("Failed to verify magic link".to_string()),
                session: None,
                user: None,
            };
        }
    };

    verify_magic_link_with_client(client, state, &supabase_url, &anon_key, magic_link).await
}

#[cfg(test)]
#[path = "tests/auth_tests.rs"]
mod tests;
