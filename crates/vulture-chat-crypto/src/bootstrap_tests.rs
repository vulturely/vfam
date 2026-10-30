use super::*;
use serde_json::{json, Value};

const NOW: i64 = 1_800_000_000_000;
const DEVICE: &str = "adadf5f9-6598-4461-a52e-e8528910e80d";

fn edited(code: &str, edit: impl FnOnce(&mut Value)) -> String {
    let bytes = URL_SAFE_NO_PAD
        .decode(code.strip_prefix("vfb1.").unwrap())
        .unwrap();
    let mut value: Value = serde_json::from_slice(&bytes).unwrap();
    edit(&mut value);
    format!(
        "vfb1.{}",
        URL_SAFE_NO_PAD.encode(serde_json::to_vec(&value).unwrap())
    )
}

#[test]
fn roundtrip_uses_random_secret_and_nonce_without_exposing_content() {
    let invite = Invite::generate(DEVICE, NOW).unwrap();
    let code = invite.code().unwrap();
    let peer = Invite::parse(&code, NOW).unwrap();
    assert_eq!(peer.id, invite.id);
    assert_eq!(peer.device, DEVICE);
    assert_eq!(peer.bearer(), invite.bearer());
    assert_eq!(invite.bearer().len(), 68);
    assert!(invite.bearer().starts_with("vfb_"));
    let other = Invite::generate(DEVICE, NOW).unwrap();
    assert_ne!(other.bearer(), invite.bearer());
    let text = b"private bootstrap credentials";
    let first = invite.seal("request", text, NOW).unwrap();
    let second = invite.seal("request", text, NOW).unwrap();
    assert_ne!(first, second);
    assert!(!first.windows(text.len()).any(|part| part == text));
    assert_eq!(peer.open("request", &first, NOW).unwrap(), text);
    let answer = peer.seal("response", b"confirmed", NOW).unwrap();
    assert_eq!(invite.open("response", &answer, NOW).unwrap(), b"confirmed");
}

#[test]
fn expiry_is_checked_on_parse_encrypt_and_decrypt_without_clock_overflow() {
    let invite = Invite::generate(DEVICE, NOW).unwrap();
    let code = invite.code().unwrap();
    let packet = invite.seal("request", b"private", NOW).unwrap();
    assert!(Invite::parse(&code, invite.expires_at - 1).is_ok());
    for now in [
        invite.expires_at,
        invite.expires_at + 1,
        NOW - 1,
        -1,
        i64::MAX,
    ] {
        assert!(Invite::parse(&code, now).is_err());
        assert!(invite.seal("request", b"private", now).is_err());
        assert!(invite.open("request", &packet, now).is_err());
    }
    assert!(Invite::generate(DEVICE, i64::MAX).is_err());
    assert!(Invite::generate(DEVICE, -1).is_err());
}

#[test]
fn tampering_direction_and_every_invite_binding_are_rejected() {
    let invite = Invite::generate(DEVICE, NOW).unwrap();
    let code = invite.code().unwrap();
    let packet = invite.seal("request", b"private", NOW).unwrap();
    assert!(invite.open("response", &packet, NOW).is_err());
    assert!(invite.seal("other", b"private", NOW).is_err());
    assert!(invite.open("other", &packet, NOW).is_err());
    assert!(Invite::generate(DEVICE, NOW)
        .unwrap()
        .open("request", &packet, NOW)
        .is_err());
    for index in [0, 11, 12, packet.len() - 1] {
        let mut changed = packet.clone();
        changed[index] ^= 1;
        assert!(invite.open("request", &changed, NOW).is_err());
    }
    for field in ["id", "device"] {
        let changed = edited(&code, |value| {
            value[field] = json!(Uuid::new_v4().to_string())
        });
        assert!(Invite::parse(&changed, NOW)
            .unwrap()
            .open("request", &packet, NOW)
            .is_err());
    }
    let changed = edited(&code, |value| value["expires_at"] = json!(NOW + 1000));
    assert!(Invite::parse(&changed, NOW)
        .unwrap()
        .open("request", &packet, NOW)
        .is_err());
}

#[test]
fn strict_code_validation_and_redacted_errors() {
    let invite = Invite::generate(DEVICE, NOW).unwrap();
    let code = invite.code().unwrap();
    let secret = URL_SAFE_NO_PAD.encode(invite.secret);
    let invalid_codes = [
        "not-a-code".into(),
        format!("vfb1.{}", "A".repeat(MAX_CODE_BYTES)),
        edited(&code, |v| v["extra"] = json!(secret)),
        edited(&code, |v| v["secret"] = json!("wrong")),
        edited(&code, |v| {
            v["secret"] = json!(URL_SAFE_NO_PAD.encode([0; 31]))
        }),
        edited(&code, |v| v["id"] = json!("invalid")),
        edited(&code, |v| v["device"] = json!(Uuid::nil().to_string())),
        edited(&code, |v| {
            v["expires_at"] = json!(NOW + MAX_LIFETIME_MS + 1)
        }),
    ];
    for value in invalid_codes {
        let error = Invite::parse(&value, NOW).err().unwrap();
        assert_eq!(error, FAILURE);
        assert!(!error.contains(&secret));
        assert!(!error.contains(&value));
    }
    assert!(Invite::generate("invalid-device", NOW).is_err());
}

#[test]
fn ciphertext_and_plaintext_limits_include_nonce_and_tag() {
    let invite = Invite::generate(DEVICE, NOW).unwrap();
    let text = vec![42; MAX_PACKET_BYTES - NONCE_BYTES - TAG_BYTES];
    let packet = invite.seal("request", &text, NOW).unwrap();
    assert_eq!(packet.len(), MAX_PACKET_BYTES);
    assert_eq!(invite.open("request", &packet, NOW).unwrap(), text);
    assert!(invite
        .seal("request", &vec![42; text.len() + 1], NOW)
        .is_err());
    assert!(invite
        .open("request", &vec![0; MAX_PACKET_BYTES + 1], NOW)
        .is_err());
    assert!(invite
        .open("request", &[0; NONCE_BYTES + TAG_BYTES - 1], NOW)
        .is_err());
}
