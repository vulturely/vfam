use crate::repositories::{
    auth::oidc::{discovery, DiscoveryInput},
    server::ServerError,
};

pub async fn discover(input: DiscoveryInput) -> Result<serde_json::Value, ServerError> {
    discovery(input).await
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInput {
    pub display_name: String,
    pub email: Option<String>,
}

pub fn validate_account_input(input: &AccountInput) -> Result<(), ServerError> {
    if input.display_name.trim().is_empty() {
        return Err(ServerError::invalid("Name is required."));
    }
    if input
        .email
        .as_deref()
        .is_some_and(|email| !email.is_empty() && !email.contains('@'))
    {
        return Err(ServerError::invalid("Enter a valid email address."));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_account_name_and_email() {
        let valid = AccountInput {
            display_name: "Parent".into(),
            email: Some("parent@example.com".into()),
        };
        assert!(validate_account_input(&valid).is_ok());
        for input in [
            AccountInput {
                display_name: " ".into(),
                email: None,
            },
            AccountInput {
                display_name: "Parent".into(),
                email: Some("invalid".into()),
            },
        ] {
            assert!(validate_account_input(&input).is_err());
        }
    }
}
