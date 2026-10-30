use crate::{
    repositories::{
        chat_transport::{
            AttachmentDownloadInput, AttachmentUploadInput, ChatCommandInput, ChatConnectInput,
            ChatSubscriptionInput,
        },
        server::ServerError,
    },
    services,
};

#[tauri::command]
pub async fn chat_command<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    input: ChatCommandInput,
) -> Result<serde_json::Value, ServerError> {
    services::chat_transport::command(app, input).await
}

#[tauri::command]
pub async fn chat_connect<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    input: ChatConnectInput,
) -> Result<(), ServerError> {
    services::chat_transport::connect(app, input).await
}

#[tauri::command]
pub async fn chat_disconnect<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<(), ServerError> {
    services::chat_transport::disconnect(app).await
}

#[tauri::command]
pub async fn chat_subscribe<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    input: ChatSubscriptionInput,
) -> Result<(), ServerError> {
    services::chat_transport::subscribe(app, input).await
}

#[tauri::command]
pub async fn chat_unsubscribe<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    subscription_id: String,
) -> Result<(), ServerError> {
    services::chat_transport::close(app, subscription_id).await
}

#[tauri::command]
pub async fn chat_attachment_upload<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    input: AttachmentUploadInput,
) -> Result<String, ServerError> {
    services::chat_transport::upload(app, input).await
}

#[tauri::command]
pub async fn chat_attachment_download(
    input: AttachmentDownloadInput,
) -> Result<String, ServerError> {
    services::chat_transport::download(input).await
}
