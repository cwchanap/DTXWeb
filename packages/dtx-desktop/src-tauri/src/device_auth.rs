//! Better Auth Device Authorization protocol.
//!
//! This module deliberately has no Tauri or renderer dependency. Device
//! codes stay inside [`DeviceAuthorizationFlow`] until the token exchange is
//! complete; only [`DeviceAuthorizationAttempt`] is safe to return over IPC.

use crate::api_contracts::{DesktopAuthSession, DesktopAuthUser, DeviceAuthorizationAttempt};
use crate::error::{DesktopError, Result};
use reqwest::StatusCode;
use serde::Deserialize;
use std::fmt;
use std::time::{Duration, Instant};
use time::{format_description::well_known::Rfc3339, Duration as TimeDuration, OffsetDateTime};

pub(crate) const DESKTOP_CLIENT_ID: &str = "dtx-desktop";
const DEVICE_CODE_GRANT_TYPE: &str = "urn:ietf:params:oauth:grant-type:device_code";
const AUTH_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const DEFAULT_POLL_INTERVAL: Duration = Duration::from_secs(5);
const SLOW_DOWN_INCREMENT: Duration = Duration::from_secs(5);

/// Build an API base URL once for both application API and Better Auth calls.
pub(crate) fn api_base_url_from_values(api_url: Option<&str>) -> Result<String> {
    let url = api_url
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            DesktopError::Message("VITE_DTX_API_URL environment variable is not set".to_string())
        })?;
    let url = url.trim().trim_end_matches('/');
    if url.is_empty() {
        return Err(DesktopError::Message(
            "VITE_DTX_API_URL environment variable is not set".to_string(),
        ));
    }
    Ok(url.to_string())
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub(crate) enum DeviceAuthError {
    #[error("device authorization client is invalid")]
    InvalidClient,
    #[error("device authorization request is invalid")]
    InvalidRequest,
    #[error("device authorization is pending")]
    AuthorizationPending,
    #[error("device authorization polling is too fast")]
    SlowDown,
    #[error("device authorization was denied")]
    AccessDenied,
    #[error("device authorization expired")]
    ExpiredToken,
    #[error("device authorization grant is invalid")]
    InvalidGrant,
    #[error("device authorization response was malformed")]
    MalformedResponse,
    #[error("device authorization server returned status {0}")]
    ServerStatus(u16),
    #[error("device authorization request timed out")]
    Timeout,
    #[error("device authorization network request failed")]
    Network,
}

#[derive(Clone)]
pub(crate) struct DeviceAuthClient {
    client: reqwest::Client,
    base_url: String,
    client_id: String,
}

impl fmt::Debug for DeviceAuthClient {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DeviceAuthClient")
            .field("base_url", &self.base_url)
            .field("client_id", &self.client_id)
            .finish()
    }
}

impl DeviceAuthClient {
    pub(crate) fn new(base_url: String) -> Result<Self> {
        Self::new_with_timeout(base_url, AUTH_REQUEST_TIMEOUT)
    }

    pub(crate) fn new_with_timeout(base_url: String, timeout: Duration) -> Result<Self> {
        let base_url = api_base_url_from_values(Some(&base_url))?;
        let client = reqwest::Client::builder()
            .timeout(timeout)
            .build()
            .map_err(DesktopError::Network)?;
        Ok(Self {
            client,
            base_url,
            client_id: DESKTOP_CLIENT_ID.to_string(),
        })
    }

    pub(crate) async fn begin(
        &self,
    ) -> std::result::Result<DeviceAuthorizationFlow, DeviceAuthError> {
        let response = self
            .client
            .post(self.endpoint("/api/auth/device/code"))
            .json(&serde_json::json!({ "client_id": self.client_id }))
            .send()
            .await
            .map_err(map_reqwest_error)?;
        let status = response.status();
        let body = response
            .json::<DeviceCodeResponse>()
            .await
            .map_err(|_| DeviceAuthError::MalformedResponse)?;
        if !status.is_success() {
            return Err(map_wire_error(status, &body.error));
        }

        let expires_in = body
            .expires_in
            .filter(|seconds| *seconds > 0)
            .ok_or(DeviceAuthError::MalformedResponse)?;
        let device_code = body
            .device_code
            .filter(|code| !code.trim().is_empty())
            .ok_or(DeviceAuthError::MalformedResponse)?;
        let user_code = body
            .user_code
            .filter(|code| !code.trim().is_empty())
            .ok_or(DeviceAuthError::MalformedResponse)?;
        let verification_uri = body
            .verification_uri
            .filter(|uri| !uri.trim().is_empty())
            .ok_or(DeviceAuthError::MalformedResponse)?;
        let verification_uri_complete = body
            .verification_uri_complete
            .filter(|uri| !uri.trim().is_empty())
            .ok_or(DeviceAuthError::MalformedResponse)?;
        let interval =
            Duration::from_secs(body.interval.unwrap_or(DEFAULT_POLL_INTERVAL.as_secs()));
        let expires_at = OffsetDateTime::now_utc()
            .checked_add(TimeDuration::seconds(
                i64::try_from(expires_in).unwrap_or(i64::MAX),
            ))
            .ok_or(DeviceAuthError::MalformedResponse)?
            .format(&Rfc3339)
            .map_err(|_| DeviceAuthError::MalformedResponse)?;

        Ok(DeviceAuthorizationFlow {
            device_code,
            attempt: DeviceAuthorizationAttempt {
                user_code,
                verification_uri,
                verification_uri_complete,
                expires_at,
            },
            expires_at: Instant::now()
                .checked_add(Duration::from_secs(expires_in))
                .ok_or(DeviceAuthError::MalformedResponse)?,
            interval,
        })
    }

    pub(crate) async fn poll(
        &self,
        flow: &DeviceAuthorizationFlow,
    ) -> std::result::Result<DevicePollResult, DeviceAuthError> {
        if Instant::now() >= flow.expires_at {
            return Err(DeviceAuthError::ExpiredToken);
        }

        let response = self
            .client
            .post(self.endpoint("/api/auth/device/token"))
            .json(&serde_json::json!({
                "grant_type": DEVICE_CODE_GRANT_TYPE,
                "device_code": flow.device_code,
                "client_id": self.client_id,
            }))
            .send()
            .await
            .map_err(map_reqwest_error)?;
        let status = response.status();
        let body = response
            .json::<DeviceTokenResponse>()
            .await
            .map_err(|_| DeviceAuthError::MalformedResponse)?;
        if !status.is_success() {
            return Err(map_wire_error(status, &body.error));
        }
        let access_token = body
            .access_token
            .filter(|token| !token.trim().is_empty())
            .ok_or(DeviceAuthError::MalformedResponse)?;

        let response = self
            .client
            .get(self.endpoint("/api/auth/get-session"))
            .bearer_auth(&access_token)
            .send()
            .await
            .map_err(map_reqwest_error)?;
        let status = response.status();
        if status == StatusCode::UNAUTHORIZED {
            return Err(DeviceAuthError::InvalidGrant);
        }
        let body = response
            .json::<Option<GetSessionResponse>>()
            .await
            .map_err(|_| DeviceAuthError::MalformedResponse)?;
        if !status.is_success() {
            return Err(DeviceAuthError::ServerStatus(status.as_u16()));
        }
        let user = body
            .and_then(|body| body.user)
            .filter(|user| !user.id.trim().is_empty())
            .ok_or(DeviceAuthError::InvalidGrant)?;

        Ok(DevicePollResult::Approved(DesktopAuthSession {
            session_token: access_token,
            user,
        }))
    }

    #[allow(dead_code)]
    pub(crate) async fn get_session(
        &self,
        session_token: &str,
    ) -> std::result::Result<Option<DesktopAuthUser>, DeviceAuthError> {
        if session_token.trim().is_empty() {
            return Ok(None);
        }
        let response = self
            .client
            .get(self.endpoint("/api/auth/get-session"))
            .bearer_auth(session_token)
            .send()
            .await
            .map_err(map_reqwest_error)?;
        let status = response.status();
        if status == StatusCode::UNAUTHORIZED {
            return Ok(None);
        }
        let body = response
            .json::<Option<GetSessionResponse>>()
            .await
            .map_err(|_| DeviceAuthError::MalformedResponse)?;
        if !status.is_success() {
            return Err(DeviceAuthError::ServerStatus(status.as_u16()));
        }
        Ok(body
            .and_then(|body| body.user)
            .filter(|user| !user.id.trim().is_empty()))
    }

    pub(crate) async fn sign_out(
        &self,
        session_token: &str,
    ) -> std::result::Result<(), DeviceAuthError> {
        if session_token.trim().is_empty() {
            return Ok(());
        }
        let response = self
            .client
            .post(self.endpoint("/api/auth/sign-out"))
            .bearer_auth(session_token)
            .send()
            .await
            .map_err(map_reqwest_error)?;
        let status = response.status();
        if status.is_success() {
            Ok(())
        } else if status == StatusCode::UNAUTHORIZED {
            Err(DeviceAuthError::InvalidGrant)
        } else if status.is_server_error() {
            Err(DeviceAuthError::ServerStatus(status.as_u16()))
        } else {
            Err(DeviceAuthError::InvalidRequest)
        }
    }

    fn endpoint(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }
}

#[derive(Clone)]
pub(crate) struct DeviceAuthorizationFlow {
    device_code: String,
    attempt: DeviceAuthorizationAttempt,
    expires_at: Instant,
    interval: Duration,
}

impl fmt::Debug for DeviceAuthorizationFlow {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DeviceAuthorizationFlow")
            .field("device_code", &"<redacted>")
            .field("attempt", &self.attempt)
            .field("expires_at", &self.expires_at)
            .field("interval", &self.interval)
            .finish()
    }
}

impl DeviceAuthorizationFlow {
    pub(crate) fn attempt(&self) -> &DeviceAuthorizationAttempt {
        &self.attempt
    }

    pub(crate) fn interval(&self) -> Duration {
        self.interval
    }

    pub(crate) fn increase_interval(&mut self) {
        self.interval = self.interval.saturating_add(SLOW_DOWN_INCREMENT);
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum DevicePollResult {
    Approved(DesktopAuthSession),
}

#[derive(Debug, Deserialize)]
struct DeviceCodeResponse {
    #[serde(default)]
    device_code: Option<String>,
    #[serde(default)]
    user_code: Option<String>,
    #[serde(default)]
    verification_uri: Option<String>,
    #[serde(default)]
    verification_uri_complete: Option<String>,
    #[serde(default)]
    expires_in: Option<u64>,
    #[serde(default)]
    interval: Option<u64>,
    #[serde(default)]
    error: String,
}

#[derive(Debug, Deserialize)]
struct DeviceTokenResponse {
    #[serde(default)]
    access_token: Option<String>,
    #[serde(default)]
    error: String,
}

#[derive(Debug, Deserialize)]
struct GetSessionResponse {
    #[serde(default)]
    user: Option<DesktopAuthUser>,
}

fn map_reqwest_error(error: reqwest::Error) -> DeviceAuthError {
    if error.is_timeout() {
        DeviceAuthError::Timeout
    } else {
        DeviceAuthError::Network
    }
}

fn map_wire_error(status: StatusCode, error: &str) -> DeviceAuthError {
    match error {
        "invalid_client" => DeviceAuthError::InvalidClient,
        "invalid_request" => DeviceAuthError::InvalidRequest,
        "authorization_pending" => DeviceAuthError::AuthorizationPending,
        "slow_down" => DeviceAuthError::SlowDown,
        "access_denied" => DeviceAuthError::AccessDenied,
        "expired_token" => DeviceAuthError::ExpiredToken,
        "invalid_grant" => DeviceAuthError::InvalidGrant,
        _ if status.is_server_error() => DeviceAuthError::ServerStatus(status.as_u16()),
        _ => DeviceAuthError::MalformedResponse,
    }
}
