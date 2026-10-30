//! Native encrypted files with a transactional SQLite reference index.
use aes_gcm::{
    aead::{rand_core::RngCore, Aead, OsRng, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use sha2::{Digest, Sha256};
use std::{
    fmt::Write as _,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use uuid::Uuid;
use zeroize::Zeroizing;

const LIMIT: usize = 32 * 1024 * 1024;
const OVERHEAD: usize = 12 + 16;
const FAILURE: &str = "Encrypted device storage is unavailable.";

/// The caller obtains the key from the OS keystore. This store never writes it.
pub struct Vault {
    root: PathBuf,
    key: Zeroizing<[u8; 32]>,
    index: Mutex<Connection>,
}

impl Vault {
    pub fn open(root: &Path, key: [u8; 32]) -> Result<Self, String> {
        let key = Zeroizing::new(key);
        fs::create_dir_all(root).map_err(storage_error)?;
        if !fs::symlink_metadata(root).map_err(storage_error)?.is_dir() {
            return Err(FAILURE.into());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(root, fs::Permissions::from_mode(0o700)).map_err(storage_error)?;
        }
        let database = root.join("references.sqlite3");
        if database.exists() {
            require_regular_file(&database)?;
        } else {
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            private_file(&mut options);
            match options.open(&database) {
                Ok(file) => file.sync_all().map_err(storage_error)?,
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    require_regular_file(&database)?;
                }
                Err(_) => return Err(FAILURE.into()),
            }
        }
        let index = open_index(&database, &key)?;
        Ok(Self {
            root: root.to_owned(),
            key,
            index: Mutex::new(index),
        })
    }

    /// Read, transform and publish one scope while holding the cross-process lock.
    /// Callback errors, encryption failures and commit errors never return output.
    pub fn transact<T>(
        &self,
        scope: &str,
        callback: impl FnOnce(Option<&str>) -> Result<(Option<String>, T), String>,
    ) -> Result<T, String> {
        if scope.is_empty() || scope.len() > 4096 {
            return Err("Invalid device storage scope.".into());
        }
        let hash = format!("{:x}", Sha256::digest(scope));
        let mut index = self.index.lock().map_err(storage_error)?;
        let transaction = index
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage_error)?;
        let previous: Option<String> = transaction
            .query_row(
                "SELECT filename FROM vault_references WHERE scope_hash=?1",
                [&hash],
                |row| row.get(0),
            )
            .optional()
            .map_err(storage_error)?;
        let plaintext = previous
            .as_ref()
            .map(|name| self.read(name, &hash))
            .transpose()?;
        // Errors may originate in a parser that includes its input; never expose them.
        let (replacement, output) = callback(plaintext.as_deref().map(String::as_str))
            .map_err(|_| "Device storage operation failed.".to_owned())?;
        let replacement = replacement.map(Zeroizing::new);
        if replacement.as_deref() == plaintext.as_deref() {
            // Read-only transitions still finish the locked transaction before
            // returning output, but do not rotate ciphertext or touch its index.
            transaction.commit().map_err(storage_error)?;
            drop(index);
            return Ok(output);
        }
        let next = replacement
            .as_ref()
            .map(|value| self.write(value, &hash))
            .transpose()?;
        let changed = match next.as_ref() {
            Some(name) => transaction.execute(
                "INSERT INTO vault_references(scope_hash,filename) VALUES(?1,?2)
                 ON CONFLICT(scope_hash) DO UPDATE SET filename=excluded.filename",
                [&hash, name],
            ),
            None => {
                transaction.execute("DELETE FROM vault_references WHERE scope_hash=?1", [&hash])
            }
        };
        if changed.is_err() {
            if let Some(name) = next.as_ref() {
                let _ = fs::remove_file(self.root.join(name));
            }
            return Err(FAILURE.into());
        }
        // On an ambiguous commit failure retain the new ciphertext. An orphan is
        // preferable to deleting a file SQLite might already reference.
        transaction.commit().map_err(storage_error)?;
        if let Some(name) = previous {
            let _ = fs::remove_file(self.path(&name)?);
            let _ = sync_directory(&self.root);
        }
        Ok(output)
    }

    fn path(&self, filename: &str) -> Result<PathBuf, String> {
        let id = filename
            .strip_suffix(".vault")
            .ok_or_else(|| FAILURE.to_owned())?;
        let parsed = Uuid::parse_str(id).map_err(storage_error)?;
        if parsed.to_string() != id {
            return Err(FAILURE.into());
        }
        Ok(self.root.join(filename))
    }

    fn read(&self, filename: &str, hash: &str) -> Result<Zeroizing<String>, String> {
        let path = self.path(filename)?;
        require_regular_file(&path)?;
        let file = File::open(path).map_err(storage_error)?;
        let mut bytes = Vec::new();
        file.take((LIMIT + OVERHEAD + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(storage_error)?;
        if bytes.len() < OVERHEAD || bytes.len() > LIMIT + OVERHEAD {
            return Err(FAILURE.into());
        }
        let cipher = Aes256Gcm::new_from_slice(self.key.as_ref()).map_err(storage_error)?;
        let clear = Zeroizing::new(
            cipher
                .decrypt(
                    Nonce::from_slice(&bytes[..12]),
                    Payload {
                        msg: &bytes[12..],
                        aad: hash.as_bytes(),
                    },
                )
                .map_err(storage_error)?,
        );
        let text = std::str::from_utf8(&clear)
            .map_err(storage_error)?
            .to_owned();
        Ok(Zeroizing::new(text))
    }

    fn write(&self, text: &str, hash: &str) -> Result<String, String> {
        if text.len() > LIMIT {
            return Err("Device storage state exceeds its limit.".into());
        }
        let cipher = Aes256Gcm::new_from_slice(self.key.as_ref()).map_err(storage_error)?;
        let mut nonce = [0; 12];
        OsRng.try_fill_bytes(&mut nonce).map_err(storage_error)?;
        let ciphertext = cipher
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: text.as_bytes(),
                    aad: hash.as_bytes(),
                },
            )
            .map_err(storage_error)?;
        let filename = format!("{}.vault", Uuid::new_v4());
        let path = self.path(&filename)?;
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        private_file(&mut options);
        let mut file = options.open(&path).map_err(storage_error)?;
        let written = file
            .write_all(&nonce)
            .and_then(|_| file.write_all(&ciphertext))
            .and_then(|_| file.sync_all());
        if written.is_err() || sync_directory(&self.root).is_err() {
            let _ = fs::remove_file(&path);
            return Err(FAILURE.into());
        }
        Ok(filename)
    }
}

fn open_index(path: &Path, key: &[u8; 32]) -> Result<Connection, String> {
    let connection = Connection::open(path).map_err(storage_error)?;
    let mut hex = Zeroizing::new(String::with_capacity(64));
    for byte in key {
        write!(&mut *hex, "{byte:02x}").map_err(storage_error)?;
    }
    connection
        .pragma_update(None, "key", format!("x'{}'", hex.as_str()))
        .map_err(storage_error)?;
    let version: String = connection
        .query_row("PRAGMA cipher_version", [], |row| row.get(0))
        .map_err(storage_error)?;
    if version.is_empty() {
        return Err(FAILURE.into());
    }
    connection
        .pragma_update(None, "cipher_memory_security", "ON")
        .map_err(storage_error)?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(storage_error)?;
    connection
        .execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=FULL;
             PRAGMA secure_delete=ON;
             PRAGMA temp_store=MEMORY;
             CREATE TABLE IF NOT EXISTS vault_references (
                 scope_hash TEXT PRIMARY KEY,
                 filename TEXT NOT NULL UNIQUE
             );",
        )
        .map_err(storage_error)?;
    Ok(connection)
}

fn storage_error<E>(_: E) -> String {
    FAILURE.into()
}
fn require_regular_file(path: &Path) -> Result<(), String> {
    if fs::symlink_metadata(path).map_err(storage_error)?.is_file() {
        Ok(())
    } else {
        Err(FAILURE.into())
    }
}
fn private_file(options: &mut OpenOptions) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    #[cfg(not(unix))]
    let _ = options;
}
fn sync_directory(path: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        File::open(path)?.sync_all()
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(())
    }
}

#[cfg(test)]
#[path = "files_tests.rs"]
mod tests;
