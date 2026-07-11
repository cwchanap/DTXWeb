#[macro_use]
mod macros;

mod api;
mod auth;
mod error;
mod filesystem;
mod models;
mod preferences;
mod score_links;
mod scores;
mod songs;
mod updater;

use auth::AuthState;
use tauri::{AppHandle, Manager};
use tauri_plugin_deep_link::DeepLinkExt;

fn spawn_deep_link_handler(app: &AppHandle, raw_url: String) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = crate::auth::handle_deep_link(&handle, &raw_url).await {
            eprintln!("Failed to handle deep link {raw_url}: {error}");
        }
    });
}

/// Used during app startup (`setup`): the deep-link plugin delivers URLs that
/// were passed to launch the app, but the Tauri command layer and AuthState are
/// not ready to resolve them yet (the session mutex/local callback server are
/// still initializing). Queue them and drain once via `drain_pending_auth_events`.
fn queue_deep_link_handler(app: &AppHandle, raw_url: String) {
    let _ = crate::auth::queue_deep_link(app, &raw_url);
}

/// Filters a second-instance launch's argv for `dtx://` deep-link URLs. Any
/// non-`dtx://` argument (executable path, file-open arguments, flags) is
/// ignored. Extracted from the single-instance handler closure so the filter
/// can be unit-tested without a real second-launch event.
fn extract_deep_link_args<I, S>(argv: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    argv.into_iter()
        .map(|arg| arg.as_ref().to_string())
        // Per RFC 3986 the URI scheme is case-insensitive, so an OS-delivered
        // `DTX://` launch argument is just as valid as `dtx://`. Compare against
        // a lowercase copy while keeping the original casing in the captured
        // URL (the auth handler normalizes the scheme itself).
        .filter(|arg| arg.to_ascii_lowercase().starts_with("dtx://"))
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default().manage(AuthState::default());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // A second launch (e.g. clicking a dtx:// link while the app already
            // runs on Windows/Linux) must raise/focus the existing window — the
            // plugin guarantees only the first instance keeps running, so without
            // this the user sees nothing happen even though the link is processed.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            for arg in extract_deep_link_args(argv) {
                spawn_deep_link_handler(app, arg);
            }
        }));
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                for url in urls {
                    queue_deep_link_handler(&handle, url.to_string());
                }
            }

            let deep_link_handle = handle.clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    spawn_deep_link_handler(&deep_link_handle, url.to_string());
                }
            });

            auth::spawn_local_auth_callback_server(&handle);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            auth::open_external_url,
            auth::validate_session,
            auth::get_current_session,
            auth::logout_session,
            auth::drain_pending_auth_events,
            api::fetch_user_simfiles,
            api::get_next_display_id,
            api::search_cloud_songs,
            api::fetch_cloud_song,
            api::update_simfile_record,
            api::create_simfile_record,
            api::load_asset_files,
            api::get_preview_url,
            api::get_sound_preview_url,
            api::upload_file,
            api::fetch_cloud_song_charts,
            api::upload_scores,
            filesystem::select_folder,
            filesystem::path_exists,
            filesystem::list_directories,
            filesystem::list_directory,
            filesystem::list_files,
            filesystem::read_file,
            filesystem::load_tree_structure,
            filesystem::open_folder,
            filesystem::get_default_downloads_dir,
            preferences::read_preferences,
            preferences::write_preferences,
            score_links::read_score_song_links,
            score_links::write_score_song_links,
            songs::create_song,
            songs::export_song_to_zip,
            songs::get_skin_asset,
            songs::parse_dtx_files,
            filesystem::select_dtxmania_db,
            scores::default_dtxmania_db_path,
            scores::parse_dtxmania_scores,
            updater::check_for_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running Drumery desktop");
}

#[cfg(test)]
#[path = "tests/lib_tests.rs"]
mod tests;
