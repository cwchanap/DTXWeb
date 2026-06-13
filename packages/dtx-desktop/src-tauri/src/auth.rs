use crate::error::{DesktopError, Result};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::Mutex;
use url::Url;

#[derive(Debug, Clone, Default)]
pub struct AuthState {
    current_session: Arc<Mutex<Option<serde_json::Value>>>,
    pending_events: Arc<Mutex<Vec<AuthEvent>>>,
}

impl AuthState {
    pub async fn current_session(&self) -> Option<serde_json::Value> {
        self.current_session.lock().await.clone()
    }

    async fn set_current_session(&self, session: Option<serde_json::Value>) {
        *self.current_session.lock().await = session;
    }

    async fn push_pending_event(&self, event: AuthEvent) {
        self.pending_events.lock().await.push(event);
    }

    async fn drain_pending_events(&self) -> Vec<AuthEvent> {
        self.pending_events.lock().await.drain(..).collect()
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
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthCallbackTokens {
    access_token: String,
    refresh_token: String,
}

#[derive(Debug, Clone, PartialEq)]
enum AuthEvent {
    MagicLinkResult(MagicLinkResult),
    AuthCallback(AuthCallbackTokens),
}

impl AuthEvent {
    fn name(&self) -> &'static str {
        match self {
            AuthEvent::MagicLinkResult(_) => "magic-link-result",
            AuthEvent::AuthCallback(_) => "auth-callback",
        }
    }

    fn payload(&self) -> serde_json::Value {
        match self {
            AuthEvent::MagicLinkResult(result) => {
                serde_json::to_value(result).unwrap_or_else(|_| json!({ "success": false }))
            }
            AuthEvent::AuthCallback(tokens) => json!({
                "accessToken": tokens.access_token,
                "refreshToken": tokens.refresh_token,
            }),
        }
    }
}

pub fn parse_auth_callback(raw_url: &str) -> Option<AuthCallback> {
    let url = Url::parse(raw_url).ok()?;
    if url.scheme() != "dtx" || url.host_str() != Some("auth-callback") {
        return None;
    }

    let mut magic_link = None;
    let mut access_token = None;
    let mut refresh_token = None;

    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "magic_link" => magic_link = Some(value.into_owned()),
            "access_token" => access_token = Some(value.into_owned()),
            "refresh_token" => refresh_token = Some(value.into_owned()),
            _ => {}
        }
    }

    Some(AuthCallback {
        magic_link,
        access_token,
        refresh_token,
    })
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

#[tauri::command]
pub async fn validate_session(app: AppHandle, session_data: SessionData) -> Result<bool> {
    let Some(session) = session_value_from_data(session_data) else {
        return Ok(false);
    };

    app.state::<AuthState>()
        .set_current_session(Some(session))
        .await;
    Ok(true)
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
    if let Some(event) = auth_event_from_url(raw_url).await {
        emit_auth_event(app, &event)?;
    }

    Ok(())
}

pub async fn queue_deep_link(app: &AppHandle, raw_url: &str) -> Result<()> {
    if let Some(event) = auth_event_from_url(raw_url).await {
        app.state::<AuthState>().push_pending_event(event).await;
    }

    Ok(())
}

#[tauri::command]
pub async fn drain_pending_auth_events(app: AppHandle) -> Result<usize> {
    let events = app.state::<AuthState>().drain_pending_events().await;
    let count = events.len();

    for event in events {
        emit_auth_event(&app, &event)?;
    }

    Ok(count)
}

async fn auth_event_from_url(raw_url: &str) -> Option<AuthEvent> {
    let callback = parse_auth_callback(raw_url)?;

    if callback.magic_link.is_some() {
        return Some(AuthEvent::MagicLinkResult(verify_magic_link().await));
    }

    let access_token = non_empty_token(callback.access_token)?;
    let refresh_token = non_empty_token(callback.refresh_token)?;

    Some(AuthEvent::AuthCallback(AuthCallbackTokens {
        access_token,
        refresh_token,
    }))
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

async fn verify_magic_link() -> MagicLinkResult {
    MagicLinkResult {
        success: false,
        error: Some("Magic link verification is not configured".to_string()),
        session: None,
        user: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_magic_link_from_dtx_auth_callback() {
        let parsed =
            parse_auth_callback("dtx://auth-callback?magic_link=https%3A%2F%2Fexample.com%2Fmagic")
                .expect("parsed");

        assert_eq!(
            parsed.magic_link.as_deref(),
            Some("https://example.com/magic")
        );
        assert_eq!(parsed.access_token, None);
        assert_eq!(parsed.refresh_token, None);
    }

    #[test]
    fn extracts_legacy_tokens_from_dtx_auth_callback() {
        let parsed = parse_auth_callback("dtx://auth-callback?access_token=a&refresh_token=b")
            .expect("parsed");

        assert_eq!(parsed.access_token.as_deref(), Some("a"));
        assert_eq!(parsed.refresh_token.as_deref(), Some("b"));
    }

    #[test]
    fn rejects_non_auth_callback_host() {
        let parsed = parse_auth_callback("dtx://other?magic_link=x");
        assert!(parsed.is_none());
    }

    #[test]
    fn builds_session_from_camel_case_session_data() {
        let session_data = serde_json::from_value(serde_json::json!({
            "accessToken": "access",
            "refreshToken": "refresh",
        }))
        .expect("session data");
        let session = session_value_from_data(session_data).expect("session");

        assert_eq!(session["access_token"], "access");
        assert_eq!(session["refresh_token"], "refresh");
    }

    #[test]
    fn rejects_session_data_without_both_tokens() {
        let session_data = serde_json::from_value(serde_json::json!({
            "access_token": "access",
        }))
        .expect("session data");
        let session = session_value_from_data(session_data);

        assert!(session.is_none());
    }

    #[tokio::test]
    async fn magic_link_failure_does_not_echo_raw_link() {
        let event = auth_event_from_url(
            "dtx://auth-callback?magic_link=https%3A%2F%2Fexample.com%2Fmagic%3Ftoken_hash%3Dsecret",
        )
        .await
        .expect("event");

        let AuthEvent::MagicLinkResult(result) = event else {
            panic!("expected magic-link event");
        };

        assert!(!result.success);
        assert_eq!(
            result.error.as_deref(),
            Some("Magic link verification is not configured")
        );
    }

    #[tokio::test]
    async fn ignores_empty_legacy_tokens() {
        let event =
            auth_event_from_url("dtx://auth-callback?access_token=tok&refresh_token=%20").await;

        assert!(event.is_none());
    }

    #[test]
    fn external_url_validation_allows_only_http_and_https() {
        assert!(ensure_allowed_external_url("https://example.com/login").is_ok());
        assert!(ensure_allowed_external_url("http://localhost:5173/login").is_ok());
        assert!(ensure_allowed_external_url("file:///etc/passwd").is_err());
        assert!(ensure_allowed_external_url("dtx://auth-callback").is_err());
    }
}
