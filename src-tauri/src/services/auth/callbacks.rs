use crate::repositories::auth;

pub async fn start_callback<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    token: String,
) -> Result<String, String> {
    validate_token(&token)?;
    auth::start_callback(app, token).await
}

fn validate_token(token: &str) -> Result<(), String> {
    if token.len() != 36
        || !token
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
    {
        return Err("Could not start the local sign-in callback.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_token;

    #[test]
    fn callback_token_validates_shape() {
        assert!(validate_token("invalid").is_err());
        assert!(validate_token("123e4567-e89b-12d3-a456-426614174000").is_ok());
        assert!(validate_token("123e4567-e89b-12d3-a456-42661417400!").is_err());
    }
}
