use crate::{repositories::server::ServerError, services};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechInput {
    pub text: String,
}

#[tauri::command]
pub async fn speech_speak(input: SpeechInput) -> Result<(), ServerError> {
    services::speech::speak(input.text).await
}

#[tauri::command]
pub async fn speech_stop() {
    services::speech::stop();
}
