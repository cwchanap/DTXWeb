mod error;
mod filesystem;
mod models;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            filesystem::select_folder,
            filesystem::path_exists,
            filesystem::list_directories,
            filesystem::list_directory,
            filesystem::list_files,
            filesystem::read_file,
            filesystem::load_tree_structure,
            filesystem::open_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running Drumery desktop");
}
