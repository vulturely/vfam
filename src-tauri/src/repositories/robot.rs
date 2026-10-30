use super::server::{authenticated, channel, decode, encode, ServerError, UnaryInput};
use vulture_protocol::server::v1::robot_gateway_service_client::RobotGatewayServiceClient;

macro_rules! unary {
    ($client:ident, $input:ident, $method:ident) => {{
        let mut $client = RobotGatewayServiceClient::new(channel(&$input).await?);
        let request = decode(&$input.payload)?;
        let response = $client.$method(authenticated(&$input, request)?).await?;
        drop($client);
        encode(response.into_inner())
    }};
}

pub async fn execute(input: UnaryInput) -> Result<serde_json::Value, ServerError> {
    let result = match input.method.as_str() {
        "CreateRobotPairing" => unary!(client, input, create_robot_pairing),
        "PairRobot" => unary!(client, input, pair_robot),
        "ListRobots" => unary!(client, input, list_robots),
        "RevokeRobot" => unary!(client, input, revoke_robot),
        "IssueRobotCommand" => unary!(client, input, issue_robot_command),
        "CancelRobotCommand" => unary!(client, input, cancel_robot_command),
        "RobotHeartbeat" => unary!(client, input, robot_heartbeat),
        "PollRobot" => unary!(client, input, poll_robot),
        "AcknowledgeRobot" => unary!(client, input, acknowledge_robot),
        "AnswerRobot" => unary!(client, input, answer_robot),
        _ => Err(ServerError::invalid("Unsupported robot method.")),
    };
    result
}
