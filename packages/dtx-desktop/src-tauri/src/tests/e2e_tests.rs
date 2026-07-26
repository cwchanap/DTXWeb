use std::sync::{Mutex, OnceLock};

fn env_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

struct EnvVarGuard {
    saved: Option<std::ffi::OsString>,
}

impl EnvVarGuard {
    fn replace(value: &str) -> Self {
        let saved = std::env::var_os("DTX_E2E_SESSION_NONCE");
        std::env::set_var("DTX_E2E_SESSION_NONCE", value);
        Self { saved }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        match self.saved.take() {
            Some(value) => std::env::set_var("DTX_E2E_SESSION_NONCE", value),
            None => std::env::remove_var("DTX_E2E_SESSION_NONCE"),
        }
    }
}

#[test]
fn readiness_nonce_returns_the_e2e_launch_nonce() {
    let _lock = env_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _env = EnvVarGuard::replace("trusted-harness-nonce");

    assert_eq!(
        crate::e2e::read_e2e_session_nonce()
            .expect("e2e nonce command should read the launch nonce"),
        "trusted-harness-nonce"
    );
}

#[tokio::test]
async fn e2e_auth_state_is_seeded_only_for_the_configured_user() {
    let state =
        crate::auth::AuthState::for_e2e_user("fixed-e2e-user").expect("valid fixed E2E user");

    assert_eq!(
        state.current_user_id().await.as_deref(),
        Some("fixed-e2e-user")
    );
    let session = state.current_session().await.expect("seeded session");
    assert_eq!(session["user"]["id"], "fixed-e2e-user");
    assert_eq!(session["access_token"], "e2e-supabase-access-token");
    assert_eq!(session["refresh_token"], "e2e-supabase-refresh-token");

    assert!(crate::auth::AuthState::for_e2e_user("").is_err());
    assert!(crate::auth::AuthState::for_e2e_user(" other-user ").is_err());
}

#[test]
fn e2e_session_validation_accepts_only_the_seeded_user() {
    let matching = crate::auth::SessionData {
        access_token: Some("renderer-e2e-access".to_string()),
        refresh_token: Some("renderer-e2e-refresh".to_string()),
        user: Some(serde_json::json!({ "id": "fixed-e2e-user" })),
    };
    assert!(crate::auth::e2e_session_matches_user(
        &matching,
        "fixed-e2e-user"
    ));

    let different = crate::auth::SessionData {
        access_token: matching.access_token.clone(),
        refresh_token: matching.refresh_token.clone(),
        user: Some(serde_json::json!({ "id": "different-user" })),
    };
    assert!(!crate::auth::e2e_session_matches_user(
        &different,
        "fixed-e2e-user"
    ));
}

#[test]
fn e2e_drive_state_rejects_missing_or_blank_data_dir_before_constructing_fake() {
    for value in [
        None,
        Some(std::ffi::OsString::from("")),
        Some(std::ffi::OsString::from("   ")),
    ] {
        let error = match crate::google_drive::GoogleDriveState::e2e_from_data_dir_value(
            "fixed-e2e-user",
            value,
        ) {
            Ok(_) => {
                panic!("the fake Drive state must not fall back to a real platform data directory")
            }
            Err(error) => error,
        };

        assert_eq!(
            error.to_string(),
            "DTX_E2E_DATA_DIR is required for a desktop E2E build"
        );
    }
}
