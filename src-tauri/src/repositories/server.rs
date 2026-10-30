use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::time::Duration;
use tonic::transport::{Channel, Endpoint};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnaryInput {
    pub server_url: String,
    pub service: String,
    pub method: String,
    pub token: Option<String>,
    pub payload: serde_json::Value,
    pub timeout_ms: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamInput {
    pub stream_id: String,
    #[serde(flatten)]
    pub unary: UnaryInput,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServerError {
    pub kind: String,
    pub message: String,
}

impl ServerError {
    pub fn new(kind: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            kind: kind.into(),
            message: message.into(),
        }
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new("invalid_argument", message)
    }

    pub fn unavailable(message: impl Into<String>) -> Self {
        Self::new("unavailable", message)
    }
}

impl std::fmt::Display for ServerError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ServerError {}

pub fn decode<T: DeserializeOwned>(value: &serde_json::Value) -> Result<T, ServerError> {
    serde_json::from_value(value.clone())
        .map_err(|_| ServerError::invalid("Invalid server request payload."))
}

pub fn encode<T: Serialize>(value: T) -> Result<serde_json::Value, ServerError> {
    serde_json::to_value(value)
        .map_err(|_| ServerError::new("internal", "Invalid server response payload."))
}

pub async fn channel(input: &UnaryInput) -> Result<Channel, ServerError> {
    let endpoint = url::Url::parse(&input.server_url)
        .map_err(|_| ServerError::invalid("Invalid Vulture server URL."))?;
    let secure = endpoint.scheme() == "https";
    let loopback = endpoint.scheme() == "http"
        && matches!(
            endpoint.host_str(),
            Some("localhost" | "127.0.0.1" | "[::1]")
        );
    if !secure && !loopback {
        return Err(ServerError::invalid(
            "Vulture requires HTTPS outside local development.",
        ));
    }
    // A FamBuddy on the home network is reached only through the certificate the parent
    // confirmed when pairing; its private authority is never trusted system-wide.
    if secure && input.service == "fambuddy_gateway" {
        let origin = super::fambuddy_trust::origin(&input.server_url)?;
        let confirmed = super::fambuddy_trust::pinned(&origin)?.ok_or_else(|| {
            ServerError::new(
                "failed_precondition",
                "Confirm this FamBuddy's certificate before connecting.",
            )
        })?;
        return super::fambuddy_trust::channel(&origin, &confirmed, connect_timeout(input)).await;
    }
    let channel = Endpoint::new(input.server_url.clone())
        .map_err(|_| ServerError::invalid("Invalid Vulture server URL."))?
        .connect_timeout(connect_timeout(input));
    tokio::time::timeout(connect_timeout(input), channel.connect())
        .await
        .map_err(|_| ServerError::new("deadline_exceeded", "Server connection timed out."))?
        .map_err(|_| ServerError::unavailable("Vulture server is unavailable."))
}

pub fn authenticated<T>(input: &UnaryInput, value: T) -> Result<tonic::Request<T>, ServerError> {
    let mut request = tonic::Request::new(value);
    if input.timeout_ms != Some(0) {
        request.set_timeout(timeout(input));
    }
    if let Some(token) = input.token.as_deref().filter(|token| !token.is_empty()) {
        let value = format!("Bearer {token}")
            .parse()
            .map_err(|_| ServerError::invalid("Invalid server access token."))?;
        request.metadata_mut().insert("authorization", value);
    }
    Ok(request)
}

pub fn status(error: &tonic::Status) -> ServerError {
    let kind = match error.code() {
        tonic::Code::Unauthenticated => "unauthenticated",
        tonic::Code::PermissionDenied => "permission_denied",
        tonic::Code::InvalidArgument => "invalid_argument",
        tonic::Code::NotFound => "not_found",
        tonic::Code::AlreadyExists => "already_exists",
        tonic::Code::FailedPrecondition => "failed_precondition",
        tonic::Code::DeadlineExceeded => "deadline_exceeded",
        tonic::Code::Unavailable => "unavailable",
        tonic::Code::Cancelled => "cancelled",
        _ => "internal",
    };
    ServerError::new(kind, error.message())
}

/// Streams ask for no request deadline (0); connecting still gets the normal wait.
fn connect_timeout(input: &UnaryInput) -> Duration {
    if input.timeout_ms == Some(0) {
        Duration::from_secs(15)
    } else {
        timeout(input)
    }
}

fn timeout(input: &UnaryInput) -> Duration {
    Duration::from_millis(input.timeout_ms.unwrap_or(15_000).clamp(1, 120_000))
}

impl From<tonic::Status> for ServerError {
    fn from(error: tonic::Status) -> Self {
        status(&error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Invalid;
    impl Serialize for Invalid {
        fn serialize<S>(&self, _serializer: S) -> Result<S::Ok, S::Error>
        where
            S: serde::Serializer,
        {
            Err(serde::ser::Error::custom("invalid"))
        }
    }

    fn input(url: &str) -> UnaryInput {
        UnaryInput {
            server_url: url.into(),
            service: "control".into(),
            method: "Health".into(),
            token: None,
            payload: serde_json::json!({}),
            timeout_ms: Some(10),
        }
    }

    #[test]
    fn streams_without_a_deadline_still_get_time_to_connect() {
        assert_eq!(
            connect_timeout(&input("http://127.0.0.1:1")),
            Duration::from_millis(10)
        );
        let stream = UnaryInput {
            timeout_ms: Some(0),
            ..input("http://127.0.0.1:1")
        };
        assert_eq!(connect_timeout(&stream), Duration::from_secs(15));
    }

    #[test]
    fn validates_endpoint_and_authentication_without_opening_network() {
        for url in ["not a url", "http://example.com", "ftp://localhost"] {
            let error = tauri::async_runtime::block_on(channel(&input(url))).unwrap_err();
            assert_eq!(error.kind, "invalid_argument");
        }
        let mut request = input("https://server.example");
        request.token = Some("token".into());
        let request = authenticated(&request, ()).expect("authenticated request");
        assert_eq!(
            request.metadata().get("authorization").expect("bearer"),
            "Bearer token"
        );
        assert!(request.metadata().get("authorization").is_some());
    }

    #[test]
    fn maps_status_and_rejects_invalid_json() {
        for (code, kind) in [
            (tonic::Code::Unauthenticated, "unauthenticated"),
            (tonic::Code::PermissionDenied, "permission_denied"),
            (tonic::Code::InvalidArgument, "invalid_argument"),
            (tonic::Code::NotFound, "not_found"),
            (tonic::Code::AlreadyExists, "already_exists"),
            (tonic::Code::FailedPrecondition, "failed_precondition"),
            (tonic::Code::DeadlineExceeded, "deadline_exceeded"),
            (tonic::Code::Unavailable, "unavailable"),
            (tonic::Code::Cancelled, "cancelled"),
            (tonic::Code::Internal, "internal"),
        ] {
            let error = status(&tonic::Status::new(code, "failed"));
            assert_eq!(error.kind, kind);
            assert_eq!(error.to_string(), "failed");
        }
        assert!(decode::<serde_json::Value>(&serde_json::Value::Null).is_ok());
        assert!(decode::<bool>(&serde_json::json!("not bool")).is_err());
    }

    #[test]
    fn validates_tokens_and_json_encoding() {
        let mut value = input("https://server.example");
        value.token = Some("invalid\ntoken".into());
        assert!(authenticated(&value, ()).is_err());
        value.token = Some(String::new());
        value.timeout_ms = Some(0);
        assert!(authenticated(&value, ()).is_ok());
        assert_eq!(encode(Invalid).unwrap_err().kind, "internal");
    }

    #[tokio::test]
    async fn reports_connection_failures() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind closed port");
        let address = listener.local_addr().expect("closed address");
        drop(listener);
        let error = channel(&input(&format!("http://{address}")))
            .await
            .unwrap_err();
        assert_eq!(error.kind, "unavailable");
    }
}
