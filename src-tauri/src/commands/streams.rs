use crate::{
    repositories::server::{ServerError, StreamInput},
    services,
};

#[tauri::command]
pub async fn server_stream_open<R: tauri::Runtime + 'static>(
    app: tauri::AppHandle<R>,
    input: StreamInput,
) -> Result<(), ServerError> {
    services::streams::open(app, input).await
}

#[tauri::command]
pub async fn server_stream_close<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    stream_id: String,
) -> Result<(), ServerError> {
    services::streams::close(app, stream_id).await
}
