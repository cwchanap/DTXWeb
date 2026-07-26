use tauri::{AppHandle, Manager};

use super::oauth::{
    GoogleDriveConnectionState, GoogleDriveDisconnectResult, GoogleDriveOAuthError,
};
use super::GoogleDriveState;
use crate::auth::AuthState;
use crate::error::{DesktopError, Result};

#[tauri::command]
pub(crate) async fn get_google_drive_connection_state(
    app: AppHandle,
) -> Result<GoogleDriveConnectionState> {
    let user_id = current_user_id(&app).await?;
    Ok(app
        .state::<GoogleDriveState>()
        .connection_state_for_user(&user_id)
        .await)
}

#[tauri::command]
pub(crate) async fn connect_google_drive_and_choose_folder(
    app: AppHandle,
) -> Result<GoogleDriveConnectionState> {
    app.state::<GoogleDriveState>()
        .connect_and_choose_folder(&app.state::<AuthState>())
        .await
        .map_err(sanitized_oauth_error)
}

#[tauri::command]
pub(crate) async fn change_google_drive_folder(
    app: AppHandle,
) -> Result<GoogleDriveConnectionState> {
    app.state::<GoogleDriveState>()
        .connect_and_choose_folder(&app.state::<AuthState>())
        .await
        .map_err(sanitized_oauth_error)
}

#[tauri::command]
pub(crate) async fn disconnect_google_drive(app: AppHandle) -> Result<GoogleDriveDisconnectResult> {
    let user_id = current_user_id(&app).await?;
    app.state::<GoogleDriveState>()
        .disconnect_user(&user_id)
        .await
        .map_err(sanitized_oauth_error)
}

async fn current_user_id(app: &AppHandle) -> Result<String> {
    app.state::<AuthState>()
        .current_user_id()
        .await
        .ok_or_else(|| {
            DesktopError::Message(GoogleDriveOAuthError::NotConnected.code().to_string())
        })
}

fn sanitized_oauth_error(error: GoogleDriveOAuthError) -> DesktopError {
    DesktopError::Message(error.code().to_string())
}
