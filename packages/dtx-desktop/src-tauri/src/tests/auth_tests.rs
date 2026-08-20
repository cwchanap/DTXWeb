use super::*;
use crate::api_contracts::DesktopAuthUser;

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
    assert!(ensure_allowed_external_url("dtx://auth-callback").is_err());
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
