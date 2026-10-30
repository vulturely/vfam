use tauri::Manager;

pub async fn execute<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    scope: String,
    account: String,
    input: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| "FamBuddy storage unavailable.")?
        .join("private-fambuddy");
    execute_at(root, scope, account, input).await
}

async fn execute_at(
    root: std::path::PathBuf,
    scope: String,
    account: String,
    input: serde_json::Value,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        vulture_device_vault::execute(&root, &scope, &account, input)
    })
    .await
    .map_err(|_| "FamBuddy storage operation interrupted.".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::execute_at;

    #[test]
    fn native_fambuddy_record_roundtrips_off_webview_thread() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("vault");
        tauri::async_runtime::block_on(execute_at(
            root.clone(),
            "server".into(),
            "account".into(),
            serde_json::json!({"action":"put","value":{"pairing":"private"}}),
        ))
        .unwrap();
        let saved = tauri::async_runtime::block_on(execute_at(
            root,
            "server".into(),
            "account".into(),
            serde_json::json!({"action":"get"}),
        ))
        .unwrap();
        assert_eq!(saved["pairing"], "private");
    }
}
