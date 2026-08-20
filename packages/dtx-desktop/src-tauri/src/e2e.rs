#[cfg(debug_assertions)]
use crate::api_contracts::{DesktopAuthSession, DesktopAuthUser};
use crate::error::{DesktopError, Result};
#[cfg(debug_assertions)]
use crate::google_drive::GoogleDriveState;
#[cfg(debug_assertions)]
use crate::models::{E2eDriveControl, E2eDriveSnapshot};
#[cfg(debug_assertions)]
use tauri::{AppHandle, Manager};

const SESSION_NONCE_ENV: &str = "DTX_E2E_SESSION_NONCE";

#[cfg(debug_assertions)]
pub(crate) fn seeded_auth_session(user_id: &str) -> DesktopAuthSession {
    DesktopAuthSession {
        session_token: "e2e-better-auth-session-token".to_string(),
        user: DesktopAuthUser {
            id: user_id.to_string(),
            name: "Desktop E2E".to_string(),
            email: "desktop-e2e@drumery.invalid".to_string(),
            email_verified: true,
            image: None,
            created_at: String::new(),
            updated_at: String::new(),
        },
    }
}

/// Restore the deterministic native session after a renderer logout. This
/// helper and its IPC wrapper are debug-only E2E seams; release builds cannot
/// call or register them.
#[cfg(all(feature = "e2e", debug_assertions))]
pub(crate) async fn restore_seeded_auth_session(
    state: &crate::auth::AuthState,
    user_id: &str,
) -> Result<DesktopAuthSession> {
    // Reuse the startup validation so the restoration cannot seed an arbitrary
    // identifier or accidentally create a different class of test account.
    crate::auth::AuthState::for_e2e_user(user_id)?;
    let session = seeded_auth_session(user_id);
    state.set_current_auth_session(Some(session.clone())).await;
    Ok(session)
}

#[cfg(all(feature = "e2e", debug_assertions))]
#[tauri::command]
pub async fn restore_e2e_auth_session(app: AppHandle) -> Result<DesktopAuthSession> {
    let user_id = std::env::var("DTX_E2E_DRUMERY_USER_ID").map_err(|_| {
        DesktopError::Message(
            "DTX_E2E_DRUMERY_USER_ID is required for a desktop E2E build".to_string(),
        )
    })?;
    restore_seeded_auth_session(&app.state::<crate::auth::AuthState>(), &user_id).await
}

/// Proves that the WebDriver session belongs to the e2e process that received
/// this launch's nonce. This module is compiled only with the e2e Cargo feature.
#[tauri::command]
pub fn read_e2e_session_nonce() -> Result<String> {
    std::env::var(SESSION_NONCE_ENV)
        .ok()
        .filter(|nonce| !nonce.is_empty())
        .ok_or_else(|| DesktopError::Message("E2E session nonce is unavailable".to_string()))
}

#[cfg(debug_assertions)]
#[tauri::command]
pub async fn configure_google_drive_e2e(app: AppHandle, control: E2eDriveControl) -> Result<()> {
    app.state::<GoogleDriveState>()
        .e2e_fake
        .as_ref()
        .ok_or_else(|| DesktopError::Message("E2E Drive fake is unavailable".to_string()))?
        .configure(control)
        .await
}

#[cfg(debug_assertions)]
#[tauri::command]
pub async fn snapshot_google_drive_e2e(app: AppHandle) -> Result<E2eDriveSnapshot> {
    app.state::<GoogleDriveState>()
        .e2e_fake
        .as_ref()
        .ok_or_else(|| DesktopError::Message("E2E Drive fake is unavailable".to_string()))?
        .snapshot()
        .await
}
