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
mod tests {
    use super::*;

    #[test]
    fn unavailable_result_is_non_blocking() {
        let value = unavailable_update_result("release endpoint is not configured");

        assert_eq!(value["success"], false);
        assert_eq!(value["available"], false);
        assert_eq!(value["error"], "release endpoint is not configured");
    }

    #[test]
    fn available_update_result_includes_version_body_and_date_when_present() {
        // The renderer's update prompt renders `version`, `body` (release
        // notes), and `date` when present — all three must round-trip.
        let value = available_update_result(
            "1.2.3",
            Some("Release notes here"),
            Some("2024-12-31T00:00:00Z"),
        );

        assert_eq!(value["success"], true);
        assert_eq!(value["available"], true);
        assert_eq!(value["version"], "1.2.3");
        assert_eq!(value["body"], "Release notes here");
        assert_eq!(value["date"], "2024-12-31T00:00:00Z");
    }

    #[test]
    fn available_update_result_emits_null_for_missing_body_and_date() {
        // Some updates lack release notes or a publish date. The renderer
        // treats them as optional, so null is the correct shape (not omitted
        // keys — the renderer's destructuring assumes the keys exist).
        let value = available_update_result("1.0.0", None, None);

        assert_eq!(value["success"], true);
        assert_eq!(value["available"], true);
        assert_eq!(value["version"], "1.0.0");
        assert_eq!(value["body"], serde_json::Value::Null);
        assert_eq!(value["date"], serde_json::Value::Null);
    }

    #[test]
    fn no_update_result_reports_success_with_available_false() {
        // The renderer uses `available: false` to hide the update banner;
        // `success: true` distinguishes "checked, no update" from
        // unavailable_result's "couldn't check".
        let value = no_update_result();

        assert_eq!(value["success"], true);
        assert_eq!(value["available"], false);
        assert!(
            value.get("version").is_none(),
            "no_update_result should not advertise a version"
        );
    }
}
