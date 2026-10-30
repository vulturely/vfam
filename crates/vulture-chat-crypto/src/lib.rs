//! Shared MLS engine. Desktop and browser clients use identical wire formats and verification.
//! Persistence is supplied by the client; private state is never sent to the relay.
pub mod bootstrap;
pub mod bootstrap_command;

#[cfg(feature = "browser")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn fambuddy_bootstrap(input: &str, now: f64) -> std::result::Result<String, String> {
    if !now.is_finite()
        || now.fract() != 0.0
        || now < 0.0
        || now > 9_007_199_254_740_991.0
        || input.len() > 300_000
    {
        return Err("Invalid FamBuddy setup command.".into());
    }
    let value = serde_json::from_str(input).map_err(|_| "Invalid FamBuddy setup command.")?;
    let output = bootstrap_command::execute(value, now as i64)?;
    serde_json::to_string(&output).map_err(|_| "Invalid FamBuddy setup command.".into())
}

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use openmls_traits::{storage::StorageProvider as _, OpenMlsProvider};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
#[cfg(not(target_arch = "wasm32"))]
use std::{fs, io::Write, path::Path, sync::Mutex};
use tls_codec::Deserialize as _;

#[cfg(not(target_arch = "wasm32"))]
static LOCK: Mutex<()> = Mutex::new(());
const SUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;
const POOL: usize = 32;
type Result<T> = std::result::Result<T, String>;
fn err(_: impl std::fmt::Debug) -> String {
    "Native encryption operation failed".into()
}
fn fingerprint(key: &[u8]) -> String {
    format!("{:x}", Sha256::digest(key))
}
fn field<'a>(v: &'a Value, name: &str) -> Result<&'a str> {
    v[name].as_str().ok_or_else(|| format!("Missing {name}"))
}
fn decode(s: &str) -> Result<Vec<u8>> {
    B64.decode(s).map_err(err)
}
fn wire(v: &impl tls_codec::Serialize) -> Result<String> {
    Ok(B64.encode(v.tls_serialize_detached().map_err(err)?))
}
fn credential(account: &str, device: &str) -> Credential {
    BasicCredential::new(serde_json::to_vec(&(account, device)).expect("strings serialize")).into()
}
#[derive(Serialize, Deserialize)]
struct State {
    device: String,
    signer: SignatureKeyPair,
    storage: Vec<(Vec<u8>, Vec<u8>)>,
    packages: Vec<String>,
    #[serde(default)]
    issued_packages: Vec<IssuedPackage>,
    #[serde(default)]
    local: Value,
}
#[derive(Serialize, Deserialize)]
struct IssuedPackage {
    reference: KeyPackageRef,
    issued_at: u64,
}
// Welcome may remain recoverable through package advertisement, a group generation,
// and retained messages: retain unused private bundles for at most ninety days.
const PACKAGE_RETENTION: u64 = 90 * 86400;
fn prune_packages(state: &mut State, provider: &OpenMlsRustCrypto, now: u64) -> Result<()> {
    // Discover bundles in pre-tracking state on migration; bound their remaining life
    // from the first upgraded launch without discarding pending historical Welcomes.
    if !state.local["packageTrackingMigrated"]
        .as_bool()
        .unwrap_or(false)
    {
        let bundles: Vec<KeyPackageBundle> = provider
            .storage()
            .values
            .read()
            .map_err(err)?
            .values()
            .filter_map(|bytes| serde_json::from_slice(bytes).ok())
            .collect();
        for bundle in bundles {
            let reference = bundle
                .key_package()
                .hash_ref(provider.crypto())
                .map_err(err)?;
            if !state
                .issued_packages
                .iter()
                .any(|issued| issued.reference == reference)
            {
                state.issued_packages.push(IssuedPackage {
                    reference,
                    issued_at: now,
                });
            }
        }
        state.local["packageTrackingMigrated"] = json!(true);
    }
    let mut retained = vec![];
    for issued in state.issued_packages.drain(..) {
        if issued.issued_at.saturating_add(PACKAGE_RETENTION) <= now {
            provider
                .storage()
                .delete_key_package(&issued.reference)
                .map_err(err)?;
        } else if provider
            .storage()
            .key_package::<KeyPackageRef, KeyPackageBundle>(&issued.reference)
            .map_err(err)?
            .is_some()
        {
            retained.push(issued);
        }
    }
    state.issued_packages = retained;
    Ok(())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Peer {
    account_id: String,
    device_id: String,
    fingerprint: String,
    key_package: Option<String>,
}
fn verify_member(peer: &Peer, cred: &Credential, signature: &[u8]) -> Result<()> {
    if cred != &credential(&peer.account_id, &peer.device_id)
        || fingerprint(signature) != peer.fingerprint
    {
        return Err("Unverified device identity".into());
    }
    Ok(())
}
fn verify_roster(members: impl Iterator<Item = Member>, roster: &[Peer]) -> Result<()> {
    let mut seen = HashSet::new();
    for m in members {
        let peer = roster
            .iter()
            .find(|p| credential(&p.account_id, &p.device_id) == m.credential)
            .ok_or("Unexpected MLS member")?;
        verify_member(peer, &m.credential, &m.signature_key)?;
        if !seen.insert(peer.device_id.clone()) {
            return Err("Duplicate member".into());
        }
    }
    if seen.len() != roster.len() {
        return Err("Incomplete MLS roster".into());
    }
    Ok(())
}
#[cfg(not(target_arch = "wasm32"))]
fn save(path: &Path, bytes: &[u8]) -> Result<()> {
    let temp = path.with_extension("tmp");
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    // A stale temporary file cannot replace the last successfully committed state.
    if temp.exists() {
        fs::remove_file(&temp).map_err(err)?;
    }
    let mut file = options.open(&temp).map_err(err)?;
    file.write_all(bytes).map_err(err)?;
    file.sync_all().map_err(err)?;
    fs::rename(temp, path).map_err(err)?;
    Ok(())
}
fn timestamp(message: &Value) -> u64 {
    message["createdAt"]
        .as_u64()
        .or_else(|| {
            message["createdAt"]
                .as_str()
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                .and_then(|d| u64::try_from(d.timestamp()).ok())
        })
        .or_else(|| message["cachedAt"].as_u64())
        .unwrap_or(0)
}
fn prune_local(state: &mut State, now: u64) -> Result<()> {
    for category in ["history", "outbox"] {
        if let Some(rooms) = state.local[category].as_object_mut() {
            for messages in rooms.values_mut() {
                if let Some(list) = messages.as_array_mut() {
                    list.retain(|m| timestamp(m).saturating_add(30 * 86400) > now);
                }
            }
        }
    }
    Ok(())
}
/// A state transition must be persisted atomically before its output is used.
#[derive(Serialize)]
pub struct CryptoResult {
    pub output: Value,
    pub state: Option<String>,
}
fn finish(output: Value, mut state: State, provider: &OpenMlsRustCrypto) -> Result<CryptoResult> {
    state.storage = provider
        .storage()
        .values
        .read()
        .map_err(err)?
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    Ok(CryptoResult {
        output,
        state: Some(serde_json::to_string(&state).map_err(err)?),
    })
}
fn decrypt_message(
    group: &mut MlsGroup,
    provider: &OpenMlsRustCrypto,
    state: &mut State,
    input: &Value,
    room: &str,
    now: u64,
) -> Result<Value> {
    let message = MlsMessageIn::tls_deserialize_exact(&decode(field(input, "ciphertext")?)?)
        .map_err(err)?
        .try_into_protocol_message()
        .map_err(err)?;
    let message = group.process_message(provider, message).map_err(err)?;
    let sender: BasicCredential = message.credential().clone().try_into().map_err(err)?;
    let (sender_account, sender_device): (String, String) =
        serde_json::from_slice(sender.identity()).map_err(err)?;
    if let Some(expected) = input["message"]["accountId"]
        .as_str()
        .or_else(|| input["message"]["senderId"].as_str())
    {
        if expected != sender_account {
            return Err("Sender metadata does not match MLS credential".into());
        }
    }
    if let Some(expected) = input["message"]["deviceId"].as_str() {
        if expected != sender_device {
            return Err("Device metadata does not match MLS credential".into());
        }
    }
    match message.into_content() {
        ProcessedMessageContent::ApplicationMessage(m) => {
            let plaintext = String::from_utf8(m.into_bytes()).map_err(err)?;
            if input["message"].is_object() {
                let mut message = input["message"].clone();
                if message["id"].is_null() {
                    message["id"] = message["messageId"].clone();
                }
                field(&message, "id")?;
                message
                    .as_object_mut()
                    .ok_or("Invalid message")?
                    .remove("ciphertext");
                message["plaintext"] = json!(plaintext);
                message["payload"] = serde_json::from_str(&plaintext).unwrap_or(json!(plaintext));
                message["cachedAt"] = json!(now);
                if state.local["history"].is_null() {
                    state.local["history"] = json!({});
                }
                if state.local["history"][room].is_null() {
                    state.local["history"][room] = json!([]);
                }
                let list = state.local["history"][room]
                    .as_array_mut()
                    .ok_or("Invalid history")?;
                list.retain(|m| m["id"] != message["id"]);
                list.push(message);
            }
            Ok(json!({"plaintext":plaintext,"senderId":sender_account,"deviceId":sender_device}))
        }
        _ => Err("Expected application message".into()),
    }
}
/// Execute an isolated MLS state transition, using the caller's trusted clock.
pub fn execute_state(
    account: &str,
    input: Value,
    persisted: Option<&str>,
    now: u64,
) -> Result<CryptoResult> {
    if account.is_empty() {
        return Err("Account required".into());
    }
    let action = field(&input, "action")?;
    if action == "forget" {
        return Ok(CryptoResult {
            output: json!({"forgotten":true}),
            state: None,
        });
    }
    let provider = OpenMlsRustCrypto::default();
    let mut state: State = if let Some(persisted) = persisted {
        serde_json::from_str(persisted).map_err(err)?
    } else {
        State {
            device: uuid::Uuid::new_v4().to_string(),
            signer: SignatureKeyPair::new(SUITE.signature_algorithm()).map_err(err)?,
            storage: vec![],
            packages: vec![],
            issued_packages: vec![],
            local: json!({}),
        }
    };
    *provider.storage().values.write().map_err(err)? = state.storage.drain(..).collect();
    let own = CredentialWithKey {
        credential: credential(account, &state.device),
        signature_key: state.signer.to_public_vec().into(),
    };
    prune_local(&mut state, now)?;
    prune_packages(&mut state, &provider, now)?;
    let expired: Vec<_> = if let Some(groups) = state.local["groups"].as_object() {
        groups
            .iter()
            .filter(|(id, time)| {
                !state.local["latest"]
                    .as_object()
                    .is_some_and(|latest| latest.values().any(|v| v.as_str() == Some(id.as_str())))
                    && time.as_u64().unwrap_or(0).saturating_add(30 * 86400) <= now
                    && !state.local["outbox"].as_object().is_some_and(|rooms| {
                        rooms.values().any(|messages| {
                            messages.as_array().is_some_and(|messages| {
                                messages.iter().any(|m| {
                                    GroupId::from_slice(
                                        &serde_json::to_vec(&(
                                            m["roomId"].as_str().unwrap_or(""),
                                            m["generation"].as_u64().unwrap_or(0),
                                        ))
                                        .unwrap_or_default(),
                                    )
                                    .as_slice()
                                        == decode(id).unwrap_or_default()
                                })
                            })
                        })
                    })
            })
            .map(|(id, _)| id.clone())
            .collect()
    } else {
        vec![]
    };
    for key in expired {
        let id = GroupId::from_slice(&decode(&key)?);
        if let Some(mut group) = MlsGroup::load(provider.storage(), &id).map_err(err)? {
            group.delete(provider.storage()).map_err(err)?;
        }
        state.local["groups"]
            .as_object_mut()
            .ok_or("Invalid groups")?
            .remove(&key);
        if let Some(inits) = state.local["initializations"].as_object_mut() {
            inits.remove(&key);
        }
    }
    let output = if matches!(
        action,
        "pin"
            | "pins"
            | "cache"
            | "cacheAndAck"
            | "history"
            | "purge"
            | "pending"
            | "outbox"
            | "ack"
    ) {
        let scope = if matches!(action, "pin" | "pins") {
            field(&input, "familyId")?
        } else {
            field(&input, "roomId")?
        };
        let category = match action {
            "pin" | "pins" => "pins",
            "pending" | "outbox" | "ack" => "outbox",
            _ => "history",
        };
        if state.local[category].is_null() {
            state.local[category] = json!({});
        }
        if state.local[category][scope].is_null() {
            state.local[category][scope] = if category == "pins" {
                json!({})
            } else {
                json!([])
            };
        }
        let data = &mut state.local[category][scope];
        match action {
            "pin" => {
                data[field(&input, "deviceId")?] = json!(field(&input, "fingerprint")?);
                json!({"pinned":true})
            }
            "pins" => json!({"pins":data}),
            "cache" | "cacheAndAck" | "pending" => {
                let mut message = if action == "cache" || action == "cacheAndAck" {
                    input["message"].clone()
                } else {
                    input.clone()
                };
                if !message.is_object() {
                    return Err("Message required".into());
                }
                let key = if action == "cache" || action == "cacheAndAck" {
                    "id"
                } else {
                    "clientId"
                };
                if (action == "cache" || action == "cacheAndAck") && message["id"].is_null() {
                    message["id"] = message["messageId"].clone();
                }
                let id = field(&message, key)?.to_owned();
                message["cachedAt"] = json!(now);
                let list = data.as_array_mut().ok_or("Invalid local history")?;
                list.retain(|m| m[key] != id && timestamp(m).saturating_add(30 * 86400) > now);
                list.push(message);
                if action == "cacheAndAck" {
                    state.local["outbox"][scope]
                        .as_array_mut()
                        .ok_or("Invalid local outbox")?
                        .retain(|m| m["clientId"] != input["clientId"]);
                }
                json!({"stored":true})
            }
            "purge" | "ack" => {
                let list = data.as_array_mut().ok_or("Invalid local history")?;
                list.retain(|m| {
                    if action == "ack" {
                        m["clientId"] != input["clientId"]
                    } else {
                        !input["ids"]
                            .as_array()
                            .is_some_and(|ids| ids.contains(&m["id"]))
                    }
                });
                json!({"removed":true})
            }
            _ => {
                data.as_array_mut()
                    .ok_or("Invalid local history")?
                    .retain(|m| timestamp(m).saturating_add(30 * 86400) > now);
                json!({"messages":data})
            }
        }
    } else if action == "identity" {
        // Packages are single-use; advertised packages are replenished on each registration.
        state.packages.clear();
        for _ in 0..POOL {
            let kp = KeyPackage::builder()
                .key_package_lifetime(Lifetime::new(30 * 86400))
                .build(SUITE, &provider, &state.signer, own.clone())
                .map_err(err)?;
            state.issued_packages.push(IssuedPackage {
                reference: kp.key_package().hash_ref(provider.crypto()).map_err(err)?,
                issued_at: now,
            });
            state.packages.push(wire(kp.key_package())?);
        }
        json!({"deviceId":state.device,"fingerprint":fingerprint(state.signer.public()),"keyPackages":state.packages})
    } else {
        let room = field(&input, "roomId")?;
        let generation = input["generation"].as_u64().ok_or("Generation required")?;
        let id = GroupId::from_slice(&serde_json::to_vec(&(room, generation)).map_err(err)?);
        let init_key = B64.encode(id.as_slice());
        if action == "decryptBatch" {
            if state.local["groups"].is_null() {
                state.local["groups"] = json!({});
            }
            state.local["groups"][&init_key] = json!(now);
            let mut group = MlsGroup::load(provider.storage(), &id)
                .map_err(err)?
                .ok_or("Room keys unavailable")?;
            let messages = input["messages"].as_array().ok_or("Messages required")?;
            let mut outputs = Vec::with_capacity(messages.len());
            for item in messages {
                let command = json!({
                    "action":"decrypt",
                    "roomId":room,
                    "generation":generation,
                    "ciphertext":item["ciphertext"],
                    "message":item["message"],
                });
                outputs.push(decrypt_message(
                    &mut group, &provider, &mut state, &command, room, now,
                )?);
            }
            json!({"messages":outputs})
        } else {
            match action {
                "dropGroup" => {
                    if let Some(mut group) = MlsGroup::load(provider.storage(), &id).map_err(err)? {
                        group.delete(provider.storage()).map_err(err)?;
                    }
                    if let Some(initializations) = state.local["initializations"].as_object_mut() {
                        initializations.remove(&init_key);
                    }
                    json!({"dropped":true})
                }
                "exists" => {
                    let exists = MlsGroup::load(provider.storage(), &id)
                        .map_err(err)?
                        .is_some();
                    let mut output = json!({"exists":exists});
                    if exists {
                        if let Some(welcome) = state.local["initializations"][&init_key]["output"]
                            ["welcomes"]
                            .as_array()
                            .and_then(|welcomes| {
                                welcomes
                                    .iter()
                                    .find(|welcome| welcome["deviceId"] == state.device)
                            })
                            .and_then(|welcome| welcome["ciphertext"].as_str())
                        {
                            output["initializerWelcome"] = json!(welcome);
                        }
                    }
                    output
                }
                "create" => {
                    let roster: Vec<Peer> =
                        serde_json::from_value(input["roster"].clone()).map_err(err)?;
                    if let Some(group) = MlsGroup::load(provider.storage(), &id).map_err(err)? {
                        verify_roster(group.members(), &roster)?;
                        let saved = &state.local["initializations"][&init_key];
                        // verify_roster above compares exact authenticated identities; public
                        // KeyPackages can legitimately change during registration retries.
                        if saved["output"].is_null() {
                            return Err(
                                "Group already exists with a different initialization".into()
                            );
                        }
                        return finish(saved["output"].clone(), state, &provider);
                    }
                    let self_peer = roster
                        .iter()
                        .find(|p| p.device_id == state.device)
                        .ok_or("Self missing from roster")?;
                    verify_member(self_peer, &own.credential, state.signer.public())?;
                    let config = MlsGroupCreateConfig::builder()
                        .ciphersuite(SUITE)
                        .sender_ratchet_configuration(SenderRatchetConfiguration::new(100, 2000))
                        .use_ratchet_tree_extension(true)
                        .build();
                    let mut group =
                        MlsGroup::new_with_group_id(&provider, &state.signer, &config, id, own)
                            .map_err(err)?;
                    let mut packages = vec![];
                    for peer in roster.iter().filter(|p| p.device_id != state.device) {
                        let kp = KeyPackageIn::tls_deserialize_exact(&decode(
                            peer.key_package.as_deref().ok_or("Key package required")?,
                        )?)
                        .map_err(err)?
                        .validate(provider.crypto(), ProtocolVersion::Mls10)
                        .map_err(err)?;
                        verify_member(
                            peer,
                            kp.leaf_node().credential(),
                            kp.leaf_node().signature_key().as_slice(),
                        )?;
                        packages.push(kp);
                    }
                    let mut welcomes = vec![
                        json!({"deviceId":state.device,"ciphertext":B64.encode(b"local-creator-state")}),
                    ];
                    if !packages.is_empty() {
                        let (_, welcome, _) = group
                            .add_members(&provider, &state.signer, &packages)
                            .map_err(err)?;
                        group.merge_pending_commit(&provider).map_err(err)?;
                        let ciphertext = wire(&welcome)?;
                        for peer in roster.iter().filter(|p| p.device_id != state.device) {
                            welcomes
                                .push(json!({"deviceId":peer.device_id,"ciphertext":ciphertext}));
                        }
                    }
                    verify_roster(group.members(), &roster)?;
                    if state.local["groups"].is_null() {
                        state.local["groups"] = json!({});
                    }
                    state.local["groups"][&init_key] = json!(now);
                    if state.local["latest"].is_null() {
                        state.local["latest"] = json!({});
                    }
                    state.local["latest"][room] = json!(init_key);
                    let output = json!({"welcomes":welcomes});
                    if state.local["initializations"].is_null() {
                        state.local["initializations"] = json!({});
                    }
                    state.local["initializations"][&init_key] =
                        json!({"roster":input["roster"],"output":output});
                    output
                }
                "join" => {
                    if MlsGroup::load(provider.storage(), &id)
                        .map_err(err)?
                        .is_some()
                    {
                        return Err("Group already exists".into());
                    }
                    let roster: Vec<Peer> =
                        serde_json::from_value(input["roster"].clone()).map_err(err)?;
                    let welcome = match MlsMessageIn::tls_deserialize_exact(&decode(field(
                        &input, "welcome",
                    )?)?)
                    .map_err(err)?
                    .extract()
                    {
                        MlsMessageBodyIn::Welcome(w) => w,
                        _ => return Err("Expected welcome".into()),
                    };
                    let config = MlsGroupJoinConfig::builder()
                        .sender_ratchet_configuration(SenderRatchetConfiguration::new(100, 2000))
                        .use_ratchet_tree_extension(true)
                        .build();
                    let staged = StagedWelcome::new_from_welcome(&provider, &config, welcome, None)
                        .map_err(err)?;
                    verify_roster(staged.members(), &roster)?;
                    if staged.group_context().group_id() != &id {
                        return Err("Wrong room or generation".into());
                    }
                    staged.into_group(&provider).map_err(err)?;
                    if state.local["groups"].is_null() {
                        state.local["groups"] = json!({});
                    }
                    state.local["groups"][&init_key] = json!(now);
                    if state.local["latest"].is_null() {
                        state.local["latest"] = json!({});
                    }
                    state.local["latest"][room] = json!(init_key);
                    json!({"joined":true})
                }
                "encrypt" | "decrypt" => {
                    if state.local["groups"].is_null() {
                        state.local["groups"] = json!({});
                    }
                    state.local["groups"][&init_key] = json!(now);
                    let mut group = MlsGroup::load(provider.storage(), &id)
                        .map_err(err)?
                        .ok_or("Room keys unavailable")?;
                    if action == "encrypt" {
                        let message = group
                            .create_message(
                                &provider,
                                &state.signer,
                                field(&input, "plaintext")?.as_bytes(),
                            )
                            .map_err(err)?;
                        {
                            let ciphertext = wire(&message)?;
                            if let Some(client_id) = input["clientId"].as_str() {
                                if state.local["outbox"].is_null() {
                                    state.local["outbox"] = json!({});
                                }
                                if state.local["outbox"][room].is_null() {
                                    state.local["outbox"][room] = json!([]);
                                }
                                state.local["outbox"][room].as_array_mut().ok_or("Invalid outbox")?.push(json!({"roomId":room,"generation":generation,"clientId":client_id,"ciphertext":ciphertext,"plaintext":input["plaintext"],"cachedAt":now}));
                            }
                            json!({"ciphertext":ciphertext})
                        }
                    } else {
                        decrypt_message(&mut group, &provider, &mut state, &input, room, now)?
                    }
                }
                _ => return Err("Unknown crypto action".into()),
            }
        }
    };
    prune_local(&mut state, now)?;
    finish(output, state, &provider)
}

/// Desktop adapter: preserve account-scoped atomic files and their existing format.
#[cfg(not(target_arch = "wasm32"))]
pub fn execute(root: &Path, account: &str, input: Value) -> Result<Value> {
    let _guard = LOCK.lock().map_err(err)?;
    if account.is_empty() {
        return Err("Account required".into());
    }
    fs::create_dir_all(root).map_err(err)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(root, fs::Permissions::from_mode(0o700)).map_err(err)?;
    }
    let path = root.join(format!("{}.json", fingerprint(account.as_bytes())));
    if input["action"] == "forget" {
        if path.exists() {
            fs::remove_file(path).map_err(err)?;
        }
        return Ok(json!({"forgotten":true}));
    }
    let persisted = if path.exists() {
        Some(fs::read_to_string(&path).map_err(err)?)
    } else {
        None
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(err)?
        .as_secs();
    let result = execute_state(account, input, persisted.as_deref(), now)?;
    if let Some(state) = result.state {
        save(&path, state.as_bytes())?;
    }
    Ok(result.output)
}

/// Browser adapter: no storage or networking is performed inside the MLS engine.
#[cfg(all(target_arch = "wasm32", feature = "browser"))]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn execute_browser(
    account: &str,
    input: &str,
    persisted: Option<String>,
    now: f64,
) -> std::result::Result<String, wasm_bindgen::JsValue> {
    let run = || -> Result<String> {
        if !now.is_finite() || !(0.0..=9_007_199_254_740_991.0).contains(&now) {
            return Err("Invalid clock".into());
        }
        let input = serde_json::from_str(input).map_err(err)?;
        let result = execute_state(account, input, persisted.as_deref(), now as u64)?;
        serde_json::to_string(&result).map_err(err)
    };
    run().map_err(|message| wasm_bindgen::JsValue::from_str(&message))
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    struct Fixture {
        root: std::path::PathBuf,
        alice: Value,
        bob: Value,
        roster: Value,
    }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("vulture-mls-{}", uuid::Uuid::new_v4()));
            let alice = execute(&root, "alice", json!({"action":"identity"})).unwrap();
            let bob = execute(&root, "bob", json!({"action":"identity"})).unwrap();
            let roster = json!([{"accountId":"alice","deviceId":alice["deviceId"],"fingerprint":alice["fingerprint"],"keyPackage":alice["keyPackages"][0]}, {"accountId":"bob","deviceId":bob["deviceId"],"fingerprint":bob["fingerprint"],"keyPackage":bob["keyPackages"][0]}]);
            Self {
                root,
                alice,
                bob,
                roster,
            }
        }
        fn call(&self, account: &str, mut input: Value) -> Result<Value> {
            input["roomId"] = json!("room");
            if input["generation"].is_null() {
                input["generation"] = json!(1);
            }
            execute(&self.root, account, input)
        }
        fn setup(&self) {
            let created = self
                .call("alice", json!({"action":"create","roster":self.roster}))
                .unwrap();
            self.call("bob",json!({"action":"join","welcome":created["welcomes"][1]["ciphertext"],"roster":self.roster})).unwrap();
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }
    #[test]
    fn ciphertext_roundtrip_reload_order_replay_and_tamper() {
        let f = Fixture::new();
        f.setup();
        let first = f
            .call(
                "alice",
                json!({"action":"encrypt","plaintext":"Secret dinner plan"}),
            )
            .unwrap();
        let second = f
            .call("alice", json!({"action":"encrypt","plaintext":"second"}))
            .unwrap();
        assert!(
            !String::from_utf8_lossy(&decode(first["ciphertext"].as_str().unwrap()).unwrap())
                .contains("Secret dinner plan")
        );
        assert_eq!(
            f.call(
                "bob",
                json!({"action":"decrypt","ciphertext":second["ciphertext"]})
            )
            .unwrap()["plaintext"],
            "second"
        );
        assert_eq!(
            f.call(
                "bob",
                json!({"action":"decrypt","ciphertext":first["ciphertext"]})
            )
            .unwrap()["plaintext"],
            "Secret dinner plan"
        );
        assert!(f
            .call(
                "bob",
                json!({"action":"decrypt","ciphertext":first["ciphertext"]})
            )
            .is_err());
        let mut bytes = decode(second["ciphertext"].as_str().unwrap()).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 1;
        assert!(f
            .call(
                "bob",
                json!({"action":"decrypt","ciphertext":B64.encode(bytes)})
            )
            .is_err());
        for entry in fs::read_dir(&f.root).unwrap() {
            assert!(
                !String::from_utf8_lossy(&fs::read(entry.unwrap().path()).unwrap())
                    .contains("Secret dinner plan")
            );
        }
        let again = execute(&f.root, "alice", json!({"action":"identity"})).unwrap();
        assert_eq!(again["deviceId"], f.alice["deviceId"]);
        assert_eq!(again["fingerprint"], f.alice["fingerprint"]);
    }
    #[test]
    fn batch_decrypt_uses_one_ordered_mls_state_transition() {
        let f = Fixture::new();
        f.setup();
        let first = f
            .call("alice", json!({"action":"encrypt","plaintext":"first"}))
            .unwrap();
        let second = f
            .call("alice", json!({"action":"encrypt","plaintext":"second"}))
            .unwrap();
        let output = f
            .call(
                "bob",
                json!({
                    "action":"decryptBatch",
                    "messages":[
                        {
                            "ciphertext":first["ciphertext"],
                            "message":{"messageId":"first","accountId":"alice","deviceId":f.alice["deviceId"]}
                        },
                        {
                            "ciphertext":second["ciphertext"],
                            "message":{"messageId":"second","accountId":"alice","deviceId":f.alice["deviceId"]}
                        }
                    ]
                }),
            )
            .unwrap();
        assert_eq!(output["messages"][0]["plaintext"], "first");
        assert_eq!(output["messages"][1]["plaintext"], "second");
        let history = f.call("bob", json!({"action":"history"})).unwrap();
        assert_eq!(history["messages"].as_array().unwrap().len(), 2);
    }
    #[test]
    fn rejects_unpinned_roster_wrong_room_and_generation() {
        let f = Fixture::new();
        let created = f
            .call("alice", json!({"action":"create","roster":f.roster}))
            .unwrap();
        let welcome = &created["welcomes"][1]["ciphertext"];
        let mut roster = f.roster.clone();
        roster[0]["fingerprint"] = json!("impostor");
        assert!(f
            .call(
                "bob",
                json!({"action":"join","welcome":welcome,"roster":roster})
            )
            .is_err());
        assert!(execute(&f.root,"bob",json!({"action":"join","roomId":"other","generation":1,"welcome":welcome,"roster":f.roster})).is_err());
        assert!(f
            .call(
                "bob",
                json!({"action":"join","generation":2,"welcome":welcome,"roster":f.roster})
            )
            .is_err());
        f.call(
            "bob",
            json!({"action":"join","welcome":welcome,"roster":f.roster}),
        )
        .unwrap();
        assert_eq!(
            f.call("alice", json!({"action":"create","roster":f.roster}))
                .unwrap(),
            created
        );
    }
    #[test]
    fn removed_device_cannot_read_new_generation() {
        let f = Fixture::new();
        f.setup();
        let roster = json!([f.roster[0]]);
        f.call(
            "alice",
            json!({"action":"create","generation":2,"roster":roster}),
        )
        .unwrap();
        let encrypted = f
            .call(
                "alice",
                json!({"action":"encrypt","generation":2,"plaintext":"after removal"}),
            )
            .unwrap();
        assert!(f
            .call(
                "bob",
                json!({"action":"decrypt","generation":2,"ciphertext":encrypted["ciphertext"]})
            )
            .is_err());
        assert!(f
            .call(
                "bob",
                json!({"action":"decrypt","generation":1,"ciphertext":encrypted["ciphertext"]})
            )
            .is_err());
    }
    #[test]
    fn atomic_outbox_decryption_cache_and_group_reset() {
        let f = Fixture::new();
        f.setup();
        let encrypted=f.call("alice",json!({"action":"encrypt","clientId":"durable","plaintext":"{\"text\":\"durable body\"}"})).unwrap();
        let outbox = f.call("alice", json!({"action":"outbox"})).unwrap();
        assert_eq!(outbox["messages"][0]["ciphertext"], encrypted["ciphertext"]);
        f.call("bob",json!({"action":"decrypt","ciphertext":encrypted["ciphertext"],"message":{"id":"received","sequence":1}})).unwrap();
        let history = f.call("bob", json!({"action":"history"})).unwrap();
        assert_eq!(history["messages"][0]["payload"]["text"], "durable body");
        assert_eq!(
            f.call("bob", json!({"action":"exists"})).unwrap()["exists"],
            true
        );
        f.call("bob", json!({"action":"dropGroup"})).unwrap();
        assert_eq!(
            f.call("bob", json!({"action":"exists"})).unwrap()["exists"],
            false
        );
    }
    #[test]
    fn cache_and_ack_commits_sender_history_and_clears_outbox_together() {
        let f = Fixture::new();
        f.setup();
        f.call(
            "alice",
            json!({"action":"encrypt","clientId":"sent-1","plaintext":"secret"}),
        )
        .unwrap();
        f.call(
            "alice",
            json!({
                "action":"cacheAndAck",
                "clientId":"sent-1",
                "message":{"id":"message-1","messageId":"message-1","payload":{"text":"secret"}}
            }),
        )
        .unwrap();
        assert!(
            f.call("alice", json!({"action":"outbox"})).unwrap()["messages"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            f.call("alice", json!({"action":"history"})).unwrap()["messages"][0]["payload"]["text"],
            "secret"
        );
    }
    #[test]
    fn initialization_retries_allow_refreshed_packages_and_expose_creator_welcome() {
        let f = Fixture::new();
        let created = f
            .call("alice", json!({"action":"create","roster":f.roster}))
            .unwrap();
        let refreshed = execute(&f.root, "bob", json!({"action":"identity"})).unwrap();
        let mut roster = f.roster.clone();
        roster[1]["keyPackage"] = refreshed["keyPackages"][0].clone();
        assert_eq!(
            f.call("alice", json!({"action":"create","roster":roster}))
                .unwrap(),
            created
        );
        let status = f.call("alice", json!({"action":"exists"})).unwrap();
        assert_eq!(
            status["initializerWelcome"],
            created["welcomes"][0]["ciphertext"]
        );
        roster[1]["fingerprint"] = json!("different identity");
        assert!(f
            .call("alice", json!({"action":"create","roster":roster}))
            .is_err());
        f.call("bob",json!({"action":"join","roster":f.roster,"welcome":created["welcomes"][1]["ciphertext"]})).unwrap();
        assert!(f.call("bob", json!({"action":"exists"})).unwrap()["initializerWelcome"].is_null());
    }
    #[test]
    fn unused_package_secrets_expire_but_recent_and_migrated_packages_survive() {
        let f = Fixture::new();
        let path = f.root.join(format!("{}.json", fingerprint(b"alice")));
        let mut state: State = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        let provider = OpenMlsRustCrypto::default();
        *provider.storage().values.write().unwrap() = state.storage.drain(..).collect();
        let now = PACKAGE_RETENTION + 100;
        for (index, issued) in state.issued_packages.iter_mut().enumerate() {
            issued.issued_at = if index == 0 { 100 } else { 101 };
        }
        let expired = state.issued_packages[0].reference.clone();
        let fresh = state.issued_packages[1].reference.clone();
        prune_packages(&mut state, &provider, now).unwrap();
        assert_eq!(state.issued_packages.len(), POOL - 1);
        assert!(provider
            .storage()
            .key_package::<KeyPackageRef, KeyPackageBundle>(&expired)
            .unwrap()
            .is_none());
        assert!(provider
            .storage()
            .key_package::<KeyPackageRef, KeyPackageBundle>(&fresh)
            .unwrap()
            .is_some());
        prune_packages(&mut state, &provider, now + 1).unwrap();
        assert!(state.issued_packages.is_empty());
        assert!(provider
            .storage()
            .key_package::<KeyPackageRef, KeyPackageBundle>(&fresh)
            .unwrap()
            .is_none());
        let mut legacy: Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        legacy.as_object_mut().unwrap().remove("issued_packages");
        legacy["local"]
            .as_object_mut()
            .unwrap()
            .remove("packageTrackingMigrated");
        let mut migrated: State = serde_json::from_value(legacy).unwrap();
        *provider.storage().values.write().unwrap() = migrated.storage.drain(..).collect();
        prune_packages(&mut migrated, &provider, now).unwrap();
        assert_eq!(migrated.issued_packages.len(), POOL);
        assert_eq!(migrated.local["packageTrackingMigrated"], true);
        prune_packages(&mut migrated, &provider, now + PACKAGE_RETENTION).unwrap();
        assert!(migrated.issued_packages.is_empty());
    }
    #[test]
    fn attachments_are_encrypted_and_authenticated() {
        let f = Fixture::new();
        f.setup();
        let attachment=json!({"type":"attachment","filename":"private-school-report.pdf","mimeType":"application/pdf","data":"cHJpdmF0ZSBhdHRhY2htZW50IGJ5dGVz"}).to_string();
        let encrypted = f
            .call("alice", json!({"action":"encrypt","plaintext":attachment}))
            .unwrap();
        let bytes = decode(encrypted["ciphertext"].as_str().unwrap()).unwrap();
        for secret in [
            "private-school-report.pdf",
            "application/pdf",
            "cHJpdmF0ZSBhdHRhY2htZW50IGJ5dGVz",
        ] {
            assert!(!String::from_utf8_lossy(&bytes).contains(secret));
        }
        let mut tampered = bytes;
        let end = tampered.len() - 1;
        tampered[end] ^= 1;
        assert!(f
            .call(
                "bob",
                json!({"action":"decrypt","ciphertext":B64.encode(tampered)})
            )
            .is_err());
        assert_eq!(
            f.call(
                "bob",
                json!({"action":"decrypt","ciphertext":encrypted["ciphertext"]})
            )
            .unwrap()["plaintext"],
            attachment
        );
    }
    #[test]
    fn retention_uses_original_timestamp_on_next_start() {
        let f = Fixture::new();
        f.call("alice",json!({"action":"cache","message":{"id":"expired","createdAt":1,"payload":{"text":"old"}}})).unwrap();
        assert!(
            f.call("alice", json!({"action":"history"})).unwrap()["messages"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            timestamp(&json!({"createdAt":"1970-01-01T00:00:01Z","cachedAt":999})),
            1
        );
        f.setup();
        let encrypted = f
            .call("alice", json!({"action":"encrypt","plaintext":"authentic"}))
            .unwrap();
        assert!(f.call("bob",json!({"action":"decrypt","ciphertext":encrypted["ciphertext"],"message":{"messageId":"message","accountId":"impostor","deviceId":f.alice["deviceId"]}})).is_err());
        assert!(f.call("bob",json!({"action":"decrypt","ciphertext":encrypted["ciphertext"],"message":{"messageId":"message","accountId":"alice","deviceId":"impostor"}})).is_err());
        f.call("bob",json!({"action":"decrypt","ciphertext":encrypted["ciphertext"],"message":{"messageId":"message","accountId":"alice","deviceId":f.alice["deviceId"]}})).unwrap();
        let cached = f.call("bob", json!({"action":"history"})).unwrap();
        assert_eq!(cached["messages"][0]["id"], "message");
        assert!(cached["messages"][0]["ciphertext"].is_null());
    }
    #[test]
    fn local_history_pins_outbox_forget_and_account_isolation() {
        let f = Fixture::new();
        f.call("alice",json!({"action":"pin","familyId":"family","deviceId":f.bob["deviceId"],"fingerprint":f.bob["fingerprint"]})).unwrap();
        let pins = f
            .call("alice", json!({"action":"pins","familyId":"family"}))
            .unwrap();
        assert_eq!(
            pins["pins"][f.bob["deviceId"].as_str().unwrap()],
            f.bob["fingerprint"]
        );
        f.call(
            "alice",
            json!({"action":"cache","message":{"id":"one","payload":{"text":"hello"}}}),
        )
        .unwrap();
        assert_eq!(
            f.call("alice", json!({"action":"history"})).unwrap()["messages"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert!(
            f.call("bob", json!({"action":"history"})).unwrap()["messages"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        f.call("alice", json!({"action":"purge","ids":["one"]}))
            .unwrap();
        assert!(
            f.call("alice", json!({"action":"history"})).unwrap()["messages"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        f.call(
            "alice",
            json!({"action":"pending","clientId":"uuid","ciphertext":"opaque"}),
        )
        .unwrap();
        assert_eq!(
            f.call("alice", json!({"action":"outbox"})).unwrap()["messages"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        f.call("alice", json!({"action":"ack","clientId":"uuid"}))
            .unwrap();
        assert!(
            f.call("alice", json!({"action":"outbox"})).unwrap()["messages"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        f.call("alice", json!({"action":"forget"})).unwrap();
        let new = execute(&f.root, "alice", json!({"action":"identity"})).unwrap();
        assert_ne!(new["deviceId"], f.alice["deviceId"]);
        assert!(execute(&f.root, "", json!({"action":"identity"})).is_err());
        assert!(f.call("alice", json!({"action":"unknown"})).is_err());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for entry in fs::read_dir(&f.root).unwrap() {
                assert_eq!(
                    fs::metadata(entry.unwrap().path())
                        .unwrap()
                        .permissions()
                        .mode()
                        & 0o777,
                    0o600
                );
            }
        }
    }
}
