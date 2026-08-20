use super::*;
use crate::api_contracts::DesktopAuthUser;
use crate::google_drive::credential_store::InMemoryGoogleDriveCredentialStore;
use crate::google_drive::settings::GoogleDriveSettingsStore;
use crate::google_drive::{GoogleDriveState, UnavailableDriveMetadataClient};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex, OnceLock,
};
use std::time::Duration;
use tempfile::tempdir;
use wiremock::matchers::{body_json, header, method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

fn logout_env_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
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
