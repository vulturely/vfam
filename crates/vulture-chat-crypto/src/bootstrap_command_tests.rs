use super::*;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;

const NOW: i64 = 1_800_000_000_000;
const DEVICE: &str = "adadf5f9-6598-4461-a52e-e8528910e80d";

fn code() -> String {
    Invite::generate(DEVICE, NOW).unwrap().code().unwrap()
}

#[test]
fn parse_exports_public_metadata_and_derived_bearers_without_shared_secret() {
    let code = code();
    let invite = Invite::parse(&code, NOW).unwrap();
    let metadata = execute(json!({"action": "parse", "code": code}), NOW).unwrap();
    assert_eq!(metadata["id"], invite.id);
    assert_eq!(metadata["device"], DEVICE);
    assert_eq!(metadata["expiresAt"], invite.expires_at);
    assert_eq!(metadata["bearer"], invite.bearer());
    assert_eq!(
        metadata["bootstrapHash"],
        format!("{:x}", Sha256::digest(invite.bearer().as_bytes()))
    );
    assert_eq!(metadata.as_object().unwrap().len(), 5);
    let bytes = URL_SAFE_NO_PAD
        .decode(code.strip_prefix("vfb1.").unwrap())
        .unwrap();
    let wire: Value = serde_json::from_slice(&bytes).unwrap();
    let output = serde_json::to_string(&metadata).unwrap();
    assert!(!output.contains(wire["secret"].as_str().unwrap()));
    assert!(!output.contains(&code));
}

#[test]
fn standard_base64_roundtrip_matches_raw_engine_for_arbitrary_bytes() {
    let code = code();
    let invite = Invite::parse(&code, NOW).unwrap();
    let plaintext: Vec<u8> = (0..=255).collect();
    let sealed = execute(
        json!({
            "action": "seal", "code": code, "direction": "request",
            "plaintext": STANDARD.encode(&plaintext),
        }),
        NOW,
    )
    .unwrap();
    let packet = STANDARD
        .decode(sealed["ciphertext"].as_str().unwrap())
        .unwrap();
    assert_eq!(invite.open("request", &packet, NOW).unwrap(), plaintext);
    let opened = execute(
        json!({
            "action": "open", "code": code, "direction": "request",
            "ciphertext": sealed["ciphertext"],
        }),
        NOW,
    )
    .unwrap();
    assert_eq!(
        STANDARD
            .decode(opened["plaintext"].as_str().unwrap())
            .unwrap(),
        plaintext
    );
    let reply = invite.seal("response", b"device reply", NOW).unwrap();
    let opened = execute(
        json!({
            "action": "open", "code": code, "direction": "response",
            "ciphertext": STANDARD.encode(reply),
        }),
        NOW,
    )
    .unwrap();
    assert_eq!(opened["plaintext"], STANDARD.encode(b"device reply"));
}

#[test]
fn malformed_unknown_or_oversized_inputs_have_only_redacted_errors() {
    let code = code();
    let cases = [
        Value::Null,
        json!([]),
        json!({"action": "generate", "device": DEVICE}),
        json!({"action": "parse", "code": code, "extra": "private"}),
        json!({"action": "parse", "code": 7}),
        json!({"action": "parse", "code": "private invalid code"}),
        json!({"action": "seal", "code": code, "direction": "request", "plaintext": "private invalid base64"}),
        json!({"action": "seal", "code": code, "direction": "request", "plaintext": "", "extra": true}),
        json!({"action": "open", "code": code, "direction": "request", "ciphertext": "", "extra": true}),
        json!({"action": "seal", "code": code, "direction": "invalid", "plaintext": ""}),
        json!({"action": "seal", "code": code, "direction": "request", "plaintext": "A".repeat(MAX_ENCODED_PACKET + 1)}),
        json!({"action": "open", "code": code, "direction": "request", "ciphertext": "A".repeat(MAX_ENCODED_PACKET + 1)}),
        json!({"action": "open", "code": code, "direction": "request", "ciphertext": STANDARD.encode([0; 40])}),
    ];
    for input in cases {
        let error = execute(input, NOW).unwrap_err();
        assert_eq!(error, FAILURE);
        assert!(!error.contains(&code));
        assert!(!error.contains("private"));
    }
    assert_eq!(
        execute(json!({"action": "parse", "code": code}), NOW + 600_000).unwrap_err(),
        FAILURE
    );
}
