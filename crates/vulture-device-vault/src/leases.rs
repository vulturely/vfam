//! One native relay consumer per MLS identity, including across app processes.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{File, OpenOptions},
    path::Path,
    sync::{Mutex, OnceLock},
};
use uuid::Uuid;
struct Lease {
    record: String,
    _file: File,
}
static LEASES: OnceLock<Mutex<HashMap<String, Lease>>> = OnceLock::new();
const BUSY: &str = "Remote approvals are open in another Vulture window. Close that connection first; restart the app if its window crashed.";

pub(super) fn execute(root: &Path, record: &str, input: &Value) -> Result<Value, String> {
    let mut leases = LEASES
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| BUSY)?;
    if input["action"] == "lease_release" {
        let id = input["lease"].as_str().ok_or(BUSY)?;
        if leases.get(id).is_some_and(|lease| lease.record == record) {
            leases.remove(id);
        }
        return Ok(Value::Null);
    }
    if leases.len() >= 16 {
        return Err(BUSY.into());
    }
    let path = root.join(format!(
        "lease-{:x}.lock",
        Sha256::digest(record.as_bytes())
    ));
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(path).map_err(|_| BUSY)?;
    file.try_lock().map_err(|_| BUSY)?;
    let id = Uuid::new_v4().to_string();
    leases.insert(
        id.clone(),
        Lease {
            record: record.into(),
            _file: file,
        },
    );
    Ok(json!({"lease": id}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn one_consumer_per_identity_and_release_is_bound_to_its_scope() {
        let dir = tempfile::tempdir().unwrap();
        let first = execute(dir.path(), "identity", &json!({"action":"lease_acquire"})).unwrap();
        assert!(execute(dir.path(), "identity", &json!({"action":"lease_acquire"})).is_err());
        execute(
            dir.path(),
            "other",
            &json!({"action":"lease_release", "lease": first["lease"]}),
        )
        .unwrap();
        assert!(execute(dir.path(), "identity", &json!({"action":"lease_acquire"})).is_err());
        execute(
            dir.path(),
            "identity",
            &json!({"action":"lease_release", "lease": first["lease"]}),
        )
        .unwrap();
        let next = execute(dir.path(), "identity", &json!({"action":"lease_acquire"})).unwrap();
        execute(
            dir.path(),
            "identity",
            &json!({"action":"lease_release", "lease": next["lease"]}),
        )
        .unwrap();
    }
}
