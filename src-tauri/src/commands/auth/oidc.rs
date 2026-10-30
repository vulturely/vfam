use crate::{
    repositories::{auth::oidc::DiscoveryInput, server::ServerError},
    services::auth::oidc,
};

#[tauri::command]
pub async fn oidc_discovery(input: DiscoveryInput) -> Result<serde_json::Value, ServerError> {
    oidc::discover(input).await
}

#[tauri::command]
pub async fn oidc_account_input(input: oidc::AccountInput) -> Result<(), ServerError> {
    oidc::validate_account_input(&input)
}
