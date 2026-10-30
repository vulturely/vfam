//! Family-owned AI on this device: settings live in the OS credential store and
//! provider calls run here. The Vulture server only prepares prompts and
//! validates output, so it never receives the family's AI key.
use crate::repositories::{
    control, fambuddy_gateway,
    family_ai::{
        keys::{self, FamilyAiConfig},
        provider::{self, Prompt, Target},
    },
    server::{ServerError, UnaryInput},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::future::Future;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingsInput {
    pub server_url: String,
    pub family_id: String,
    pub action: SettingsAction,
    pub config: Option<FamilyAiConfig>,
}

#[derive(Clone, Copy, Deserialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum SettingsAction {
    Status,
    Save,
    Clear,
}

/// What the UI may see: never the API key.
#[derive(Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsStatus {
    pub configured: bool,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub endpoint: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunInput {
    pub server_url: String,
    pub family_id: String,
    pub token: Option<String>,
    pub job_id: String,
}

/// A parent-approved `FamBuddy` question answered with this device's family AI.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnswerInput {
    pub server_url: String,
    pub family_id: String,
    pub question: String,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnswerOutput {
    pub answer: String,
}

/// Stores the family AI key on a `FamBuddy` through its local gateway only.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProvisionInput {
    pub server_url: String,
    pub family_id: String,
    pub gateway: String,
    pub token: String,
    pub device: String,
}

/// External systems used by the service; tests substitute them.
pub trait Ports: Sync {
    fn load(
        &self,
        scope: &str,
    ) -> impl Future<Output = Result<Option<FamilyAiConfig>, String>> + Send;
    fn save(
        &self,
        scope: &str,
        config: FamilyAiConfig,
    ) -> impl Future<Output = Result<(), String>> + Send;
    fn clear(&self, scope: &str) -> impl Future<Output = Result<(), String>> + Send;
    fn server(&self, input: UnaryInput) -> impl Future<Output = Result<Value, ServerError>> + Send;
    fn gateway(&self, input: UnaryInput)
        -> impl Future<Output = Result<Value, ServerError>> + Send;
    fn provider(
        &self,
        target: &Target,
        prompt: &Prompt,
    ) -> impl Future<Output = Result<String, String>> + Send;
}

pub struct Native;

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| "Family AI key storage is unavailable.".to_owned())?
}

impl Ports for Native {
    async fn load(&self, scope: &str) -> Result<Option<FamilyAiConfig>, String> {
        let scope = scope.to_owned();
        blocking(move || keys::load(&scope)).await
    }
    async fn save(&self, scope: &str, config: FamilyAiConfig) -> Result<(), String> {
        let scope = scope.to_owned();
        blocking(move || keys::save(&scope, &config)).await
    }
    async fn clear(&self, scope: &str) -> Result<(), String> {
        let scope = scope.to_owned();
        blocking(move || keys::clear(&scope)).await
    }
    async fn server(&self, input: UnaryInput) -> Result<Value, ServerError> {
        control::execute(input).await
    }
    async fn gateway(&self, input: UnaryInput) -> Result<Value, ServerError> {
        fambuddy_gateway::execute(input).await
    }
    async fn provider(&self, target: &Target, prompt: &Prompt) -> Result<String, String> {
        provider::complete(target, prompt).await
    }
}

pub async fn settings(input: SettingsInput) -> Result<SettingsStatus, ServerError> {
    settings_with(&Native, input).await
}

pub async fn run(input: RunInput) -> Result<Value, ServerError> {
    run_with(&Native, input).await
}

pub async fn answer(input: AnswerInput) -> Result<AnswerOutput, ServerError> {
    answer_with(&Native, input).await
}

pub async fn provision_robot(input: ProvisionInput) -> Result<Value, ServerError> {
    provision_robot_with(&Native, input).await
}

async fn configured(ports: &impl Ports, scope: &str) -> Result<FamilyAiConfig, ServerError> {
    ports
        .load(scope)
        .await
        .map_err(storage_error)?
        .ok_or_else(|| {
            ServerError::new(
                "failed_precondition",
                "Set up your family AI provider on this device first.",
            )
        })
}

/// `FamBuddy` accepts 1–8000 bytes of plain text; answers are bounded the same way.
fn robot_text(text: &str) -> bool {
    !text.trim().is_empty()
        && text.len() <= 8000
        && !text
            .chars()
            .any(|c| c.is_control() && c != '\n' && c != '\t')
}

pub async fn answer_with(
    ports: &impl Ports,
    input: AnswerInput,
) -> Result<AnswerOutput, ServerError> {
    let scope = scope(&input.server_url, &input.family_id)?;
    if !robot_text(&input.question) {
        return Err(ServerError::invalid(
            "Question must be 1–8000 characters of text.",
        ));
    }
    let config = configured(ports, &scope).await?;
    let target = Target::new(&config).map_err(ServerError::invalid)?;
    drop(config);
    // Exactly the parent-approved question, as FamBuddy providers send it.
    let prompt = Prompt {
        system: String::new(),
        user: input.question,
        schema_name: String::new(),
        schema: None,
        max_output_tokens: 1024,
    };
    let answer = ports
        .provider(&target, &prompt)
        .await
        .map_err(ServerError::unavailable)?;
    if !robot_text(&answer) {
        return Err(ServerError::unavailable(
            "AI returned an answer FamBuddy cannot speak. Retry.",
        ));
    }
    Ok(AnswerOutput { answer })
}

pub async fn provision_robot_with(
    ports: &impl Ports,
    input: ProvisionInput,
) -> Result<Value, ServerError> {
    let scope = scope(&input.server_url, &input.family_id)?;
    let device = uuid::Uuid::parse_str(&input.device)
        .ok()
        .filter(|id| !id.is_nil())
        .ok_or_else(|| ServerError::invalid("FamBuddy device required."))?;
    let gateway = url::Url::parse(&input.gateway)
        .map_err(|_| ServerError::invalid("Connect to FamBuddy on your local network first."))?;
    let local = matches!(
        gateway.host_str(),
        Some("localhost" | "127.0.0.1" | "[::1]")
    );
    if (gateway.scheme() != "https" && !(gateway.scheme() == "http" && local))
        || input.token.trim().is_empty()
    {
        return Err(ServerError::invalid(
            "Connect to FamBuddy on your local network first.",
        ));
    }
    let config = configured(ports, &scope).await?;
    let target = Target::new(&config).map_err(ServerError::invalid)?;
    if target.endpoint.scheme() != "https" {
        return Err(ServerError::invalid(
            "FamBuddy needs an HTTPS AI provider. Models on this computer can only answer from this device.",
        ));
    }
    let payload = json!({
        "saveProvider": {
            "device": device.to_string(),
            "config": {
                "provider": config.provider,
                "model": config.model,
                "endpoint": if config.provider == "openai_compatible" { config.endpoint.as_str() } else { "" },
                "apiKey": config.api_key,
                "maxMicrousdPerToken": 0,
            }
        }
    });
    drop(config);
    ports
        .gateway(UnaryInput {
            server_url: input.gateway,
            service: "fambuddy_gateway".into(),
            method: "ParentCommand".into(),
            token: Some(input.token),
            payload,
            timeout_ms: Some(30_000),
        })
        .await
}

/// Keys are scoped to one Vulture server and family on this device.
pub(super) fn scope(server_url: &str, family_id: &str) -> Result<String, ServerError> {
    let url = url::Url::parse(server_url)
        .map_err(|_| ServerError::invalid("Invalid Vulture server URL."))?;
    if !matches!(url.scheme(), "https" | "http") || url.host().is_none() {
        return Err(ServerError::invalid("Invalid Vulture server URL."));
    }
    let family = uuid::Uuid::parse_str(family_id)
        .ok()
        .filter(|id| !id.is_nil())
        .ok_or_else(|| ServerError::invalid("Family required."))?;
    Ok(format!("{}|{family}", url.origin().ascii_serialization()))
}

fn storage_error(message: String) -> ServerError {
    ServerError::unavailable(message)
}

pub async fn settings_with(
    ports: &impl Ports,
    input: SettingsInput,
) -> Result<SettingsStatus, ServerError> {
    let scope = scope(&input.server_url, &input.family_id)?;
    match input.action {
        SettingsAction::Save => {
            let config = input
                .config
                .ok_or_else(|| ServerError::invalid("Enter the AI provider settings."))?;
            Target::new(&config).map_err(ServerError::invalid)?;
            ports.save(&scope, config).await.map_err(storage_error)?;
        }
        SettingsAction::Clear => {
            if input.config.is_some() {
                return Err(ServerError::invalid("Unexpected AI settings."));
            }
            ports.clear(&scope).await.map_err(storage_error)?;
        }
        SettingsAction::Status => {
            if input.config.is_some() {
                return Err(ServerError::invalid("Unexpected AI settings."));
            }
        }
    }
    Ok(ports
        .load(&scope)
        .await
        .map_err(storage_error)?
        .map(|config| SettingsStatus {
            configured: true,
            provider: Some(config.provider.clone()),
            model: Some(config.model.clone()),
            endpoint: (config.provider == "openai_compatible").then(|| config.endpoint.clone()),
        })
        .unwrap_or_default())
}

fn prompt(job: &Value) -> Result<Prompt, ServerError> {
    let waiting = || {
        ServerError::new(
            "failed_precondition",
            "This AI request is not ready to run. It may need approval or may have expired.",
        )
    };
    let prompt = job
        .get("prompt")
        .filter(|p| p.is_object())
        .ok_or_else(waiting)?;
    let text = |name: &str| {
        prompt
            .get(name)
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| ServerError::invalid("The AI request is malformed."))
    };
    let schema = serde_json::from_str(&text("schemaJson")?)
        .map_err(|_| ServerError::invalid("The AI request is malformed."))?;
    let max_output_tokens = prompt
        .get("maxOutputTokens")
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .filter(|value| (1..=32_768).contains(value))
        .ok_or_else(|| ServerError::invalid("The AI request is malformed."))?;
    Ok(Prompt {
        system: text("system")?,
        user: text("user")?,
        schema_name: text("schemaName")?,
        schema: Some(schema),
        max_output_tokens,
    })
}

pub async fn run_with(ports: &impl Ports, input: RunInput) -> Result<Value, ServerError> {
    let scope = scope(&input.server_url, &input.family_id)?;
    let job_id = uuid::Uuid::parse_str(&input.job_id)
        .map_err(|_| ServerError::invalid("AI request ID required."))?
        .to_string();
    let config = configured(ports, &scope).await?;
    let target = Target::new(&config).map_err(ServerError::invalid)?;
    drop(config);
    let call = |method: &str, payload: Value, timeout_ms: u64| UnaryInput {
        server_url: input.server_url.clone(),
        service: "control".into(),
        method: method.into(),
        token: input.token.clone(),
        payload,
        timeout_ms: Some(timeout_ms),
    };
    let job = ports
        .server(call("GetFamilyAiJob", json!({ "id": job_id }), 15_000))
        .await?;
    let prompt = prompt(&job)?;
    let output = ports
        .provider(&target, &prompt)
        .await
        .map_err(ServerError::unavailable)?;
    ports
        .server(call(
            "CompleteFamilyAiJob",
            json!({ "id": job_id, "output": output }),
            30_000,
        ))
        .await
}

#[cfg(test)]
#[path = "family_ai_tests.rs"]
mod tests;
