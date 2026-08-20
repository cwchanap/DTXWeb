use crate::api_contracts::{DesktopAuthSession, DesktopAuthUser, DeviceAuthorizationAttempt};
use crate::device_auth::{
    api_base_url_from_values, DeviceAuthClient, DeviceAuthError, DeviceAuthorizationFlow,
    DevicePollResult,
};
use crate::error::{DesktopError, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::Mutex as AsyncMutex;
use url::Url;

#[derive(Debug, Clone)]
struct PendingDeviceAuthorization {
    client: DeviceAuthClient,
    flow: DeviceAuthorizationFlow,
    next_poll_at: Instant,
}

#[derive(Debug, Clone, Default)]
pub struct AuthState {
    current_session: Arc<AsyncMutex<Option<DesktopAuthSession>>>,
    session_generation: Arc<AtomicU64>,
    pending_device: Arc<AsyncMutex<Option<PendingDeviceAuthorization>>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AuthSessionEpoch {
    user_id: String,
    generation: u64,
}

impl AuthSessionEpoch {
    pub(crate) fn user_id(&self) -> &str {
        &self.user_id
    }
}

impl AuthState {
    #[cfg(all(feature = "e2e", debug_assertions))]
    pub(crate) fn for_e2e_user(user_id: &str) -> Result<Self> {
        if user_id.is_empty()
            || user_id.trim() != user_id
            || user_id.len() > 512
            || !user_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(DesktopError::Message(
                "DTX_E2E_DRUMERY_USER_ID is invalid".to_string(),
            ));
        }

        Ok(Self {
            current_session: Arc::new(AsyncMutex::new(Some(crate::e2e::seeded_auth_session(
                user_id,
            )))),
            session_generation: Arc::new(AtomicU64::new(1)),
            pending_device: Arc::new(AsyncMutex::new(None)),
        })
    }

    /// Returns the Better Auth-shaped session as JSON for existing native
    /// ownership helpers. The serialized credential is the opaque
    /// `sessionToken`.
    #[allow(dead_code)]
    pub async fn current_session(&self) -> Option<Value> {
        self.current_session
            .lock()
            .await
            .as_ref()
            .and_then(|session| serde_json::to_value(session).ok())
    }

    pub(crate) async fn current_session_typed(&self) -> Option<DesktopAuthSession> {
        self.current_session.lock().await.clone()
    }

    pub(crate) async fn current_session_token(&self) -> Result<String> {
        self.current_session_typed()
            .await
            .map(|session| session.session_token)
            .filter(|token| !token.trim().is_empty())
            .ok_or_else(|| DesktopError::Message("No authenticated session".to_string()))
    }

    /// Returns the authenticated Drumery user identifier from native state.
    #[allow(dead_code)]
    pub async fn current_user_id(&self) -> Option<String> {
        self.current_session_typed()
            .await
            .map(|session| session.user.id)
            .filter(|user_id| !user_id.trim().is_empty())
    }

    /// Compatibility setter for native ownership tests and callers that still
    /// construct a JSON value. Production authentication uses
    /// `set_current_auth_session`, which accepts only the typed Better Auth
    /// session.
    #[allow(dead_code)]
    pub async fn set_current_session(&self, session: Option<Value>) {
        let typed = session.and_then(|value| serde_json::from_value(value).ok());
        self.set_current_auth_session(typed).await;
    }

    pub(crate) async fn set_current_auth_session(&self, session: Option<DesktopAuthSession>) {
        *self.current_session.lock().await = session;
        self.session_generation.fetch_add(1, Ordering::SeqCst);
    }

    pub(crate) async fn current_session_epoch(&self) -> Option<AuthSessionEpoch> {
        let current = self.current_session.lock().await;
        let user_id = current.as_ref()?.user.id.trim();
        if user_id.is_empty() {
            return None;
        }
        Some(AuthSessionEpoch {
            user_id: user_id.to_string(),
            generation: self.session_generation.load(Ordering::SeqCst),
        })
    }

    pub(crate) async fn matches_session_epoch(&self, expected: &AuthSessionEpoch) -> bool {
        let current = self.current_session.lock().await;
        self.session_generation.load(Ordering::SeqCst) == expected.generation
            && current.as_ref().map(|session| session.user.id.trim())
                == Some(expected.user_id.as_str())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionData {
    #[serde(default, alias = "session_token")]
    pub session_token: Option<String>,
    #[serde(default)]
    pub user: Option<DesktopAuthUser>,
}

#[cfg(all(feature = "e2e", debug_assertions))]
pub(crate) fn e2e_session_matches_user(session: &SessionData, expected_user_id: &str) -> bool {
    session.user.as_ref().is_some_and(|user| {
        user.id == expected_user_id
            && session
                .session_token
                .as_deref()
                .is_some_and(|token| !token.trim().is_empty())
    })
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
pub enum SessionValidationStatus {
    Valid,
    Invalid,
    NotConfigured,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum DeviceAuthorizationPoll {
    Pending { retry_after_ms: u64 },
    Approved { session: DesktopAuthSession },
    Denied,
    Expired,
    InvalidGrant,
}

#[tauri::command]
pub async fn begin_device_authorization(app: AppHandle) -> Result<DeviceAuthorizationAttempt> {
    let base_url = api_base_url_from_values(config_env!("VITE_DTX_API_URL").as_deref())
        .map_err(|_| DesktopError::Message("Device authorization is not configured".to_string()))?;
    let client = DeviceAuthClient::new(base_url)?;
    let flow = client.begin().await.map_err(device_auth_error)?;
    let attempt = flow.attempt().clone();
    app.state::<AuthState>()
        .pending_device
        .lock()
        .await
        .replace(PendingDeviceAuthorization {
            next_poll_at: Instant::now(),
            client,
            flow,
        });
    Ok(attempt)
}

#[tauri::command]
pub async fn poll_device_authorization(app: AppHandle) -> Result<DeviceAuthorizationPoll> {
    let state = app.state::<AuthState>();
    let mut pending =
        state.pending_device.lock().await.take().ok_or_else(|| {
            DesktopError::Message("No device authorization is pending".to_string())
        })?;

    let now = Instant::now();
    if now < pending.next_poll_at {
        let retry_after = pending.next_poll_at.saturating_duration_since(now);
        let retry_after_ms = retry_after.as_millis().min(u128::from(u64::MAX)) as u64;
        state.pending_device.lock().await.replace(pending);
        return Ok(DeviceAuthorizationPoll::Pending { retry_after_ms });
    }

    match pending.client.poll(&pending.flow).await {
        Ok(DevicePollResult::Approved(session)) => {
            state.set_current_auth_session(Some(session.clone())).await;
            spawn_drive_reconciliation_if_available(&app);
            Ok(DeviceAuthorizationPoll::Approved { session })
        }
        Err(DeviceAuthError::AuthorizationPending) => {
            pending.next_poll_at = Instant::now() + pending.flow.interval();
            let retry_after_ms = pending.flow.interval().as_millis() as u64;
            state.pending_device.lock().await.replace(pending);
            Ok(DeviceAuthorizationPoll::Pending { retry_after_ms })
        }
        Err(DeviceAuthError::SlowDown) => {
            pending.flow.increase_interval();
            pending.next_poll_at = Instant::now() + pending.flow.interval();
            let retry_after_ms = pending.flow.interval().as_millis() as u64;
            state.pending_device.lock().await.replace(pending);
            Ok(DeviceAuthorizationPoll::Pending { retry_after_ms })
        }
        Err(DeviceAuthError::AccessDenied) => Ok(DeviceAuthorizationPoll::Denied),
        Err(DeviceAuthError::ExpiredToken) => Ok(DeviceAuthorizationPoll::Expired),
        Err(DeviceAuthError::InvalidGrant) => Ok(DeviceAuthorizationPoll::InvalidGrant),
        Err(error) => {
            state.pending_device.lock().await.replace(pending);
            Err(device_auth_error(error))
        }
    }
}

#[tauri::command]
pub async fn cancel_device_authorization(app: AppHandle) -> Result<bool> {
    Ok(app
        .state::<AuthState>()
        .pending_device
        .lock()
        .await
        .take()
        .is_some())
}

#[tauri::command]
pub async fn validate_session(
    app: AppHandle,
    session_data: SessionData,
) -> Result<SessionValidationStatus> {
    #[cfg(all(feature = "e2e", debug_assertions))]
    {
        let expected_user_id = std::env::var("DTX_E2E_DRUMERY_USER_ID").ok();
        let current_user_id = app.state::<AuthState>().current_user_id().await;
        let valid = expected_user_id.as_deref().is_some_and(|expected| {
            e2e_session_matches_user(&session_data, expected)
                && current_user_id.as_deref() == Some(expected)
        });
        if valid {
            spawn_drive_reconciliation_if_available(&app);
        }
        Ok(if valid {
            SessionValidationStatus::Valid
        } else {
            SessionValidationStatus::Invalid
        })
    }

    #[cfg(not(all(feature = "e2e", debug_assertions)))]
    {
        let Some(base_url) = config_env!("VITE_DTX_API_URL") else {
            return Ok(SessionValidationStatus::NotConfigured);
        };
        let base_url = match api_base_url_from_values(Some(&base_url)) {
            Ok(base_url) => base_url,
            Err(_) => return Ok(SessionValidationStatus::NotConfigured),
        };
        let Some(token) = session_data
            .session_token
            .as_deref()
            .filter(|token| !token.trim().is_empty())
        else {
            app.state::<AuthState>()
                .set_current_auth_session(None)
                .await;
            return Ok(SessionValidationStatus::Invalid);
        };
        let Some(expected_user) = session_data.user.as_ref() else {
            app.state::<AuthState>()
                .set_current_auth_session(None)
                .await;
            return Ok(SessionValidationStatus::Invalid);
        };
        let client = match DeviceAuthClient::new(base_url) {
            Ok(client) => client,
            Err(_) => return Ok(SessionValidationStatus::Invalid),
        };
        let valid_user = client.get_session(token).await.ok().flatten();
        let Some(user) = valid_user.filter(|user| user.id == expected_user.id) else {
            app.state::<AuthState>()
                .set_current_auth_session(None)
                .await;
            return Ok(SessionValidationStatus::Invalid);
        };
        app.state::<AuthState>()
            .set_current_auth_session(Some(DesktopAuthSession {
                session_token: token.to_string(),
                user,
            }))
            .await;
        spawn_drive_reconciliation_if_available(&app);
        Ok(SessionValidationStatus::Valid)
    }
}

#[tauri::command]
pub async fn get_current_session(app: AppHandle) -> Result<Option<DesktopAuthSession>> {
    Ok(app.state::<AuthState>().current_session_typed().await)
}

#[tauri::command]
pub async fn logout_session(app: AppHandle) -> Result<bool> {
    logout_session_impl(app).await
}

pub(crate) async fn logout_session_impl<R: Runtime>(app: AppHandle<R>) -> Result<bool> {
    let state = app.state::<AuthState>();
    if let Some(session_token) = state.current_session_token().await.ok() {
        if let Some(base_url) = config_env!("VITE_DTX_API_URL")
            .and_then(|url| api_base_url_from_values(Some(&url)).ok())
        {
            if let Ok(client) = DeviceAuthClient::new(base_url) {
                let _ = client.sign_out(&session_token).await;
            }
        }
    }
    if let (Some(user_id), Some(drive)) = (
        state.current_user_id().await,
        app.try_state::<crate::google_drive::GoogleDriveState>(),
    ) {
        drive.clear_user_memory(&user_id).await;
    }
    state.set_current_auth_session(None).await;
    state.pending_device.lock().await.take();
    Ok(true)
}

#[tauri::command]
pub async fn open_external_url(app: AppHandle, url: String) -> Result<()> {
    ensure_allowed_external_url(&url)?;
    app.opener()
        .open_url(url, None::<String>)
        .map_err(|error| DesktopError::Message(error.to_string()))
}

fn device_auth_error(error: DeviceAuthError) -> DesktopError {
    DesktopError::Message(error.to_string())
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

fn spawn_drive_reconciliation_if_available(app: &AppHandle) {
    if app
        .try_state::<crate::google_drive::GoogleDriveState>()
        .is_some()
    {
        crate::google_drive::GoogleDriveState::spawn_current_user_reconciliation(app.clone());
    }
}

#[cfg(test)]
#[path = "tests/auth_tests.rs"]
mod tests;
