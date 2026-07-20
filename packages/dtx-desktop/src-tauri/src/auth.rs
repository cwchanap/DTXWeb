use crate::error::{DesktopError, Result};
use base64::engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD};
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Mutex as AsyncMutex, Semaphore};
use url::Url;

const AUTH_REQUEST_TIMEOUT_MS: u64 = 30_000;
/// Refresh the access token proactively when it expires within this many
/// seconds. Supabase access tokens default to a 1-hour lifetime; refreshing
/// just ahead of expiry keeps long-running desktop sessions working without
/// waiting for an authenticated API call to fail with an expired-JWT error.
const TOKEN_REFRESH_SKEW_SECS: i64 = 60;
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
    /// Single-flights proactive token refreshes. Held across the
    /// read-refresh-write in `ensure_valid_access_token_with_config` so that
    /// concurrent authenticated commands serialize onto ONE refresh: without
    /// this, two commands that both see a near-expiry token would each replay
    /// the same (rotated) refresh token, and Supabase would either reject the
    /// second call or, with reuse-detection enabled, revoke the whole token
    /// family — silently forcing a full re-login.
    refresh_lock: Arc<AsyncMutex<()>>,
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
    /// Emitted whenever a token refresh rotates the session (proactive
    /// near-expiry refresh during a long-running session, or the startup
    /// validation refresh). The payload is the new Supabase session value so
    /// the renderer can persist the rotated `access_token`/`refresh_token` to
    /// localStorage — without this, the renderer keeps the now-revoked refresh
    /// token and the next launch logs the user out.
    SessionRefreshed(serde_json::Value),
}

impl AuthEvent {
    fn name(&self) -> &'static str {
        match self {
            AuthEvent::MagicLinkResult(_) => "magic-link-result",
            AuthEvent::SessionRefreshed(_) => "session-refreshed",
        }
    }

    fn payload(&self) -> serde_json::Value {
        match self {
            AuthEvent::MagicLinkResult(result) => {
                serde_json::to_value(result).unwrap_or_else(|_| json!({ "success": false }))
            }
            AuthEvent::SessionRefreshed(session) => session.clone(),
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
    // The production `dtx://` scheme is always accepted. The dev `dtx-dev://`
    // scheme is accepted only in debug builds — the dev build registers
    // `dtx-dev` in tauri.dev.conf.json so deep links route to the dev app
    // instead of an installed production copy, and a release build must never
    // honor it.
    if url.scheme() == "dtx" || (cfg!(debug_assertions) && url.scheme() == "dtx-dev") {
        return url.host_str() == Some("auth-callback");
    }

    if url.scheme() != "http" || url.path() != LOCAL_AUTH_CALLBACK_PATH {
        return false;
    }

    if !matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "::1")) {
        return false;
    }

    // The port must match the configured callback port. Without this check,
    // a redirect to any loopback port would be accepted. The callback server
    // only binds to `local_auth_callback_port()`, so a different port means
    // no server is listening there (or a different process is).
    match local_auth_callback_port() {
        Some(expected) => url.port() == Some(expected),
        None => false,
    }
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

/// Non-empty, trimmed access token borrowed from a stored Supabase session
/// value. Collapses the `session.get("access_token")...` boilerplate that was
/// hand-rolled at every read site so token extraction lives in one place.
fn session_access_token(session: &serde_json::Value) -> Option<&str> {
    session
        .get("access_token")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

/// Non-empty refresh token (owned) from a stored Supabase session value.
fn session_refresh_token(session: &serde_json::Value) -> Option<String> {
    non_empty_token(
        session
            .get("refresh_token")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
    )
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
    let Some((supabase_url, anon_key)) = resolve_auth_config() else {
        return Ok(SessionValidationStatus::NotConfigured);
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
        Some(&app),
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
    let state = app.state::<AuthState>();
    // Best-effort server-side revocation: if we have config + a working HTTP
    // client, POST to Supabase's /logout endpoint to invalidate the refresh
    // token before clearing local state. If config/client is unavailable we
    // fall through to clearing local state only (mirrors the renderer's
    // fallback behavior of always logging the user out locally).
    if let Some((supabase_url, anon_key)) = resolve_auth_config() {
        if let Ok(client) = auth_client() {
            revoke_session_with_client(client, &state, &supabase_url, &anon_key).await;
            return Ok(true);
        }
    }
    state.set_current_session(None).await;
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

    // Track each listener independently so a transient accept() error on one
    // (EMFILE, ECONNABORTED) drops only that listener instead of aborting the
    // whole callback server for the app lifetime. The loop continues serving
    // the survivor; when both are gone the server returns an error.
    let mut v4 = Some(v4_listener);
    let mut v6 = v6_listener;

    loop {
        let stream = match accept_from_listeners(&mut v4, &mut v6).await {
            Ok(Some(stream)) => stream,
            // A listener failed accept and was dropped — try the survivor.
            Ok(None) => continue,
            // Both listeners are gone; the callback server can no longer run.
            Err(error) => return Err(error),
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

/// One attempt to accept a connection from whichever listeners remain.
/// On a transient accept error (EMFILE, ECONNABORTED, etc.) in the
/// dual-listener case the failing listener is dropped (set to `None`) and
/// `Ok(None)` is returned so the caller loops and tries the survivor — a
/// transient error no longer permanently breaks deep-link sign-in. When
/// only one listener remains, a transient error is retried in-place with
/// exponential backoff (capped) so the sole survivor is NOT dropped and
/// the callback server keeps serving; only an unrecoverable error retires
/// it. Returns `Err` only when both listeners have been dropped, meaning
/// the callback server can no longer accept any connection.
async fn accept_from_listeners(
    v4: &mut Option<TcpListener>,
    v6: &mut Option<TcpListener>,
) -> Result<Option<TcpStream>> {
    // Match on is_some() (immutable borrows) rather than as_mut() so the
    // single-listener arms can pass the &mut Option<TcpListener> into
    // accept_from_sole_listener without conflicting with a scrutinee borrow.
    match (v4.is_some(), v6.is_some()) {
        (true, true) => {
            // Both present — safe to unwrap after the is_some() checks, and
            // we hold unique &mut access to each slot (no concurrent mutation).
            let v4l = v4.as_mut().expect("v4 present");
            let v6l = v6.as_mut().expect("v6 present");
            tokio::select! {
                result = v4l.accept() => match result {
                    Ok((stream, _)) => Ok(Some(stream)),
                    Err(error) => {
                        eprintln!(
                            "IPv4 auth callback accept failed, dropping listener: {error}"
                        );
                        *v4 = None;
                        Ok(None)
                    }
                },
                result = v6l.accept() => match result {
                    Ok((stream, _)) => Ok(Some(stream)),
                    Err(error) => {
                        eprintln!(
                            "IPv6 auth callback accept failed, dropping listener: {error}"
                        );
                        *v6 = None;
                        Ok(None)
                    }
                },
            }
        }
        (true, false) => accept_from_sole_listener(v4, "IPv4").await,
        (false, true) => accept_from_sole_listener(v6, "IPv6").await,
        (false, false) => Err(DesktopError::Message(
            "both auth callback listeners failed".to_string(),
        )),
    }
}

/// Initial backoff for a transient accept() error on the sole remaining
/// listener. Doubles on each consecutive transient failure up to
/// `ACCEPT_RETRY_MAX_BACKOFF_MS`.
const ACCEPT_RETRY_INITIAL_BACKOFF_MS: u64 = 50;
const ACCEPT_RETRY_MAX_BACKOFF_MS: u64 = 1_000;

/// Classify an accept() error as unrecoverable (retire the listener) vs
/// transient (keep the listener alive and retry with backoff). A working
/// TcpListener almost never returns unrecoverable errors; the ones we
/// treat as fatal indicate the socket/permission state is fundamentally
/// broken (e.g. the fd was closed, the address is no longer available, or
/// the operation is unsupported). Everything else — EMFILE, ENFILE,
/// ENOMEM, ECONNABORTED, ETIMEDOUT, EINTR — is transient and should not
/// permanently break deep-link sign-in on the sole remaining listener.
fn is_unrecoverable_accept_error(error: &std::io::Error) -> bool {
    use std::io::ErrorKind;
    matches!(
        error.kind(),
        ErrorKind::NotFound
            | ErrorKind::InvalidInput
            | ErrorKind::Unsupported
            | ErrorKind::AddrNotAvailable
            | ErrorKind::PermissionDenied
    )
}

/// Drive the sole remaining listener: retry transient accept() failures
/// in-place with exponential backoff so a temporary resource exhaustion
/// (EMFILE, etc.) doesn't kill the callback server for the app lifetime.
/// Only an unrecoverable error retires the listener (sets `*listener_slot`
/// to `None` and returns `Ok(None)`); a successful accept returns the
/// stream. The inner `&mut TcpListener` is re-acquired from the slot each
/// iteration so the borrow is not held across the accept() await, allowing
/// `*listener_slot = None` on the unrecoverable path.
async fn accept_from_sole_listener(
    listener_slot: &mut Option<TcpListener>,
    label: &str,
) -> Result<Option<TcpStream>> {
    let mut backoff_ms = ACCEPT_RETRY_INITIAL_BACKOFF_MS;
    loop {
        let listener = match listener_slot.as_mut() {
            Some(l) => l,
            None => return Ok(None),
        };
        match listener.accept().await {
            Ok((stream, _)) => return Ok(Some(stream)),
            Err(error) if is_unrecoverable_accept_error(&error) => {
                eprintln!(
                    "{label} auth callback accept failed (unrecoverable), dropping listener: {error}"
                );
                *listener_slot = None;
                return Ok(None);
            }
            Err(error) => {
                eprintln!(
                    "{label} auth callback accept failed (transient), retrying in {backoff_ms}ms: {error}"
                );
                tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
                backoff_ms = (backoff_ms.saturating_mul(2)).min(ACCEPT_RETRY_MAX_BACKOFF_MS);
            }
        }
    }
}

/// Routing decision for an inbound local auth callback request, extracted so
/// the request-line classification can be unit-tested without a TcpStream or
/// AppHandle.
#[derive(Debug)]
enum CallbackRoute {
    /// Request line targeted `/auth-callback` and should be dispatched.
    Valid(String),
    /// Request line was missing or malformed.
    BadRequest,
    /// Request line did not target the auth-callback path.
    NotFound,
}

fn route_callback_request(request_line: Option<&str>, port: u16) -> CallbackRoute {
    let Some(request_line) = request_line else {
        return CallbackRoute::BadRequest;
    };
    let Some(target) = request_line.split_whitespace().nth(1) else {
        return CallbackRoute::BadRequest;
    };

    let raw_url = format!("http://127.0.0.1:{port}{target}");
    if parse_auth_callback(&raw_url).is_none() {
        return CallbackRoute::NotFound;
    }

    CallbackRoute::Valid(raw_url)
}

async fn handle_local_auth_callback_connection(
    app: AppHandle,
    mut stream: TcpStream,
    port: u16,
) -> Result<()> {
    let request_line = read_auth_request_line(&mut stream).await?;
    match route_callback_request(request_line.as_deref(), port) {
        CallbackRoute::Valid(raw_url) => {
            handle_deep_link(&app, &raw_url).await?;
            write_local_auth_callback_html_response(
                &mut stream,
                200,
                LOCAL_AUTH_CALLBACK_SUCCESS_HTML,
            )
            .await?;
        }
        CallbackRoute::BadRequest => {
            write_local_auth_callback_text_response(&mut stream, 400, "Bad Request").await?;
        }
        CallbackRoute::NotFound => {
            write_local_auth_callback_text_response(&mut stream, 404, "Not Found").await?;
        }
    }
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
    let outcome: std::result::Result<(), DesktopError> =
        tokio::time::timeout(Duration::from_millis(LOCAL_AUTH_READ_TIMEOUT_MS), async {
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
        })
        .await
        .map_err(|_| {
            DesktopError::Message("Auth callback connection read timed out".to_string())
        })?;

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

fn local_auth_callback_status_text(status: u16) -> &'static str {
    match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        _ => "Internal Server Error",
    }
}

fn format_local_auth_callback_response(status: u16, content_type: &str, body: &str) -> String {
    let status_text = local_auth_callback_status_text(status);
    format!(
        "HTTP/1.1 {status} {status_text}\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len()
    )
}

async fn write_local_auth_callback_response(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &str,
) -> Result<()> {
    stream
        .write_all(format_local_auth_callback_response(status, content_type, body).as_bytes())
        .await?;
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

/// Resolves the Supabase URL and anon key from build-time/runtime env. Returns
/// None when either value is missing or blank, which the callers translate
/// into a `NotConfigured` status (validate_session) or a sanitized "not
/// configured" error (verify_magic_link). Extracted so the env-resolution
/// branching is unit-testable independent of the Tauri command wrappers.
fn resolve_auth_config() -> Option<(String, String)> {
    let supabase_url = config_env!("PUBLIC_SUPABASE_URL")?;
    let anon_key = config_env!("PUBLIC_SUPABASE_ANON_KEY")?;
    Some((supabase_url, anon_key))
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
    app: Option<&AppHandle>,
) -> bool {
    let Some(mut session) = session_value_from_data(session_data) else {
        state.set_current_session(None).await;
        return false;
    };
    let Some(access_token) = session_access_token(&session).map(str::to_string) else {
        state.set_current_session(None).await;
        return false;
    };
    let refresh_token = session_refresh_token(&session);

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
        return refresh_session_with_client(
            &client,
            state,
            supabase_url,
            anon_key,
            refresh_token,
            app,
        )
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
    app: Option<&AppHandle>,
) -> bool {
    let Some(refresh_token) = non_empty_token(refresh_token) else {
        state.set_current_session(None).await;
        return false;
    };

    match perform_refresh(client, supabase_url, anon_key, &refresh_token).await {
        Some(session) => {
            state.set_current_session(Some(session.clone())).await;
            if let Some(app) = app {
                // Persist the rotated tokens in the renderer so the next launch
                // uses the fresh refresh token instead of the now-revoked one.
                let _ = emit_auth_event(app, &AuthEvent::SessionRefreshed(session));
            }
            true
        }
        None => {
            // Startup validation treats any refresh failure as "log the user
            // out": a rejected refresh token means the session is no longer
            // recoverable and we must not leave stale credentials around.
            state.set_current_session(None).await;
            false
        }
    }
}

/// Pure HTTP refresh: POSTs the refresh token to Supabase's token endpoint and
/// returns the new session value on success, or `None` on any failure. Does
/// NOT touch `AuthState`, so callers decide whether to clear state on failure
/// (startup validation clears; the proactive path used during long sessions
/// leaves the previous session intact so a transient network blip doesn't log
/// the user out while their token is still valid).
async fn perform_refresh(
    client: &reqwest::Client,
    supabase_url: &str,
    anon_key: &str,
    refresh_token: &str,
) -> Option<serde_json::Value> {
    let response = client
        .post(format!(
            "{}?grant_type=refresh_token",
            supabase_auth_url(supabase_url, "token")
        ))
        .header("apikey", anon_key)
        .bearer_auth(anon_key)
        .json(&json!({ "refresh_token": refresh_token }))
        .send()
        .await
        .ok()?;

    if !response.status().is_success() {
        return None;
    }

    let body = response.json::<serde_json::Value>().await.ok()?;
    let result = magic_link_result_from_verify_response(body).ok()?;
    if result.success {
        result.session
    } else {
        None
    }
}

/// Best-effort proactive refresh used by `ensure_valid_access_token`. Calls
/// Supabase's token endpoint with the resolved config and, on success, stores
/// the new session and emits `session-refreshed` so the renderer persists the
/// rotated tokens. On any failure it leaves the existing session untouched
/// (unlike the startup path) so the caller can still try the possibly-still-
/// valid token and surface a clear server-side error. `config` is threaded in
/// (rather than re-resolved) so the decision path is unit-testable without
/// mutating process-global env. `app` is `Option` so unit tests can exercise
/// the refresh logic without a real `AppHandle` (pass `None` to skip emission);
/// production callers pass `Some(&app)`.
async fn try_refresh_session(
    state: &AuthState,
    config: Option<(String, String)>,
    client: &reqwest::Client,
    app: Option<&AppHandle>,
) {
    let Some((supabase_url, anon_key)) = config else {
        return;
    };
    let Some(refresh_token) = state
        .current_session()
        .await
        .as_ref()
        .and_then(session_refresh_token)
    else {
        return;
    };
    if let Some(new_session) =
        perform_refresh(client, &supabase_url, &anon_key, &refresh_token).await
    {
        state.set_current_session(Some(new_session.clone())).await;
        if let Some(app) = app {
            // Best-effort: a failure to emit must not break the API call that
            // triggered the refresh — the in-memory session is already updated,
            // so the worst case is the renderer persists stale tokens this once
            // and rotates them on the next refresh.
            let _ = emit_auth_event(app, &AuthEvent::SessionRefreshed(new_session));
        }
    }
}

/// Decodes the `exp` (expiry, seconds since epoch) claim from a JWT payload
/// without verifying the signature. Returns `None` for malformed tokens or
/// tokens without an `exp` claim. Signature verification is intentionally
/// skipped: this is only used to decide whether to refresh proactively, and
/// the API still validates the token server-side on every request.
fn jwt_exp_seconds(token: &str) -> Option<i64> {
    let payload_b64 = token.split('.').nth(1)?;
    // JWT payloads are base64url; tolerate both padded and unpadded encodings.
    let decoded = URL_SAFE_NO_PAD
        .decode(payload_b64)
        .or_else(|_| URL_SAFE.decode(payload_b64))
        .ok()?;
    let value: serde_json::Value = serde_json::from_slice(&decoded).ok()?;
    value.get("exp").and_then(serde_json::Value::as_i64)
}

fn unix_now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

/// Returns an access token that is not within `TOKEN_REFRESH_SKEW_SECS` of
/// expiry, refreshing the session proactively when the current token is about
/// to expire. Used by every authenticated API/upload command so long-running
/// desktop sessions keep working past the Supabase access-token lifetime
/// (default 1 hour) instead of failing with expired-JWT errors until restart.
///
/// If the user has no session at all this returns an error. If a refresh is
/// attempted but fails (network blip, revoked refresh token), the previous
/// token is returned so the API call proceeds and surfaces a clear server-side
/// error rather than masking the real cause as "not authenticated".
pub async fn ensure_valid_access_token(
    state: &AuthState,
    app: Option<&AppHandle>,
) -> Result<String> {
    ensure_valid_access_token_with_config(state, resolve_auth_config(), app).await
}

/// Config-injected core of `ensure_valid_access_token`. Tests pass an explicit
/// `(supabase_url, anon_key)` so the refresh path can be exercised against a
/// mock server without mutating process-global env (which would race with
/// other config-dependent tests). `config = None` mirrors the "auth not
/// configured" case: refresh is skipped and the existing token is returned.
/// `app = None` skips the `session-refreshed` emission (unit tests pass `None`
/// since no `AppHandle` is available); production callers pass `Some(&app)`.
async fn ensure_valid_access_token_with_config(
    state: &AuthState,
    config: Option<(String, String)>,
    app: Option<&AppHandle>,
) -> Result<String> {
    let session = state
        .current_session()
        .await
        .ok_or_else(|| DesktopError::Message("User not authenticated".to_string()))?;
    let access_token = session_access_token(&session)
        .ok_or_else(|| DesktopError::Message("User not authenticated".to_string()))?
        .to_string();

    let needs_refresh = match jwt_exp_seconds(&access_token) {
        Some(exp) => exp - unix_now_secs() <= TOKEN_REFRESH_SKEW_SECS,
        // No parseable exp: can't tell, let the server validate it.
        None => false,
    };

    if needs_refresh && config.is_some() {
        // Only build a client when we might actually use it.
        if let Ok(client) = auth_client() {
            // Single-flight the refresh (mirrors supabase-js): hold
            // `refresh_lock` across the read-refresh-write so concurrent
            // callers serialize onto one refresh instead of each replaying
            // the rotated refresh token. After acquiring the lock, re-check
            // staleness — the previous holder may have just refreshed, in
            // which case this caller must NOT POST again.
            let _refresh_guard = state.refresh_lock.lock().await;
            let still_stale = state
                .current_session()
                .await
                .as_ref()
                .and_then(session_access_token)
                .map(|token| {
                    jwt_exp_seconds(token)
                        .map_or(true, |exp| exp - unix_now_secs() <= TOKEN_REFRESH_SKEW_SECS)
                })
                .unwrap_or(true);
            if still_stale {
                try_refresh_session(state, config, &client, app).await;
            }
        }
        // Re-read in case refresh replaced the session with a fresh token.
        if let Some(new_token) = state
            .current_session()
            .await
            .as_ref()
            .and_then(|session| session_access_token(session).map(str::to_string))
        {
            return Ok(new_token);
        }
    }

    Ok(access_token)
}

/// Best-effort server-side session revocation. POSTs to Supabase's
/// `/auth/v1/logout` endpoint with the current access token to invalidate the
/// refresh token, then clears the in-memory session regardless of whether the
/// network call succeeded. Local state is always cleared so the user appears
/// logged out even if the server is unreachable (mirrors the renderer's
/// fallback behavior in `authService.logout`). The revocation HTTP status is
/// logged so a failed server-side logout is observable rather than silently
/// reported as success — local logout still succeeds either way.
async fn revoke_session_with_client(
    client: reqwest::Client,
    state: &AuthState,
    supabase_url: &str,
    anon_key: &str,
) {
    let session = state.current_session().await;
    if let Some(access_token) = session.as_ref().and_then(|s| session_access_token(s)) {
        // Best-effort: the outcome doesn't change whether we clear local
        // state below, but we surface it so a rejected/unreachable revocation
        // is observable instead of indistinguishable from success.
        match client
            .post(supabase_auth_url(supabase_url, "logout"))
            .header("apikey", anon_key)
            .bearer_auth(access_token)
            .send()
            .await
        {
            Ok(response) if !response.status().is_success() => {
                eprintln!(
                    "[auth] logout revocation rejected by server: HTTP {}",
                    response.status()
                );
            }
            Ok(_) => {}
            Err(error) => {
                eprintln!("[auth] logout revocation request failed: {error}");
            }
        }
    }
    state.set_current_session(None).await;
}

async fn verify_magic_link(state: &AuthState, magic_link: &str) -> MagicLinkResult {
    let Some((supabase_url, anon_key)) = resolve_auth_config() else {
        return MagicLinkResult {
            success: false,
            error: Some("Magic link verification is not configured".to_string()),
            session: None,
            user: None,
        };
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
