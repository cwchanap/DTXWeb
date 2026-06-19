#[cfg(test)]
async fn auth_event_from_url(raw_url: &str) -> Option<AuthEvent> {
    let state = AuthState::default();
    auth_event_from_url_with_state(&state, raw_url).await
}

use super::*;
use std::sync::{Mutex, OnceLock};

/// Singleton mutex serializing tests that mutate process-global env vars
/// (DTX_DESKTOP_AUTH_CALLBACK_PORT). Without this, parallel test runs race:
/// one test's `set_var` is visible to another test's `remove_var`, producing
/// flaky failures. Each env-mutating test acquires this lock for its full
/// duration.
fn auth_env_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

#[test]
fn extracts_magic_link_from_dtx_auth_callback() {
    let parsed =
        parse_auth_callback("dtx://auth-callback?magic_link=https%3A%2F%2Fexample.com%2Fmagic")
            .expect("parsed");

    assert_eq!(
        parsed.magic_link.as_deref(),
        Some("https://example.com/magic")
    );
}

#[test]
fn extracts_magic_link_from_localhost_auth_callback() {
    let parsed = parse_auth_callback(
        "http://127.0.0.1:47931/auth-callback?magic_link=https%3A%2F%2Fexample.com%2Fmagic",
    )
    .expect("parsed");

    assert_eq!(
        parsed.magic_link.as_deref(),
        Some("https://example.com/magic")
    );
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

    let AuthEvent::MagicLinkResult(result) = event;

    assert!(!result.success);
    assert_eq!(
        result.error.as_deref(),
        Some("Magic link verification is not configured")
    );
}

#[tokio::test]
async fn callback_without_magic_link_produces_no_event() {
    // Legacy token-only callbacks are intentionally ignored: only the
    // magic_link flow is supported, and raw tokens must never be accepted
    // from a deep link without server-side verification.
    let event = auth_event_from_url("dtx://auth-callback?access_token=tok&refresh_token=b").await;

    assert!(event.is_none());
}

#[tokio::test]
async fn read_auth_request_line_handles_request_lines_longer_than_4kb() {
    use tokio::io::AsyncWriteExt;
    use tokio::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("addr");

    // An ~8 KB magic_link query value that would overflow a single 4 KB read.
    let long_value = "x".repeat(8 * 1024);
    let request = format!("GET /auth-callback?magic_link={long_value} HTTP/1.1\r\n\r\n");
    let request_bytes = request.into_bytes();

    let writer = tokio::spawn(async move {
        let mut stream = tokio::net::TcpStream::connect(addr).await.expect("connect");
        stream.write_all(&request_bytes).await.expect("write");
        stream
    });

    let (mut stream, _) = listener.accept().await.expect("accept");
    let line = read_auth_request_line(&mut stream)
        .await
        .expect("read")
        .expect("request line");

    let _ = writer.await;
    assert!(line.starts_with("GET /auth-callback?magic_link="));
    assert!(line.contains(&"x".repeat(8 * 1024)));
    assert!(line.len() > 4096);
}

#[test]
fn builds_session_from_top_level_verify_response_tokens() {
    let response = serde_json::json!({
        "access_token": "access",
        "refresh_token": "refresh",
        "user": { "id": "user-1" }
    });

    let result = magic_link_result_from_verify_response(response).expect("magic link result");

    assert!(result.success);
    assert_eq!(
        result.session.as_ref().expect("session")["access_token"],
        "access"
    );
    assert_eq!(
        result.session.as_ref().expect("session")["refresh_token"],
        "refresh"
    );
    assert_eq!(result.user.as_ref().expect("user")["id"], "user-1");
}

#[test]
fn builds_session_from_nested_verify_response_session() {
    let response = serde_json::json!({
        "session": {
            "access_token": "access",
            "refresh_token": "refresh",
            "user": { "id": "user-1" }
        },
        "user": { "id": "user-1" }
    });

    let result = magic_link_result_from_verify_response(response).expect("magic link result");

    assert!(result.success);
    assert_eq!(
        result.session.as_ref().expect("session")["access_token"],
        "access"
    );
    assert_eq!(result.user.as_ref().expect("user")["id"], "user-1");
}

#[tokio::test]
async fn verify_magic_link_posts_token_hash_and_stores_session() {
    let server = wiremock::MockServer::start().await;
    wiremock::Mock::given(wiremock::matchers::method("POST"))
        .and(wiremock::matchers::path("/auth/v1/verify"))
        .and(wiremock::matchers::header("apikey", "anon"))
        .and(wiremock::matchers::header("authorization", "Bearer anon"))
        .and(wiremock::matchers::body_json(serde_json::json!({
            "token_hash": "hash-1",
            "type": "magiclink"
        })))
        .respond_with(
            wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "access_token": "access",
                "refresh_token": "refresh",
                "user": { "id": "user-1" }
            })),
        )
        .mount(&server)
        .await;
    let state = AuthState::default();

    let result = verify_magic_link_with_client(
        reqwest::Client::new(),
        &state,
        &server.uri(),
        "anon",
        "https://example.com/auth?token_hash=hash-1",
    )
    .await;

    assert!(result.success);
    assert_eq!(
        state.current_session().await.expect("stored session")["access_token"],
        "access"
    );
}

#[tokio::test]
async fn verify_magic_link_failure_is_sanitized_and_does_not_store_session() {
    let server = wiremock::MockServer::start().await;
    wiremock::Mock::given(wiremock::matchers::method("POST"))
        .and(wiremock::matchers::path("/auth/v1/verify"))
        .respond_with(
            wiremock::ResponseTemplate::new(400).set_body_json(serde_json::json!({
                "error_description": "Token has expired"
            })),
        )
        .mount(&server)
        .await;
    let state = AuthState::default();

    let result = verify_magic_link_with_client(
        reqwest::Client::new(),
        &state,
        &server.uri(),
        "anon",
        "https://example.com/auth?token_hash=secret-token",
    )
    .await;

    assert!(!result.success);
    assert_eq!(result.error.as_deref(), Some("Token has expired"));
    assert!(!result.error.unwrap_or_default().contains("secret-token"));
    assert!(state.current_session().await.is_none());
}

#[tokio::test]
async fn validate_session_rejects_invalid_supabase_user_response() {
    let server = wiremock::MockServer::start().await;
    wiremock::Mock::given(wiremock::matchers::method("GET"))
        .and(wiremock::matchers::path("/auth/v1/user"))
        .respond_with(
            wiremock::ResponseTemplate::new(401).set_body_json(serde_json::json!({
                "message": "invalid token"
            })),
        )
        .mount(&server)
        .await;
    let state = AuthState::default();
    let session_data = SessionData {
        access_token: Some("stale-access".to_string()),
        refresh_token: Some("refresh".to_string()),
        user: None,
    };

    let is_valid = validate_session_with_client(
        reqwest::Client::new(),
        &state,
        &server.uri(),
        "anon",
        session_data,
    )
    .await;

    assert!(!is_valid);
    assert!(state.current_session().await.is_none());
}

#[tokio::test]
async fn validate_session_stores_user_from_supabase_user_response() {
    let server = wiremock::MockServer::start().await;
    wiremock::Mock::given(wiremock::matchers::method("GET"))
        .and(wiremock::matchers::path("/auth/v1/user"))
        .and(wiremock::matchers::header("apikey", "anon"))
        .and(wiremock::matchers::header("authorization", "Bearer access"))
        .respond_with(
            wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "id": "user-1",
                "email": "user@example.com"
            })),
        )
        .mount(&server)
        .await;
    let state = AuthState::default();
    let session_data = SessionData {
        access_token: Some("access".to_string()),
        refresh_token: Some("refresh".to_string()),
        user: None,
    };

    let is_valid = validate_session_with_client(
        reqwest::Client::new(),
        &state,
        &server.uri(),
        "anon",
        session_data,
    )
    .await;

    assert!(is_valid);
    let session = state.current_session().await.expect("stored session");
    assert_eq!(session["access_token"], "access");
    assert_eq!(session["user"]["id"], "user-1");
}

#[tokio::test]
async fn validate_session_refreshes_expired_access_token() {
    let server = wiremock::MockServer::start().await;
    wiremock::Mock::given(wiremock::matchers::method("GET"))
        .and(wiremock::matchers::path("/auth/v1/user"))
        .respond_with(
            wiremock::ResponseTemplate::new(401).set_body_json(serde_json::json!({
                "message": "expired token"
            })),
        )
        .mount(&server)
        .await;
    wiremock::Mock::given(wiremock::matchers::method("POST"))
        .and(wiremock::matchers::path("/auth/v1/token"))
        .and(wiremock::matchers::query_param(
            "grant_type",
            "refresh_token",
        ))
        .and(wiremock::matchers::header("apikey", "anon"))
        .and(wiremock::matchers::header("authorization", "Bearer anon"))
        .and(wiremock::matchers::body_json(serde_json::json!({
            "refresh_token": "refresh-old"
        })))
        .respond_with(
            wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "access_token": "access-new",
                "refresh_token": "refresh-new",
                "user": { "id": "user-1", "email": "user@example.com" }
            })),
        )
        .mount(&server)
        .await;
    let state = AuthState::default();
    let session_data = SessionData {
        access_token: Some("access-old".to_string()),
        refresh_token: Some("refresh-old".to_string()),
        user: None,
    };

    let is_valid = validate_session_with_client(
        reqwest::Client::new(),
        &state,
        &server.uri(),
        "anon",
        session_data,
    )
    .await;

    assert!(is_valid);
    let session = state.current_session().await.expect("stored session");
    assert_eq!(session["access_token"], "access-new");
    assert_eq!(session["refresh_token"], "refresh-new");
    assert_eq!(session["user"]["id"], "user-1");
}

#[test]
fn external_url_validation_allows_only_http_and_https() {
    assert!(ensure_allowed_external_url("https://example.com/login").is_ok());
    assert!(ensure_allowed_external_url("http://localhost:5173/login").is_ok());
    assert!(ensure_allowed_external_url("file:///etc/passwd").is_err());
    assert!(ensure_allowed_external_url("dtx://auth-callback").is_err());
}

#[test]
fn pending_urls_are_queued_and_drained_synchronously() {
    let state = AuthState::default();

    state.push_pending_url("dtx://auth-callback?access_token=a&refresh_token=b".to_string());

    assert_eq!(
        state.drain_pending_urls(),
        vec!["dtx://auth-callback?access_token=a&refresh_token=b".to_string()]
    );
    assert!(state.drain_pending_urls().is_empty());
}

#[test]
fn local_auth_callback_success_page_uses_app_layout_copy() {
    let body = local_auth_callback_success_html();

    assert!(body.contains("<!doctype html>"));
    assert!(body.contains("Return to Drumery"));
    assert!(body.contains("Your desktop session has been updated."));
    assert!(
        body.contains("You can close this browser tab and continue in the Drumery desktop app.")
    );
    assert!(body.contains("app-shell"));
}

#[test]
fn supabase_auth_url_builds_url_from_base_and_path() {
    assert_eq!(
        supabase_auth_url("https://example.supabase.co", "verify"),
        "https://example.supabase.co/auth/v1/verify"
    );
}

#[test]
fn supabase_auth_url_strips_trailing_slash_from_base() {
    assert_eq!(
        supabase_auth_url("https://example.supabase.co/", "verify"),
        "https://example.supabase.co/auth/v1/verify"
    );
}

#[test]
fn supabase_auth_url_strips_leading_slash_from_path() {
    assert_eq!(
        supabase_auth_url("https://example.supabase.co", "/verify"),
        "https://example.supabase.co/auth/v1/verify"
    );
}

#[test]
fn auth_error_extracts_error_description_field() {
    let body = serde_json::json!({ "error_description": "desc" });
    assert_eq!(auth_error_from_response_body(&body, "fallback"), "desc");
}

#[test]
fn auth_error_falls_back_to_message_field() {
    let body = serde_json::json!({ "message": "msg" });
    assert_eq!(auth_error_from_response_body(&body, "fallback"), "msg");
}

#[test]
fn auth_error_falls_back_to_msg_field() {
    let body = serde_json::json!({ "msg": "custom msg" });
    assert_eq!(
        auth_error_from_response_body(&body, "fallback"),
        "custom msg"
    );
}

#[test]
fn auth_error_falls_back_to_error_field() {
    let body = serde_json::json!({ "error": "err" });
    assert_eq!(auth_error_from_response_body(&body, "fallback"), "err");
}

#[test]
fn auth_error_uses_fallback_when_no_known_field_present() {
    let body = serde_json::json!({ "code": 500 });
    assert_eq!(auth_error_from_response_body(&body, "fallback"), "fallback");
}

#[test]
fn non_empty_token_returns_none_for_none() {
    assert_eq!(non_empty_token(None), None);
}

#[test]
fn non_empty_token_returns_none_for_empty_string() {
    assert_eq!(non_empty_token(Some("".to_string())), None);
}

#[test]
fn non_empty_token_returns_none_for_whitespace_only() {
    assert_eq!(non_empty_token(Some("  ".to_string())), None);
}

#[test]
fn non_empty_token_returns_trimmed_token() {
    assert_eq!(
        non_empty_token(Some("token123".to_string())),
        Some("token123".to_string())
    );
}

#[test]
fn is_auth_callback_url_accepts_dtx_scheme_with_auth_callback_host() {
    let url = Url::parse("dtx://auth-callback?magic_link=x").unwrap();
    assert!(is_auth_callback_url(&url));
}

#[test]
fn is_auth_callback_url_rejects_dtx_scheme_with_other_host() {
    let url = Url::parse("dtx://other?magic_link=x").unwrap();
    assert!(!is_auth_callback_url(&url));
}

#[test]
fn is_auth_callback_url_accepts_http_loopback_with_callback_path() {
    let url = Url::parse("http://127.0.0.1/auth-callback").unwrap();
    assert!(is_auth_callback_url(&url));
}

#[test]
fn is_auth_callback_url_rejects_http_loopback_with_wrong_path() {
    let url = Url::parse("http://127.0.0.1/other").unwrap();
    assert!(!is_auth_callback_url(&url));
}

#[test]
fn is_auth_callback_url_rejects_http_non_loopback_host() {
    let url = Url::parse("http://example.com/auth-callback").unwrap();
    assert!(!is_auth_callback_url(&url));
}

#[test]
fn is_auth_callback_url_rejects_https_scheme() {
    let url = Url::parse("https://127.0.0.1/auth-callback").unwrap();
    assert!(!is_auth_callback_url(&url));
}

#[test]
fn is_auth_callback_url_accepts_localhost_host() {
    let url = Url::parse("http://localhost/auth-callback").unwrap();
    assert!(is_auth_callback_url(&url));
}

#[tokio::test]
async fn verify_magic_link_rejects_invalid_url() {
    let state = AuthState::default();

    let result = verify_magic_link_with_client(
        reqwest::Client::new(),
        &state,
        "https://example.supabase.co",
        "anon",
        "not a url",
    )
    .await;

    assert!(!result.success);
    assert_eq!(result.error.as_deref(), Some("Invalid magic link"));
    assert!(state.current_session().await.is_none());
}

#[tokio::test]
async fn verify_magic_link_rejects_url_without_token() {
    let state = AuthState::default();

    let result = verify_magic_link_with_client(
        reqwest::Client::new(),
        &state,
        "https://example.supabase.co",
        "anon",
        "https://example.com/auth",
    )
    .await;

    assert!(!result.success);
    assert_eq!(
        result.error.as_deref(),
        Some("No token found in magic link")
    );
    assert!(state.current_session().await.is_none());
}

#[tokio::test]
async fn verify_magic_link_falls_back_to_token_query_param() {
    let server = wiremock::MockServer::start().await;
    wiremock::Mock::given(wiremock::matchers::method("POST"))
        .and(wiremock::matchers::path("/auth/v1/verify"))
        .and(wiremock::matchers::body_json(serde_json::json!({
            "token_hash": "xyz",
            "type": "magiclink"
        })))
        .respond_with(
            wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "access_token": "access",
                "refresh_token": "refresh",
            })),
        )
        .mount(&server)
        .await;
    let state = AuthState::default();

    let result = verify_magic_link_with_client(
        reqwest::Client::new(),
        &state,
        &server.uri(),
        "anon",
        "https://example.com/auth?token=xyz",
    )
    .await;

    assert!(result.success);
    assert_eq!(
        state.current_session().await.expect("stored session")["access_token"],
        "access"
    );
}

#[tokio::test]
async fn verify_magic_link_fails_on_network_error() {
    let state = AuthState::default();

    let result = verify_magic_link_with_client(
        reqwest::Client::new(),
        &state,
        "http://127.0.0.1:1",
        "anon",
        "https://example.com/auth?token_hash=hash-1",
    )
    .await;

    assert!(!result.success);
    assert!(state.current_session().await.is_none());
}

#[tokio::test]
async fn verify_magic_link_fails_on_invalid_json_response() {
    let server = wiremock::MockServer::start().await;
    wiremock::Mock::given(wiremock::matchers::method("POST"))
        .and(wiremock::matchers::path("/auth/v1/verify"))
        .respond_with(
            wiremock::ResponseTemplate::new(200)
                .set_body_raw(b"not json".to_vec(), "application/json"),
        )
        .mount(&server)
        .await;
    let state = AuthState::default();

    let result = verify_magic_link_with_client(
        reqwest::Client::new(),
        &state,
        &server.uri(),
        "anon",
        "https://example.com/auth?token_hash=hash-1",
    )
    .await;

    assert!(!result.success);
    assert!(state.current_session().await.is_none());
}

#[tokio::test]
async fn validate_session_rejects_session_data_without_tokens() {
    let state = AuthState::default();
    let session_data = SessionData {
        access_token: None,
        refresh_token: None,
        user: None,
    };

    let is_valid = validate_session_with_client(
        reqwest::Client::new(),
        &state,
        "https://example.supabase.co",
        "anon",
        session_data,
    )
    .await;

    assert!(!is_valid);
    assert!(state.current_session().await.is_none());
}

#[tokio::test]
async fn validate_session_fails_on_network_error() {
    let state = AuthState::default();
    let session_data = SessionData {
        access_token: Some("access".to_string()),
        refresh_token: Some("refresh".to_string()),
        user: None,
    };

    let is_valid = validate_session_with_client(
        reqwest::Client::new(),
        &state,
        "http://127.0.0.1:1",
        "anon",
        session_data,
    )
    .await;

    assert!(!is_valid);
    assert!(state.current_session().await.is_none());
}

#[tokio::test]
async fn validate_session_fails_on_invalid_json_response() {
    let server = wiremock::MockServer::start().await;
    wiremock::Mock::given(wiremock::matchers::method("GET"))
        .and(wiremock::matchers::path("/auth/v1/user"))
        .respond_with(
            wiremock::ResponseTemplate::new(200)
                .set_body_raw(b"not json".to_vec(), "application/json"),
        )
        .mount(&server)
        .await;
    let state = AuthState::default();
    let session_data = SessionData {
        access_token: Some("access".to_string()),
        refresh_token: Some("refresh".to_string()),
        user: None,
    };

    let is_valid = validate_session_with_client(
        reqwest::Client::new(),
        &state,
        &server.uri(),
        "anon",
        session_data,
    )
    .await;

    assert!(!is_valid);
    assert!(state.current_session().await.is_none());
}

#[tokio::test]
async fn validate_session_rejects_user_response_without_id() {
    let server = wiremock::MockServer::start().await;
    wiremock::Mock::given(wiremock::matchers::method("GET"))
        .and(wiremock::matchers::path("/auth/v1/user"))
        .respond_with(
            wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "email": "x@example.com"
            })),
        )
        .mount(&server)
        .await;
    let state = AuthState::default();
    let session_data = SessionData {
        access_token: Some("access".to_string()),
        refresh_token: Some("refresh".to_string()),
        user: None,
    };

    let is_valid = validate_session_with_client(
        reqwest::Client::new(),
        &state,
        &server.uri(),
        "anon",
        session_data,
    )
    .await;

    assert!(!is_valid);
    assert!(state.current_session().await.is_none());
}

#[tokio::test]
async fn refresh_session_rejects_empty_refresh_token() {
    let state = AuthState::default();

    let is_valid = refresh_session_with_client(
        &reqwest::Client::new(),
        &state,
        "https://example.supabase.co",
        "anon",
        None,
    )
    .await;

    assert!(!is_valid);
    assert!(state.current_session().await.is_none());
}

#[tokio::test]
async fn refresh_session_fails_on_network_error() {
    let state = AuthState::default();

    let is_valid = refresh_session_with_client(
        &reqwest::Client::new(),
        &state,
        "http://127.0.0.1:1",
        "anon",
        Some("refresh-old".to_string()),
    )
    .await;

    assert!(!is_valid);
    assert!(state.current_session().await.is_none());
}

#[tokio::test]
async fn refresh_session_fails_on_non_success_status() {
    let server = wiremock::MockServer::start().await;
    wiremock::Mock::given(wiremock::matchers::method("POST"))
        .and(wiremock::matchers::path("/auth/v1/token"))
        .respond_with(
            wiremock::ResponseTemplate::new(401).set_body_json(serde_json::json!({
                "message": "invalid refresh token"
            })),
        )
        .mount(&server)
        .await;
    let state = AuthState::default();

    let is_valid = refresh_session_with_client(
        &reqwest::Client::new(),
        &state,
        &server.uri(),
        "anon",
        Some("refresh-old".to_string()),
    )
    .await;

    assert!(!is_valid);
    assert!(state.current_session().await.is_none());
}

#[tokio::test]
async fn refresh_session_fails_on_invalid_json_response() {
    let server = wiremock::MockServer::start().await;
    wiremock::Mock::given(wiremock::matchers::method("POST"))
        .and(wiremock::matchers::path("/auth/v1/token"))
        .respond_with(
            wiremock::ResponseTemplate::new(200)
                .set_body_raw(b"not json".to_vec(), "application/json"),
        )
        .mount(&server)
        .await;
    let state = AuthState::default();

    let is_valid = refresh_session_with_client(
        &reqwest::Client::new(),
        &state,
        &server.uri(),
        "anon",
        Some("refresh-old".to_string()),
    )
    .await;

    assert!(!is_valid);
    assert!(state.current_session().await.is_none());
}

#[tokio::test]
async fn refresh_session_fails_when_response_has_no_tokens() {
    let server = wiremock::MockServer::start().await;
    wiremock::Mock::given(wiremock::matchers::method("POST"))
        .and(wiremock::matchers::path("/auth/v1/token"))
        .respond_with(wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
        .mount(&server)
        .await;
    let state = AuthState::default();

    let is_valid = refresh_session_with_client(
        &reqwest::Client::new(),
        &state,
        &server.uri(),
        "anon",
        Some("refresh-old".to_string()),
    )
    .await;

    assert!(!is_valid);
    assert!(state.current_session().await.is_none());
}

#[test]
fn parse_auth_callback_returns_none_for_malformed_url() {
    // `url::Url::parse` rejects spaces and stray scheme separators, so a
    // garbage request line cannot leak through as a partial AuthCallback.
    assert!(parse_auth_callback("not a url").is_none());
    assert!(parse_auth_callback("://missing-scheme").is_none());
    assert!(parse_auth_callback("").is_none());
}

#[test]
fn session_validation_status_serializes_to_kebab_case() {
    // The renderer matches on the exact strings "valid"/"invalid"/"not-configured".
    assert_eq!(
        serde_json::to_value(SessionValidationStatus::Valid).unwrap(),
        serde_json::json!("valid")
    );
    assert_eq!(
        serde_json::to_value(SessionValidationStatus::Invalid).unwrap(),
        serde_json::json!("invalid")
    );
    assert_eq!(
        serde_json::to_value(SessionValidationStatus::NotConfigured).unwrap(),
        serde_json::json!("not-configured")
    );
}

#[test]
fn magic_link_result_serializes_with_camel_case_and_skips_empty_optional_fields() {
    let result = MagicLinkResult {
        success: true,
        error: None,
        session: Some(serde_json::json!({ "access_token": "tok" })),
        user: None,
    };

    let value = serde_json::to_value(&result).unwrap();
    assert_eq!(value["success"], true);
    assert_eq!(value["session"]["access_token"], "tok");
    // Skipped optional fields must not appear (keeps the IPC payload small
    // and matches the renderer's optional-field handling).
    assert!(value.get("error").is_none());
    assert!(value.get("user").is_none());
}

#[test]
fn magic_link_result_serializes_failure_with_error_message() {
    let result = MagicLinkResult {
        success: false,
        error: Some("Token has expired".to_string()),
        session: None,
        user: None,
    };

    let value = serde_json::to_value(&result).unwrap();
    assert_eq!(value["success"], false);
    assert_eq!(value["error"], "Token has expired");
    assert!(value.get("session").is_none());
}

#[test]
fn session_data_deserializes_camel_case_aliases_from_renderer() {
    // The renderer stores session data in camelCase; the alias attribute lets
    // the same struct accept either casing without custom conversion.
    let data = serde_json::from_value::<SessionData>(serde_json::json!({
        "accessToken": "access",
        "refreshToken": "refresh",
        "userData": { "id": "u-1" }
    }))
    .expect("session data");

    assert_eq!(data.access_token.as_deref(), Some("access"));
    assert_eq!(data.refresh_token.as_deref(), Some("refresh"));
    assert_eq!(data.user.as_ref().unwrap()["id"], "u-1");
}

#[test]
fn session_data_deserializes_snake_case_and_defaults_missing_fields_to_none() {
    let data = serde_json::from_value::<SessionData>(serde_json::json!({
        "access_token": "a",
        "refresh_token": "r"
    }))
    .expect("session data");

    assert_eq!(data.access_token.as_deref(), Some("a"));
    assert_eq!(data.refresh_token.as_deref(), Some("r"));
    assert!(data.user.is_none());
}

#[test]
fn session_data_defaults_all_fields_to_none_when_empty() {
    let data = serde_json::from_value::<SessionData>(serde_json::json!({})).expect("session data");

    assert!(data.access_token.is_none());
    assert!(data.refresh_token.is_none());
    assert!(data.user.is_none());
}

#[test]
fn auth_event_name_and_payload_round_trip_through_serde() {
    // AuthEvent is emitted over Tauri's event bus; its name and payload shape
    // are part of the IPC contract with the renderer.
    let result = MagicLinkResult {
        success: true,
        error: None,
        session: Some(serde_json::json!({ "access_token": "tok" })),
        user: Some(serde_json::json!({ "id": "u-1" })),
    };
    let event = AuthEvent::MagicLinkResult(result);

    assert_eq!(event.name(), "magic-link-result");
    let payload = event.payload();
    assert_eq!(payload["success"], true);
    assert_eq!(payload["session"]["access_token"], "tok");
    assert_eq!(payload["user"]["id"], "u-1");
}

#[test]
fn auth_event_payload_falls_back_when_serialization_fails() {
    // MagicLinkResult always serializes (its fields are plain JSON Values),
    // so the fallback arm is unreachable in practice — but the enum variant
    // name must stay stable regardless.
    let result = MagicLinkResult {
        success: false,
        error: Some("err".to_string()),
        session: None,
        user: None,
    };
    let event = AuthEvent::MagicLinkResult(result);

    assert_eq!(event.name(), "magic-link-result");
    assert_eq!(event.payload()["success"], false);
}

#[tokio::test]
async fn auth_event_from_url_returns_none_for_callback_without_magic_link_async() {
    // A bare auth-callback URL with no magic_link query param produces no
    // event: legacy token-only callbacks must never be honored without
    // server-side verification. This covers the Option::None branch in
    // auth_event_from_url_with_state through the real async state machine.
    let state = AuthState::default();
    let event =
        auth_event_from_url_with_state(&state, "dtx://auth-callback?access_token=tok").await;
    assert!(event.is_none());
}

#[test]
fn route_callback_request_returns_bad_request_when_request_line_is_missing() {
    assert!(matches!(
        route_callback_request(None, 47931),
        CallbackRoute::BadRequest
    ));
}

#[test]
fn route_callback_request_returns_bad_request_when_target_is_missing() {
    // A request line that has no whitespace-separated target (e.g. just "GET")
    // is malformed.
    assert!(matches!(
        route_callback_request(Some("GET"), 47931),
        CallbackRoute::BadRequest
    ));
}

#[test]
fn route_callback_request_returns_valid_url_for_auth_callback_target() {
    let route = route_callback_request(
        Some("GET /auth-callback?magic_link=https%3A%2F%2Fexample.com HTTP/1.1"),
        47931,
    );

    match route {
        CallbackRoute::Valid(raw_url) => {
            assert!(raw_url.contains("/auth-callback?magic_link="));
            assert!(raw_url.starts_with("http://127.0.0.1:47931/"));
        }
        other => panic!("expected Valid, got {other:?}"),
    }
}

#[test]
fn route_callback_request_returns_not_found_for_non_auth_callback_target() {
    // Any other path on the loopback server is rejected with 404 to avoid
    // proxying arbitrary requests through the auth callback server.
    assert!(matches!(
        route_callback_request(Some("GET /other HTTP/1.1"), 47931),
        CallbackRoute::NotFound
    ));
}

#[test]
fn local_auth_callback_status_text_maps_known_http_status_codes() {
    assert_eq!(local_auth_callback_status_text(200), "OK");
    assert_eq!(local_auth_callback_status_text(400), "Bad Request");
    assert_eq!(local_auth_callback_status_text(404), "Not Found");
}

#[test]
fn local_auth_callback_status_text_defaults_to_internal_server_error() {
    // Any status code outside the explicit map falls through to a generic 500
    // label so the response line is always well-formed.
    assert_eq!(
        local_auth_callback_status_text(500),
        "Internal Server Error"
    );
    assert_eq!(
        local_auth_callback_status_text(302),
        "Internal Server Error"
    );
}

#[test]
fn format_local_auth_callback_response_builds_http_response_with_headers_and_body() {
    // Body of 6 bytes: `<h1>ok`. content-length is the *byte* length of the
    // body, not the char count — multi-byte sequences must be measured
    // correctly.
    let response = format_local_auth_callback_response(200, "text/html; charset=utf-8", "<h1>ok");

    assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
    assert!(response.contains("content-type: text/html; charset=utf-8\r\n"));
    assert_eq!(
        response.matches("content-length: 6\r\n").count(),
        1,
        "expected content-length header for 6-byte body"
    );
    assert!(response.contains("\r\n\r\n<h1>ok"));
    assert!(response.ends_with("<h1>ok"));
}

#[test]
fn format_local_auth_callback_response_emits_bad_request_for_400_status() {
    let response = format_local_auth_callback_response(400, "text/plain", "Bad Request");
    assert!(response.starts_with("HTTP/1.1 400 Bad Request\r\n"));
    assert!(response.contains("content-type: text/plain\r\n"));
    assert!(response.ends_with("Bad Request"));
}

#[test]
fn format_local_auth_callback_response_emits_not_found_for_404_status() {
    let response = format_local_auth_callback_response(404, "text/plain", "Not Found");
    assert!(response.starts_with("HTTP/1.1 404 Not Found\r\n"));
}

#[test]
fn local_auth_callback_port_returns_none_when_env_unset() {
    // CI does not bake in DTX_DESKTOP_AUTH_CALLBACK_PORT, so the default
    // behavior is "no callback server". Only assert the unset path to avoid
    // races between parallel tests mutating process-global env.
    let _guard = auth_env_lock().lock().unwrap();
    std::env::remove_var("DTX_DESKTOP_AUTH_CALLBACK_PORT");
    assert!(local_auth_callback_port().is_none());
}

#[test]
fn local_auth_callback_port_rejects_zero_and_invalid_values() {
    // Port 0 is reserved as "any port" by the OS and must not be used as a
    // real listen port for the auth callback server.
    let _guard = auth_env_lock().lock().unwrap();
    std::env::set_var("DTX_DESKTOP_AUTH_CALLBACK_PORT", "0");
    assert!(local_auth_callback_port().is_none());

    std::env::set_var("DTX_DESKTOP_AUTH_CALLBACK_PORT", "not-a-number");
    assert!(local_auth_callback_port().is_none());

    std::env::remove_var("DTX_DESKTOP_AUTH_CALLBACK_PORT");
}

#[test]
fn local_auth_callback_port_parses_valid_port() {
    let _guard = auth_env_lock().lock().unwrap();
    std::env::set_var("DTX_DESKTOP_AUTH_CALLBACK_PORT", "47931");
    assert_eq!(local_auth_callback_port(), Some(47931));
    std::env::remove_var("DTX_DESKTOP_AUTH_CALLBACK_PORT");
}

#[test]
fn resolve_auth_config_returns_none_in_test_environment() {
    // The test/CI environment does not bake in PUBLIC_SUPABASE_URL or
    // PUBLIC_SUPABASE_ANON_KEY, so the resolver returns None — which both
    // validate_session and verify_magic_link translate to a "not configured"
    // response. This covers the NotConfigured branch without requiring
    // process-global env mutation that could race with parallel tests.
    assert!(resolve_auth_config().is_none());
}

// ---------------------------------------------------------------------------
// session_value_from_data with user field
// ---------------------------------------------------------------------------

#[test]
fn session_value_from_data_includes_user_when_present() {
    let session_data = SessionData {
        access_token: Some("access".to_string()),
        refresh_token: Some("refresh".to_string()),
        user: Some(serde_json::json!({ "id": "user-1", "email": "u@example.com" })),
    };

    let session = session_value_from_data(session_data).expect("session");

    assert_eq!(session["access_token"], "access");
    assert_eq!(session["refresh_token"], "refresh");
    assert_eq!(session["user"]["id"], "user-1");
    assert_eq!(session["user"]["email"], "u@example.com");
}

#[test]
fn session_value_from_data_omits_user_when_none() {
    let session_data = SessionData {
        access_token: Some("access".to_string()),
        refresh_token: Some("refresh".to_string()),
        user: None,
    };

    let session = session_value_from_data(session_data).expect("session");

    assert!(session.get("user").is_none());
}

// ---------------------------------------------------------------------------
// auth_client
// ---------------------------------------------------------------------------

#[test]
fn auth_client_builds_client_with_timeout() {
    let client = auth_client();
    assert!(client.is_ok());
}

// ---------------------------------------------------------------------------
// revoke_session_with_client (logout)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn revoke_session_posts_access_token_to_supabase_logout_endpoint() {
    // The renderer's logout flow must invalidate the Supabase refresh token
    // server-side (regression from the Electron signOut() path). This verifies
    // the POST hits /auth/v1/logout with the session's access_token as bearer.
    let server = wiremock::MockServer::start().await;
    wiremock::Mock::given(wiremock::matchers::method("POST"))
        .and(wiremock::matchers::path("/auth/v1/logout"))
        .and(wiremock::matchers::header("apikey", "anon"))
        .and(wiremock::matchers::header(
            "authorization",
            "Bearer access-token",
        ))
        .respond_with(wiremock::ResponseTemplate::new(204))
        // Expect exactly one call — verified on MockServer drop.
        .expect(1)
        .mount(&server)
        .await;
    let state = AuthState::default();
    state
        .set_current_session(Some(serde_json::json!({
            "access_token": "access-token",
            "refresh_token": "refresh-token",
        })))
        .await;

    revoke_session_with_client(reqwest::Client::new(), &state, &server.uri(), "anon").await;

    // Server-side revocation was called, and local state is cleared.
    assert!(state.current_session().await.is_none());
}

#[tokio::test]
async fn revoke_session_clears_local_state_when_server_is_unreachable() {
    // Logout must clear local state even if the Supabase revocation endpoint
    // can't be reached (offline, DNS failure, etc.) — the user should always
    // appear logged out locally.
    let state = AuthState::default();
    state
        .set_current_session(Some(serde_json::json!({
            "access_token": "access-token",
            "refresh_token": "refresh-token",
        })))
        .await;

    revoke_session_with_client(
        reqwest::Client::new(),
        &state,
        // Unreachable loopback port — connect fails, body is dropped.
        "http://127.0.0.1:1",
        "anon",
    )
    .await;

    assert!(state.current_session().await.is_none());
}

#[tokio::test]
async fn revoke_session_without_session_skips_server_call_and_clears_state() {
    // When there is no session to revoke (e.g. user was never logged in),
    // no server call is made and local state stays None.
    let server = wiremock::MockServer::start().await;
    wiremock::Mock::given(wiremock::matchers::any())
        .respond_with(wiremock::ResponseTemplate::new(500))
        // Expect zero calls — any request would fail the test on drop.
        .expect(0)
        .mount(&server)
        .await;
    let state = AuthState::default();

    revoke_session_with_client(reqwest::Client::new(), &state, &server.uri(), "anon").await;

    assert!(state.current_session().await.is_none());
}
