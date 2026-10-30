use super::*;

const SECRET: &str = "PRIVATE_FAMBUDDY_PAIRING_TOKEN_AND_MLS_STATE";
fn save(vault: &Vault, scope: &str, value: &str) {
    vault
        .transact(scope, |_| Ok((Some(value.into()), ())))
        .unwrap();
}
fn load(vault: &Vault, scope: &str) -> Result<Option<String>, String> {
    vault.transact(scope, |value| {
        Ok((value.map(str::to_owned), value.map(str::to_owned)))
    })
}
fn reference(root: &Path, scope: &str) -> String {
    open_index(&root.join("references.sqlite3"), &[9; 32])
        .unwrap()
        .query_row(
            "SELECT filename FROM vault_references WHERE scope_hash=?1",
            [format!("{:x}", Sha256::digest(scope))],
            |row| row.get(0),
        )
        .unwrap()
}

#[test]
fn ciphertext_and_index_exclude_plaintext_and_survive_restart() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("vault");
    let vault = Vault::open(&root, [9; 32]).unwrap();
    save(&vault, "private-account:family-pairing", SECRET);
    assert_eq!(
        load(&vault, "private-account:family-pairing")
            .unwrap()
            .as_deref(),
        Some(SECRET)
    );
    drop(vault);
    for entry in fs::read_dir(&root).unwrap() {
        let bytes = fs::read(entry.unwrap().path()).unwrap();
        for forbidden in [SECRET, "private-account:family-pairing"] {
            assert!(!bytes
                .windows(forbidden.len())
                .any(|part| part == forbidden.as_bytes()));
        }
    }
    let reopened = Vault::open(&root, [9; 32]).unwrap();
    assert_eq!(
        load(&reopened, "private-account:family-pairing")
            .unwrap()
            .as_deref(),
        Some(SECRET)
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&root).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(root.join(reference(&root, "private-account:family-pairing")))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}

#[test]
fn wrong_key_and_tampered_ciphertext_fail_without_replacing_state() {
    let dir = tempfile::tempdir().unwrap();
    let vault = Vault::open(dir.path(), [9; 32]).unwrap();
    save(&vault, "account-a", SECRET);
    let name = reference(dir.path(), "account-a");
    assert!(Vault::open(dir.path(), [8; 32]).is_err());
    assert_eq!(reference(dir.path(), "account-a"), name);
    let path = dir.path().join(&name);
    let mut bytes = fs::read(&path).unwrap();
    bytes[15] ^= 1;
    fs::write(path, bytes).unwrap();
    assert!(load(&vault, "account-a").is_err());
    assert_eq!(reference(dir.path(), "account-a"), name);
}

#[test]
fn scope_swapping_missing_files_and_path_traversal_fail_closed() {
    let dir = tempfile::tempdir().unwrap();
    let vault = Vault::open(dir.path(), [9; 32]).unwrap();
    save(&vault, "account-a", SECRET);
    let name = reference(dir.path(), "account-a");
    let index = open_index(&dir.path().join("references.sqlite3"), &[9; 32]).unwrap();
    index
        .execute(
            "UPDATE vault_references SET scope_hash=?1",
            [format!("{:x}", Sha256::digest("account-b"))],
        )
        .unwrap();
    assert!(load(&vault, "account-b").is_err());
    index
        .execute("UPDATE vault_references SET filename='../outside'", [])
        .unwrap();
    assert!(load(&vault, "account-b").is_err());
    index
        .execute("UPDATE vault_references SET filename=?1", [&name])
        .unwrap();
    fs::remove_file(dir.path().join(name)).unwrap();
    assert!(load(&vault, "account-b").is_err());
}

#[test]
fn deletion_removes_reference_and_old_file() {
    let dir = tempfile::tempdir().unwrap();
    let vault = Vault::open(dir.path(), [9; 32]).unwrap();
    save(&vault, "account", SECRET);
    let name = reference(dir.path(), "account");
    vault.transact("account", |_| Ok((None, ()))).unwrap();
    assert!(!dir.path().join(name).exists());
    assert_eq!(load(&vault, "account").unwrap(), None);
}

#[test]
fn callback_error_rolls_back_and_redacts_diagnostics() {
    let dir = tempfile::tempdir().unwrap();
    let vault = Vault::open(dir.path(), [9; 32]).unwrap();
    save(&vault, "account", SECRET);
    let name = reference(dir.path(), "account");
    let result: Result<(), _> = vault.transact("account", |_| Err(SECRET.into()));
    assert!(result.is_err());
    assert!(!result.unwrap_err().contains(SECRET));
    assert_eq!(reference(dir.path(), "account"), name);
    assert_eq!(load(&vault, "account").unwrap().as_deref(), Some(SECRET));
}

#[test]
fn two_connections_serialize_read_modify_write() {
    let dir = tempfile::tempdir().unwrap();
    let a = Vault::open(dir.path(), [9; 32]).unwrap();
    let b = Vault::open(dir.path(), [9; 32]).unwrap();
    let update = |vault: Vault| {
        for _ in 0..20 {
            vault
                .transact("counter", |value| {
                    let current: usize = value.unwrap_or("0").parse().unwrap();
                    std::thread::sleep(Duration::from_millis(1));
                    Ok((Some((current + 1).to_string()), ()))
                })
                .unwrap();
        }
    };
    let first = std::thread::spawn(move || update(a));
    let second = std::thread::spawn(move || update(b));
    first.join().unwrap();
    second.join().unwrap();
    let vault = Vault::open(dir.path(), [9; 32]).unwrap();
    assert_eq!(load(&vault, "counter").unwrap().as_deref(), Some("40"));
}

#[test]
fn oversized_plaintext_does_not_change_the_reference() {
    let dir = tempfile::tempdir().unwrap();
    let vault = Vault::open(dir.path(), [9; 32]).unwrap();
    save(&vault, "account", SECRET);
    let name = reference(dir.path(), "account");
    assert!(vault
        .transact("account", |_| Ok((Some("x".repeat(LIMIT + 1)), ())))
        .is_err());
    assert_eq!(reference(dir.path(), "account"), name);
}

#[test]
fn repeated_reads_preserve_ciphertext_and_skip_index_writes() {
    let dir = tempfile::tempdir().unwrap();
    let vault = Vault::open(dir.path(), [9; 32]).unwrap();
    save(&vault, "account", SECRET);
    let filename = reference(dir.path(), "account");
    let ciphertext = fs::read(dir.path().join(&filename)).unwrap();
    let index = open_index(&dir.path().join("references.sqlite3"), &[9; 32]).unwrap();
    // A read must not publish even an equivalent reference or delete an empty one.
    index
        .execute_batch(
            "CREATE TRIGGER forbid_insert BEFORE INSERT ON vault_references
         BEGIN SELECT RAISE(ABORT, 'unexpected insert'); END;
         CREATE TRIGGER forbid_update BEFORE UPDATE ON vault_references
         BEGIN SELECT RAISE(ABORT, 'unexpected update'); END;
         CREATE TRIGGER forbid_delete BEFORE DELETE ON vault_references
         BEGIN SELECT RAISE(ABORT, 'unexpected delete'); END;",
        )
        .unwrap();
    for _ in 0..3 {
        assert_eq!(load(&vault, "account").unwrap().as_deref(), Some(SECRET));
        assert_eq!(load(&vault, "absent").unwrap(), None);
        assert_eq!(reference(dir.path(), "account"), filename);
    }
    assert_eq!(fs::read(dir.path().join(&filename)).unwrap(), ciphertext);
    let files: Vec<_> = fs::read_dir(dir.path())
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension == "vault")
        })
        .collect();
    assert_eq!(files, vec![dir.path().join(filename)]);
    // The read releases its SQLite lock before its output is returned.
    index.execute_batch("BEGIN IMMEDIATE; ROLLBACK;").unwrap();
}
