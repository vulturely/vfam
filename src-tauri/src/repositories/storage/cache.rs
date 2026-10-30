use super::keys;
use crate::cache_types::CacheRequest;
use rusqlite::{Connection, OptionalExtension};
use std::{fmt::Write, path::Path, sync::Mutex, time::Duration};
use tauri::Manager;
use zeroize::Zeroizing;

const FAILURE: &str = "Encrypted local cache is unavailable.";

pub async fn execute<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: CacheRequest,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = app
            .path()
            .app_data_dir()
            .map_err(|_| FAILURE.to_owned())?
            .join("display-cache");
        let key = keys::load(&root)?;
        CacheStore::open(&root.join("cache.sqlite3"), &key)?.execute(&request)
    })
    .await
    .map_err(|_| FAILURE.to_owned())?
}

pub struct CacheStore {
    connection: Mutex<Connection>,
}

impl CacheStore {
    pub(crate) fn open(path: &Path, key: &[u8; 32]) -> Result<Self, String> {
        let connection = Connection::open(path).map_err(|_| FAILURE.to_owned())?;
        let mut hex = Zeroizing::new(String::with_capacity(64));
        for byte in key {
            write!(&mut *hex, "{byte:02x}").map_err(|_| FAILURE.to_owned())?;
        }
        connection
            .pragma_update(None, "key", format!("x'{}'", hex.as_str()))
            .map_err(|_| FAILURE.to_owned())?;
        let version: String = connection
            .query_row("PRAGMA cipher_version", [], |row| row.get(0))
            .map_err(|_| FAILURE.to_owned())?;
        if version.is_empty() {
            return Err(FAILURE.into());
        }
        connection
            .pragma_update(None, "cipher_memory_security", "ON")
            .map_err(|_| FAILURE.to_owned())?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|_| FAILURE.to_owned())?;
        connection
            .execute_batch(
                "PRAGMA secure_delete=ON;
                 PRAGMA temp_store=MEMORY;
                 PRAGMA synchronous=FULL;
                 PRAGMA journal_mode=WAL;",
            )
            .map_err(|_| FAILURE.to_owned())?;
        let schema: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(|_| FAILURE.to_owned())?;
        if schema > 1 {
            return Err(FAILURE.into());
        }
        if schema == 0 {
            connection
                .execute_batch(
                    "CREATE TABLE cache_entries (
                        namespace TEXT NOT NULL,
                        key TEXT NOT NULL,
                        value TEXT NOT NULL,
                        updated_at INTEGER NOT NULL,
                        expires_at INTEGER,
                        PRIMARY KEY (namespace, key)
                     );
                     PRAGMA user_version=1;",
                )
                .map_err(|_| FAILURE.to_owned())?;
        }
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub(crate) fn execute(&self, request: &CacheRequest) -> Result<serde_json::Value, String> {
        let connection = self.connection.lock().map_err(|_| FAILURE.to_owned())?;
        let now = now()?;
        let result = match request.action.as_str() {
            "get" => {
                let key = request.key.as_deref().ok_or_else(|| FAILURE.to_owned())?;
                let include_expired = request.include_expired.unwrap_or(false);
                let value: Option<String> = connection
                    .query_row(
                        "SELECT value FROM cache_entries
                         WHERE namespace=?1 AND key=?2
                         AND (?3 OR expires_at IS NULL OR expires_at>?4)",
                        rusqlite::params![request.namespace, key, include_expired, now],
                        |row| row.get(0),
                    )
                    .optional()
                    .map_err(|_| FAILURE.to_owned())?;
                value.map_or(Ok(serde_json::Value::Null), |value| {
                    serde_json::from_str(&value).map_err(|_| FAILURE.to_owned())
                })
            }
            "put" => {
                let key = request.key.as_deref().ok_or_else(|| FAILURE.to_owned())?;
                let value = serde_json::to_string(
                    request.value.as_ref().ok_or_else(|| FAILURE.to_owned())?,
                )
                .map_err(|_| FAILURE.to_owned())?;
                let expires_at = request
                    .ttl_seconds
                    .map(|ttl| {
                        i64::try_from(ttl)
                            .ok()
                            .and_then(|ttl| ttl.checked_mul(1000))
                            .and_then(|ttl| now.checked_add(ttl))
                            .ok_or_else(|| FAILURE.to_owned())
                    })
                    .transpose()?;
                connection
                    .execute(
                        "INSERT INTO cache_entries(namespace,key,value,updated_at,expires_at)
                         VALUES(?1,?2,?3,?4,?5)
                         ON CONFLICT(namespace,key) DO UPDATE SET
                         value=excluded.value,updated_at=excluded.updated_at,expires_at=excluded.expires_at",
                        rusqlite::params![request.namespace, key, value, now, expires_at],
                    )
                    .map_err(|_| FAILURE.to_owned())?;
                Ok(serde_json::Value::Null)
            }
            "delete" => {
                let key = request.key.as_deref().ok_or_else(|| FAILURE.to_owned())?;
                connection
                    .execute(
                        "DELETE FROM cache_entries WHERE namespace=?1 AND key=?2",
                        rusqlite::params![request.namespace, key],
                    )
                    .map_err(|_| FAILURE.to_owned())?;
                Ok(serde_json::Value::Null)
            }
            "clear_namespace" => {
                connection
                    .execute(
                        "DELETE FROM cache_entries WHERE namespace=?1",
                        [&request.namespace],
                    )
                    .map_err(|_| FAILURE.to_owned())?;
                Ok(serde_json::Value::Null)
            }
            _ => Err(FAILURE.into()),
        };
        drop(connection);
        result
    }
}

fn now() -> Result<i64, String> {
    let milliseconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| FAILURE.to_owned())?
        .as_millis();
    i64::try_from(milliseconds).map_err(|_| FAILURE.to_owned())
}

#[cfg(test)]
mod tests {
    use super::CacheStore;
    use crate::cache_types::CacheRequest;
    use std::sync::Arc;

    fn request(action: &str, namespace: &str, key: &str) -> CacheRequest {
        CacheRequest {
            action: action.into(),
            namespace: namespace.into(),
            key: Some(key.into()),
            value: None,
            ttl_seconds: None,
            include_expired: None,
        }
    }

    #[test]
    fn encrypted_roundtrip_restart_expiry_delete_and_namespaces() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("cache.sqlite3");
        let store = CacheStore::open(&path, &[7; 32]).unwrap();
        let mut put = request("put", "account-a", "family");
        put.value = Some(serde_json::json!({ "name": "Private family" }));
        store.execute(&put).unwrap();
        assert_eq!(
            store
                .execute(&request("get", "account-a", "family"))
                .unwrap(),
            serde_json::json!({ "name": "Private family" })
        );
        assert_eq!(
            store
                .execute(&request("get", "account-b", "family"))
                .unwrap(),
            serde_json::Value::Null
        );
        let database = std::fs::read(&path).unwrap();
        assert!(!database.starts_with(b"SQLite format 3\0"));
        assert!(!database
            .windows(b"Private family".len())
            .any(|part| part == b"Private family"));
        let wal = std::fs::read(directory.path().join("cache.sqlite3-wal")).unwrap();
        assert!(!wal
            .windows(b"Private family".len())
            .any(|part| part == b"Private family"));
        drop(store);
        let reopened = CacheStore::open(&path, &[7; 32]).unwrap();
        assert!(CacheStore::open(&path, &[8; 32]).is_err());
        reopened
            .execute(&request("delete", "account-a", "family"))
            .unwrap();
        assert_eq!(
            reopened
                .execute(&request("get", "account-a", "family"))
                .unwrap(),
            serde_json::Value::Null
        );
        let mut expiring = request("put", "account-a", "expiring");
        expiring.value = Some(serde_json::json!("short"));
        expiring.ttl_seconds = Some(0);
        reopened.execute(&expiring).unwrap();
        assert_eq!(
            reopened
                .execute(&request("get", "account-a", "expiring"))
                .unwrap(),
            serde_json::Value::Null
        );
        let mut stale = request("get", "account-a", "expiring");
        stale.include_expired = Some(true);
        assert_eq!(
            reopened.execute(&stale).unwrap(),
            serde_json::json!("short")
        );
        reopened
            .execute(&CacheRequest {
                action: "clear_namespace".into(),
                namespace: "account-a".into(),
                key: None,
                value: None,
                ttl_seconds: None,
                include_expired: None,
            })
            .unwrap();
        assert_eq!(reopened.execute(&stale).unwrap(), serde_json::Value::Null);
    }

    #[test]
    fn plaintext_database_is_rejected() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("plain.sqlite3");
        Connection::open(&path)
            .unwrap()
            .execute_batch("CREATE TABLE plaintext(value TEXT);")
            .unwrap();
        assert!(CacheStore::open(&path, &[7; 32]).is_err());
    }

    #[test]
    fn newer_schema_corrupt_values_and_invalid_operations_fail_closed() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("cache.sqlite3");
        let store = CacheStore::open(&path, &[7; 32]).unwrap();
        store
            .connection
            .lock()
            .unwrap()
            .execute_batch("PRAGMA user_version=2;")
            .unwrap();
        drop(store);
        assert!(CacheStore::open(&path, &[7; 32]).is_err());
        let store = CacheStore::open(&directory.path().join("other.sqlite3"), &[7; 32]).unwrap();
        store
            .connection
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO cache_entries VALUES('account','bad','not-json',0,NULL)",
                [],
            )
            .unwrap();
        assert!(store.execute(&request("get", "account", "bad")).is_err());
        assert!(store
            .execute(&request("unknown", "account", "bad"))
            .is_err());
        let mut missing = request("put", "account", "missing");
        missing.key = None;
        assert!(store.execute(&missing).is_err());
        let mut overflow = request("put", "account", "overflow");
        overflow.value = Some(serde_json::json!(1));
        overflow.ttl_seconds = Some(u64::MAX);
        assert!(store.execute(&overflow).is_err());
    }

    #[test]
    fn one_store_serializes_concurrent_writers() {
        let directory = tempfile::tempdir().unwrap();
        let store =
            Arc::new(CacheStore::open(&directory.path().join("cache.sqlite3"), &[7; 32]).unwrap());
        let writers: Vec<_> = (0..8)
            .map(|index| {
                let store = Arc::clone(&store);
                std::thread::spawn(move || {
                    let mut put = request("put", "account", &format!("key-{index}"));
                    put.value = Some(serde_json::json!(index));
                    store.execute(&put).unwrap();
                })
            })
            .collect();
        for writer in writers {
            writer.join().unwrap();
        }
        for index in 0..8 {
            assert_eq!(
                store
                    .execute(&request("get", "account", &format!("key-{index}")))
                    .unwrap(),
                serde_json::json!(index)
            );
        }
    }

    use rusqlite::Connection;
}
