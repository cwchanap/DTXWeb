use super::*;
use crate::api_contracts::DesktopAuthUser;
use crate::google_drive::credential_store::InMemoryGoogleDriveCredentialStore;
use crate::google_drive::settings::GoogleDriveSettingsStore;
use crate::google_drive::{GoogleDriveState, UnavailableDriveMetadataClient};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};
use std::time::Duration;
use tempfile::tempdir;
use wiremock::matchers::{body_json, header, method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

fn logout_env_lock() -> &'static Mutex<()> {
    crate::logout_env_lock()
}

struct LogoutApiUrlGuard {
    previous: Option<std::ffi::OsString>,
}

impl LogoutApiUrlGuard {
    fn replace(value: &str) -> Self {
        let previous = std::env::var_os("VITE_DTX_API_URL");
        std::env::set_var("VITE_DTX_API_URL", value);
        Self { previous }
    }
}

impl Drop for LogoutApiUrlGuard {
    fn drop(&mut self) {
        match self.previous.take() {
            Some(value) => std::env::set_var("VITE_DTX_API_URL", value),
            None => std::env::remove_var("VITE_DTX_API_URL"),
        }
    }
}

struct WebUrlGuard {
    previous: Option<std::ffi::OsString>,
}

impl WebUrlGuard {
    fn replace(value: &str) -> Self {
        let previous = std::env::var_os("VITE_DTX_WEB_URL");
        std::env::set_var("VITE_DTX_WEB_URL", value);
        Self { previous }
    }
}

impl Drop for WebUrlGuard {
    fn drop(&mut self) {
        match self.previous.take() {
            Some(value) => std::env::set_var("VITE_DTX_WEB_URL", value),
            None => std::env::remove_var("VITE_DTX_WEB_URL"),
        }
    }
}

fn device_code_response(user_code: &str, device_code: &str) -> serde_json::Value {
    serde_json::json!({
        "device_code": device_code,
        "user_code": user_code,
        "verification_uri": "https://auth.example.test/device",
        "verification_uri_complete": format!("https://auth.example.test/device?user_code={user_code}"),
        "expires_in": 600,
        "interval": 1
    })
}

fn app_with_auth_state(state: AuthState) -> tauri::App<tauri::test::MockRuntime> {
    let app = tauri::test::mock_app();
    app.manage(state);
    app
}

#[tokio::test]
async fn auth_state_preserves_user_epoch_and_generation_across_session_changes() {
    let state = AuthState::default();
    assert!(state.current_session_epoch().await.is_none());

    state
        .set_current_session(Some(serde_json::json!({
            "sessionToken": "opaque-token-1",
            "user": { "id": "user-1" }
        })))
        .await;
    let first = state.current_session_epoch().await.expect("first epoch");
    assert_eq!(first.user_id(), "user-1");
    assert_eq!(
        state.current_session_token().await.unwrap(),
        "opaque-token-1"
    );

    assert!(state.matches_session_epoch(&first).await);
    state
        .set_current_session(Some(serde_json::json!({
            "sessionToken": "opaque-token-2",
            "user": { "id": "user-2" }
        })))
        .await;
    assert!(!state.matches_session_epoch(&first).await);
    assert_eq!(state.current_user_id().await.as_deref(), Some("user-2"));
}

#[tokio::test]
async fn empty_or_missing_opaque_session_token_is_not_authenticated() {
    let state = AuthState::default();
    state
        .set_current_session(Some(serde_json::json!({
            "sessionToken": "",
            "user": { "id": "user-1" }
        })))
        .await;
    assert!(state.current_session_token().await.is_err());

    state.set_current_session(None).await;
    assert!(state.current_user_id().await.is_none());
}

#[test]
fn session_data_accepts_only_the_better_auth_shape() {
    let session: SessionData = serde_json::from_value(serde_json::json!({
        "sessionToken": "opaque-token",
        "user": {
            "id": "user-1",
            "name": "Drummer",
            "email": "drummer@example.test",
            "emailVerified": true,
            "createdAt": "2026-08-20T00:00:00.000Z",
            "updatedAt": "2026-08-20T00:00:00.000Z"
        }
    }))
    .expect("Better Auth session data");
    assert_eq!(session.session_token.as_deref(), Some("opaque-token"));
    assert_eq!(
        session.user.as_ref().map(|user| user.id.as_str()),
        Some("user-1")
    );

    let legacy: SessionData = serde_json::from_value(serde_json::json!({
        "access_token": "legacy-token",
        "refresh_token": "legacy-refresh",
        "user": { "id": "user-1" }
    }))
    .expect("legacy input remains parseable for safe rejection");
    assert!(legacy.session_token.is_none());
}

#[test]
fn external_url_allowlist_rejects_non_web_schemes() {
    assert!(ensure_allowed_external_url("https://auth.example.test/device").is_ok());
    assert!(ensure_allowed_external_url("http://localhost:5173/device").is_ok());
    assert!(ensure_allowed_external_url("ftp://auth.example.test/device").is_err());
    assert!(ensure_allowed_external_url("file:///tmp/auth").is_err());
}

#[test]
fn typed_auth_session_debug_redacts_opaque_token() {
    let session = DesktopAuthSession {
        session_token: "opaque-token-must-not-print".to_string(),
        user: DesktopAuthUser {
            id: "user-1".to_string(),
            ..Default::default()
        },
    };
    assert!(!format!("{session:?}").contains("opaque-token-must-not-print"));
}

#[tokio::test]
async fn logout_session_signs_out_with_bearer_and_clears_local_state_on_success() {
    let _lock = logout_env_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let server = MockServer::start().await;
    let session_token = "opaque-logout-token";
    let sign_out = Mock::given(method("POST"))
        .and(path("/api/auth/sign-out"))
        .and(header("authorization", format!("Bearer {session_token}")))
        .and(header("origin", server.uri()))
        .and(header("content-type", "application/json"))
        .and(body_json(serde_json::json!({})))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount_as_scoped(&server)
        .await;
    let _api_url = LogoutApiUrlGuard::replace(&server.uri());

    let state = AuthState::default();
    state
        .set_current_session(Some(serde_json::json!({
            "sessionToken": session_token,
            "user": { "id": "logout-user" }
        })))
        .await;
    let app = tauri::test::mock_app();
    app.manage(state.clone());

    assert!(logout_session_impl(app.handle().clone())
        .await
        .expect("logout"));
    assert!(state.current_session().await.is_none());
    drop(sign_out);
}

#[tokio::test]
async fn logout_session_clears_local_state_when_remote_sign_out_fails() {
    let _lock = logout_env_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let server = MockServer::start().await;
    let session_token = "opaque-logout-token";
    let sign_out = Mock::given(method("POST"))
        .and(path("/api/auth/sign-out"))
        .and(header("authorization", format!("Bearer {session_token}")))
        .and(header("origin", server.uri()))
        .and(header("content-type", "application/json"))
        .and(body_json(serde_json::json!({})))
        .respond_with(ResponseTemplate::new(503))
        .expect(1)
        .mount_as_scoped(&server)
        .await;
    let _api_url = LogoutApiUrlGuard::replace(&server.uri());

    let state = AuthState::default();
    state
        .set_current_session(Some(serde_json::json!({
            "sessionToken": session_token,
            "user": { "id": "logout-user" }
        })))
        .await;
    let app = tauri::test::mock_app();
    app.manage(state.clone());

    assert!(logout_session_impl(app.handle().clone())
        .await
        .expect("logout"));
    assert!(state.current_session().await.is_none());
    drop(sign_out);
}

#[tokio::test]
async fn logout_invalidates_native_state_before_delayed_remote_revocation_finishes() {
    let _lock = logout_env_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let server = MockServer::start().await;
    let session_token = "opaque-delayed-logout-token";
    Mock::given(method("POST"))
        .and(path("/api/auth/sign-out"))
        .and(header("authorization", format!("Bearer {session_token}")))
        .and(header("origin", server.uri()))
        .and(header("content-type", "application/json"))
        .and(body_json(serde_json::json!({})))
        .respond_with(ResponseTemplate::new(200).set_delay(Duration::from_millis(150)))
        .expect(1)
        .mount(&server)
        .await;
    let _api_url = LogoutApiUrlGuard::replace(&server.uri());

    let state = AuthState::default();
    state
        .set_current_session(Some(serde_json::json!({
            "sessionToken": session_token,
            "user": { "id": "delayed-logout-user" }
        })))
        .await;
    let initial_attempt_generation = state.pending_device.lock().await.generation;
    let data_dir = tempdir().expect("Drive test data directory");
    let drive = GoogleDriveState::with_adapters(
        Arc::new(InMemoryGoogleDriveCredentialStore::default()),
        Arc::new(UnavailableDriveMetadataClient),
        Arc::new(GoogleDriveSettingsStore::new(data_dir.path().to_path_buf())),
    );
    drive
        .cache_access_token("delayed-logout-user", "cached-drive-token")
        .await;
    let app = tauri::test::mock_app();
    app.manage(state.clone());
    app.manage(drive);

    let logout = tokio::spawn(logout_session_impl(app.handle().clone()));
    for _ in 0..50 {
        if server.received_requests().await.is_some_and(|requests| {
            requests
                .iter()
                .any(|request| request.url.path() == "/api/auth/sign-out")
        }) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(2)).await;
    }

    assert!(state.current_session().await.is_none());
    assert!(state.pending_device.lock().await.generation > initial_attempt_generation);
    assert!(app
        .state::<GoogleDriveState>()
        .cached_access_token("delayed-logout-user")
        .await
        .is_none());
    assert!(logout.await.expect("logout task should join").is_ok());
}

#[tokio::test]
async fn delayed_device_begin_cannot_restore_pending_flow_after_cancel() {
    let _lock = logout_env_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/auth/device/code"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_delay(Duration::from_millis(100))
                .set_body_json(device_code_response("LATE", "late-device-code")),
        )
        .mount(&server)
        .await;
    let _api_url = LogoutApiUrlGuard::replace(&server.uri());

    let state = AuthState::default();
    let app = app_with_auth_state(state.clone());
    let initial_attempt_generation = state.pending_device.lock().await.generation;
    let begin_app = app.handle().clone();
    let begin = tokio::spawn(async move { begin_device_authorization_impl(begin_app).await });
    tokio::time::sleep(Duration::from_millis(10)).await;

    assert!(!cancel_device_authorization_impl(app.handle().clone())
        .await
        .expect("cancel should succeed even when begin is still awaiting"));
    assert!(state.pending_device.lock().await.generation > initial_attempt_generation);
    assert!(begin.await.expect("begin task should join").is_err());
    assert!(state.current_session().await.is_none());
    assert!(state.pending_device.lock().await.pending.is_none());
}

#[tokio::test]
async fn delayed_device_poll_cannot_commit_approval_after_cancel() {
    let _lock = logout_env_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/auth/device/code"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(device_code_response("POLL", "poll-device-code")),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/auth/device/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "access_token": "delayed-approval-token",
            "token_type": "Bearer",
            "expires_in": 3600
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/auth/get-session"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_delay(Duration::from_millis(100))
                .set_body_json(serde_json::json!({
                    "session": {"token": "delayed-approval-token"},
                    "user": {"id": "poll-user"}
                })),
        )
        .mount(&server)
        .await;
    let _api_url = LogoutApiUrlGuard::replace(&server.uri());

    let state = AuthState::default();
    let app = app_with_auth_state(state.clone());
    begin_device_authorization_impl(app.handle().clone())
        .await
        .expect("device begin");
    let poll_app = app.handle().clone();
    let poll = tokio::spawn(async move { poll_device_authorization_impl(poll_app).await });
    tokio::time::sleep(Duration::from_millis(20)).await;

    assert!(!cancel_device_authorization_impl(app.handle().clone())
        .await
        .expect("cancel should invalidate an in-flight poll"));
    assert!(poll.await.expect("poll task should join").is_err());
    assert!(state.current_session().await.is_none());
}

#[tokio::test]
async fn overlapping_begins_keep_only_the_latest_attempt_after_the_first_returns() {
    let _lock = logout_env_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let server = MockServer::start().await;
    let request_number = Arc::new(AtomicUsize::new(0));
    let responder_number = Arc::clone(&request_number);
    Mock::given(method("POST"))
        .and(path("/api/auth/device/code"))
        .respond_with(move |_request: &Request| {
            if responder_number.fetch_add(1, Ordering::SeqCst) == 0 {
                ResponseTemplate::new(200)
                    .set_delay(Duration::from_millis(100))
                    .set_body_json(device_code_response("FIRST", "first-device-code"))
            } else {
                ResponseTemplate::new(200)
                    .set_body_json(device_code_response("SECOND", "second-device-code"))
            }
        })
        .mount(&server)
        .await;
    let _api_url = LogoutApiUrlGuard::replace(&server.uri());

    let state = AuthState::default();
    let app = app_with_auth_state(state.clone());
    let first_app = app.handle().clone();
    let first = tokio::spawn(async move { begin_device_authorization_impl(first_app).await });
    tokio::time::sleep(Duration::from_millis(10)).await;
    let second = begin_device_authorization_impl(app.handle().clone())
        .await
        .expect("second begin");
    let first_result = first.await.expect("first begin task should join");

    assert!(first_result.is_err());
    assert_eq!(second.user_code, "SECOND");
    let pending = state.pending_device.lock().await;
    assert_eq!(
        pending
            .pending
            .as_ref()
            .map(|pending| pending.flow.attempt().user_code.as_str()),
        Some("SECOND")
    );
}

struct DeviceFlowEnv {
    _api_url: LogoutApiUrlGuard,
    _web_url: Option<WebUrlGuard>,
    _lock: std::sync::MutexGuard<'static, ()>,
}

async fn device_flow_app(
    web_url: Option<&str>,
) -> (
    tauri::App<tauri::test::MockRuntime>,
    MockServer,
    DeviceFlowEnv,
) {
    let lock = logout_env_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/auth/device/code"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(device_code_response("FLOW", "flow-device-code")),
        )
        .mount(&server)
        .await;
    let api_url = LogoutApiUrlGuard::replace(&server.uri());
    let web_url_guard = web_url.map(WebUrlGuard::replace);
    let app = app_with_auth_state(AuthState::default());
    (
        app,
        server,
        DeviceFlowEnv {
            _api_url: api_url,
            _web_url: web_url_guard,
            _lock: lock,
        },
    )
}

async fn mount_token_response(server: &MockServer, status: u16, body: serde_json::Value) {
    Mock::given(method("POST"))
        .and(path("/api/auth/device/token"))
        .respond_with(ResponseTemplate::new(status).set_body_json(body))
        .mount(server)
        .await;
}

async fn token_request_count(server: &MockServer) -> usize {
    server
        .received_requests()
        .await
        .unwrap_or_default()
        .into_iter()
        .filter(|request| request.url.path() == "/api/auth/device/token")
        .count()
}

#[tokio::test]
async fn poll_without_a_pending_device_attempt_is_rejected() {
    let state = AuthState::default();
    let app = app_with_auth_state(state);

    let error = poll_device_authorization_impl(app.handle().clone())
        .await
        .expect_err("polling without a pending attempt must fail");
    assert!(error
        .to_string()
        .contains("No device authorization is pending"));
}

#[tokio::test]
async fn poll_maps_oauth_terminal_and_pending_states_to_renderer_results() {
    for (wire_error, assert_terminal) in [
        ("authorization_pending", "pending" as &str),
        ("slow_down", "slow"),
        ("access_denied", "denied"),
        ("expired_token", "expired"),
        ("invalid_grant", "invalid_grant"),
    ] {
        let (app, server, _env) = device_flow_app(None).await;
        mount_token_response(&server, 400, serde_json::json!({ "error": wire_error })).await;
        begin_device_authorization_impl(app.handle().clone())
            .await
            .expect("device begin");

        let poll = poll_device_authorization_impl(app.handle().clone())
            .await
            .expect("mapped poll result");
        match (&poll, assert_terminal) {
            (DeviceAuthorizationPoll::Pending { retry_after_ms }, "pending") => {
                // The fixture advertises interval 1s; the client floors it at
                // DEFAULT_POLL_INTERVAL (5s) so a misbehaving server cannot
                // force faster polling.
                assert_eq!(*retry_after_ms, 5_000);
            }
            (DeviceAuthorizationPoll::Pending { retry_after_ms }, "slow") => {
                assert_eq!(*retry_after_ms, 10_000);
            }
            (DeviceAuthorizationPoll::Denied, "denied") => {}
            (DeviceAuthorizationPoll::Expired, "expired") => {}
            (DeviceAuthorizationPoll::InvalidGrant, "invalid_grant") => {}
            _ => panic!("unexpected poll result {poll:?} for {wire_error}"),
        }
    }
}

#[tokio::test]
async fn polling_before_the_retry_window_elapses_skips_the_network_round_trip() {
    let (app, server, _env) = device_flow_app(None).await;
    mount_token_response(
        &server,
        400,
        serde_json::json!({ "error": "authorization_pending" }),
    )
    .await;
    begin_device_authorization_impl(app.handle().clone())
        .await
        .expect("device begin");

    let first = poll_device_authorization_impl(app.handle().clone())
        .await
        .expect("first poll");
    let second = poll_device_authorization_impl(app.handle().clone())
        .await
        .expect("immediate second poll");

    let DeviceAuthorizationPoll::Pending { retry_after_ms } = second else {
        panic!("expected a pending result, got {second:?}");
    };
    assert!((4_990..=5_000).contains(&retry_after_ms));
    assert!(matches!(
        first,
        DeviceAuthorizationPoll::Pending {
            retry_after_ms: 5_000
        }
    ));
    assert_eq!(token_request_count(&server).await, 1);
}

#[tokio::test]
async fn poll_reports_unmapped_server_failures_as_errors_and_keeps_the_attempt() {
    let (app, server, _env) = device_flow_app(None).await;
    mount_token_response(&server, 500, serde_json::json!({ "error": "internal" })).await;
    begin_device_authorization_impl(app.handle().clone())
        .await
        .expect("device begin");

    let error = poll_device_authorization_impl(app.handle().clone())
        .await
        .expect_err("server failures must surface as errors");
    assert!(error.to_string().contains("status 500"));
    assert!(app
        .state::<AuthState>()
        .pending_device
        .lock()
        .await
        .pending
        .is_some());
}

#[tokio::test]
async fn approved_poll_stores_the_session_and_starts_drive_reconciliation() {
    let (app, server, _env) = device_flow_app(None).await;
    Mock::given(method("POST"))
        .and(path("/api/auth/device/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "access_token": "approved-session-token",
            "token_type": "Bearer",
            "expires_in": 3600
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/auth/get-session"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "session": { "token": "approved-session-token" },
            "user": { "id": "approved-user" }
        })))
        .mount(&server)
        .await;
    let data_dir = tempdir().expect("Drive test data directory");
    let drive = GoogleDriveState::with_adapters(
        Arc::new(InMemoryGoogleDriveCredentialStore::default()),
        Arc::new(UnavailableDriveMetadataClient),
        Arc::new(GoogleDriveSettingsStore::new(data_dir.path().to_path_buf())),
    );
    app.manage(drive);

    begin_device_authorization_impl(app.handle().clone())
        .await
        .expect("device begin");
    let poll = poll_device_authorization_impl(app.handle().clone())
        .await
        .expect("approval poll");

    let DeviceAuthorizationPoll::Approved { session } = poll else {
        panic!("expected approval, got {poll:?}");
    };
    assert_eq!(session.user.id, "approved-user");
    assert_eq!(
        app.state::<AuthState>()
            .current_session_token()
            .await
            .unwrap(),
        "approved-session-token"
    );
}

#[tokio::test]
async fn device_attempt_generation_helpers_replace_only_the_current_attempt() {
    let (app, _server, _env) = device_flow_app(None).await;
    let state = app.state::<AuthState>();
    begin_device_authorization_impl(app.handle().clone())
        .await
        .expect("device begin");
    let (generation, attempt) = state
        .take_device_attempt()
        .await
        .expect("pending attempt after begin");

    assert!(state.is_current_device_attempt(generation).await);
    assert!(
        !state
            .replace_device_attempt_if_current(generation + 7, attempt)
            .await
    );
    assert!(!state.is_current_device_attempt(generation + 7).await);
}

#[tokio::test]
async fn current_session_epoch_is_none_for_a_blank_user_id() {
    let state = AuthState::default();
    state
        .set_current_session(Some(serde_json::json!({
            "sessionToken": "opaque-token",
            "user": { "id": "   " }
        })))
        .await;

    assert!(state.current_session_epoch().await.is_none());
}

#[tokio::test]
async fn begin_honors_the_configured_web_origin_and_rejects_invalid_values() {
    let (app, _server, _env) = device_flow_app(Some("https://web.example.test")).await;

    let attempt = begin_device_authorization_impl(app.handle().clone())
        .await
        .expect("begin with an explicit trusted web origin");
    assert_eq!(attempt.user_code, "FLOW");

    let invalid_web_url = WebUrlGuard::replace("not-a-url");
    let error = begin_device_authorization_impl(app.handle().clone())
        .await
        .expect_err("an invalid web origin must fail configuration");
    assert!(error.to_string().contains("VITE_DTX_WEB_URL is invalid"));
    drop(invalid_web_url);

    let blank_api_url = LogoutApiUrlGuard::replace("");
    let error = begin_device_authorization_impl(app.handle().clone())
        .await
        .expect_err("a missing API URL must report the feature as not configured");
    assert!(error
        .to_string()
        .contains("Device authorization is not configured"));
    drop(blank_api_url);
}

#[cfg(not(all(feature = "e2e", debug_assertions)))]
fn session_data(token: Option<&str>, user_id: Option<&str>) -> SessionData {
    SessionData {
        session_token: token.map(str::to_string),
        user: user_id.map(|id| DesktopAuthUser {
            id: id.to_string(),
            ..Default::default()
        }),
    }
}

#[cfg(not(all(feature = "e2e", debug_assertions)))]
#[tokio::test]
async fn validate_session_reports_not_configured_without_an_api_url() {
    let _lock = logout_env_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _api_url = LogoutApiUrlGuard::replace("");
    let state = AuthState::default();
    let app = app_with_auth_state(state);

    let status = validate_session_impl(app.handle().clone(), session_data(Some("tok"), Some("u")))
        .await
        .expect("validation status");
    assert_eq!(status, SessionValidationStatus::NotConfigured);
}

#[cfg(not(all(feature = "e2e", debug_assertions)))]
#[tokio::test]
async fn validate_session_clears_local_state_for_missing_token_user_or_server_rejection() {
    let _lock = logout_env_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/auth/get-session"))
        .respond_with(ResponseTemplate::new(401))
        .mount(&server)
        .await;
    let _api_url = LogoutApiUrlGuard::replace(&server.uri());
    let state = AuthState::default();
    state
        .set_current_session(Some(serde_json::json!({
            "sessionToken": "stale-token",
            "user": { "id": "stale-user" }
        })))
        .await;
    let app = app_with_auth_state(state.clone());

    for data in [
        session_data(Some("   "), Some("stale-user")),
        session_data(Some("tok"), None),
        session_data(Some("tok"), Some("other-user")),
    ] {
        let status = validate_session_impl(app.handle().clone(), data)
            .await
            .expect("validation status");
        assert_eq!(status, SessionValidationStatus::Invalid);
        assert!(state.current_session().await.is_none());
        state
            .set_current_session(Some(serde_json::json!({
                "sessionToken": "stale-token",
                "user": { "id": "stale-user" }
            })))
            .await;
    }
}

#[cfg(not(all(feature = "e2e", debug_assertions)))]
#[tokio::test]
async fn validate_session_accepts_a_matching_remote_user_and_stores_the_session() {
    let _lock = logout_env_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/auth/get-session"))
        .and(header("authorization", "Bearer opaque-restore-token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "session": { "token": "opaque-restore-token" },
            "user": { "id": "restore-user" }
        })))
        .mount(&server)
        .await;
    let _api_url = LogoutApiUrlGuard::replace(&server.uri());
    let state = AuthState::default();
    let app = app_with_auth_state(state.clone());

    let status = validate_session_impl(
        app.handle().clone(),
        session_data(Some("opaque-restore-token"), Some("restore-user")),
    )
    .await
    .expect("validation status");

    assert_eq!(status, SessionValidationStatus::Valid);
    assert_eq!(
        state.current_session_token().await.unwrap(),
        "opaque-restore-token"
    );
}

#[cfg(not(all(feature = "e2e", debug_assertions)))]
#[tokio::test]
async fn validate_session_keeps_the_stored_session_when_verification_fails() {
    let _lock = logout_env_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let server = MockServer::start().await;
    // A server failure means verification did not complete: the renderer must
    // be told to retry later instead of silently signing the user out.
    Mock::given(method("GET"))
        .and(path("/api/auth/get-session"))
        .respond_with(ResponseTemplate::new(500).set_body_json(serde_json::json!({
            "error": "backend unavailable"
        })))
        .mount(&server)
        .await;
    let _api_url = LogoutApiUrlGuard::replace(&server.uri());
    let state = AuthState::default();
    state
        .set_current_session(Some(serde_json::json!({
            "sessionToken": "still-valid-locally",
            "user": { "id": "restore-user" }
        })))
        .await;
    let app = app_with_auth_state(state.clone());

    let status = validate_session_impl(
        app.handle().clone(),
        session_data(Some("still-valid-locally"), Some("restore-user")),
    )
    .await
    .expect("validation status");

    assert_eq!(status, SessionValidationStatus::RetryLater);
    assert_eq!(
        state.current_session_token().await.unwrap(),
        "still-valid-locally"
    );
}

#[test]
fn open_external_url_rejects_non_web_schemes_before_touching_the_opener() {
    let app = tauri::test::mock_app();
    let error = open_external_url_impl(app.handle(), "file:///tmp/auth")
        .expect_err("non-web schemes must be rejected");
    assert!(error
        .to_string()
        .contains("Only http and https URLs can be opened externally"));
}

#[cfg(all(feature = "e2e", debug_assertions))]
#[test]
fn e2e_validation_requires_expected_user_and_one_opaque_session_token() {
    let matching = SessionData {
        session_token: Some("e2e-session".to_string()),
        user: Some(DesktopAuthUser {
            id: "fixed-e2e-user".to_string(),
            ..Default::default()
        }),
    };
    assert!(e2e_session_matches_user(&matching, "fixed-e2e-user"));

    let missing_token = SessionData {
        session_token: None,
        user: matching.user.clone(),
    };
    assert!(!e2e_session_matches_user(&missing_token, "fixed-e2e-user"));
}

#[tokio::test]
async fn drive_metadata_wrappers_require_configuration_and_authentication() {
    use crate::api::{fetch_owner_drive_simfile, update_drive_file};
    use crate::google_drive::DriveMetadataError;

    let _lock = logout_env_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let server = MockServer::start().await;
    let state = AuthState::default();
    let app = app_with_auth_state(state.clone());
    let handle = app.handle().clone();

    let blank_api_url = LogoutApiUrlGuard::replace("");
    assert_eq!(
        fetch_owner_drive_simfile(&state, &handle, "42")
            .await
            .expect_err("missing configuration"),
        DriveMetadataError::LocalState
    );
    assert_eq!(
        update_drive_file(
            &state,
            &handle,
            "42",
            "drive-file-42",
            "https://drive.example.test/uc?id=drive-file-42",
            None,
        )
        .await
        .expect_err("missing configuration"),
        DriveMetadataError::LocalState
    );
    drop(blank_api_url);

    let _api_url = LogoutApiUrlGuard::replace(&server.uri());
    assert_eq!(
        fetch_owner_drive_simfile(&state, &handle, "42")
            .await
            .expect_err("unauthenticated"),
        DriveMetadataError::Authentication
    );
    assert_eq!(
        update_drive_file(
            &state,
            &handle,
            "42",
            "drive-file-42",
            "https://drive.example.test/uc?id=drive-file-42",
            None,
        )
        .await
        .expect_err("unauthenticated"),
        DriveMetadataError::Authentication
    );
    assert!(server
        .received_requests()
        .await
        .is_some_and(|requests| requests.is_empty()));
}

#[tokio::test]
async fn drive_metadata_wrappers_pass_the_session_to_the_graphql_service() {
    use crate::api::{fetch_owner_drive_simfile, update_drive_file};
    use crate::google_drive::DriveMetadataError;

    let _lock = logout_env_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let state = AuthState::default();
    state
        .set_current_session(Some(serde_json::json!({
            "sessionToken": "wrapper-session-token",
            "user": { "id": "wrapper-user" }
        })))
        .await;
    let app = app_with_auth_state(state.clone());
    let handle = app.handle().clone();

    let fetch_server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .and(header("authorization", "Bearer wrapper-session-token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": { "simfile": {
                "id": "42",
                "title": "Song",
                "userId": "wrapper-user",
                "googleDriveFileId": "drive-file-42",
                "downloadUrl": "https://drive.example.test/uc?id=drive-file-42"
            }}
        })))
        .mount(&fetch_server)
        .await;
    let fetch_env = LogoutApiUrlGuard::replace(&fetch_server.uri());
    let fetched = fetch_owner_drive_simfile(&state, &handle, "42")
        .await
        .expect("authenticated fetch");
    assert_eq!(fetched.id, "42");
    drop(fetch_env);

    let update_server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": { "updateSimfileDriveFileGuarded": {
                "id": "42",
                "title": "Song",
                "userId": "wrapper-user",
                "googleDriveFileId": "drive-file-42",
                "downloadUrl": "https://drive.example.test/uc?id=drive-file-42"
            }}
        })))
        .mount(&update_server)
        .await;
    let update_env = LogoutApiUrlGuard::replace(&update_server.uri());
    let updated = update_drive_file(
        &state,
        &handle,
        "42",
        "drive-file-42",
        "https://drive.example.test/uc?id=drive-file-42",
        None,
    )
    .await
    .expect("authenticated update");
    assert_eq!(
        updated.google_drive_file_id.as_deref(),
        Some("drive-file-42")
    );
    drop(update_env);

    let invalid_server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": { "unexpected": null }
        })))
        .mount(&invalid_server)
        .await;
    let invalid_env = LogoutApiUrlGuard::replace(&invalid_server.uri());
    assert_eq!(
        update_drive_file(
            &state,
            &handle,
            "42",
            "drive-file-42",
            "https://drive.example.test/uc?id=drive-file-42",
            None,
        )
        .await
        .expect_err("responses without the guarded mutation are invalid"),
        DriveMetadataError::InvalidResponse
    );
    drop(invalid_env);
}

#[cfg(not(all(feature = "e2e", debug_assertions)))]
#[tokio::test]
async fn validate_session_treats_unusable_api_configuration_as_not_configured_or_invalid() {
    let _lock = logout_env_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let state = AuthState::default();
    let app = app_with_auth_state(state);

    let slash_only = LogoutApiUrlGuard::replace("  /  ");
    let status = validate_session_impl(app.handle().clone(), session_data(Some("t"), Some("u")))
        .await
        .expect("validation status");
    assert_eq!(status, SessionValidationStatus::NotConfigured);
    drop(slash_only);

    let unsupported_scheme = LogoutApiUrlGuard::replace("ftp://example.test");
    let status = validate_session_impl(app.handle().clone(), session_data(Some("t"), Some("u")))
        .await
        .expect("validation status");
    assert_eq!(status, SessionValidationStatus::Invalid);
    drop(unsupported_scheme);
}
