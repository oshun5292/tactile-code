pub mod commands;
pub mod domain;
pub mod services;
pub mod storage;

// 単体テストの exe に tauri 本体(Windows では comctl32 v6 が必要)を持ち込まないため、テスト時は除外
#[cfg(not(test))]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::Manager;

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    builder
        .setup(|app| {
            // 保存先は OS のアプリ専用フォルダ(契約書 §4)
            let dir = app.path().app_data_dir()?;
            app.manage(storage::Store::new(dir.join("projects.json")));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_projects,
            commands::add_project,
            commands::remove_project,
            commands::update_project_note,
            commands::update_project_description,
            commands::move_project,
            commands::refresh_project,
            commands::get_board,
            commands::add_stroke,
            commands::remove_stroke,
            commands::clear_strokes,
            commands::save_viewport,
            commands::list_dir,
            commands::read_file,
            commands::write_file,
            commands::stat_files,
            commands::get_editor_session,
            commands::save_editor_session
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
