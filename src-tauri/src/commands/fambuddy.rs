use crate::{
    repositories::server::ServerError,
    services::{fambuddy, fambuddy_approvals, fambuddy_trust},
};

#[tauri::command]
pub async fn fambuddy_storage<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    scope: String,
    account: String,
    input: serde_json::Value,
) -> Result<serde_json::Value, String> {
    fambuddy::execute(app, scope, account, input).await
}

#[tauri::command]
pub async fn fambuddy_certificate(server_url: String) -> Result<String, ServerError> {
    fambuddy_trust::certificate(server_url).await
}

#[tauri::command]
pub async fn fambuddy_trust(input: fambuddy_trust::TrustInput) -> Result<(), ServerError> {
    fambuddy_trust::trust(input).await
}

#[tauri::command]
pub async fn fambuddy_approval_notice<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    input: fambuddy_approvals::ApprovalNoticeInput,
) -> Result<(), String> {
    fambuddy_approvals::notice(&app, &input)
}
