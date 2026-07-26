use std::fmt;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::sync::Arc;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex as AsyncMutex;
use tokio::time::timeout;
use url::Url;
use uuid::Uuid;
use zeroize::Zeroizing;

use super::credential_store::GoogleDriveCredentialAccess;
use super::settings::{GoogleDriveFolderSetting, GoogleDriveSettingsAccess};
use super::GoogleDriveState;
use crate::auth::AuthState;

pub(crate) const GOOGLE_DRIVE_FILE_SCOPE: &str = "https://www.googleapis.com/auth/drive.file";
pub(crate) const GOOGLE_DRIVE_CALLBACK_PATH: &str = "/google-drive/oauth/callback";
const GOOGLE_AUTHORIZATION_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_ENDPOINT: &str = "https://oauth2.googleapis.com/revoke";
const CALLBACK_READ_TIMEOUT: Duration = Duration::from_secs(10);
const TOKEN_REFRESH_SKEW: Duration = Duration::from_secs(60);
const DEFAULT_PICKER_TIMEOUT: Duration = Duration::from_secs(5 * 60);

pub(crate) struct PickerAttempt {
    attempt_id: Uuid,
    user_id: String,
    pkce_verifier: Zeroizing<String>,
    oauth_state: Zeroizing<String>,
    callback_addr: SocketAddrV4,
    callback_path: String,
    deadline: Instant,
}

impl PickerAttempt {
    pub(crate) fn new(
        user_id: String,
        callback_addr: SocketAddrV4,
        now: Instant,
        timeout: Duration,
    ) -> Self {
        Self {
            attempt_id: Uuid::new_v4(),
            user_id,
            pkce_verifier: Zeroizing::new(random_urlsafe_value()),
            oauth_state: Zeroizing::new(random_urlsafe_value()),
            callback_addr,
            callback_path: GOOGLE_DRIVE_CALLBACK_PATH.to_string(),
            deadline: now + timeout,
        }
    }

    pub(crate) fn attempt_id(&self) -> Uuid {
        self.attempt_id
    }

    pub(crate) fn oauth_state(&self) -> &str {
        &self.oauth_state
    }

    pub(crate) fn pkce_verifier(&self) -> &str {
        &self.pkce_verifier
    }

    pub(crate) fn pkce_challenge(&self) -> String {
        URL_SAFE_NO_PAD.encode(Sha256::digest(self.pkce_verifier.as_bytes()))
    }

    pub(crate) fn redirect_uri(&self) -> String {
        format!("http://{}{}", self.callback_addr, self.callback_path)
    }

    pub(crate) fn authorization_url(
        &self,
        client_id: &str,
    ) -> Result<String, GoogleDriveOAuthError> {
        if client_id.trim().is_empty() {
            return Err(GoogleDriveOAuthError::InvalidResponse);
        }
        let mut url = Url::parse(GOOGLE_AUTHORIZATION_ENDPOINT)
            .map_err(|_| GoogleDriveOAuthError::InvalidResponse)?;
        url.query_pairs_mut()
            .append_pair("client_id", client_id.trim())
            .append_pair("redirect_uri", &self.redirect_uri())
            .append_pair("response_type", "code")
            .append_pair("scope", GOOGLE_DRIVE_FILE_SCOPE)
            .append_pair("code_challenge", &self.pkce_challenge())
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", &self.oauth_state)
            .append_pair("access_type", "offline")
            .append_pair("prompt", "consent")
            .append_pair("trigger_onepick", "true")
            .append_pair("allow_folder_selection", "true");
        Ok(url.into())
    }

    pub(crate) fn validate_callback_target(
        &self,
        target: &str,
        current_user_id: &str,
        now: Instant,
    ) -> Result<PickerCallback, GoogleDriveOAuthError> {
        if now > self.deadline || current_user_id != self.user_id {
            return Err(GoogleDriveOAuthError::Canceled);
        }
        if target.len() > MAX_CALLBACK_TARGET_BYTES {
            return Err(GoogleDriveOAuthError::InvalidResponse);
        }

        let url = Url::parse(&format!("http://127.0.0.1{target}"))
            .map_err(|_| GoogleDriveOAuthError::InvalidResponse)?;
        if url.path() != self.callback_path || url.fragment().is_some() {
            return Err(GoogleDriveOAuthError::InvalidResponse);
        }

        let states = query_values(&url, "state");
        if states.len() != 1
            || states[0].len() != self.oauth_state.len()
            || !bool::from(states[0].as_bytes().ct_eq(self.oauth_state.as_bytes()))
        {
            return Err(GoogleDriveOAuthError::InvalidResponse);
        }

        let codes = query_values(&url, "code");
        let errors = query_values(&url, "error");
        if codes.len() + errors.len() != 1 || codes.len() > 1 || errors.len() > 1 {
            return Err(GoogleDriveOAuthError::InvalidResponse);
        }

        let folders = query_values(&url, "picked_file_ids");
        if folders.len() > 1 {
            return Err(GoogleDriveOAuthError::InvalidResponse);
        }

        if errors.len() == 1 {
            return Err(GoogleDriveOAuthError::Canceled);
        }

        let code = Zeroizing::new(
            non_blank_bounded(codes.first(), MAX_AUTH_ARTIFACT_BYTES)
                .ok_or(GoogleDriveOAuthError::InvalidResponse)?,
        );
        let Some(folder_id) = non_blank_bounded(folders.first(), MAX_AUTH_ARTIFACT_BYTES) else {
            return Err(GoogleDriveOAuthError::Canceled);
        };
        if folder_id.contains(',') {
            return Err(GoogleDriveOAuthError::InvalidResponse);
        }

        Ok(PickerCallback::AuthorizationCode { code, folder_id })
    }
}

fn random_urlsafe_value() -> String {
    let mut bytes = [0_u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn query_values(url: &Url, key: &str) -> Vec<String> {
    url.query_pairs()
        .filter(|(candidate, _)| candidate == key)
        .map(|(_, value)| value.into_owned())
        .collect()
}

fn non_blank_bounded(value: Option<&String>, maximum: usize) -> Option<String> {
    value
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= maximum)
        .map(str::to_string)
}

const MAX_CALLBACK_TARGET_BYTES: usize = 8 * 1024;
const MAX_AUTH_ARTIFACT_BYTES: usize = 4 * 1024;

#[derive(Clone, PartialEq, Eq)]
pub(crate) enum PickerCallback {
    AuthorizationCode {
        code: Zeroizing<String>,
        folder_id: String,
    },
}

impl fmt::Debug for PickerCallback {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("AuthorizationCode { <redacted> }")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GoogleDriveOAuthError {
    Canceled,
    InvalidResponse,
    Network,
    ReconnectRequired,
    NotConnected,
    CredentialStore,
    LocalState,
    AlreadyInProgress,
}

impl GoogleDriveOAuthError {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::Canceled => "CANCELED",
            Self::InvalidResponse => "INVALID_RESPONSE",
            Self::Network => "NETWORK",
            Self::ReconnectRequired => "RECONNECT_REQUIRED",
            Self::NotConnected => "NOT_CONNECTED",
            Self::CredentialStore => "CREDENTIAL_STORE",
            Self::LocalState => "LOCAL_STATE",
            Self::AlreadyInProgress => "UPLOAD_IN_PROGRESS",
        }
    }
}

#[derive(Clone, PartialEq, Eq, Deserialize)]
pub(crate) struct OAuthTokenResponse {
    pub(crate) access_token: String,
    #[serde(default)]
    pub(crate) refresh_token: Option<String>,
    #[serde(default)]
    pub(crate) expires_in: u64,
    #[serde(default)]
    pub(crate) scope: Option<String>,
}

#[derive(PartialEq, Eq)]
pub(crate) struct ValidatedPickerTokens {
    pub(crate) access_token: Zeroizing<String>,
    pub(crate) refresh_token: Zeroizing<String>,
    pub(crate) expires_in: u64,
}

impl fmt::Debug for ValidatedPickerTokens {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ValidatedPickerTokens { <redacted> }")
    }
}

impl TryFrom<OAuthTokenResponse> for ValidatedPickerTokens {
    type Error = GoogleDriveOAuthError;

    fn try_from(response: OAuthTokenResponse) -> Result<Self, Self::Error> {
        let access_token = Zeroizing::new(response.access_token);
        let refresh_token = response
            .refresh_token
            .map(Zeroizing::new)
            .filter(|token| !token.trim().is_empty());
        let has_scope = response.scope.as_deref().is_some_and(|scope| {
            scope
                .split_ascii_whitespace()
                .any(|candidate| candidate == GOOGLE_DRIVE_FILE_SCOPE)
        });
        if access_token.trim().is_empty()
            || access_token.len() > MAX_AUTH_ARTIFACT_BYTES
            || refresh_token.is_none()
            || !has_scope
            || response.expires_in == 0
        {
            return Err(GoogleDriveOAuthError::InvalidResponse);
        }

        Ok(Self {
            access_token,
            refresh_token: refresh_token.unwrap_or_default(),
            expires_in: response.expires_in,
        })
    }
}

pub(crate) fn callback_response_html() -> &'static str {
    "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>Return to Drumery</title><body><p>Return to Drumery. You may close this window.</p></body></html>"
}

pub(crate) struct TokenExchangeRequest {
    pub(crate) code: Zeroizing<String>,
    pub(crate) pkce_verifier: Zeroizing<String>,
    pub(crate) redirect_uri: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum OAuthProviderError {
    InvalidGrant,
    InvalidResponse,
    Network,
}

#[async_trait]
pub(crate) trait GoogleOAuthProvider: Send + Sync {
    async fn exchange_code(
        &self,
        request: TokenExchangeRequest,
    ) -> Result<OAuthTokenResponse, OAuthProviderError>;

    async fn refresh_access_token(
        &self,
        refresh_token: &str,
    ) -> Result<OAuthTokenResponse, OAuthProviderError>;

    async fn revoke_refresh_token(&self, refresh_token: &str) -> Result<(), OAuthProviderError>;
}

pub(crate) trait PickerBrowser: Send + Sync {
    fn open(&self, authorization_url: &str) -> Result<(), GoogleDriveOAuthError>;
}

#[async_trait]
pub(crate) trait PickerFolderValidator: Send + Sync {
    async fn validate_folder(
        &self,
        access_token: &str,
        folder_id: &str,
    ) -> Result<GoogleDriveFolderSetting, GoogleDriveOAuthError>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AuthorizedDriveRequestError {
    TokenExpired,
    Request(GoogleDriveOAuthError),
}

#[async_trait]
pub(crate) trait AuthorizedDriveRequest<T>: Send + Sync
where
    T: Send,
{
    async fn execute(&self, access_token: &str) -> Result<T, AuthorizedDriveRequestError>;
}

#[derive(Debug, Clone)]
pub(crate) struct PickerProtocolConfig {
    pub(crate) client_id: String,
    pub(crate) timeout: Duration,
}

impl PickerProtocolConfig {
    pub(crate) fn new(client_id: String, timeout: Duration) -> Self {
        Self { client_id, timeout }
    }

    pub(crate) fn production() -> Self {
        Self {
            client_id: option_env!("GOOGLE_DRIVE_OAUTH_CLIENT_ID")
                .unwrap_or_default()
                .trim()
                .to_string(),
            timeout: DEFAULT_PICKER_TIMEOUT,
        }
    }
}

pub(crate) struct ReqwestGoogleOAuthProvider {
    client: reqwest::Client,
    client_id: String,
}

impl ReqwestGoogleOAuthProvider {
    pub(crate) fn new(client_id: String) -> Result<Self, GoogleDriveOAuthError> {
        if client_id.trim().is_empty() {
            return Err(GoogleDriveOAuthError::InvalidResponse);
        }
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|_| GoogleDriveOAuthError::Network)?;
        Ok(Self { client, client_id })
    }

    async fn decode_token_response(
        response: reqwest::Response,
        classify_invalid_grant: bool,
    ) -> Result<OAuthTokenResponse, OAuthProviderError> {
        if response.status().is_success() {
            return response
                .json::<OAuthTokenResponse>()
                .await
                .map_err(|_| OAuthProviderError::InvalidResponse);
        }

        if classify_invalid_grant {
            #[derive(Deserialize)]
            struct ProviderErrorBody {
                error: Option<String>,
            }
            if response
                .json::<ProviderErrorBody>()
                .await
                .ok()
                .and_then(|body| body.error)
                .as_deref()
                == Some("invalid_grant")
            {
                return Err(OAuthProviderError::InvalidGrant);
            }
        }
        Err(OAuthProviderError::InvalidResponse)
    }
}

#[async_trait]
impl GoogleOAuthProvider for ReqwestGoogleOAuthProvider {
    async fn exchange_code(
        &self,
        request: TokenExchangeRequest,
    ) -> Result<OAuthTokenResponse, OAuthProviderError> {
        let response = self
            .client
            .post(GOOGLE_TOKEN_ENDPOINT)
            .form(&[
                ("client_id", self.client_id.as_str()),
                ("code", request.code.as_str()),
                ("code_verifier", request.pkce_verifier.as_str()),
                ("redirect_uri", request.redirect_uri.as_str()),
                ("grant_type", "authorization_code"),
            ])
            .send()
            .await
            .map_err(|_| OAuthProviderError::Network)?;
        Self::decode_token_response(response, false).await
    }

    async fn refresh_access_token(
        &self,
        refresh_token: &str,
    ) -> Result<OAuthTokenResponse, OAuthProviderError> {
        let response = self
            .client
            .post(GOOGLE_TOKEN_ENDPOINT)
            .form(&[
                ("client_id", self.client_id.as_str()),
                ("refresh_token", refresh_token),
                ("grant_type", "refresh_token"),
            ])
            .send()
            .await
            .map_err(|_| OAuthProviderError::Network)?;
        Self::decode_token_response(response, true).await
    }

    async fn revoke_refresh_token(&self, refresh_token: &str) -> Result<(), OAuthProviderError> {
        let response = self
            .client
            .post(GOOGLE_REVOKE_ENDPOINT)
            .form(&[("token", refresh_token)])
            .send()
            .await
            .map_err(|_| OAuthProviderError::Network)?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err(OAuthProviderError::InvalidResponse)
        }
    }
}

pub(crate) struct TauriPickerBrowser {
    app: AppHandle,
}

impl TauriPickerBrowser {
    pub(crate) fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl PickerBrowser for TauriPickerBrowser {
    fn open(&self, authorization_url: &str) -> Result<(), GoogleDriveOAuthError> {
        let parsed =
            Url::parse(authorization_url).map_err(|_| GoogleDriveOAuthError::InvalidResponse)?;
        if parsed.scheme() != "https" {
            return Err(GoogleDriveOAuthError::InvalidResponse);
        }
        self.app
            .opener()
            .open_url(parsed.as_str(), None::<String>)
            .map_err(|_| GoogleDriveOAuthError::Network)
    }
}

pub(crate) struct UnavailableOAuthProvider;

#[async_trait]
impl GoogleOAuthProvider for UnavailableOAuthProvider {
    async fn exchange_code(
        &self,
        _request: TokenExchangeRequest,
    ) -> Result<OAuthTokenResponse, OAuthProviderError> {
        Err(OAuthProviderError::InvalidResponse)
    }

    async fn refresh_access_token(
        &self,
        _refresh_token: &str,
    ) -> Result<OAuthTokenResponse, OAuthProviderError> {
        Err(OAuthProviderError::InvalidResponse)
    }

    async fn revoke_refresh_token(&self, _refresh_token: &str) -> Result<(), OAuthProviderError> {
        Err(OAuthProviderError::Network)
    }
}

pub(crate) struct UnavailablePickerBrowser;

impl PickerBrowser for UnavailablePickerBrowser {
    fn open(&self, _authorization_url: &str) -> Result<(), GoogleDriveOAuthError> {
        Err(GoogleDriveOAuthError::InvalidResponse)
    }
}

pub(crate) struct DeferredPickerFolderValidator;

#[async_trait]
impl PickerFolderValidator for DeferredPickerFolderValidator {
    async fn validate_folder(
        &self,
        _access_token: &str,
        _folder_id: &str,
    ) -> Result<GoogleDriveFolderSetting, GoogleDriveOAuthError> {
        Err(GoogleDriveOAuthError::InvalidResponse)
    }
}

pub(crate) async fn persist_validated_connection(
    credentials: &GoogleDriveCredentialAccess,
    settings: &dyn GoogleDriveSettingsAccess,
    user_id: &str,
    refresh_token: Zeroizing<String>,
    folder: GoogleDriveFolderSetting,
) -> Result<(), GoogleDriveOAuthError> {
    let prior_token = credentials
        .get_refresh_token(user_id)
        .await
        .map_err(|_| GoogleDriveOAuthError::CredentialStore)?;
    let prior_folder = settings.folder_for_user(user_id);

    credentials
        .set_refresh_token(user_id, refresh_token)
        .await
        .map_err(|_| GoogleDriveOAuthError::CredentialStore)?;

    if settings.set_folder_for_user(user_id, folder).is_ok() {
        return Ok(());
    }

    let rollback_result = match prior_token {
        Some(token) => credentials.set_refresh_token(user_id, token).await,
        None => credentials.delete_refresh_token(user_id).await,
    };
    if rollback_result.is_err() {
        return Err(GoogleDriveOAuthError::CredentialStore);
    }

    // A failed atomic settings write must not replace the prior value. Keep
    // this read so an adapter that violates that contract fails closed.
    if settings.folder_for_user(user_id) != prior_folder {
        if let Some(folder) = prior_folder {
            settings
                .set_folder_for_user(user_id, folder)
                .map_err(|_| GoogleDriveOAuthError::LocalState)?;
        } else {
            settings
                .clear_folder_for_user(user_id)
                .map_err(|_| GoogleDriveOAuthError::LocalState)?;
        }
    }
    Err(GoogleDriveOAuthError::LocalState)
}

impl GoogleDriveState {
    pub(crate) async fn connect_and_choose_folder(
        &self,
        auth: &AuthState,
    ) -> Result<GoogleDriveConnectionState, GoogleDriveOAuthError> {
        let user_id = auth
            .current_user_id()
            .await
            .ok_or(GoogleDriveOAuthError::NotConnected)?;
        self.run_picker_attempt(auth, &user_id).await
    }

    async fn run_picker_attempt(
        &self,
        auth: &AuthState,
        user_id: &str,
    ) -> Result<GoogleDriveConnectionState, GoogleDriveOAuthError> {
        let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
            .await
            .map_err(|_| GoogleDriveOAuthError::Network)?;
        let callback_addr = match listener
            .local_addr()
            .map_err(|_| GoogleDriveOAuthError::Network)?
        {
            SocketAddr::V4(addr) if *addr.ip() == Ipv4Addr::LOCALHOST => addr,
            _ => return Err(GoogleDriveOAuthError::InvalidResponse),
        };
        let attempt = PickerAttempt::new(
            user_id.to_string(),
            callback_addr,
            Instant::now(),
            self.picker_config.timeout,
        );
        let attempt_id = attempt.attempt_id();
        let authorization_url =
            Zeroizing::new(attempt.authorization_url(&self.picker_config.client_id)?);

        {
            let mut active = self.active_picker_attempt.lock().await;
            if active.is_some() {
                return Err(GoogleDriveOAuthError::AlreadyInProgress);
            }
            *active = Some(attempt);
        }
        let mut active_attempt =
            ActivePickerAttemptGuard::new(self.active_picker_attempt.clone(), attempt_id);

        if let Err(error) = self.picker_browser.open(&authorization_url) {
            active_attempt.clear().await;
            return Err(error);
        }

        let accepted = timeout(self.picker_config.timeout, listener.accept()).await;
        let (mut stream, _) = match accepted {
            Ok(Ok(accepted)) => accepted,
            _ => {
                active_attempt.clear().await;
                return Err(GoogleDriveOAuthError::Canceled);
            }
        };
        let target = match read_callback_target(&mut stream).await {
            Ok(target) => target,
            Err(error) => {
                active_attempt.clear().await;
                let _ = write_callback_response(&mut stream).await;
                return Err(error);
            }
        };
        let current_user_id = auth.current_user_id().await.unwrap_or_default();
        let attempt = active_attempt.take().await?;
        let callback = attempt.validate_callback_target(&target, &current_user_id, Instant::now());
        let _ = write_callback_response(&mut stream).await;
        let PickerCallback::AuthorizationCode { code, folder_id } = callback?;

        let redirect_uri = attempt.redirect_uri();
        let token_response = self
            .oauth_provider
            .exchange_code(TokenExchangeRequest {
                code,
                pkce_verifier: attempt.pkce_verifier,
                redirect_uri,
            })
            .await
            .map_err(map_provider_error)?;
        let tokens = ValidatedPickerTokens::try_from(token_response)?;

        if auth.current_user_id().await.as_deref() != Some(user_id) {
            return Err(GoogleDriveOAuthError::Canceled);
        }
        let folder = self
            .folder_validator
            .validate_folder(&tokens.access_token, &folder_id)
            .await?;
        if auth.current_user_id().await.as_deref() != Some(user_id) {
            return Err(GoogleDriveOAuthError::Canceled);
        }

        let expires_at = Instant::now()
            .checked_add(Duration::from_secs(tokens.expires_in))
            .ok_or(GoogleDriveOAuthError::InvalidResponse)?;
        persist_validated_connection(
            &self.credentials,
            self.settings.as_ref(),
            user_id,
            tokens.refresh_token,
            folder,
        )
        .await?;
        self.cache_access_token_until(user_id, tokens.access_token, expires_at)
            .await;
        self.set_requires_reconnect(user_id, false).await;
        Ok(self.connection_state_for_user(user_id).await)
    }
}

struct ActivePickerAttemptGuard {
    slot: Arc<AsyncMutex<Option<PickerAttempt>>>,
    attempt_id: Uuid,
    armed: bool,
}

impl ActivePickerAttemptGuard {
    fn new(slot: Arc<AsyncMutex<Option<PickerAttempt>>>, attempt_id: Uuid) -> Self {
        Self {
            slot,
            attempt_id,
            armed: true,
        }
    }

    async fn take(&mut self) -> Result<PickerAttempt, GoogleDriveOAuthError> {
        let mut active = self.slot.lock().await;
        let matches = active
            .as_ref()
            .is_some_and(|attempt| attempt.attempt_id == self.attempt_id);
        if !matches {
            self.armed = false;
            return Err(GoogleDriveOAuthError::Canceled);
        }
        self.armed = false;
        active.take().ok_or(GoogleDriveOAuthError::Canceled)
    }

    async fn clear(&mut self) {
        let mut active = self.slot.lock().await;
        if active
            .as_ref()
            .is_some_and(|attempt| attempt.attempt_id == self.attempt_id)
        {
            active.take();
        }
        self.armed = false;
    }
}

impl Drop for ActivePickerAttemptGuard {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        let slot = self.slot.clone();
        let attempt_id = self.attempt_id;
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                let mut active = slot.lock().await;
                if active
                    .as_ref()
                    .is_some_and(|attempt| attempt.attempt_id == attempt_id)
                {
                    active.take();
                }
            });
        }
    }
}

fn map_provider_error(error: OAuthProviderError) -> GoogleDriveOAuthError {
    match error {
        OAuthProviderError::InvalidGrant => GoogleDriveOAuthError::ReconnectRequired,
        OAuthProviderError::InvalidResponse => GoogleDriveOAuthError::InvalidResponse,
        OAuthProviderError::Network => GoogleDriveOAuthError::Network,
    }
}

async fn read_callback_target(
    stream: &mut TcpStream,
) -> Result<Zeroizing<String>, GoogleDriveOAuthError> {
    let mut request = Zeroizing::new(Vec::with_capacity(1024));
    let mut chunk = [0_u8; 1024];
    loop {
        let read = timeout(CALLBACK_READ_TIMEOUT, stream.read(&mut chunk))
            .await
            .map_err(|_| GoogleDriveOAuthError::InvalidResponse)?
            .map_err(|_| GoogleDriveOAuthError::InvalidResponse)?;
        if read == 0 {
            return Err(GoogleDriveOAuthError::InvalidResponse);
        }
        request.extend_from_slice(&chunk[..read]);
        if request.len() > MAX_CALLBACK_REQUEST_BYTES {
            return Err(GoogleDriveOAuthError::InvalidResponse);
        }
        if request.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }

    let request =
        std::str::from_utf8(&request).map_err(|_| GoogleDriveOAuthError::InvalidResponse)?;
    let header_end = request
        .find("\r\n\r\n")
        .ok_or(GoogleDriveOAuthError::InvalidResponse)?;
    let headers = &request[..header_end];
    if headers.lines().count() > MAX_CALLBACK_HEADER_LINES
        || headers
            .lines()
            .any(|line| line.len() > MAX_CALLBACK_HEADER_BYTES)
    {
        return Err(GoogleDriveOAuthError::InvalidResponse);
    }
    let request_line = headers
        .lines()
        .next()
        .ok_or(GoogleDriveOAuthError::InvalidResponse)?;
    let mut parts = request_line.split_ascii_whitespace();
    let method = parts.next();
    let target = parts.next();
    let version = parts.next();
    if method != Some("GET")
        || !matches!(version, Some("HTTP/1.0" | "HTTP/1.1"))
        || parts.next().is_some()
    {
        return Err(GoogleDriveOAuthError::InvalidResponse);
    }
    target
        .filter(|target| target.len() <= MAX_CALLBACK_TARGET_BYTES)
        .map(|target| Zeroizing::new(target.to_string()))
        .ok_or(GoogleDriveOAuthError::InvalidResponse)
}

async fn write_callback_response(stream: &mut TcpStream) -> std::io::Result<()> {
    let body = callback_response_html();
    let response = format!(
        "HTTP/1.1 200 OK\r\ncontent-type: text/html; charset=utf-8\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(response.as_bytes()).await?;
    stream.shutdown().await
}

const MAX_CALLBACK_REQUEST_BYTES: usize = 16 * 1024;
const MAX_CALLBACK_HEADER_LINES: usize = 64;
const MAX_CALLBACK_HEADER_BYTES: usize = 4 * 1024;

#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GoogleDriveConnectionState {
    pub(crate) connected: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) folder: Option<GoogleDriveFolderSetting>,
    pub(crate) requires_reconnect: bool,
    pub(crate) requires_public_sharing: bool,
    pub(crate) sharing_check_unavailable: bool,
    pub(crate) credential_store_unavailable: bool,
}

#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GoogleDriveDisconnectResult {
    pub(crate) connection: GoogleDriveConnectionState,
    pub(crate) revocation_unconfirmed: bool,
}

pub(crate) fn access_token_is_reusable(expires_at: Instant, now: Instant) -> bool {
    expires_at
        .checked_duration_since(now)
        .is_some_and(|remaining| remaining > TOKEN_REFRESH_SKEW)
}

#[cfg(test)]
#[path = "../tests/google_drive_oauth_tests.rs"]
mod tests;
