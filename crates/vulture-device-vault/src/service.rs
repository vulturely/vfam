use super::{files::Vault, keys};
use serde_json::Value;
use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

/// The native host owns this root. Caller never supplies a filename or encryption key.
pub fn execute(root: &Path, scope: &str, account: &str, input: Value) -> Result<Value, String> {
    if scope.len() > 4096 || account.is_empty() || account.len() > 1024 {
        return Err("Invalid FamBuddy storage scope.".into());
    }
    if input["action"] == "bootstrap" {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "Invalid system clock.")?
            .as_millis();
        let now = i64::try_from(now).map_err(|_| "Invalid system clock.")?;
        return vulture_chat_crypto::bootstrap_command::execute(input["command"].clone(), now);
    }
    let record = serde_json::to_string(&(scope, account)).map_err(|_| "Invalid storage scope.")?;
    if input["action"] == "lease_release" {
        return super::leases::execute(root, &record, &input);
    }
    let key = keys::load(root)?;
    if input["action"] == "lease_acquire" {
        return super::leases::execute(root, &record, &input);
    }
    execute_with_key(root, scope, account, input, *key)
}

fn execute_with_key(
    root: &Path,
    scope: &str,
    account: &str,
    input: Value,
    key: [u8; 32],
) -> Result<Value, String> {
    let record = serde_json::to_string(&(scope, account)).map_err(|_| "Invalid storage scope.")?;
    let vault = Vault::open(root, key)?;
    vault.transact(&record, |persisted| match input["action"].as_str() {
        Some("get") => Ok((
            persisted.map(str::to_owned),
            persisted
                .map(serde_json::from_str)
                .transpose()
                .map_err(|_| "Invalid encrypted record.")?
                .unwrap_or(Value::Null),
        )),
        Some("put") => {
            let value = input.get("value").ok_or("Missing encrypted record.")?;
            Ok((
                Some(serde_json::to_string(value).map_err(|_| "Invalid encrypted record.")?),
                Value::Null,
            ))
        }
        Some("delete") => Ok((None, Value::Null)),
        Some("delete_if" | "update_if") => {
            let stored: Value = persisted
                .map(serde_json::from_str)
                .transpose()
                .map_err(|_| "Invalid encrypted record.")?
                .unwrap_or(Value::Null);
            let expected = &input["value"];
            let actual = match expected["field"].as_str() {
                Some("token") => &stored["token"],
                Some("channel") => &stored["pair"]["binding"]["channel"],
                _ => return Err("Invalid record condition.".into()),
            };
            let matches = expected["value"].as_str().is_some() && actual == &expected["value"];
            if input["action"] == "delete_if" {
                Ok((
                    if matches {
                        None
                    } else {
                        persisted.map(str::to_owned)
                    },
                    Value::Null,
                ))
            } else if matches {
                Ok((
                    Some(
                        serde_json::to_string(&expected["replacement"])
                            .map_err(|_| "Invalid encrypted record.")?,
                    ),
                    Value::Null,
                ))
            } else {
                Err("Saved pairing changed. Reload FamBuddy before reconnecting.".into())
            }
        }
        Some("crypto") => {
            let command = input
                .get("command")
                .ok_or("Missing encryption command.")?
                .clone();
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|_| "Invalid system clock.")?
                .as_secs();
            let result = vulture_chat_crypto::execute_state(account, command, persisted, now)?;
            Ok((result.state, result.output))
        }
        _ => Err("Unsupported FamBuddy storage operation.".into()),
    })
}

#[cfg(test)]
#[path = "service_tests.rs"]
mod tests;
