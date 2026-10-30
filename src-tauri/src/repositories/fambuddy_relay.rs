use super::server::{authenticated, channel, decode, encode, ServerError, UnaryInput};
use vulture_protocol::server::v1::fam_buddy_relay_service_client::FamBuddyRelayServiceClient;

macro_rules! unary {
    ($client:ident, $input:ident, $method:ident) => {{
        let mut $client = FamBuddyRelayServiceClient::new(channel(&$input).await?);
        let request = decode(&$input.payload)?;
        let response = $client.$method(authenticated(&$input, request)?).await?;
        drop($client);
        encode(response.into_inner())
    }};
}

pub async fn execute(input: UnaryInput) -> Result<serde_json::Value, ServerError> {
    let result = match input.method.as_str() {
        "CreateChannel" => unary!(client, input, create_channel),
        "RevokeChannel" => unary!(client, input, revoke_channel),
        "PublishEnvelope" => unary!(client, input, publish_envelope),
        _ => Err(ServerError::invalid("Unsupported FamBuddy relay method.")),
    };
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repositories::server::StreamInput;
    use tokio_stream::wrappers::{ReceiverStream, TcpListenerStream};
    use vulture_protocol::server::v1::{
        fam_buddy_relay_service_server::{FamBuddyRelayService, FamBuddyRelayServiceServer},
        CreateChannelRequest, CreateChannelResponse, PublishEnvelopeRequest,
        PublishEnvelopeResponse, RevokeChannelRequest, RevokeChannelResponse,
        WatchEnvelopesRequest, WatchEnvelopesResponse,
    };

    struct TestService;

    #[tonic::async_trait]
    impl FamBuddyRelayService for TestService {
        async fn create_channel(
            &self,
            _request: tonic::Request<CreateChannelRequest>,
        ) -> Result<tonic::Response<CreateChannelResponse>, tonic::Status> {
            Ok(tonic::Response::new(CreateChannelResponse {
                channel: "channel".into(),
                device_credential: "credential".into(),
            }))
        }

        async fn revoke_channel(
            &self,
            _request: tonic::Request<RevokeChannelRequest>,
        ) -> Result<tonic::Response<RevokeChannelResponse>, tonic::Status> {
            Err(tonic::Status::unimplemented("not tested"))
        }

        async fn publish_envelope(
            &self,
            _request: tonic::Request<PublishEnvelopeRequest>,
        ) -> Result<tonic::Response<PublishEnvelopeResponse>, tonic::Status> {
            Err(tonic::Status::unimplemented("not tested"))
        }

        type WatchEnvelopesStream = ReceiverStream<Result<WatchEnvelopesResponse, tonic::Status>>;

        async fn watch_envelopes(
            &self,
            request: tonic::Request<WatchEnvelopesRequest>,
        ) -> Result<tonic::Response<Self::WatchEnvelopesStream>, tonic::Status> {
            assert_eq!(request.into_inner().channel, "channel");
            let (sender, receiver) = tokio::sync::mpsc::channel(1);
            sender
                .send(Ok(WatchEnvelopesResponse {
                    ready: true,
                    ciphertext: vec![0, 1, 255],
                }))
                .await
                .expect("send stream response");
            drop(sender);
            Ok(tonic::Response::new(ReceiverStream::new(receiver)))
        }
    }

    #[tokio::test]
    async fn unary_and_stream_calls_use_generated_tonic_clients() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind relay server");
        let address = listener.local_addr().expect("relay address");
        let server = tokio::spawn(async move {
            tonic::transport::Server::builder()
                .add_service(FamBuddyRelayServiceServer::new(TestService))
                .serve_with_incoming(TcpListenerStream::new(listener))
                .await
        });
        let unary = UnaryInput {
            server_url: format!("http://{address}"),
            service: "fambuddy_relay".into(),
            method: "CreateChannel".into(),
            token: None,
            payload: serde_json::json!({}),
            timeout_ms: Some(5000),
        };
        assert_eq!(
            execute(unary.clone()).await.expect("create channel"),
            serde_json::json!({"channel": "channel", "deviceCredential": "credential"})
        );
        super::super::streams::run(
            StreamInput {
                stream_id: "stream".into(),
                unary: UnaryInput {
                    method: "WatchEnvelopes".into(),
                    payload: serde_json::json!({"channel": "channel"}),
                    ..unary
                },
            },
            |payload| {
                assert_eq!(
                    payload,
                    serde_json::json!({"ready": true, "ciphertext": "AAH/"})
                );
            },
        )
        .await
        .expect("watch envelopes");
        server.abort();
    }
}
