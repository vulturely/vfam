use crate::repositories::fambuddy;

pub async fn execute<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    scope: String,
    account: String,
    input: serde_json::Value,
) -> Result<serde_json::Value, String> {
    fambuddy::execute(app, scope, account, input).await
}
