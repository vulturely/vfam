use super::server::{authenticated, channel, decode, encode, ServerError, UnaryInput};
use vulture_protocol::fambuddy::v1::fam_buddy_gateway_service_client::FamBuddyGatewayServiceClient;

macro_rules! unary {
    ($client:ident, $input:ident, $method:ident) => {{
        let mut $client = FamBuddyGatewayServiceClient::new(channel(&$input).await?);
        let request = decode(&$input.payload)?;
        let response = $client.$method(authenticated(&$input, request)?).await?;
        drop($client);
        encode(response.into_inner())
    }};
}

pub async fn execute(input: UnaryInput) -> Result<serde_json::Value, ServerError> {
    let result = match input.method.as_str() {
        "EnableRemote" => unary!(client, input, enable_remote),
        "DisableRemote" => unary!(client, input, disable_remote),
        "PairPhone" => unary!(client, input, pair_phone),
        "ParentCommand" => unary!(client, input, parent_command),
        "DeviceCommand" => unary!(client, input, device_command),
        _ => Err(ServerError::invalid("Unsupported FamBuddy gateway method.")),
    };
    result
}
