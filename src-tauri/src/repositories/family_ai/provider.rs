//! Family AI provider calls made from this device with the family's own key.
use super::keys::FamilyAiConfig;
use serde_json::{json, Value};
use std::time::Duration;
use zeroize::Zeroizing;

const MAX_RESPONSE_BYTES: usize = 200_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Protocol {
    OpenAi,
    Compatible,
    Claude,
    Gemini,
}

/// Provider-neutral request. Jobs prepared by the Vulture server carry a JSON
/// schema; parent-approved `FamBuddy` questions are plain text with no system rules.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Prompt {
    pub system: String,
    pub user: String,
    pub schema_name: String,
    pub schema: Option<Value>,
    pub max_output_tokens: u32,
}

/// Where and how to call the provider. The key never leaves this struct.
pub struct Target {
    pub protocol: Protocol,
    pub endpoint: url::Url,
    pub model: String,
    key: Zeroizing<String>,
}

impl std::fmt::Debug for Target {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Target")
            .field("protocol", &self.protocol)
            .field("endpoint", &self.endpoint.as_str())
            .field("model", &self.model)
            .finish_non_exhaustive()
    }
}

impl Target {
    /// Validates settings: fixed vendor endpoints; custom endpoints must be HTTPS,
    /// except plain HTTP to this device's loopback address for local models.
    pub fn new(config: &FamilyAiConfig) -> Result<Self, String> {
        let model = config.model.trim();
        if model.is_empty()
            || model.len() > 100
            || !model
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-._:/".contains(&b))
        {
            return Err("Enter a valid AI model ID.".into());
        }
        if config.api_key.trim().is_empty() && config.provider != "openai_compatible" {
            return Err("Enter the AI provider API key.".into());
        }
        let (protocol, endpoint) = match config.provider.as_str() {
            "openai" => (
                Protocol::OpenAi,
                "https://api.openai.com/v1/chat/completions".to_owned(),
            ),
            "grok" => (
                Protocol::Compatible,
                "https://api.x.ai/v1/chat/completions".to_owned(),
            ),
            "claude" => (
                Protocol::Claude,
                "https://api.anthropic.com/v1/messages".to_owned(),
            ),
            "gemini" => (
                Protocol::Gemini,
                format!(
                    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
                ),
            ),
            "openai_compatible" => (Protocol::Compatible, config.endpoint.trim().to_owned()),
            _ => return Err("Choose a supported AI provider.".into()),
        };
        let endpoint = url::Url::parse(&endpoint).map_err(|_| "Enter a valid provider URL.")?;
        let loopback = match endpoint.host() {
            Some(url::Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
            Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
            Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
            None => false,
        };
        let allowed_scheme = match endpoint.scheme() {
            "https" => true,
            "http" => loopback,
            _ => false,
        };
        if !allowed_scheme
            || endpoint.host().is_none()
            || !endpoint.username().is_empty()
            || endpoint.password().is_some()
            || endpoint.fragment().is_some()
        {
            return Err(
                "Use an HTTPS provider URL, or http://localhost for an AI model on this device."
                    .into(),
            );
        }
        Ok(Self {
            protocol,
            endpoint,
            model: model.to_owned(),
            key: Zeroizing::new(config.api_key.trim().to_owned()),
        })
    }
}

/// Builds the provider request body; rules stay in the system role, data in the user role.
pub fn body(target: &Target, prompt: &Prompt) -> Value {
    let mut messages = Vec::new();
    if !prompt.system.is_empty() {
        messages.push(json!({"role":"system","content":prompt.system}));
    }
    messages.push(json!({"role":"user","content":prompt.user}));
    let structured = prompt.schema.as_ref().map(|schema| {
        json!({"type":"json_schema","json_schema":{"name":prompt.schema_name,"strict":true,"schema":schema}})
    });
    let mut body = match target.protocol {
        Protocol::OpenAi => json!({
            "model":target.model,"store":false,"max_completion_tokens":prompt.max_output_tokens,
            "messages":messages,
        }),
        Protocol::Compatible => json!({
            "model":target.model,"max_tokens":prompt.max_output_tokens,"messages":messages,
        }),
        Protocol::Claude => json!({
            "model":target.model,"max_tokens":prompt.max_output_tokens,
            "messages":[{"role":"user","content":prompt.user}],
        }),
        Protocol::Gemini => json!({
            "contents":[{"role":"user","parts":[{"text":prompt.user}]}],
            "generationConfig":{"maxOutputTokens":prompt.max_output_tokens},
        }),
    };
    match target.protocol {
        Protocol::OpenAi | Protocol::Compatible => {
            if let Some(format) = structured {
                body["response_format"] = format;
            }
        }
        Protocol::Claude => {
            if !prompt.system.is_empty() {
                body["system"] = json!(prompt.system);
            }
            if let Some(schema) = &prompt.schema {
                body["output_config"] = json!({"format":{"type":"json_schema","schema":schema}});
            }
        }
        Protocol::Gemini => {
            if !prompt.system.is_empty() {
                body["systemInstruction"] = json!({"parts":[{"text":prompt.system}]});
            }
            if let Some(schema) = &prompt.schema {
                body["generationConfig"]["responseFormat"] =
                    json!({"text":{"mimeType":"application/json","schema":schema}});
            }
        }
    }
    body
}

pub async fn complete(target: &Target, prompt: &Prompt) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .connect_timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "AI provider client unavailable.")?;
    let request = client
        .post(target.endpoint.clone())
        .json(&body(target, prompt));
    let request = match target.protocol {
        Protocol::OpenAi | Protocol::Compatible if target.key.is_empty() => request,
        Protocol::OpenAi | Protocol::Compatible => request.bearer_auth(target.key.as_str()),
        Protocol::Claude => request
            .header("x-api-key", target.key.as_str())
            .header("anthropic-version", "2023-06-01"),
        Protocol::Gemini => request.header("x-goog-api-key", target.key.as_str()),
    };
    let mut response = request.send().await.map_err(|error| {
        if error.is_timeout() {
            "AI provider timed out. Retry later."
        } else {
            "Could not reach the AI provider. Check the provider URL and connection."
        }
    })?;
    match response.status().as_u16() {
        200 => {}
        401 | 403 => return Err("The AI provider rejected the API key.".into()),
        429 => return Err("AI provider rate limit reached. Retry later.".into()),
        _ => return Err("AI provider is unavailable. Retry later.".into()),
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "AI provider response was interrupted.")?
    {
        if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err("AI provider response is too large.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let body: Value =
        serde_json::from_slice(&bytes).map_err(|_| "AI provider returned an invalid response.")?;
    output(target.protocol, &body)
}

/// Extracts the structured-output text; refusals and truncated output are errors.
pub fn output(protocol: Protocol, body: &Value) -> Result<String, String> {
    const INVALID: &str = "AI provider returned an incomplete response. Retry.";
    const REFUSED: &str = "AI provider refused this request. Review the content and retry.";
    let text = match protocol {
        Protocol::OpenAi | Protocol::Compatible => {
            if body
                .pointer("/choices/0/message/refusal")
                .is_some_and(|v| !v.is_null())
            {
                return Err(REFUSED.into());
            }
            if body
                .pointer("/choices/0/finish_reason")
                .and_then(Value::as_str)
                != Some("stop")
            {
                return Err(INVALID.into());
            }
            body.pointer("/choices/0/message/content")
                .and_then(Value::as_str)
                .map(str::to_owned)
        }
        Protocol::Claude => {
            if body["stop_reason"] == "refusal" {
                return Err(REFUSED.into());
            }
            if body["stop_reason"] != "end_turn" {
                return Err(INVALID.into());
            }
            match body["content"].as_array().map(Vec::as_slice) {
                Some([block]) if block["type"] == "text" => {
                    block["text"].as_str().map(str::to_owned)
                }
                _ => return Err(INVALID.into()),
            }
        }
        Protocol::Gemini => {
            if body.pointer("/promptFeedback/blockReason").is_some() {
                return Err(REFUSED.into());
            }
            if body
                .pointer("/candidates/0/finishReason")
                .and_then(Value::as_str)
                != Some("STOP")
            {
                return Err(INVALID.into());
            }
            let parts = body
                .pointer("/candidates/0/content/parts")
                .and_then(Value::as_array)
                .ok_or(INVALID)?;
            Some(
                parts
                    .iter()
                    .filter(|part| part["thought"] != true)
                    .map(|part| part["text"].as_str().ok_or(INVALID))
                    .collect::<Result<Vec<_>, _>>()?
                    .join(""),
            )
        }
    };
    text.filter(|text| !text.trim().is_empty())
        .ok_or_else(|| INVALID.into())
}

#[cfg(test)]
#[path = "provider_tests.rs"]
mod tests;
