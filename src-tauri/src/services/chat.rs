use crate::repositories::{chat, notification};

pub async fn execute<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    account: String,
    input: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if input["action"] == "notify" {
        notification::family_message(&app)?;
        return Ok(serde_json::json!({ "notified": true }));
    }
    if input["action"] == "encrypt" {
        validate_message(&input)?;
    }
    chat::execute(app, account, input).await
}

fn validate_message(input: &serde_json::Value) -> Result<(), String> {
    let plaintext = input["plaintext"].as_str().ok_or("Invalid message")?;
    let payload: serde_json::Value =
        serde_json::from_str(plaintext).map_err(|_| "Invalid message")?;
    let text = payload["text"].as_str().unwrap_or_default();
    if text.trim().is_empty() && payload["attachment"].is_null() {
        return Err("Enter a message or choose a file.".into());
    }
    if text.encode_utf16().count() > 16_000 {
        return Err("Messages are limited to 16,000 characters.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_message;

    #[test]
    fn validates_plaintext_before_encryption() {
        for plaintext in ["{}", "{\"text\":\"\"}", "{\"text\":\"   \"}"] {
            let input = serde_json::json!({"plaintext": plaintext});
            assert!(validate_message(&input).is_err());
        }
        assert!(
            validate_message(&serde_json::json!({"plaintext": "{\"text\":\"Hello\"}"})).is_ok()
        );
        assert!(validate_message(
            &serde_json::json!({"plaintext": "{\"text\":\"\",\"attachment\":{\"name\":\"photo\"}}"})
        )
        .is_ok());
        let oversized = serde_json::json!({"text": "x".repeat(16_001)}).to_string();
        assert!(validate_message(&serde_json::json!({"plaintext": oversized})).is_err());
        assert!(validate_message(&serde_json::json!({"plaintext": "not-json"})).is_err());
    }
}
