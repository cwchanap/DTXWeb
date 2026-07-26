use crate::error::{DesktopError, Result};
#[cfg(debug_assertions)]
use crate::google_drive::GoogleDriveState;
#[cfg(debug_assertions)]
use crate::models::{E2eDriveControl, E2eDriveSnapshot};
#[cfg(debug_assertions)]
use tauri::{AppHandle, Manager};

const SESSION_NONCE_ENV: &str = "DTX_E2E_SESSION_NONCE";

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
pub fn configure_google_drive_e2e(app: AppHandle, control: E2eDriveControl) -> Result<()> {
    app.state::<GoogleDriveState>()
        .e2e_fake
        .as_ref()
        .ok_or_else(|| DesktopError::Message("E2E Drive fake is unavailable".to_string()))?
        .configure(control)
}

#[cfg(debug_assertions)]
#[tauri::command]
pub fn snapshot_google_drive_e2e(app: AppHandle) -> Result<E2eDriveSnapshot> {
    app.state::<GoogleDriveState>()
        .e2e_fake
        .as_ref()
        .ok_or_else(|| DesktopError::Message("E2E Drive fake is unavailable".to_string()))?
        .snapshot()
}
