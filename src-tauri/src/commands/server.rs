use crate::{
    repositories::server::{ServerError, UnaryInput},
    services,
};

#[tauri::command]
pub async fn server_unary(input: UnaryInput) -> Result<serde_json::Value, ServerError> {
    services::server::execute(input).await
}
