use crate::{
    repositories::server::ServerError,
    services::family_ai::{
        self, AnswerInput, AnswerOutput, ProvisionInput, RunInput, SettingsInput, SettingsStatus,
    },
    services::family_ai_keys::{self, KeyTransferInput, KeyTransferOutput, KeyTransferRegistry},
};

#[tauri::command]
pub async fn family_ai_settings(input: SettingsInput) -> Result<SettingsStatus, ServerError> {
    family_ai::settings(input).await
}

#[tauri::command]
pub async fn family_ai_run(input: RunInput) -> Result<serde_json::Value, ServerError> {
    family_ai::run(input).await
}

#[tauri::command]
pub async fn family_ai_answer(input: AnswerInput) -> Result<AnswerOutput, ServerError> {
    family_ai::answer(input).await
}

#[tauri::command]
pub async fn family_ai_provision_robot(
    input: ProvisionInput,
) -> Result<serde_json::Value, ServerError> {
    family_ai::provision_robot(input).await
}

#[tauri::command]
pub async fn family_ai_key_transfer(
    registry: tauri::State<'_, KeyTransferRegistry>,
    input: KeyTransferInput,
) -> Result<KeyTransferOutput, ServerError> {
    family_ai_keys::key_transfer(&registry, input).await
}
