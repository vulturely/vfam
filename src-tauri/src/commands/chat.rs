use crate::services::chat;

#[tauri::command]
pub async fn family_chat_crypto<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    account: String,
    input: serde_json::Value,
) -> Result<serde_json::Value, String> {
    chat::execute(app, account, input).await
}
