mod api;
mod auth;
mod error;
mod filesystem;
mod models;
mod songs;

use auth::AuthState;
use tauri::AppHandle;
use tauri_plugin_deep_link::DeepLinkExt;

fn spawn_deep_link_handler(app: &AppHandle, raw_url: String) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = crate::auth::handle_deep_link(&handle, &raw_url).await;
    });
}

fn queue_deep_link_handler(app: &AppHandle, raw_url: String) {
    let _ = crate::auth::queue_deep_link(app, &raw_url);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default().manage(AuthState::default());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            for arg in argv {
                if arg.starts_with("dtx://") {
                    spawn_deep_link_handler(app, arg);
                }
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

            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    spawn_deep_link_handler(&handle, url.to_string());
                }
            });

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
            filesystem::select_folder,
            filesystem::path_exists,
            filesystem::list_directories,
            filesystem::list_directory,
            filesystem::list_files,
            filesystem::read_file,
            filesystem::load_tree_structure,
            filesystem::open_folder,
            songs::create_song,
            songs::export_song_to_zip,
            songs::get_skin_asset,
            songs::parse_dtx_files
        ])
        .run(tauri::generate_context!())
        .expect("error while running Drumery desktop");
}
