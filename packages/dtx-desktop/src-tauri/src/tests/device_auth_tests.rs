use super::device_auth::{
    infer_web_origin_from_api_url, web_origin_from_values, DeviceAuthClient, DeviceAuthError,
    DevicePollResult,
};
use wiremock::matchers::{body_json, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const DEVICE_CODE: &str = "device-code-must-never-leak";
const SESSION_TOKEN: &str = "opaque-session-token-must-never-leak";

fn client(server: &MockServer) -> DeviceAuthClient {
    DeviceAuthClient::new(server.uri()).expect("test server URL is valid")
}

#[test]
fn trusted_origin_matches_the_api_topology_and_strips_paths() {
    assert_eq!(
        infer_web_origin_from_api_url("https://api.dtx.hapadona.com/graphql")
            .expect("production API origin"),
        "https://dtx.hapadona.com"
    );
    assert_eq!(
        infer_web_origin_from_api_url("https://api.pre-prod.dtx.hapadona.com/")
            .expect("pre-production API origin"),
        "https://pre-prod.dtx.hapadona.com"
    );
    assert_eq!(
        infer_web_origin_from_api_url("http://localhost:8787/api").expect("local API origin"),
        "http://localhost:5173"
    );
    assert_eq!(
        infer_web_origin_from_api_url("http://[::1]:8787/api").expect("local IPv6 API origin"),
        "http://[::1]:5173"
    );
    assert_eq!(
        web_origin_from_values(Some("https://dtx.hapadona.com/app")).expect("configured origin"),
        "https://dtx.hapadona.com"
    );
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
        ("unmapped_error_code", DeviceAuthError::MalformedResponse),
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

#[tokio::test]
async fn sign_out_posts_json_bearer_and_the_canonical_origin() {
    let server = MockServer::start().await;
    let token = "opaque-sign-out-token";
    Mock::given(method("POST"))
        .and(path("/api/auth/sign-out"))
        .and(header("authorization", format!("Bearer {token}")))
        .and(header("origin", server.uri()))
        .and(header("content-type", "application/json"))
        .and(body_json(serde_json::json!({})))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&server)
        .await;

    client(&server)
        .sign_out(token)
        .await
        .expect("sign-out request should satisfy Better Auth's handler contract");
}

#[test]
fn url_helpers_reject_blank_and_non_web_values() {
    use crate::device_auth::api_base_url_from_values;

    assert!(api_base_url_from_values(Some("  /  ")).is_err());
    assert!(web_origin_from_values(None).is_err());
    assert!(web_origin_from_values(Some("   ")).is_err());
    assert!(web_origin_from_values(Some("not-a-url")).is_err());
    assert!(web_origin_from_values(Some("ftp://example.test")).is_err());
    assert!(infer_web_origin_from_api_url("ftp://example.test").is_err());
}

#[tokio::test]
async fn client_debug_output_lists_configuration_without_secrets() {
    let server = MockServer::start().await;
    let debug = format!("{:?}", client(&server));

    assert!(debug.contains("base_url"));
    assert!(debug.contains("dtx-desktop"));
    assert!(debug.contains("trusted_origin"));
}

#[tokio::test]
async fn polling_an_expired_device_flow_fails_closed_before_any_request() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/auth/device/code"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "device_code": DEVICE_CODE,
            "user_code": "ABCD-EFGH",
            "verification_uri": "https://auth.example.test/device",
            "verification_uri_complete": "https://auth.example.test/device?user_code=ABCD-EFGH",
            "expires_in": 1,
            "interval": 5
        })))
        .mount(&server)
        .await;

    let auth = client(&server);
    let flow = auth.begin().await.expect("device code response");
    tokio::time::sleep(std::time::Duration::from_millis(1_100)).await;

    let error = auth.poll(&flow).await.expect_err("expired flow");
    assert_eq!(error, DeviceAuthError::ExpiredToken);
}

#[tokio::test]
async fn poll_maps_unauthorized_sessions_and_server_failures_from_get_session() {
    for (status, body, expected) in [
        (401u16, serde_json::json!({}), DeviceAuthError::InvalidGrant),
        (
            500,
            serde_json::json!({ "user": null }),
            DeviceAuthError::ServerStatus(500),
        ),
    ] {
        let server = MockServer::start().await;
        mount_device_and_token_success(&server).await;
        Mock::given(method("GET"))
            .and(path("/api/auth/get-session"))
            .respond_with(ResponseTemplate::new(status).set_body_json(body))
            .mount(&server)
            .await;

        let auth = client(&server);
        let flow = auth.begin().await.expect("device code response");
        let error = auth
            .poll(&flow)
            .await
            .expect_err("mapped get-session failure");
        assert_eq!(error, expected);
    }
}

async fn mount_device_and_token_success(server: &MockServer) {
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
        .mount(server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/auth/device/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "access_token": SESSION_TOKEN,
            "token_type": "Bearer",
            "expires_in": 3600
        })))
        .mount(server)
        .await;
}

#[tokio::test]
async fn get_session_maps_every_remote_outcome() {
    // A blank token never reaches the network.
    let server = MockServer::start().await;
    assert_eq!(
        client(&server).get_session("   ").await.unwrap(),
        None,
        "blank tokens must short-circuit"
    );

    for (status, body, expected) in [
        (
            401u16,
            serde_json::json!({}),
            Ok(None) as Result<Option<crate::api_contracts::DesktopAuthUser>, DeviceAuthError>,
        ),
        (200, serde_json::json!({ "unexpected": true }), Ok(None)),
        (
            500,
            serde_json::json!({}),
            Err(DeviceAuthError::ServerStatus(500)),
        ),
        (
            200,
            serde_json::json!({ "user": { "id": "restore-user" } }),
            Ok(Some(crate::api_contracts::DesktopAuthUser {
                id: "restore-user".to_string(),
                ..Default::default()
            })),
        ),
        (
            200,
            serde_json::json!({ "user": { "id": "   " } }),
            Ok(None),
        ),
    ] {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/auth/get-session"))
            .and(header("authorization", format!("Bearer {SESSION_TOKEN}")))
            .respond_with(ResponseTemplate::new(status).set_body_json(body))
            .mount(&server)
            .await;

        let result = client(&server).get_session(SESSION_TOKEN).await;
        match expected {
            Ok(expected) => assert_eq!(result.expect("get-session outcome"), expected),
            Err(expected) => assert_eq!(result.expect_err("get-session failure"), expected),
        }
    }
}

#[tokio::test]
async fn sign_out_skips_blank_tokens_and_maps_error_statuses() {
    let server = MockServer::start().await;
    client(&server)
        .sign_out("   ")
        .await
        .expect("blank tokens must not reach the network");

    for (status, expected) in [
        (401u16, DeviceAuthError::InvalidGrant),
        (400, DeviceAuthError::InvalidRequest),
    ] {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/auth/sign-out"))
            .respond_with(ResponseTemplate::new(status))
            .mount(&server)
            .await;

        let error = client(&server)
            .sign_out(SESSION_TOKEN)
            .await
            .expect_err("mapped sign-out failure");
        assert_eq!(error, expected);
    }
}

#[tokio::test]
async fn connection_timeouts_are_typed_as_timeouts() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/auth/device/code"))
        .respond_with(ResponseTemplate::new(200).set_delay(std::time::Duration::from_secs(5)))
        .mount(&server)
        .await;

    let client =
        DeviceAuthClient::new_with_timeout(server.uri(), std::time::Duration::from_millis(250))
            .expect("mock server URL is valid");

    let error = client.begin().await.expect_err("delayed endpoint");
    assert_eq!(error, DeviceAuthError::Timeout);
}

#[tokio::test]
async fn connection_failures_are_typed_as_network_errors() {
    let client = DeviceAuthClient::new_with_timeout(
        "http://127.0.0.1:1".to_string(),
        std::time::Duration::from_secs(30),
    )
    .expect("test URL is valid");

    let error = client.begin().await.expect_err("connection refused");
    assert_eq!(error, DeviceAuthError::Network);
}
