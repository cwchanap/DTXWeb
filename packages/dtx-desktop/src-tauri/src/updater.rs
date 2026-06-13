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
        Ok(Some(update)) => Ok(serde_json::json!({
            "success": true,
            "available": true,
            "version": update.version,
            "body": update.body,
            "date": update.date.map(|date| date.to_string()),
        })),
        Ok(None) => Ok(serde_json::json!({
            "success": true,
            "available": false,
        })),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unavailable_result_is_non_blocking() {
        let value = unavailable_update_result("release endpoint is not configured");

        assert_eq!(value["success"], false);
        assert_eq!(value["available"], false);
        assert_eq!(value["error"], "release endpoint is not configured");
    }
}
