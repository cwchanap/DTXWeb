#[macro_use]
mod macros;

mod api;
mod auth;
mod error;
mod filesystem;
mod models;
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
            songs::parse_dtx_files,
            updater::check_for_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running Drumery desktop");
}

#[cfg(test)]
mod tests {
    use png::ColorType;
    use std::io::Cursor;

    #[test]
    fn app_icon_decodes_to_non_empty_rgba_pixels() {
        let decoder = png::Decoder::new(Cursor::new(include_bytes!("../icons/icon.png")));
        let mut reader = decoder.read_info().expect("app icon should decode");
        let output_size = reader
            .output_buffer_size()
            .expect("app icon output buffer size should be known");
        let mut pixels = vec![0; output_size];
        let frame = reader
            .next_frame(&mut pixels)
            .expect("app icon should have a readable frame");

        assert!(
            frame.width >= 512,
            "app icon should be high-resolution enough for desktop packaging"
        );
        assert!(
            frame.height >= 512,
            "app icon should be high-resolution enough for desktop packaging"
        );
        assert!(
            frame.buffer_size() > 0,
            "app icon should decode to non-empty pixel data"
        );

        assert_eq!(
            reader.info().color_type,
            ColorType::Rgba,
            "app icon should include an alpha channel"
        );

        let corners = [
            3,
            ((frame.width as usize - 1) * 4) + 3,
            (((frame.height as usize - 1) * frame.width as usize) * 4) + 3,
            (((frame.height as usize * frame.width as usize) - 1) * 4) + 3,
        ];
        for alpha_index in corners {
            assert_eq!(
                pixels[alpha_index], 0,
                "app icon corners should be transparent"
            );
        }
    }
}
