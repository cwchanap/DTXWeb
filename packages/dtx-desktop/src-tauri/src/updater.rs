use crate::error::Result;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Result<serde_json::Value> {
    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(error) => return Ok(unavailable_update_result(&error.to_string())),
    };

    match updater.check().await {
        Ok(Some(update)) => Ok(available_update_result(
            &update.version,
            update.body.as_deref(),
            update.date.as_ref().map(|date| date.to_string()).as_deref(),
        )),
        Ok(None) => Ok(no_update_result()),
        Err(error) => Ok(unavailable_update_result(&error.to_string())),
    }
}

pub fn unavailable_update_result(error: &str) -> serde_json::Value {
    serde_json::json!({
        "success": false,
        "available": false,
        "error": error,
    })
}

/// Builds the JSON response for a found update. Extracted from
/// `check_for_update` so the renderer-facing shape (success/available/version/
/// body/date) can be unit-tested without a real Update instance.
pub fn available_update_result(
    version: &str,
    body: Option<&str>,
    date: Option<&str>,
) -> serde_json::Value {
    serde_json::json!({
        "success": true,
        "available": true,
        "version": version,
        "body": body,
        "date": date,
    })
}

/// Builds the JSON response when the updater reports no available update.
pub fn no_update_result() -> serde_json::Value {
    serde_json::json!({
        "success": true,
        "available": false,
    })
}

#[cfg(test)]
#[path = "tests/updater_tests.rs"]
mod tests;
