//! Strict JSON bridge shared by native IPC and browser WASM setup clients.
use crate::bootstrap::{Invite, MAX_PACKET_BYTES};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const MAX_ENCODED_PACKET: usize = MAX_PACKET_BYTES.div_ceil(3) * 4;
const FAILURE: &str = "Invalid FamBuddy setup command.";

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
enum Command {
    Parse {
        code: String,
    },
    Seal {
        code: String,
        direction: String,
        plaintext: String,
    },
    Open {
        code: String,
        direction: String,
        ciphertext: String,
    },
}

fn invalid() -> String {
    FAILURE.into()
}

fn decode(encoded: &str) -> Result<Vec<u8>, String> {
    if encoded.len() > MAX_ENCODED_PACKET {
        return Err(invalid());
    }
    STANDARD.decode(encoded).map_err(|_| invalid())
}

pub fn execute(input: Value, now: i64) -> Result<Value, String> {
    let command: Command = serde_json::from_value(input).map_err(|_| invalid())?;
    match command {
        Command::Parse { code } => {
            let invite = Invite::parse(&code, now).map_err(|_| invalid())?;
            let bearer = invite.bearer();
            let bootstrap_hash = format!("{:x}", Sha256::digest(bearer.as_bytes()));
            Ok(json!({
                "id": invite.id,
                "device": invite.device,
                "expiresAt": invite.expires_at,
                "bearer": bearer,
                "bootstrapHash": bootstrap_hash,
            }))
        }
        Command::Seal {
            code,
            direction,
            plaintext,
        } => {
            let invite = Invite::parse(&code, now).map_err(|_| invalid())?;
            let bytes = decode(&plaintext)?;
            let ciphertext = invite
                .seal(&direction, &bytes, now)
                .map_err(|_| invalid())?;
            Ok(json!({ "ciphertext": STANDARD.encode(ciphertext) }))
        }
        Command::Open {
            code,
            direction,
            ciphertext,
        } => {
            let invite = Invite::parse(&code, now).map_err(|_| invalid())?;
            let bytes = decode(&ciphertext)?;
            let plaintext = invite
                .open(&direction, &bytes, now)
                .map_err(|_| invalid())?;
            Ok(json!({ "plaintext": STANDARD.encode(plaintext) }))
        }
    }
}

#[cfg(test)]
#[path = "bootstrap_command_tests.rs"]
mod tests;
