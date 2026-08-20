use super::device_auth::{DeviceAuthClient, DeviceAuthError, DevicePollResult};
use wiremock::matchers::{body_json, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const DEVICE_CODE: &str = "device-code-must-never-leak";
const SESSION_TOKEN: &str = "opaque-session-token-must-never-leak";

fn client(server: &MockServer) -> DeviceAuthClient {
    DeviceAuthClient::new(server.uri()).expect("test server URL is valid")
}

#[tokio::test]
async fn begin_posts_the_pinned_device_code_wire_shape_and_hides_device_code() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/auth/device/code"))
        .and(header("content-type", "application/json"))
        .and(body_json(serde_json::json!({"client_id": "dtx-desktop"})))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "device_code": DEVICE_CODE,
            "user_code": "ABCD-EFGH",
            "verification_uri": "https://auth.example.test/device",
            "verification_uri_complete": "https://auth.example.test/device?user_code=ABCD-EFGH",
            "expires_in": 600,
            "interval": 5
        })))
        .mount(&server)
        .await;

    let flow = client(&server).begin().await.expect("device code response");
    let attempt = flow.attempt();
    assert_eq!(attempt.user_code, "ABCD-EFGH");
    assert_eq!(attempt.verification_uri, "https://auth.example.test/device");
    assert_eq!(
        attempt.verification_uri_complete,
        "https://auth.example.test/device?user_code=ABCD-EFGH"
    );
    assert!(!attempt.expires_at.is_empty());

    let serialized = serde_json::to_string(attempt).expect("attempt serializes");
    assert!(!serialized.contains(DEVICE_CODE));
    let debug = format!("{flow:?}");
    assert!(!debug.contains(DEVICE_CODE));
}

#[tokio::test]
async fn begin_maps_invalid_client_without_returning_server_details() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/auth/device/code"))
        .respond_with(ResponseTemplate::new(400).set_body_json(serde_json::json!({
            "error": "invalid_client",
            "error_description": "client details must not reach the renderer"
        })))
        .mount(&server)
        .await;

    let error = client(&server)
        .begin()
        .await
        .expect_err("invalid client response");
    assert_eq!(error, DeviceAuthError::InvalidClient);
    assert!(!format!("{error:?}").contains("client details"));
}

#[tokio::test]
async fn poll_uses_bearer_grant_and_maps_pending_without_logging_secrets() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/auth/device/code"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "device_code": DEVICE_CODE,
            "user_code": "ABCD-EFGH",
            "verification_uri": "https://auth.example.test/device",
            "verification_uri_complete": "https://auth.example.test/device?user_code=ABCD-EFGH",
            "expires_in": 600,
            "interval": 5
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/auth/device/token"))
        .and(body_json(serde_json::json!({
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            "device_code": DEVICE_CODE,
            "client_id": "dtx-desktop"
        })))
        .respond_with(ResponseTemplate::new(400).set_body_json(serde_json::json!({
            "error": "authorization_pending",
            "error_description": "The user has not approved the device yet"
        })))
        .mount(&server)
        .await;

    let flow = client(&server).begin().await.expect("device code response");
    let error = client(&server)
        .poll(&flow)
        .await
        .expect_err("pending response");
    assert_eq!(error, DeviceAuthError::AuthorizationPending);
    let debug = format!("{error:?}");
    assert!(!debug.contains(DEVICE_CODE));
}

#[tokio::test]
async fn approved_poll_fetches_bearer_session_and_returns_opaque_token() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/auth/device/code"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "device_code": DEVICE_CODE,
            "user_code": "ABCD-EFGH",
            "verification_uri": "https://auth.example.test/device",
            "verification_uri_complete": "https://auth.example.test/device?user_code=ABCD-EFGH",
            "expires_in": 600,
            "interval": 5
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/auth/device/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "access_token": SESSION_TOKEN,
            "token_type": "Bearer",
            "expires_in": 3600,
            "scope": "openid"
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/auth/get-session"))
        .and(header("authorization", format!("Bearer {SESSION_TOKEN}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "session": {"token": SESSION_TOKEN},
            "user": {
                "id": "user-1",
                "name": "Drummer",
                "email": "drummer@example.test",
                "emailVerified": true,
                "createdAt": "2026-08-20T00:00:00.000Z",
                "updatedAt": "2026-08-20T00:00:00.000Z"
            }
        })))
        .mount(&server)
        .await;

    let auth = client(&server);
    let flow = auth.begin().await.expect("device code response");
    let result = auth.poll(&flow).await.expect("approved response");
    let DevicePollResult::Approved(session) = result;
    assert_eq!(session.session_token, SESSION_TOKEN);
    assert_eq!(session.user.id, "user-1");
    let debug = format!("{session:?}");
    assert!(!debug.contains(SESSION_TOKEN));
}

#[tokio::test]
async fn approved_poll_rejects_a_null_bearer_session_as_invalid_grant() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/auth/device/code"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "device_code": DEVICE_CODE,
            "user_code": "ABCD-EFGH",
            "verification_uri": "https://auth.example.test/device",
            "verification_uri_complete": "https://auth.example.test/device?user_code=ABCD-EFGH",
            "expires_in": 600,
            "interval": 5
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/auth/device/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "access_token": SESSION_TOKEN,
            "token_type": "Bearer",
            "expires_in": 3600
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/auth/get-session"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::Value::Null))
        .mount(&server)
        .await;

    let auth = client(&server);
    let flow = auth.begin().await.expect("device code response");
    assert_eq!(
        auth.poll(&flow).await.expect_err("null session"),
        DeviceAuthError::InvalidGrant
    );
}

#[tokio::test]
async fn poll_maps_better_auth_errors_without_exposing_wire_secrets() {
    let cases = [
        ("slow_down", DeviceAuthError::SlowDown),
        ("access_denied", DeviceAuthError::AccessDenied),
        ("expired_token", DeviceAuthError::ExpiredToken),
        ("invalid_grant", DeviceAuthError::InvalidGrant),
    ];

    for (wire_error, expected) in cases {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/auth/device/code"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "device_code": DEVICE_CODE,
                "user_code": "ABCD-EFGH",
                "verification_uri": "https://auth.example.test/device",
                "verification_uri_complete": "https://auth.example.test/device?user_code=ABCD-EFGH",
                "expires_in": 600,
                "interval": 5
            })))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/api/auth/device/token"))
            .respond_with(ResponseTemplate::new(400).set_body_json(serde_json::json!({
                "error": wire_error,
                "error_description": format!("description contains {DEVICE_CODE}")
            })))
            .mount(&server)
            .await;

        let auth = client(&server);
        let flow = auth.begin().await.expect("device code response");
        let error = auth.poll(&flow).await.expect_err("mapped error response");
        assert_eq!(error, expected);
        assert!(!format!("{error:?}").contains(DEVICE_CODE));
    }
}

#[tokio::test]
async fn malformed_device_code_response_is_rejected_without_partial_attempt() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/auth/device/code"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "device_code": DEVICE_CODE,
            "user_code": "ABCD-EFGH"
        })))
        .mount(&server)
        .await;

    let error = client(&server)
        .begin()
        .await
        .expect_err("missing verification and expiry fields");
    assert_eq!(error, DeviceAuthError::MalformedResponse);
}

#[tokio::test]
async fn slow_down_increases_the_next_poll_interval_by_five_seconds() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/auth/device/code"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "device_code": DEVICE_CODE,
            "user_code": "ABCD-EFGH",
            "verification_uri": "https://auth.example.test/device",
            "verification_uri_complete": "https://auth.example.test/device?user_code=ABCD-EFGH",
            "expires_in": 600,
            "interval": 5
        })))
        .mount(&server)
        .await;

    let mut flow = client(&server).begin().await.expect("device code response");
    assert_eq!(flow.interval(), std::time::Duration::from_secs(5));
    flow.increase_interval();
    assert_eq!(flow.interval(), std::time::Duration::from_secs(10));
}

#[tokio::test]
async fn network_timeout_is_a_typed_error() {
    let client = DeviceAuthClient::new_with_timeout(
        "http://127.0.0.1:1".to_string(),
        std::time::Duration::from_millis(1),
    )
    .expect("test URL is valid");

    let error = client.begin().await.expect_err("unreachable endpoint");
    assert!(matches!(
        error,
        DeviceAuthError::Timeout | DeviceAuthError::Network
    ));
}
