//! Sends family AI settings to a child's device. One-time secrets stay in this
//! process; the server relays only public keys and one ciphertext. Both devices
//! show the same code before the parent sends, so a relay cannot substitute keys.
use super::family_ai::{scope, Ports};
use crate::repositories::{
    family_ai::{
        keys::FamilyAiConfig,
        provider::Target,
        transfer::{self, Binding, EphemeralKey},
    },
    server::{ServerError, UnaryInput},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

const TRANSFER_LIFETIME: Duration = Duration::from_secs(600);

struct Pending {
    secret: EphemeralKey,
    child_public: Option<[u8; 32]>,
    profile: String,
    created: Instant,
}

/// One-time transfer secrets, kept only in memory for their short lifetime.
#[derive(Default)]
pub struct KeyTransferRegistry(Mutex<HashMap<String, Pending>>);

impl KeyTransferRegistry {
    fn insert(&self, id: String, pending: Pending) {
        let mut entries = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        entries.retain(|_, entry| entry.created.elapsed() < TRANSFER_LIFETIME);
        entries.insert(id, pending);
    }
    fn take(&self, id: &str) -> Option<Pending> {
        let mut entries = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        entries.retain(|_, entry| entry.created.elapsed() < TRANSFER_LIFETIME);
        entries.remove(id)
    }
}

#[derive(Deserialize)]
#[serde(
    tag = "action",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum KeyTransferInput {
    /// Child device: start a transfer.
    Offer {
        server_url: String,
        family_id: String,
        token: String,
    },
    /// Child device: show the code, then install the settings once sent.
    Receive {
        server_url: String,
        family_id: String,
        token: String,
        transfer_id: String,
    },
    /// Child device: drop the key when a parent switched back to parent devices.
    Status {
        server_url: String,
        family_id: String,
        token: String,
    },
    /// Parent device: answer an offer and show the code.
    Respond {
        server_url: String,
        family_id: String,
        token: String,
        transfer_id: String,
    },
    /// Parent device: after the codes match, send the encrypted settings.
    Send {
        server_url: String,
        family_id: String,
        token: String,
        transfer_id: String,
    },
}

#[derive(Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyTransferOutput {
    pub transfer_id: Option<String>,
    pub code: Option<String>,
    pub installed: bool,
    pub mode: Option<String>,
}

fn invalid() -> ServerError {
    ServerError::new(
        "failed_precondition",
        "The key transfer expired or could not be verified. Start again.",
    )
}

fn bytes(value: &Value, field: &str) -> Result<Vec<u8>, ServerError> {
    match value.get(field).and_then(Value::as_str) {
        None | Some("") => Ok(Vec::new()),
        Some(encoded) => STANDARD.decode(encoded).map_err(|_| invalid()),
    }
}

fn public(value: &Value, field: &str) -> Result<Option<[u8; 32]>, ServerError> {
    let raw = bytes(value, field)?;
    if raw.is_empty() {
        return Ok(None);
    }
    raw.try_into().map(Some).map_err(|_| invalid())
}

fn text(value: &Value, field: &str) -> Result<String, ServerError> {
    value
        .get(field)
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .map(str::to_owned)
        .ok_or_else(invalid)
}

fn transfer_id(value: &str) -> Result<String, ServerError> {
    uuid::Uuid::parse_str(value)
        .map(|id| id.to_string())
        .map_err(|_| ServerError::invalid("Key transfer ID required."))
}

async fn call(
    ports: &impl Ports,
    server_url: &str,
    token: &str,
    method: &str,
    payload: Value,
) -> Result<Value, ServerError> {
    ports
        .server(UnaryInput {
            server_url: server_url.into(),
            service: "control".into(),
            method: method.into(),
            token: Some(token.into()),
            payload,
            timeout_ms: Some(15_000),
        })
        .await
}

pub async fn key_transfer(
    registry: &KeyTransferRegistry,
    input: KeyTransferInput,
) -> Result<KeyTransferOutput, ServerError> {
    key_transfer_with(&super::family_ai::Native, registry, input).await
}

pub async fn key_transfer_with(
    ports: &impl Ports,
    registry: &KeyTransferRegistry,
    input: KeyTransferInput,
) -> Result<KeyTransferOutput, ServerError> {
    match input {
        KeyTransferInput::Offer {
            server_url,
            family_id,
            token,
        } => {
            offer(
                ports,
                registry,
                &Session::new(server_url, &family_id, token)?,
            )
            .await
        }
        KeyTransferInput::Receive {
            server_url,
            family_id,
            token,
            transfer_id: id,
        } => {
            let session = Session::new(server_url, &family_id, token)?;
            receive(ports, registry, &session, transfer_id(&id)?).await
        }
        KeyTransferInput::Status {
            server_url,
            family_id,
            token,
        } => status(ports, &Session::new(server_url, &family_id, token)?).await,
        KeyTransferInput::Respond {
            server_url,
            family_id,
            token,
            transfer_id: id,
        } => {
            let session = Session::new(server_url, &family_id, token)?;
            respond(ports, registry, &session, transfer_id(&id)?).await
        }
        KeyTransferInput::Send {
            server_url,
            family_id,
            token,
            transfer_id: id,
        } => {
            let session = Session::new(server_url, &family_id, token)?;
            send(ports, registry, &session, transfer_id(&id)?).await
        }
    }
}

/// Validated caller context shared by every transfer step.
struct Session {
    server_url: String,
    token: String,
    scope: String,
    family: String,
}

impl Session {
    fn new(server_url: String, family_id: &str, token: String) -> Result<Self, ServerError> {
        let scope = scope(&server_url, family_id)?;
        let family = scope.rsplit('|').next().unwrap_or_default().to_owned();
        Ok(Self {
            server_url,
            token,
            scope,
            family,
        })
    }
    async fn call(
        &self,
        ports: &impl Ports,
        method: &str,
        payload: Value,
    ) -> Result<Value, ServerError> {
        call(ports, &self.server_url, &self.token, method, payload).await
    }
}

async fn offer(
    ports: &impl Ports,
    registry: &KeyTransferRegistry,
    session: &Session,
) -> Result<KeyTransferOutput, ServerError> {
    let secret = EphemeralKey::generate();
    let offered = session
        .call(
            ports,
            "OfferFamilyAiKey",
            json!({ "childPublicKey": STANDARD.encode(secret.public()) }),
        )
        .await?;
    let id = transfer_id(&text(&offered, "id")?)?;
    registry.insert(
        id.clone(),
        Pending {
            secret,
            child_public: None,
            profile: text(&offered, "profileId")?,
            created: Instant::now(),
        },
    );
    Ok(KeyTransferOutput {
        transfer_id: Some(id),
        ..KeyTransferOutput::default()
    })
}

async fn receive(
    ports: &impl Ports,
    registry: &KeyTransferRegistry,
    session: &Session,
    id: String,
) -> Result<KeyTransferOutput, ServerError> {
    let pending = registry.take(&id).ok_or_else(invalid)?;
    let state = match session
        .call(ports, "GetFamilyAiKeyTransfer", json!({ "id": id }))
        .await
    {
        Ok(state) => state,
        Err(error) => {
            registry.insert(id, pending);
            return Err(error);
        }
    };
    let child_public = pending.secret.public();
    if public(&state, "childPublicKey")? != Some(child_public) {
        return Err(invalid());
    }
    let Some(parent_public) = public(&state, "parentPublicKey")? else {
        registry.insert(id.clone(), pending);
        return Ok(KeyTransferOutput {
            transfer_id: Some(id),
            ..KeyTransferOutput::default()
        });
    };
    let code = transfer::code(&id, &child_public, &parent_public);
    let ciphertext = bytes(&state, "ciphertext")?;
    if ciphertext.is_empty() {
        registry.insert(id.clone(), pending);
        return Ok(KeyTransferOutput {
            transfer_id: Some(id),
            code: Some(code),
            ..KeyTransferOutput::default()
        });
    }
    let plaintext = transfer::open(
        &pending.secret,
        &parent_public,
        &Binding {
            transfer: &id,
            family: &session.family,
            profile: &pending.profile,
            child_public: &child_public,
            parent_public: &parent_public,
        },
        &bytes(&state, "nonce")?,
        &ciphertext,
    )
    .map_err(|_| invalid())?;
    let config: FamilyAiConfig = serde_json::from_slice(&plaintext).map_err(|_| invalid())?;
    Target::new(&config).map_err(ServerError::invalid)?;
    if let Err(error) = ports.save(&session.scope, config).await {
        // Saving can fail transiently; keep the transfer so the child can pick it up again.
        registry.insert(id, pending);
        return Err(ServerError::unavailable(error));
    }
    Ok(KeyTransferOutput {
        transfer_id: Some(id),
        code: Some(code),
        installed: true,
        mode: None,
    })
}

async fn status(ports: &impl Ports, session: &Session) -> Result<KeyTransferOutput, ServerError> {
    let status = session
        .call(ports, "GetFamilyAiChildStatus", json!({}))
        .await?;
    let mode = status
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or("FAMILY_AI_CHILD_MODE_PARENT_DEVICES")
        .to_owned();
    if mode != "FAMILY_AI_CHILD_MODE_CHILD_DEVICE" {
        // Revoked: this device must no longer hold the family key.
        ports
            .clear(&session.scope)
            .await
            .map_err(ServerError::unavailable)?;
    }
    Ok(KeyTransferOutput {
        mode: Some(mode),
        ..KeyTransferOutput::default()
    })
}

async fn respond(
    ports: &impl Ports,
    registry: &KeyTransferRegistry,
    session: &Session,
    id: String,
) -> Result<KeyTransferOutput, ServerError> {
    let listed = session
        .call(ports, "ListFamilyAiKeyTransfers", json!({}))
        .await?;
    let offer = listed
        .get("transfers")
        .and_then(Value::as_array)
        .and_then(|transfers| {
            transfers
                .iter()
                .find(|transfer| transfer.get("id").and_then(Value::as_str) == Some(&id))
        })
        .cloned()
        .ok_or_else(invalid)?;
    let child_public = public(&offer, "childPublicKey")?.ok_or_else(invalid)?;
    let secret = EphemeralKey::generate();
    let parent_public = secret.public();
    session
        .call(
            ports,
            "RespondFamilyAiKeyTransfer",
            json!({ "id": id, "parentPublicKey": STANDARD.encode(parent_public) }),
        )
        .await?;
    registry.insert(
        id.clone(),
        Pending {
            secret,
            child_public: Some(child_public),
            profile: text(&offer, "profileId")?,
            created: Instant::now(),
        },
    );
    Ok(KeyTransferOutput {
        code: Some(transfer::code(&id, &child_public, &parent_public)),
        transfer_id: Some(id),
        ..KeyTransferOutput::default()
    })
}

async fn send(
    ports: &impl Ports,
    registry: &KeyTransferRegistry,
    session: &Session,
    id: String,
) -> Result<KeyTransferOutput, ServerError> {
    let pending = registry.take(&id).ok_or_else(invalid)?;
    // A failed send keeps the transfer, so the parent can retry before it expires.
    match seal_and_send(ports, session, &id, &pending).await {
        Ok(()) => Ok(KeyTransferOutput {
            transfer_id: Some(id),
            installed: true,
            ..KeyTransferOutput::default()
        }),
        Err(error) => {
            registry.insert(id, pending);
            Err(error)
        }
    }
}

async fn seal_and_send(
    ports: &impl Ports,
    session: &Session,
    id: &str,
    pending: &Pending,
) -> Result<(), ServerError> {
    let child_public = pending.child_public.ok_or_else(invalid)?;
    let config = ports
        .load(&session.scope)
        .await
        .map_err(ServerError::unavailable)?
        .ok_or_else(|| {
            ServerError::new(
                "failed_precondition",
                "Set up your family AI provider on this device first.",
            )
        })?;
    let plaintext = zeroize::Zeroizing::new(serde_json::to_vec(&config).map_err(|_| invalid())?);
    drop(config);
    let parent_public = pending.secret.public();
    let (nonce, ciphertext) = transfer::seal(
        &pending.secret,
        &child_public,
        &Binding {
            transfer: id,
            family: &session.family,
            profile: &pending.profile,
            child_public: &child_public,
            parent_public: &parent_public,
        },
        &plaintext,
    )
    .map_err(|_| invalid())?;
    session
        .call(
            ports,
            "SendFamilyAiKey",
            json!({
                "id": id,
                "nonce": STANDARD.encode(nonce),
                "ciphertext": STANDARD.encode(ciphertext),
            }),
        )
        .await?;
    Ok(())
}

#[cfg(test)]
#[path = "family_ai_keys_tests.rs"]
mod tests;
