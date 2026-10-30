use crate::services::auth;

#[tauri::command]
pub async fn start_auth_callback<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    token: String,
) -> Result<String, String> {
    auth::start_callback(app, token).await
}
