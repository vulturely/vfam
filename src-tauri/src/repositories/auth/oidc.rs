use crate::repositories::server::ServerError;
use serde::Deserialize;
use std::time::Duration;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryInput {
    pub authority: String,
}

pub async fn discovery(input: DiscoveryInput) -> Result<serde_json::Value, ServerError> {
    let authority = url::Url::parse(&input.authority)
        .map_err(|_| ServerError::invalid("Invalid OIDC authority."))?;
    if authority.scheme() != "https"
        && !(authority.scheme() == "http"
            && matches!(
                authority.host_str(),
                Some("localhost" | "127.0.0.1" | "[::1]")
            ))
    {
        return Err(ServerError::invalid("OIDC discovery requires HTTPS."));
    }
    let url = format!(
        "{}/.well-known/openid-configuration",
        input.authority.trim_end_matches('/')
    );
    let response = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| ServerError::new("internal", "OIDC client unavailable."))?
        .get(url)
        .send()
        .await
        .map_err(|_| ServerError::unavailable("Could not load OIDC discovery."))?;
    if !response.status().is_success() {
        return Err(ServerError::unavailable("Could not load OIDC discovery."));
    }
    response
        .json()
        .await
        .map_err(|_| ServerError::new("internal", "Invalid OIDC discovery response."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn serve(status: &str, body: &'static str) -> std::net::SocketAddr {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind OIDC server");
        let address = listener.local_addr().expect("OIDC server address");
        let status = status.to_owned();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept discovery");
            let mut request = [0; 2048];
            let count = stream.read(&mut request).await.expect("read discovery");
            assert!(String::from_utf8_lossy(&request[..count])
                .starts_with("GET /.well-known/openid-configuration"));
            let response = format!(
                "HTTP/1.1 {status}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            stream
                .write_all(response.as_bytes())
                .await
                .expect("response");
        });
        address
    }

    #[tokio::test]
    async fn discovers_valid_documents_and_rejects_invalid_responses() {
        let valid = serve(
            "200 OK",
            r#"{"authorization_endpoint":"https://auth.example"}"#,
        )
        .await;
        let document = discovery(DiscoveryInput {
            authority: format!("http://{valid}/"),
        })
        .await
        .expect("discovery document");
        assert_eq!(document["authorization_endpoint"], "https://auth.example");

        let redirect = serve("302 Found", "{}").await;
        let error = discovery(DiscoveryInput {
            authority: format!("http://{redirect}"),
        })
        .await
        .unwrap_err();
        assert_eq!(error.kind, "unavailable");

        let malformed = serve("200 OK", "not json").await;
        let error = discovery(DiscoveryInput {
            authority: format!("http://{malformed}"),
        })
        .await
        .unwrap_err();
        assert_eq!(error.kind, "internal");

        for authority in ["not a url", "http://example.com"] {
            assert!(discovery(DiscoveryInput {
                authority: authority.into(),
            })
            .await
            .is_err());
        }
    }
}
