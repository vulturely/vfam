use std::path::Path;

/// Turns on starting at login once, then leaves it to the parent: if they switch it off
/// in the system's login items, VFAM never switches it back on.
pub fn configure_once(
    marker: &Path,
    enable: impl FnOnce() -> Result<(), String>,
) -> Result<bool, String> {
    if marker.exists() {
        return Ok(false);
    }
    enable()?;
    if let Some(parent) = marker.parent() {
        std::fs::create_dir_all(parent).map_err(|_| "Could not save the login setting.")?;
    }
    std::fs::write(marker, b"").map_err(|_| "Could not save the login setting.")?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::configure_once;

    #[test]
    fn enables_once_and_respects_a_later_choice() {
        let dir = tempfile::tempdir().unwrap();
        let marker = dir.path().join("settings").join("autostart-configured");
        let mut calls = 0;
        assert!(configure_once(&marker, || {
            calls += 1;
            Ok(())
        })
        .unwrap());
        assert!(!configure_once(&marker, || {
            calls += 1;
            Ok(())
        })
        .unwrap());
        assert_eq!(calls, 1);
        let failed = dir.path().join("failed");
        assert!(configure_once(&failed, || Err("no launcher".into())).is_err());
        assert!(!failed.exists());
        let blocked = dir.path().join("file");
        std::fs::write(&blocked, b"").unwrap();
        assert!(configure_once(&blocked.join("marker"), || Ok(())).is_err());
    }
}
