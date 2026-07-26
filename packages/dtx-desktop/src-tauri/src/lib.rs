#[macro_use]
mod macros;

mod api;
mod auth;
mod error;
mod filesystem;
#[allow(dead_code)]
mod google_drive;
mod models;
mod native_persistence;
mod preferences;
mod scores;
mod songs;
mod updater;
mod workspace;

#[cfg(feature = "e2e")]
mod e2e;

use auth::AuthState;
use scores::DtxmaniaDbState;
use tauri::{AppHandle, Manager};
use tauri_plugin_deep_link::DeepLinkExt;
use workspace::WorkspaceRootState;

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

/// Filters a second-instance launch's argv for deep-link URLs. The production
/// `dtx://` scheme is always accepted; the dev `dtx-dev://` scheme is accepted
/// only in debug builds (the dev build registers `dtx-dev` in
/// `tauri.dev.conf.json` to avoid colliding with an installed production app,
/// and a release build must never honor it). Any non-matching argument
/// (executable path, file-open arguments, flags) is ignored. Extracted from
/// the single-instance handler closure so the filter can be unit-tested
/// without a real second-launch event.
fn extract_deep_link_args<I, S>(argv: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    argv.into_iter()
        .map(|arg| arg.as_ref().to_string())
        // Per RFC 3986 the URI scheme is case-insensitive, so an OS-delivered
        // `DTX://` or `DTX-DEV://` launch argument is just as valid as the
        // lowercase form. Compare against a lowercase copy while keeping the
        // original casing in the captured URL (the auth handler normalizes
        // the scheme itself).
        .filter(|arg| {
            let lower = arg.to_ascii_lowercase();
            lower.starts_with("dtx://")
                || (cfg!(debug_assertions) && lower.starts_with("dtx-dev://"))
        })
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let workspace_state = WorkspaceRootState::load();
    let mut builder = tauri::Builder::default()
        .manage(AuthState::default())
        .manage(DtxmaniaDbState::default())
        .manage(workspace_state);

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

    // The WDIO plugins expose an automation surface (in-process WebDriver
    // server, IPC commands) that must never ship in a release binary. Gate on
    // `debug_assertions` in addition to the `e2e` Cargo feature so
    // `cargo build --release --features e2e` compiles the plugins out. The
    // compile_error below makes a mismatch (e2e without debug) a hard build
    // failure instead of a silent no-op, so CI can't accidentally produce an
    // e2e-capable release artifact.
    #[cfg(all(feature = "e2e", not(debug_assertions)))]
    compile_error!(
        "The `e2e` feature enables WebDriver automation plugins and must not \
         be enabled in release builds (debug_assertions is off). Build with \
         `--debug` or remove `--features e2e`."
    );

    #[cfg(all(feature = "e2e", debug_assertions))]
    {
        builder = builder
            .plugin(tauri_plugin_wdio::init())
            .plugin(tauri_plugin_wdio_webdriver::init());
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            #[cfg(feature = "google-drive")]
            app.manage(google_drive::GoogleDriveState::production(
                app.handle().clone(),
            )?);
            #[cfg(all(feature = "e2e", not(feature = "google-drive")))]
            app.manage(google_drive::GoogleDriveState::e2e()?);

            // Interrupted Drive uploads may leave a native-only staging
            // directory behind. Cleanup is best-effort and restricted by the
            // helper to the dedicated cache namespace.
            if let Ok(cache_dir) = app.path().app_cache_dir() {
                google_drive::upload::cleanup_stale_upload_archives(&cache_dir);
            }
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
            workspace::select_workspace_folder,
            workspace::get_workspace_root,
            workspace::clear_workspace_root,
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
            preferences::read_score_song_links,
            preferences::write_score_song_links,
            songs::create_song,
            songs::export_song_to_zip,
            songs::get_skin_asset,
            songs::parse_dtx_files,
            filesystem::select_dtxmania_db,
            scores::default_dtxmania_db_path,
            scores::parse_dtxmania_scores,
            updater::check_for_update,
            #[cfg(feature = "e2e")]
            e2e::read_e2e_session_nonce
        ])
        .run(tauri::generate_context!())
        .expect("error while running Drumery desktop");
}

#[cfg(test)]
#[path = "tests/lib_tests.rs"]
mod tests;

#[cfg(all(test, feature = "e2e"))]
#[path = "tests/e2e_tests.rs"]
mod e2e_tests;
