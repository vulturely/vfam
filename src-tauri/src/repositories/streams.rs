use super::server::{authenticated, channel, decode, encode, ServerError, StreamInput};
use tokio_stream::StreamExt;
use vulture_protocol::{
    fambuddy::v1::fam_buddy_gateway_service_client::FamBuddyGatewayServiceClient,
    server::v1::{
        fam_buddy_registry_service_client::FamBuddyRegistryServiceClient,
        fam_buddy_relay_service_client::FamBuddyRelayServiceClient,
    },
};

macro_rules! stream {
    ($client:ident, $client_type:ident, $input:ident, $emit:ident, $method:ident) => {{
        let mut $client = $client_type::new(channel(&$input.unary).await?);
        let request = decode(&$input.unary.payload)?;
        let response = $client
            .$method(authenticated(&$input.unary, request)?)
            .await?;
        drop($client);
        let mut messages = response.into_inner();
        while let Some(message) = messages.next().await {
            $emit(encode(message?)?);
        }
        Ok(())
    }};
}

pub fn validate(input: &StreamInput) -> Result<(), ServerError> {
    let supported = matches!(
        (input.unary.service.as_str(), input.unary.method.as_str()),
        ("fambuddy_gateway", "WatchParent" | "OpenTalk")
            | ("fambuddy_registry", "WatchEnrollment")
            | ("fambuddy_relay", "WatchEnvelopes")
    );
    if supported {
        Ok(())
    } else {
        Err(ServerError::invalid("Unsupported Vulture stream method."))
    }
}

pub async fn run<F>(input: StreamInput, emit: F) -> Result<(), ServerError>
where
    F: Fn(serde_json::Value) + Send + Sync + 'static,
{
    match input.unary.service.as_str() {
        "fambuddy_gateway" => match input.unary.method.as_str() {
            "WatchParent" => stream!(
                client,
                FamBuddyGatewayServiceClient,
                input,
                emit,
                watch_parent
            ),
            "OpenTalk" => stream!(client, FamBuddyGatewayServiceClient, input, emit, open_talk),
            _ => Err(ServerError::invalid("Unsupported gateway stream.")),
        },
        "fambuddy_registry" => match input.unary.method.as_str() {
            "WatchEnrollment" => stream!(
                client,
                FamBuddyRegistryServiceClient,
                input,
                emit,
                watch_enrollment
            ),
            _ => Err(ServerError::invalid("Unsupported registry stream.")),
        },
        "fambuddy_relay" => match input.unary.method.as_str() {
            "WatchEnvelopes" => stream!(
                client,
                FamBuddyRelayServiceClient,
                input,
                emit,
                watch_envelopes
            ),
            _ => Err(ServerError::invalid("Unsupported relay stream.")),
        },
        _ => Err(ServerError::invalid("Unsupported Vulture stream service.")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlists_only_active_native_streams() {
        let mut input = StreamInput {
            stream_id: "stream".into(),
            unary: super::super::server::UnaryInput {
                server_url: "https://server.example".into(),
                service: "fambuddy_relay".into(),
                method: "WatchEnvelopes".into(),
                token: None,
                payload: serde_json::json!({}),
                timeout_ms: Some(0),
            },
        };
        assert!(validate(&input).is_ok());
        input.unary.method = "CreateChannel".into();
        assert!(validate(&input).is_err());
        input.unary.service = "control".into();
        assert!(validate(&input).is_err());
    }
}
