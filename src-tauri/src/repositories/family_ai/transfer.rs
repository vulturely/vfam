//! One-time key exchange for sending family AI settings to a child's device.
//! X25519 agreement, HKDF-SHA256 bound to the transfer, and AES-256-GCM. Both
//! devices show a code derived from both public keys before anything is sent.
use aes_gcm::{
    aead::{rand_core::RngCore, Aead, KeyInit, OsRng, Payload},
    Aes256Gcm, Nonce,
};
use hkdf::Hkdf;
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroizing;

const INVALID: &str = "The key transfer could not be verified. Start again.";

/// One-time secret held only in memory for a single transfer.
pub struct EphemeralKey(StaticSecret);

impl EphemeralKey {
    pub fn generate() -> Self {
        Self(StaticSecret::random_from_rng(OsRng))
    }
    pub fn public(&self) -> [u8; 32] {
        PublicKey::from(&self.0).to_bytes()
    }
}

/// Everything both devices agree on; any substitution changes the derived key.
pub struct Binding<'a> {
    pub transfer: &'a str,
    pub family: &'a str,
    pub profile: &'a str,
    pub child_public: &'a [u8; 32],
    pub parent_public: &'a [u8; 32],
}

/// Six-digit code both devices display; matching codes prove the same two keys.
pub fn code(transfer: &str, child_public: &[u8; 32], parent_public: &[u8; 32]) -> String {
    let digest = Sha256::new()
        .chain_update(b"vulture-family-ai-code-v1")
        .chain_update(transfer.as_bytes())
        .chain_update(child_public)
        .chain_update(parent_public)
        .finalize();
    let value = u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]]) % 1_000_000;
    format!("{value:06}")
}

fn key(
    own: &EphemeralKey,
    peer: &[u8; 32],
    binding: &Binding<'_>,
) -> Result<Zeroizing<[u8; 32]>, String> {
    let shared = own.0.diffie_hellman(&PublicKey::from(*peer));
    if !shared.was_contributory() {
        return Err(INVALID.into());
    }
    let info = [
        b"vulture-family-ai-key-v1|".as_slice(),
        binding.transfer.as_bytes(),
        b"|",
        binding.family.as_bytes(),
        b"|",
        binding.profile.as_bytes(),
        binding.child_public,
        binding.parent_public,
    ]
    .concat();
    let mut output = Zeroizing::new([0_u8; 32]);
    Hkdf::<Sha256>::new(Some(binding.transfer.as_bytes()), shared.as_bytes())
        .expand(&info, output.as_mut())
        .map_err(|_| INVALID.to_owned())?;
    Ok(output)
}

pub fn seal(
    own: &EphemeralKey,
    peer: &[u8; 32],
    binding: &Binding<'_>,
    plaintext: &[u8],
) -> Result<([u8; 12], Vec<u8>), String> {
    let key = key(own, peer, binding)?;
    let cipher = Aes256Gcm::new_from_slice(key.as_ref()).map_err(|_| INVALID.to_owned())?;
    let mut nonce = [0_u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: binding.transfer.as_bytes(),
            },
        )
        .map_err(|_| INVALID.to_owned())?;
    Ok((nonce, ciphertext))
}

pub fn open(
    own: &EphemeralKey,
    peer: &[u8; 32],
    binding: &Binding<'_>,
    nonce: &[u8],
    ciphertext: &[u8],
) -> Result<Zeroizing<Vec<u8>>, String> {
    if nonce.len() != 12 {
        return Err(INVALID.into());
    }
    let key = key(own, peer, binding)?;
    let cipher = Aes256Gcm::new_from_slice(key.as_ref()).map_err(|_| INVALID.to_owned())?;
    cipher
        .decrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad: binding.transfer.as_bytes(),
            },
        )
        .map(Zeroizing::new)
        .map_err(|_| INVALID.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn binding<'a>(child: &'a [u8; 32], parent: &'a [u8; 32]) -> Binding<'a> {
        Binding {
            transfer: "transfer-1",
            family: "family-1",
            profile: "profile-1",
            child_public: child,
            parent_public: parent,
        }
    }

    #[test]
    fn both_devices_derive_the_same_code_and_key_and_only_the_child_can_open() {
        let child = EphemeralKey::generate();
        let parent = EphemeralKey::generate();
        let (child_public, parent_public) = (child.public(), parent.public());
        assert_eq!(
            code("transfer-1", &child_public, &parent_public),
            code("transfer-1", &child_public, &parent_public)
        );
        assert_eq!(code("transfer-1", &child_public, &parent_public).len(), 6);
        let bound = binding(&child_public, &parent_public);
        let (nonce, sealed) = seal(&parent, &child_public, &bound, b"settings").unwrap();
        assert!(!sealed.windows(8).any(|w| w == b"settings"));
        assert_eq!(
            open(&child, &parent_public, &bound, &nonce, &sealed)
                .unwrap()
                .as_slice(),
            b"settings"
        );
        // An eavesdropper with its own key cannot open it.
        let other = EphemeralKey::generate();
        assert!(open(&other, &parent_public, &bound, &nonce, &sealed).is_err());
    }

    #[test]
    fn substituted_keys_change_the_code_and_break_decryption() {
        let child = EphemeralKey::generate();
        let parent = EphemeralKey::generate();
        let attacker = EphemeralKey::generate();
        let (child_public, parent_public) = (child.public(), parent.public());
        // A relay that swaps in its own key shows a different code on one screen.
        assert_ne!(
            code("transfer-1", &child_public, &parent_public),
            code("transfer-1", &attacker.public(), &parent_public)
        );
        assert_ne!(
            code("transfer-1", &child_public, &parent_public),
            code("transfer-2", &child_public, &parent_public)
        );
        let bound = binding(&child_public, &parent_public);
        let (nonce, sealed) = seal(&parent, &child_public, &bound, b"settings").unwrap();
        let mut moved = binding(&child_public, &parent_public);
        moved.profile = "profile-2";
        assert!(open(&child, &parent_public, &moved, &nonce, &sealed).is_err());
        let mut tampered = sealed.clone();
        tampered[0] ^= 1;
        assert!(open(&child, &parent_public, &bound, &nonce, &tampered).is_err());
        assert!(open(&child, &parent_public, &bound, &nonce[..11], &sealed).is_err());
    }

    #[test]
    fn low_order_public_keys_are_rejected() {
        let own = EphemeralKey::generate();
        let zero = [0_u8; 32];
        let bound = binding(&zero, &zero);
        assert!(seal(&own, &zero, &bound, b"settings").is_err());
    }
}
