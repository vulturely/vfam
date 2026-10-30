use super::server::{authenticated, channel, decode, encode, ServerError, UnaryInput};
use vulture_protocol::server::v1::fam_buddy_registry_service_client::FamBuddyRegistryServiceClient;

macro_rules! unary {
    ($client:ident, $input:ident, $method:ident) => {{
        let mut $client = FamBuddyRegistryServiceClient::new(channel(&$input).await?);
        let request = decode(&$input.payload)?;
        let response = $client.$method(authenticated(&$input, request)?).await?;
        drop($client);
        encode(response.into_inner())
    }};
}

pub async fn execute(input: UnaryInput) -> Result<serde_json::Value, ServerError> {
    let result = match input.method.as_str() {
        "RegisterFamBuddy" => unary!(client, input, register_fam_buddy),
        "ListFamBuddies" => unary!(client, input, list_fam_buddies),
        "RevokeFamBuddy" => unary!(client, input, revoke_fam_buddy),
        "BeginEnrollment" => unary!(client, input, begin_enrollment),
        "RespondEnrollment" => unary!(client, input, respond_enrollment),
        "ConfirmEnrollment" => unary!(client, input, confirm_enrollment),
        "GetChannelStatus" => unary!(client, input, get_channel_status),
        "GetMediaRelay" => unary!(client, input, get_media_relay),
        "AcknowledgeApproval" => unary!(client, input, acknowledge_approval),
        "SetFamilyLicense" => unary!(client, input, set_family_license),
        "GetFamilyLicense" => unary!(client, input, get_family_license),
        _ => Err(ServerError::invalid(
            "Unsupported FamBuddy registry method.",
        )),
    };
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(method: &str) -> UnaryInput {
        UnaryInput {
            server_url: "http://family.example".into(),
            service: "fambuddy_registry".into(),
            method: method.into(),
            token: None,
            payload: serde_json::json!({}),
            timeout_ms: None,
        }
    }

    #[tokio::test]
    async fn allows_family_license_methods_and_refuses_others() {
        for method in ["SetFamilyLicense", "GetFamilyLicense"] {
            // Allow-listed: it reaches the transport, which refuses plain HTTP before connecting.
            let error = execute(input(method)).await.unwrap_err();
            assert_eq!(
                error.message, "Vulture requires HTTPS outside local development.",
                "{method}"
            );
        }
        let error = execute(input("DeleteFamily")).await.unwrap_err();
        assert_eq!(error.message, "Unsupported FamBuddy registry method.");
    }
}
