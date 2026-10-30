use aes_gcm::aead::{rand_core::RngCore, OsRng};
use base64::{engine::general_purpose::STANDARD, Engine};
use keyring_core::Entry;
use std::{fs, fs::OpenOptions, io::Write, path::Path};
use zeroize::Zeroizing;

const UNAVAILABLE: &str =
    "Local cache encryption is locked or unavailable. Unlock the system key store and retry.";

fn entry(user: &str) -> Result<Entry, String> {
    super::keychain::entry("com.swavan.vfam.cache", user).map_err(|()| UNAVAILABLE.to_owned())
}

pub fn load(root: &Path) -> Result<Zeroizing<[u8; 32]>, String> {
    fs::create_dir_all(root).map_err(|_| UNAVAILABLE)?;
    if !fs::symlink_metadata(root)
        .map_err(|_| UNAVAILABLE)?
        .is_dir()
    {
        return Err(UNAVAILABLE.into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(root, fs::Permissions::from_mode(0o700)).map_err(|_| UNAVAILABLE)?;
    }
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let lock = options
        .open(root.join("key.lock"))
        .map_err(|_| UNAVAILABLE)?;
    lock.lock().map_err(|_| UNAVAILABLE)?;
    let user = identity(root)?;
    let credential = entry(&user)?;
    load_with_credential(root, &credential)
}

fn load_with_credential(root: &Path, credential: &Entry) -> Result<Zeroizing<[u8; 32]>, String> {
    let encoded = match credential.get_password() {
        Ok(value) => Zeroizing::new(value),
        Err(keyring_core::Error::NoEntry) => {
            let existing = fs::read_dir(root).map_err(|_| UNAVAILABLE)?.any(|item| {
                item.map_or(true, |item| {
                    item.file_name() != "key.lock" && item.file_name() != "vault.id"
                })
            });
            if existing {
                return Err(
                    "Local cache encryption key is missing. Existing data was not replaced.".into(),
                );
            }
            let mut key = Zeroizing::new([0_u8; 32]);
            OsRng.fill_bytes(key.as_mut());
            let encoded = Zeroizing::new(STANDARD.encode(*key));
            credential.set_password(&encoded).map_err(|_| UNAVAILABLE)?;
            encoded
        }
        Err(_) => return Err(UNAVAILABLE.into()),
    };
    let bytes = Zeroizing::new(
        STANDARD
            .decode(encoded.as_bytes())
            .map_err(|_| UNAVAILABLE)?,
    );
    let key: [u8; 32] = bytes.as_slice().try_into().map_err(|_| UNAVAILABLE)?;
    Ok(Zeroizing::new(key))
}

fn identity(root: &Path) -> Result<String, String> {
    let path = root.join("vault.id");
    if path.exists() {
        let metadata = fs::symlink_metadata(&path).map_err(|_| UNAVAILABLE)?;
        if !metadata.is_file() || metadata.len() != 36 {
            return Err(UNAVAILABLE.into());
        }
        let id = fs::read_to_string(path).map_err(|_| UNAVAILABLE)?;
        if uuid::Uuid::parse_str(&id)
            .map_err(|_| UNAVAILABLE)?
            .to_string()
            != id
        {
            return Err(UNAVAILABLE.into());
        }
        return Ok(id);
    }
    if fs::read_dir(root)
        .map_err(|_| UNAVAILABLE)?
        .any(|item| item.map_or(true, |item| item.file_name() != "key.lock"))
    {
        return Err(
            "Local cache vault identity is missing. Existing data was not replaced.".into(),
        );
    }
    let id = uuid::Uuid::new_v4().to_string();
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|_| UNAVAILABLE)?;
    file.write_all(id.as_bytes()).map_err(|_| UNAVAILABLE)?;
    file.sync_all().map_err(|_| UNAVAILABLE)?;
    #[cfg(unix)]
    fs::File::open(root)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| UNAVAILABLE)?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::{entry, identity, load, load_with_credential};
    use crate::{cache_types::CacheRequest, repositories::storage::CacheStore};
    use keyring_core::api::CredentialStoreApi;

    #[test]
    fn credential_store_roundtrip_corruption_and_missing_key_branches() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("cache");
        std::fs::create_dir(&root).unwrap();
        let store = keyring_core::mock::Store::new().unwrap();
        let credential = store.build("vfam-test", "cache", None).unwrap();
        let first = load_with_credential(&root, &credential).unwrap();
        assert_eq!(*first, *load_with_credential(&root, &credential).unwrap());
        credential.set_password("not-base64").unwrap();
        assert!(load_with_credential(&root, &credential).is_err());
        credential.set_password("AA==").unwrap();
        assert!(load_with_credential(&root, &credential).is_err());
        let mock = credential
            .as_any()
            .downcast_ref::<keyring_core::mock::Cred>()
            .unwrap();
        mock.set_error(keyring_core::Error::Invalid("locked".into(), "test".into()));
        assert!(load_with_credential(&root, &credential).is_err());
        let missing_root = directory.path().join("missing");
        std::fs::create_dir(&missing_root).unwrap();
        std::fs::write(missing_root.join("cache.sqlite3"), b"existing").unwrap();
        let missing = store.build("vfam-test", "missing", None).unwrap();
        assert!(load_with_credential(&missing_root, &missing).is_err());
        assert!(!missing_root.join("vault.id").exists());
    }

    #[test]
    fn identity_survives_relocation_and_missing_metadata_fails_closed() {
        let parent = tempfile::tempdir().unwrap();
        let first = parent.path().join("first");
        std::fs::create_dir(&first).unwrap();
        let id = identity(&first).unwrap();
        let moved = parent.path().join("moved");
        std::fs::rename(&first, &moved).unwrap();
        assert_eq!(identity(&moved).unwrap(), id);
        std::fs::remove_file(moved.join("vault.id")).unwrap();
        std::fs::write(moved.join("cache.sqlite3"), b"existing cache").unwrap();
        assert!(identity(&moved).is_err());
        assert!(!moved.join("vault.id").exists());
    }

    #[test]
    #[ignore = "requires an unlocked OS credential store; creates and deletes a temporary test key"]
    fn os_keychain_cache_roundtrip_and_missing_key_fail_closed() {
        struct Cleanup(keyring_core::Entry);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = self.0.delete_credential();
            }
        }
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("cache");
        let first = load(&root).unwrap();
        let id = identity(&root).unwrap();
        let credential = entry(&id).unwrap();
        let cleanup = Cleanup(credential);
        assert_eq!(*first, *load(&root).unwrap());
        let path = root.join("cache.sqlite3");
        let store = CacheStore::open(&path, &first).unwrap();
        let put = CacheRequest {
            action: "put".into(),
            namespace: "smoke".into(),
            key: Some("family".into()),
            value: Some(serde_json::json!({ "name": "Keychain family" })),
            ttl_seconds: Some(60),
            include_expired: None,
        };
        store.execute(&put).unwrap();
        drop(store);
        let reopened = CacheStore::open(&path, &first).unwrap();
        let get = CacheRequest {
            action: "get".into(),
            key: Some("family".into()),
            value: None,
            ttl_seconds: None,
            ..put
        };
        assert_eq!(
            reopened.execute(&get).unwrap(),
            serde_json::json!({ "name": "Keychain family" })
        );
        drop(reopened);
        cleanup.0.delete_credential().unwrap();
        assert!(load(&root).is_err());
    }
}
