use super::*;
use std::{collections::HashMap, sync::Mutex};

const FAMILY: &str = "00000000-0000-4000-8000-000000000010";
const JOB: &str = "00000000-0000-4000-8000-0000000000aa";

#[derive(Default)]
struct Fake {
    keys: Mutex<HashMap<String, FamilyAiConfig>>,
    calls: Mutex<Vec<UnaryInput>>,
    prompts: Mutex<Vec<Prompt>>,
    job: Option<Value>,
    provider_error: Option<String>,
}

impl Ports for Fake {
    fn load(
        &self,
        scope: &str,
    ) -> impl Future<Output = Result<Option<FamilyAiConfig>, String>> + Send {
        std::future::ready(Ok(self.keys.lock().unwrap().get(scope).cloned()))
    }
    fn save(
        &self,
        scope: &str,
        config: FamilyAiConfig,
    ) -> impl Future<Output = Result<(), String>> + Send {
        self.keys.lock().unwrap().insert(scope.into(), config);
        std::future::ready(Ok(()))
    }
    fn clear(&self, scope: &str) -> impl Future<Output = Result<(), String>> + Send {
        self.keys.lock().unwrap().remove(scope);
        std::future::ready(Ok(()))
    }
    fn server(&self, input: UnaryInput) -> impl Future<Output = Result<Value, ServerError>> + Send {
        let method = input.method.clone();
        self.calls.lock().unwrap().push(input);
        std::future::ready(match method.as_str() {
            "GetFamilyAiJob" => Ok(self.job.clone().unwrap_or_else(|| json!({}))),
            "CompleteFamilyAiJob" => Ok(json!({"job":{"status":"FAMILY_AI_JOB_STATUS_COMPLETED"}})),
            _ => Err(ServerError::invalid("unexpected")),
        })
    }
    fn gateway(
        &self,
        input: UnaryInput,
    ) -> impl Future<Output = Result<Value, ServerError>> + Send {
        self.calls.lock().unwrap().push(input);
        std::future::ready(Ok(json!({"output":{"settings":[]}})))
    }
    fn provider(
        &self,
        target: &Target,
        prompt: &Prompt,
    ) -> impl Future<Output = Result<String, String>> + Send {
        assert_eq!(target.model, "model-1");
        self.prompts.lock().unwrap().push(prompt.clone());
        std::future::ready(
            self.provider_error
                .clone()
                .map_or_else(|| Ok(r#"{"title":"ok"}"#.into()), Err),
        )
    }
}

fn config() -> FamilyAiConfig {
    FamilyAiConfig {
        provider: "openai_compatible".into(),
        model: "model-1".into(),
        endpoint: "http://localhost:11434/v1/chat/completions".into(),
        api_key: "sk-secret".into(),
    }
}

fn settings(action: SettingsAction, config: Option<FamilyAiConfig>) -> SettingsInput {
    SettingsInput {
        server_url: "https://vulture.example".into(),
        family_id: FAMILY.into(),
        action,
        config,
    }
}

fn ready_job() -> Value {
    json!({
        "id": JOB,
        "status": "FAMILY_AI_JOB_STATUS_READY",
        "prompt": {
            "system": "Rules",
            "user": "{\"topic\":\"data\"}",
            "schemaName": "vulture_practice_v1",
            "schemaJson": "{\"type\":\"object\"}",
            "maxOutputTokens": 4096
        }
    })
}

fn run_input() -> RunInput {
    RunInput {
        server_url: "https://vulture.example/".into(),
        family_id: FAMILY.into(),
        token: Some("vps_token".into()),
        job_id: JOB.into(),
    }
}

#[tokio::test]
async fn settings_are_validated_saved_per_family_and_never_returned_with_the_key() {
    let fake = Fake::default();
    let empty = settings_with(&fake, settings(SettingsAction::Status, None))
        .await
        .unwrap();
    assert_eq!(empty, SettingsStatus::default());
    let saved = settings_with(&fake, settings(SettingsAction::Save, Some(config())))
        .await
        .unwrap();
    assert!(saved.configured);
    assert_eq!(saved.provider.as_deref(), Some("openai_compatible"));
    assert_eq!(
        saved.endpoint.as_deref(),
        Some("http://localhost:11434/v1/chat/completions")
    );
    let shown = serde_json::to_string(&saved).unwrap();
    assert!(!shown.contains("sk-secret"));
    assert_eq!(
        fake.keys
            .lock()
            .unwrap()
            .keys()
            .cloned()
            .collect::<Vec<_>>(),
        vec![format!("https://vulture.example|{FAMILY}")]
    );
    let other_family = SettingsInput {
        family_id: "00000000-0000-4000-8000-000000000011".into(),
        ..settings(SettingsAction::Status, None)
    };
    assert!(!settings_with(&fake, other_family).await.unwrap().configured);
    let cleared = settings_with(&fake, settings(SettingsAction::Clear, None))
        .await
        .unwrap();
    assert!(!cleared.configured);
}

#[tokio::test]
async fn invalid_settings_and_scopes_are_rejected_before_storage() {
    let fake = Fake::default();
    let mut remote_http = config();
    remote_http.endpoint = "http://192.168.1.4:11434/v1".into();
    let mut no_key = config();
    no_key.provider = "openai".into();
    no_key.api_key = String::new();
    for bad in [None, Some(remote_http), Some(no_key)] {
        assert!(settings_with(&fake, settings(SettingsAction::Save, bad))
            .await
            .is_err());
    }
    for (server, family) in [
        ("not a url", FAMILY),
        ("file:///etc", FAMILY),
        ("https://vulture.example", "not-a-uuid"),
        (
            "https://vulture.example",
            "00000000-0000-0000-0000-000000000000",
        ),
    ] {
        let input = SettingsInput {
            server_url: server.into(),
            family_id: family.into(),
            ..settings(SettingsAction::Status, None)
        };
        assert!(
            settings_with(&fake, input).await.is_err(),
            "{server} {family}"
        );
    }
    assert!(
        settings_with(&fake, settings(SettingsAction::Clear, Some(config())))
            .await
            .is_err()
    );
    assert!(
        settings_with(&fake, settings(SettingsAction::Status, Some(config())))
            .await
            .is_err()
    );
    assert!(fake.keys.lock().unwrap().is_empty());
}

#[tokio::test]
async fn run_fetches_the_prompt_calls_the_provider_locally_and_returns_output_to_the_server() {
    let fake = Fake {
        job: Some(ready_job()),
        ..Fake::default()
    };
    fake.keys
        .lock()
        .unwrap()
        .insert(format!("https://vulture.example|{FAMILY}"), config());
    let result = run_with(&fake, run_input()).await.unwrap();
    assert_eq!(result["job"]["status"], "FAMILY_AI_JOB_STATUS_COMPLETED");
    let calls = fake.calls.lock().unwrap().clone();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].method, "GetFamilyAiJob");
    assert_eq!(calls[0].payload, json!({"id": JOB}));
    assert_eq!(calls[1].method, "CompleteFamilyAiJob");
    assert_eq!(
        calls[1].payload,
        json!({"id": JOB, "output": "{\"title\":\"ok\"}"})
    );
    for call in &calls {
        assert_eq!(call.service, "control");
        assert_eq!(call.token.as_deref(), Some("vps_token"));
        // The family's AI key never travels to the Vulture server.
        assert!(!serde_json::to_string(&call.payload)
            .unwrap()
            .contains("sk-secret"));
    }
    let prompts = fake.prompts.lock().unwrap().clone();
    assert_eq!(prompts[0].system, "Rules");
    assert_eq!(prompts[0].schema, Some(json!({"type":"object"})));
    assert_eq!(prompts[0].max_output_tokens, 4096);
}

#[tokio::test]
async fn run_requires_device_settings_a_ready_job_and_a_successful_provider() {
    let unconfigured = Fake {
        job: Some(ready_job()),
        ..Fake::default()
    };
    let error = run_with(&unconfigured, run_input()).await.unwrap_err();
    assert_eq!(error.kind, "failed_precondition");
    assert!(unconfigured.calls.lock().unwrap().is_empty());

    let scope = format!("https://vulture.example|{FAMILY}");
    let waiting = Fake {
        job: Some(json!({"id": JOB, "status": "FAMILY_AI_JOB_STATUS_AWAITING_APPROVAL"})),
        ..Fake::default()
    };
    waiting.keys.lock().unwrap().insert(scope.clone(), config());
    assert_eq!(
        run_with(&waiting, run_input()).await.unwrap_err().kind,
        "failed_precondition"
    );
    assert!(waiting.prompts.lock().unwrap().is_empty());

    let mut malformed = ready_job();
    malformed["prompt"]["schemaJson"] = json!("{not json");
    let broken = Fake {
        job: Some(malformed),
        ..Fake::default()
    };
    broken.keys.lock().unwrap().insert(scope.clone(), config());
    assert!(run_with(&broken, run_input()).await.is_err());

    let failing = Fake {
        job: Some(ready_job()),
        provider_error: Some("The AI provider rejected the API key.".into()),
        ..Fake::default()
    };
    failing.keys.lock().unwrap().insert(scope, config());
    let error = run_with(&failing, run_input()).await.unwrap_err();
    assert_eq!(error.message, "The AI provider rejected the API key.");
    assert_eq!(
        failing.calls.lock().unwrap().len(),
        1,
        "nothing is completed"
    );

    let bad_id = RunInput {
        job_id: "x".into(),
        ..run_input()
    };
    assert!(run_with(&failing, bad_id).await.is_err());
}

fn answer_input(question: &str) -> AnswerInput {
    AnswerInput {
        server_url: "https://vulture.example".into(),
        family_id: FAMILY.into(),
        question: question.into(),
    }
}

#[tokio::test]
async fn approved_fambuddy_questions_are_answered_as_plain_text_on_this_device() {
    let fake = Fake::default();
    assert_eq!(
        answer_with(&fake, answer_input("Why is the sky blue?"))
            .await
            .unwrap_err()
            .kind,
        "failed_precondition"
    );
    fake.keys
        .lock()
        .unwrap()
        .insert(format!("https://vulture.example|{FAMILY}"), config());
    for bad in ["", "   ", "\u{0007}bell"] {
        assert!(answer_with(&fake, answer_input(bad)).await.is_err());
    }
    assert!(answer_with(&fake, answer_input(&"x".repeat(8001)))
        .await
        .is_err());
    assert!(fake.prompts.lock().unwrap().is_empty());
    let output = answer_with(&fake, answer_input("Why is the sky blue?"))
        .await
        .unwrap();
    assert_eq!(output.answer, r#"{"title":"ok"}"#);
    let prompts = fake.prompts.lock().unwrap().clone();
    assert_eq!(prompts[0].user, "Why is the sky blue?");
    assert_eq!(prompts[0].system, "");
    assert!(prompts[0].schema.is_none());
    assert_eq!(prompts[0].max_output_tokens, 1024);
    assert!(
        fake.calls.lock().unwrap().is_empty(),
        "no server or device call"
    );
    let failing = Fake {
        provider_error: Some("AI provider timed out. Retry later.".into()),
        ..Fake::default()
    };
    failing
        .keys
        .lock()
        .unwrap()
        .insert(format!("https://vulture.example|{FAMILY}"), config());
    assert_eq!(
        answer_with(&failing, answer_input("Why?"))
            .await
            .unwrap_err()
            .message,
        "AI provider timed out. Retry later."
    );
}

fn provision_input() -> ProvisionInput {
    ProvisionInput {
        server_url: "https://vulture.example".into(),
        family_id: FAMILY.into(),
        gateway: "https://buddy.local:5443".into(),
        token: "pairing-token".into(),
        device: "00000000-0000-4000-8000-0000000000bb".into(),
    }
}

#[tokio::test]
async fn robot_keys_go_only_to_the_local_fambuddy_gateway() {
    let fake = Fake::default();
    let scope = format!("https://vulture.example|{FAMILY}");
    let mut vendor = config();
    vendor.provider = "claude".into();
    vendor.endpoint = String::new();
    fake.keys.lock().unwrap().insert(scope.clone(), vendor);
    provision_robot_with(&fake, provision_input())
        .await
        .unwrap();
    let calls = fake.calls.lock().unwrap().clone();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].service, "fambuddy_gateway");
    assert_eq!(calls[0].method, "ParentCommand");
    assert_eq!(calls[0].server_url, "https://buddy.local:5443");
    assert_eq!(calls[0].token.as_deref(), Some("pairing-token"));
    assert_eq!(
        calls[0].payload,
        json!({"saveProvider": {
            "device": "00000000-0000-4000-8000-0000000000bb",
            "config": {
                "provider": "claude",
                "model": "model-1",
                "endpoint": "",
                "apiKey": "sk-secret",
                "maxMicrousdPerToken": 0
            }
        }})
    );
}

#[tokio::test]
async fn robot_provisioning_refuses_remote_gateways_local_models_and_bad_input() {
    let fake = Fake::default();
    assert_eq!(
        provision_robot_with(&fake, provision_input())
            .await
            .unwrap_err()
            .kind,
        "failed_precondition"
    );
    fake.keys
        .lock()
        .unwrap()
        .insert(format!("https://vulture.example|{FAMILY}"), config());
    let local_model = provision_robot_with(&fake, provision_input())
        .await
        .unwrap_err();
    assert!(local_model.message.contains("HTTPS AI provider"));
    for input in [
        ProvisionInput {
            gateway: "http://buddy.local:5443".into(),
            ..provision_input()
        },
        ProvisionInput {
            gateway: "not a url".into(),
            ..provision_input()
        },
        ProvisionInput {
            token: " ".into(),
            ..provision_input()
        },
        ProvisionInput {
            device: "00000000-0000-0000-0000-000000000000".into(),
            ..provision_input()
        },
    ] {
        assert!(provision_robot_with(&fake, input).await.is_err());
    }
    assert!(fake.calls.lock().unwrap().is_empty());
}

#[test]
fn prompts_with_missing_fields_or_token_limits_out_of_range_are_rejected() {
    assert!(prompt(&ready_job()).is_ok());
    for (field, value) in [
        ("system", json!(1)),
        ("user", Value::Null),
        ("schemaName", json!([])),
        ("maxOutputTokens", json!(0)),
        ("maxOutputTokens", json!(40_000)),
        ("maxOutputTokens", json!("4096")),
    ] {
        let mut job = ready_job();
        job["prompt"][field] = value;
        assert_eq!(
            prompt(&job).unwrap_err().kind,
            "invalid_argument",
            "{field}"
        );
    }
    let mut job = ready_job();
    job["prompt"] = json!("text");
    assert_eq!(prompt(&job).unwrap_err().kind, "failed_precondition");
}

#[tokio::test]
#[ignore = "requires an unlocked OS credential store; creates and deletes a temporary test key"]
async fn native_ports_keep_settings_in_the_os_store_and_reach_only_the_given_endpoints() {
    // Port 9 (discard) is closed on loopback, so every network call fails fast.
    let server_url = "http://127.0.0.1:9".to_owned();
    let family_id = uuid::Uuid::new_v4().to_string();
    let input = |action, config| SettingsInput {
        server_url: server_url.clone(),
        family_id: family_id.clone(),
        action,
        config,
    };
    let local = FamilyAiConfig {
        provider: "openai_compatible".into(),
        model: "model-1".into(),
        endpoint: "http://127.0.0.1:9/v1/chat/completions".into(),
        api_key: "sk-test".into(),
    };
    let saved = super::settings(input(SettingsAction::Save, Some(local)))
        .await
        .unwrap();
    assert!(saved.configured);
    assert_eq!(
        saved.endpoint.as_deref(),
        Some("http://127.0.0.1:9/v1/chat/completions")
    );
    let ran = run(RunInput {
        server_url: server_url.clone(),
        family_id: family_id.clone(),
        token: Some("vps_parent".into()),
        job_id: JOB.into(),
    })
    .await;
    assert!(ran.is_err(), "the unreachable server is never bypassed");
    let answered = answer(AnswerInput {
        server_url: server_url.clone(),
        family_id: family_id.clone(),
        question: "Why is the sky blue?".into(),
    })
    .await;
    assert_eq!(answered.unwrap_err().kind, "unavailable");
    let remote = FamilyAiConfig {
        provider: "openai".into(),
        model: "model-1".into(),
        endpoint: String::new(),
        api_key: "sk-test".into(),
    };
    super::settings(input(SettingsAction::Save, Some(remote)))
        .await
        .unwrap();
    let provisioned = provision_robot(ProvisionInput {
        server_url: server_url.clone(),
        family_id: family_id.clone(),
        gateway: "http://127.0.0.1:9".into(),
        token: "parent-token".into(),
        device: "00000000-0000-4000-8000-0000000000dd".into(),
    })
    .await;
    assert!(
        provisioned.is_err(),
        "the closed local gateway receives nothing"
    );
    let cleared = super::settings(input(SettingsAction::Clear, None))
        .await
        .unwrap();
    assert!(!cleared.configured);
    assert!(
        !super::settings(input(SettingsAction::Status, None))
            .await
            .unwrap()
            .configured
    );
}
