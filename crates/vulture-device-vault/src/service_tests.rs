use super::{execute, execute_with_key};
use serde_json::{json, Value};

fn run(root: &std::path::Path, input: Value) -> Result<Value, String> {
    execute_with_key(root, "server", "account", input, [7; 32])
}

#[test]
fn records_roundtrip_update_and_conditional_delete() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    assert_eq!(run(root, json!({"action":"get"})).unwrap(), Value::Null);
    run(
        root,
        json!({"action":"put","value":{"token":"secret","pair":{"binding":{"channel":"one"}}}}),
    )
    .unwrap();
    assert_eq!(
        run(root, json!({"action":"get"})).unwrap()["token"],
        "secret"
    );
    run(root, json!({"action":"update_if","value":{"field":"channel","value":"one","replacement":{"token":"secret","pair":{"binding":{"channel":"two"}}}}})).unwrap();
    assert_eq!(
        run(root, json!({"action":"get"})).unwrap()["pair"]["binding"]["channel"],
        "two"
    );
    assert!(run(
        root,
        json!({"action":"update_if","value":{"field":"channel","value":"wrong","replacement":{}}})
    )
    .is_err());
    run(
        root,
        json!({"action":"delete_if","value":{"field":"channel","value":"wrong"}}),
    )
    .unwrap();
    run(
        root,
        json!({"action":"delete_if","value":{"field":"token","value":"secret"}}),
    )
    .unwrap();
    assert_eq!(run(root, json!({"action":"get"})).unwrap(), Value::Null);
    run(root, json!({"action":"put","value":{"token":"again"}})).unwrap();
    run(root, json!({"action":"delete"})).unwrap();
    assert_eq!(run(root, json!({"action":"get"})).unwrap(), Value::Null);
}

#[test]
fn crypto_and_invalid_operations_are_bounded() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    let identity = run(
        root,
        json!({"action":"crypto","command":{"action":"identity"}}),
    )
    .unwrap();
    assert!(identity["deviceId"].is_string());
    assert!(run(root, json!({"action":"crypto"})).is_err());
    assert!(run(root, json!({"action":"put"})).is_err());
    assert!(run(root, json!({"action":"unknown"})).is_err());
    assert!(run(
        root,
        json!({"action":"update_if","value":{"field":"unknown","value":"x"}})
    )
    .is_err());
    assert!(execute(root, "", "account", json!({"action":"get"})).is_err());
    assert!(execute(root, "scope", "", json!({"action":"get"})).is_err());
    assert!(execute(
        root,
        "scope",
        "account",
        json!({"action":"bootstrap","command":{"action":"unknown"}})
    )
    .is_err());
    execute(
        root,
        "scope",
        "account",
        json!({"action":"lease_release","lease":"missing"}),
    )
    .unwrap();
}
