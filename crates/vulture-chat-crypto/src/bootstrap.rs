//! One-use bootstrap encryption. The relay receives only a derived bearer and ciphertext.
//! Possession of the high-entropy code authenticates setup; this is not a short-PIN protocol.
use aes_gcm::{
    aead::{
        rand_core::{OsRng, RngCore},
        Aead, KeyInit, Payload,
    },
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub const MAX_PACKET_BYTES: usize = 96 * 1024;
pub const MAX_LIFETIME_MS: i64 = 10 * 60 * 1000;
const NONCE_BYTES: usize = 12;
const TAG_BYTES: usize = 16;
const MAX_CODE_BYTES: usize = 1024;
const FAILURE: &str = "Invalid or expired FamBuddy setup.";
type Result<T> = std::result::Result<T, String>;

// Deliberately no Debug/Serialize: accidental logs must not reveal the setup secret.
pub struct Invite {
    pub id: String,
    pub device: String,
    pub expires_at: i64,
    secret: [u8; 32],
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct WireInvite {
    id: String,
    device: String,
    secret: String,
    expires_at: i64,
}

fn invalid() -> String {
    FAILURE.into()
}

fn valid_uuid(value: &str) -> bool {
    Uuid::parse_str(value).is_ok_and(|id| !id.is_nil() && id.to_string() == value)
}

impl Invite {
    pub fn generate(device: &str, now: i64) -> Result<Self> {
        let expires_at = now.checked_add(MAX_LIFETIME_MS).ok_or_else(invalid)?;
        let mut secret = [0; 32];
        OsRng.try_fill_bytes(&mut secret).map_err(|_| invalid())?;
        let invite = Self {
            id: Uuid::new_v4().to_string(),
            device: device.into(),
            expires_at,
            secret,
        };
        invite.validate(now)?;
        Ok(invite)
    }

    pub fn parse(code: &str, now: i64) -> Result<Self> {
        if code.len() > MAX_CODE_BYTES {
            return Err(invalid());
        }
        let encoded = code.strip_prefix("vfb1.").ok_or_else(invalid)?;
        let bytes = URL_SAFE_NO_PAD.decode(encoded).map_err(|_| invalid())?;
        let wire: WireInvite = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
        let secret = URL_SAFE_NO_PAD
            .decode(&wire.secret)
            .map_err(|_| invalid())?;
        let secret: [u8; 32] = secret.try_into().map_err(|_| invalid())?;
        let invite = Self {
            id: wire.id,
            device: wire.device,
            expires_at: wire.expires_at,
            secret,
        };
        invite.validate(now)?;
        Ok(invite)
    }

    pub fn code(&self) -> Result<String> {
        if !valid_uuid(&self.id) || !valid_uuid(&self.device) || self.expires_at <= 0 {
            return Err(invalid());
        }
        let wire = WireInvite {
            id: self.id.clone(),
            device: self.device.clone(),
            secret: URL_SAFE_NO_PAD.encode(self.secret),
            expires_at: self.expires_at,
        };
        let bytes = serde_json::to_vec(&wire).map_err(|_| invalid())?;
        Ok(format!("vfb1.{}", URL_SAFE_NO_PAD.encode(bytes)))
    }

    pub fn bearer(&self) -> String {
        let mut digest = Sha256::new();
        digest.update(b"vulture.fambuddy.bootstrap.bearer.v1\0");
        digest.update(self.secret);
        format!("vfb_{:x}", digest.finalize())
    }

    pub fn seal(&self, direction: &str, plaintext: &[u8], now: i64) -> Result<Vec<u8>> {
        let aad = self.aad(direction, now)?;
        if plaintext.len() > MAX_PACKET_BYTES - NONCE_BYTES - TAG_BYTES {
            return Err(invalid());
        }
        let cipher = Aes256Gcm::new_from_slice(&self.secret).map_err(|_| invalid())?;
        let mut nonce = [0; NONCE_BYTES];
        OsRng.try_fill_bytes(&mut nonce).map_err(|_| invalid())?;
        let encrypted = cipher
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: plaintext,
                    aad: &aad,
                },
            )
            .map_err(|_| invalid())?;
        let mut packet = Vec::with_capacity(NONCE_BYTES + encrypted.len());
        packet.extend_from_slice(&nonce);
        packet.extend_from_slice(&encrypted);
        Ok(packet)
    }

    pub fn open(&self, direction: &str, ciphertext: &[u8], now: i64) -> Result<Vec<u8>> {
        let aad = self.aad(direction, now)?;
        if !(NONCE_BYTES + TAG_BYTES..=MAX_PACKET_BYTES).contains(&ciphertext.len()) {
            return Err(invalid());
        }
        let cipher = Aes256Gcm::new_from_slice(&self.secret).map_err(|_| invalid())?;
        cipher
            .decrypt(
                Nonce::from_slice(&ciphertext[..NONCE_BYTES]),
                Payload {
                    msg: &ciphertext[NONCE_BYTES..],
                    aad: &aad,
                },
            )
            .map_err(|_| invalid())
    }

    fn validate(&self, now: i64) -> Result<()> {
        if now < 0
            || !valid_uuid(&self.id)
            || !valid_uuid(&self.device)
            || self.expires_at <= now
            || self
                .expires_at
                .checked_sub(now)
                .is_none_or(|left| left > MAX_LIFETIME_MS)
        {
            return Err(invalid());
        }
        Ok(())
    }

    fn aad(&self, direction: &str, now: i64) -> Result<Vec<u8>> {
        self.validate(now)?;
        if !matches!(direction, "request" | "response") {
            return Err(invalid());
        }
        serde_json::to_vec(&(
            "vulture.fambuddy.bootstrap",
            1,
            &self.id,
            &self.device,
            direction,
            self.expires_at,
        ))
        .map_err(|_| invalid())
    }
}

#[cfg(test)]
#[path = "bootstrap_tests.rs"]
mod tests;
