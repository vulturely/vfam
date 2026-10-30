use crate::services;

#[tauri::command]
pub async fn app_exit<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    services::app_lifecycle::exit(&app);
}
