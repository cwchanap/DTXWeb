#[macro_use]
mod macros;

mod api;
mod api_contracts;
mod device_auth;
mod simfile;
// Auth tests deliberately hold a process-global environment lock across async
// requests so no parallel test can observe partially updated configuration.
#[cfg_attr(test, allow(clippy::await_holding_lock))]
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
#[cfg(all(feature = "e2e", debug_assertions))]
use error::DesktopError;
use scores::DtxmaniaDbState;
use tauri::Manager;
use workspace::WorkspaceRootState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let workspace_state = WorkspaceRootState::load();
    #[cfg(all(feature = "e2e", debug_assertions))]
    let auth_state = AuthState::for_e2e_user(
        &std::env::var("DTX_E2E_DRUMERY_USER_ID")
            .expect("DTX_E2E_DRUMERY_USER_ID is required for a desktop E2E build"),
    )
    .expect("DTX_E2E_DRUMERY_USER_ID must be a stable native identifier");
    #[cfg(not(all(feature = "e2e", debug_assertions)))]
    let auth_state = AuthState::default();
    let mut builder = tauri::Builder::default()
        .manage(auth_state)
        .manage(DtxmaniaDbState::default())
        .manage(workspace_state);

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(
            tauri_plugin_mcp_bridge::Builder::new()
                .bind_address("127.0.0.1")
                .build(),
        );
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // A second launch must raise/focus the existing window. The plugin
            // guarantees only the first instance keeps running.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            #[cfg(feature = "google-drive")]
            app.manage(google_drive::GoogleDriveState::production(
                app.handle().clone(),
            )?);
            #[cfg(all(feature = "e2e", not(feature = "google-drive"), debug_assertions))]
            {
                let user_id = std::env::var("DTX_E2E_DRUMERY_USER_ID").map_err(|_| {
                    DesktopError::Message(
                        "DTX_E2E_DRUMERY_USER_ID is required for a desktop E2E build".to_string(),
                    )
                })?;
                app.manage(google_drive::GoogleDriveState::e2e(&user_id)?);
            }

            // Interrupted Drive uploads may leave a native-only staging
            // directory behind. Cleanup is best-effort and restricted by the
            // helper to the dedicated cache namespace.
            if let Ok(cache_dir) = app.path().app_cache_dir() {
                google_drive::upload::cleanup_stale_upload_archives(&cache_dir);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            auth::open_external_url,
            auth::validate_session,
            auth::get_current_session,
            auth::logout_session,
            auth::begin_device_authorization,
            auth::poll_device_authorization,
            auth::cancel_device_authorization,
            simfile::fetch_user_simfiles,
            simfile::get_next_display_id,
            api::search_cloud_songs,
            simfile::fetch_cloud_song,
            simfile::update_simfile_record,
            simfile::create_simfile_record,
            api::load_asset_files,
            api::get_preview_url,
            api::get_sound_preview_url,
            api::upload_file,
            api::fetch_cloud_song_charts,
            api::upload_scores,
            filesystem::select_folder,
            workspace::select_workspace_folder,
            workspace::get_workspace_root,
            workspace::get_current_workspace_root_id,
            workspace::switch_trusted_workspace,
            workspace::bookmark_current_root,
            workspace::rename_bookmark,
            workspace::remove_bookmark,
            workspace::list_bookmarks,
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
            #[cfg(any(feature = "google-drive", feature = "e2e"))]
            google_drive::commands::get_google_drive_connection_state,
            #[cfg(any(feature = "google-drive", feature = "e2e"))]
            google_drive::commands::connect_google_drive_and_choose_folder,
            #[cfg(any(feature = "google-drive", feature = "e2e"))]
            google_drive::commands::change_google_drive_folder,
            #[cfg(any(feature = "google-drive", feature = "e2e"))]
            google_drive::commands::recheck_google_drive_sharing,
            #[cfg(any(feature = "google-drive", feature = "e2e"))]
            google_drive::commands::disconnect_google_drive,
            #[cfg(any(feature = "google-drive", feature = "e2e"))]
            google_drive::commands::upload_song_zip_to_google_drive,
            #[cfg(any(feature = "google-drive", feature = "e2e"))]
            google_drive::commands::cancel_google_drive_upload,
            #[cfg(feature = "e2e")]
            e2e::read_e2e_session_nonce,
            #[cfg(all(feature = "e2e", debug_assertions))]
            e2e::configure_google_drive_e2e,
            #[cfg(all(feature = "e2e", debug_assertions))]
            e2e::snapshot_google_drive_e2e,
            #[cfg(all(feature = "e2e", debug_assertions))]
            e2e::restore_e2e_auth_session
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

#[cfg(test)]
#[path = "tests/device_auth_tests.rs"]
mod device_auth_tests;
