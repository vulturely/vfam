use crate::{cache_types::CacheRequest, services::storage};

#[tauri::command]
pub async fn local_cache<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: CacheRequest,
    source: Option<String>,
) -> Result<serde_json::Value, String> {
    storage::execute(app, request, source).await
}
