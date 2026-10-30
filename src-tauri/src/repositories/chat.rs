use tauri::Manager;

pub async fn execute<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    account: String,
    input: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| "Chat storage unavailable.")?
        .join("private-chat");
    execute_at(root, account, input).await
}

async fn execute_at(
    root: std::path::PathBuf,
    account: String,
    input: serde_json::Value,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        vulture_chat_crypto::execute(&root, &account, input)
    })
    .await
    .map_err(|_| "Chat storage operation interrupted.".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::execute_at;

    #[test]
    fn native_chat_identity_executes_off_webview_thread() {
        let directory = tempfile::tempdir().unwrap();
        let identity = tauri::async_runtime::block_on(execute_at(
            directory.path().join("chat"),
            "account".into(),
            serde_json::json!({"action":"identity"}),
        ))
        .unwrap();
        assert!(identity["deviceId"].is_string());
    }
}
