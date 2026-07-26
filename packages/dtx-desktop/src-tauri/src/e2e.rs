use crate::error::{DesktopError, Result};

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
