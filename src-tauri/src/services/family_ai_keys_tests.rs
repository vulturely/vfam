use super::*;
use crate::repositories::family_ai::provider::Prompt;
use std::{collections::HashMap as Map, future::Future, sync::Arc};

const FAMILY: &str = "00000000-0000-4000-8000-000000000010";
const PROFILE: &str = "00000000-0000-4000-8000-000000000020";
const TRANSFER: &str = "00000000-0000-4000-8000-0000000000cc";
const SERVER: &str = "https://vulture.example";

/// Minimal stand-in for Vulture's relay rules: one transfer, ordered steps, one pickup.
#[derive(Default)]
struct Relay {
    child_public: String,
    parent_public: String,
    nonce: String,
    ciphertext: String,
    picked_up: bool,
    /// Simulates a malicious relay handing the child a different parent key.
    substitute_parent_key: Option<String>,
    mode: &'static str,
}

struct Device {
    keys: Mutex<Map<String, FamilyAiConfig>>,
    relay: Arc<Mutex<Relay>>,
}

impl Device {
    fn new(relay: &Arc<Mutex<Relay>>) -> Self {
        Self {
            keys: Mutex::new(Map::new()),
            relay: relay.clone(),
        }
    }
    fn stored(&self) -> Option<FamilyAiConfig> {
        self.keys.lock().unwrap().get(&scope()).cloned()
    }
}

fn scope() -> String {
    format!("{SERVER}|{FAMILY}")
}

fn relay_call(relay: &mut Relay, method: &str, payload: &Value) -> Result<Value, ServerError> {
    let refused = || ServerError::new("failed_precondition", "refused");
    match method {
        "OfferFamilyAiKey" => {
            relay.child_public = payload["childPublicKey"].as_str().unwrap().into();
            Ok(json!({"id": TRANSFER, "profileId": PROFILE, "childPublicKey": relay.child_public}))
        }
        "ListFamilyAiKeyTransfers" => Ok(json!({"transfers": [{
            "id": TRANSFER, "profileId": PROFILE, "childPublicKey": relay.child_public
        }]})),
        "RespondFamilyAiKeyTransfer" => {
            if !relay.parent_public.is_empty() {
                return Err(refused());
            }
            relay.parent_public = payload["parentPublicKey"].as_str().unwrap().into();
            Ok(json!({}))
        }
        "SendFamilyAiKey" => {
            if relay.parent_public.is_empty() || !relay.ciphertext.is_empty() {
                return Err(refused());
            }
            relay.nonce = payload["nonce"].as_str().unwrap().into();
            relay.ciphertext = payload["ciphertext"].as_str().unwrap().into();
            Ok(json!({}))
        }
        "GetFamilyAiKeyTransfer" => {
            if relay.picked_up {
                return Err(refused());
            }
            if !relay.ciphertext.is_empty() {
                relay.picked_up = true;
            }
            let parent = relay
                .substitute_parent_key
                .clone()
                .unwrap_or_else(|| relay.parent_public.clone());
            Ok(json!({
                "childPublicKey": relay.child_public,
                "parentPublicKey": parent,
                "nonce": relay.nonce,
                "ciphertext": relay.ciphertext,
            }))
        }
        "GetFamilyAiChildStatus" => Ok(json!({"mode": relay.mode})),
        _ => Err(ServerError::invalid("unexpected")),
    }
}

impl Ports for Device {
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
        assert_eq!(input.service, "control");
        // The family key never appears in anything sent to Vulture.
        assert!(!input.payload.to_string().contains("sk-family"));
        let result = relay_call(
            &mut self.relay.lock().unwrap(),
            &input.method,
            &input.payload,
        );
        std::future::ready(result)
    }
    fn gateway(&self, _: UnaryInput) -> impl Future<Output = Result<Value, ServerError>> + Send {
        std::future::ready(Err(ServerError::invalid("unexpected")))
    }
    fn provider(
        &self,
        _: &Target,
        _: &Prompt,
    ) -> impl Future<Output = Result<String, String>> + Send {
        std::future::ready(Err("unexpected".into()))
    }
}

fn family_config() -> FamilyAiConfig {
    FamilyAiConfig {
        provider: "openai".into(),
        model: "gpt-family".into(),
        endpoint: String::new(),
        api_key: "sk-family-secret".into(),
    }
}

fn offer() -> KeyTransferInput {
    KeyTransferInput::Offer {
        server_url: SERVER.into(),
        family_id: FAMILY.into(),
        token: "vcs_child".into(),
    }
}
fn receive() -> KeyTransferInput {
    KeyTransferInput::Receive {
        server_url: SERVER.into(),
        family_id: FAMILY.into(),
        token: "vcs_child".into(),
        transfer_id: TRANSFER.into(),
    }
}
fn respond() -> KeyTransferInput {
    KeyTransferInput::Respond {
        server_url: SERVER.into(),
        family_id: FAMILY.into(),
        token: "vps_parent".into(),
        transfer_id: TRANSFER.into(),
    }
}
fn send() -> KeyTransferInput {
    KeyTransferInput::Send {
        server_url: SERVER.into(),
        family_id: FAMILY.into(),
        token: "vps_parent".into(),
        transfer_id: TRANSFER.into(),
    }
}

#[tokio::test]
async fn matching_codes_let_the_parent_send_the_key_once_to_the_child_device() {
    let relay = Arc::new(Mutex::new(Relay {
        mode: "FAMILY_AI_CHILD_MODE_CHILD_DEVICE",
        ..Relay::default()
    }));
    let (parent, child) = (Device::new(&relay), Device::new(&relay));
    parent.keys.lock().unwrap().insert(scope(), family_config());
    let (parent_secrets, child_secrets) = (
        KeyTransferRegistry::default(),
        KeyTransferRegistry::default(),
    );
    let offered = key_transfer_with(&child, &child_secrets, offer())
        .await
        .unwrap();
    assert_eq!(offered.transfer_id.as_deref(), Some(TRANSFER));
    // Before the parent responds there is no code to compare.
    let waiting = key_transfer_with(&child, &child_secrets, receive())
        .await
        .unwrap();
    assert!(waiting.code.is_none());
    // Sending before responding is impossible.
    assert!(key_transfer_with(&parent, &parent_secrets, send())
        .await
        .is_err());
    let parent_code = key_transfer_with(&parent, &parent_secrets, respond())
        .await
        .unwrap()
        .code
        .unwrap();
    let child_code = key_transfer_with(&child, &child_secrets, receive())
        .await
        .unwrap()
        .code
        .unwrap();
    assert_eq!(parent_code, child_code);
    assert!(child.stored().is_none());
    assert!(
        key_transfer_with(&parent, &parent_secrets, send())
            .await
            .unwrap()
            .installed
    );
    let installed = key_transfer_with(&child, &child_secrets, receive())
        .await
        .unwrap();
    assert!(installed.installed);
    assert_eq!(child.stored().unwrap().api_key, "sk-family-secret");
    // One-time secrets and pickup: a replay fails.
    assert!(key_transfer_with(&child, &child_secrets, receive())
        .await
        .is_err());
    assert!(key_transfer_with(&parent, &parent_secrets, send())
        .await
        .is_err());
}

#[tokio::test]
async fn a_relay_that_swaps_keys_shows_different_codes_and_installs_nothing() {
    let relay = Arc::new(Mutex::new(Relay {
        mode: "FAMILY_AI_CHILD_MODE_CHILD_DEVICE",
        ..Relay::default()
    }));
    let (parent, child) = (Device::new(&relay), Device::new(&relay));
    parent.keys.lock().unwrap().insert(scope(), family_config());
    let (parent_secrets, child_secrets) = (
        KeyTransferRegistry::default(),
        KeyTransferRegistry::default(),
    );
    key_transfer_with(&child, &child_secrets, offer())
        .await
        .unwrap();
    let parent_code = key_transfer_with(&parent, &parent_secrets, respond())
        .await
        .unwrap()
        .code
        .unwrap();
    let attacker = EphemeralKey::generate();
    relay.lock().unwrap().substitute_parent_key = Some(STANDARD.encode(attacker.public()));
    let child_code = key_transfer_with(&child, &child_secrets, receive())
        .await
        .unwrap()
        .code
        .unwrap();
    // The parent sees a mismatch and never presses Send; even if it did,
    // the child cannot decrypt with the substituted key.
    assert_ne!(parent_code, child_code);
    key_transfer_with(&parent, &parent_secrets, send())
        .await
        .unwrap();
    assert!(key_transfer_with(&child, &child_secrets, receive())
        .await
        .is_err());
    assert!(child.stored().is_none());
}

#[tokio::test]
async fn switching_back_to_parent_devices_removes_the_key_from_the_child_device() {
    let relay = Arc::new(Mutex::new(Relay {
        mode: "FAMILY_AI_CHILD_MODE_CHILD_DEVICE",
        ..Relay::default()
    }));
    let child = Device::new(&relay);
    child.keys.lock().unwrap().insert(scope(), family_config());
    let status = || KeyTransferInput::Status {
        server_url: SERVER.into(),
        family_id: FAMILY.into(),
        token: "vcs_child".into(),
    };
    let registry = KeyTransferRegistry::default();
    let kept = key_transfer_with(&child, &registry, status())
        .await
        .unwrap();
    assert_eq!(
        kept.mode.as_deref(),
        Some("FAMILY_AI_CHILD_MODE_CHILD_DEVICE")
    );
    assert!(child.stored().is_some());
    relay.lock().unwrap().mode = "FAMILY_AI_CHILD_MODE_PARENT_DEVICES";
    key_transfer_with(&child, &registry, status())
        .await
        .unwrap();
    assert!(child.stored().is_none());
}

#[tokio::test]
async fn unknown_transfers_and_scopes_are_rejected() {
    let relay = Arc::new(Mutex::new(Relay::default()));
    let device = Device::new(&relay);
    let registry = KeyTransferRegistry::default();
    assert!(key_transfer_with(&device, &registry, receive())
        .await
        .is_err());
    assert!(key_transfer_with(&device, &registry, send()).await.is_err());
    let bad_id = KeyTransferInput::Receive {
        server_url: SERVER.into(),
        family_id: FAMILY.into(),
        token: "vcs_child".into(),
        transfer_id: "not-a-uuid".into(),
    };
    assert!(key_transfer_with(&device, &registry, bad_id).await.is_err());
    let bad_family = KeyTransferInput::Offer {
        server_url: SERVER.into(),
        family_id: "family".into(),
        token: "vcs_child".into(),
    };
    assert!(key_transfer_with(&device, &registry, bad_family)
        .await
        .is_err());
}
