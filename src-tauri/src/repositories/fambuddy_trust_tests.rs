use super::*;
use tonic::transport::{Identity, Server, ServerTlsConfig};

pub struct Hub {
    pub origin: String,
    pub fingerprint: String,
    pub server: tokio::task::JoinHandle<()>,
}

/// A TLS gRPC server with a self-signed certificate, as a `FamBuddy` hub has.
pub async fn hub() -> Hub {
    let certified =
        rcgen::generate_simple_self_signed(vec!["127.0.0.1".into()]).expect("certificate");
    let fingerprint = fingerprint(certified.cert.der());
    let identity = Identity::from_pem(certified.cert.pem(), certified.key_pair.serialize_pem());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind hub");
    let origin = format!("https://{}", listener.local_addr().expect("hub address"));
    let server = tokio::spawn(async move {
        let _ = Server::builder()
            .tls_config(ServerTlsConfig::new().identity(identity))
            .expect("hub TLS")
            .add_routes(tonic::service::Routes::default())
            .serve_with_incoming(tokio_stream::wrappers::TcpListenerStream::new(listener))
            .await;
    });
    Hub {
        origin,
        fingerprint,
        server,
    }
}

#[tokio::test]
async fn only_the_confirmed_certificate_is_trusted() {
    let hub = hub().await;
    let wait = Duration::from_secs(5);
    let shown = presented(&hub.origin, wait).await.expect("fingerprint");
    assert_eq!(shown, hub.fingerprint);
    assert_eq!(shown.len(), 95, "openssl-style colon-separated SHA-256");
    channel(&hub.origin, &hub.fingerprint, wait)
        .await
        .expect("pinned channel");
    let other = "00:".repeat(31) + "00";
    let refused = channel(&hub.origin, &other, wait)
        .await
        .expect_err("other certificate");
    assert_eq!(refused.kind, "permission_denied");
    hub.server.abort();
}

#[tokio::test]
async fn an_unreachable_hub_has_no_certificate() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("free port");
    let origin = format!("https://{}", listener.local_addr().expect("address"));
    drop(listener);
    let wait = Duration::from_secs(2);
    assert_eq!(
        presented(&origin, wait).await.expect_err("closed").kind,
        "unavailable"
    );
    assert_eq!(
        channel(&origin, "AA", wait).await.expect_err("closed").kind,
        "unavailable"
    );
}

#[test]
fn addresses_are_kept_as_https_origins() {
    assert_eq!(
        origin("https://fambuddy.local:5443/").unwrap(),
        "https://fambuddy.local:5443"
    );
    assert_eq!(
        origin("https://buddy.local").unwrap(),
        "https://buddy.local:443"
    );
    for invalid in [
        "http://fambuddy.local:5443",
        "https://user:pass@fambuddy.local",
        "not a url",
    ] {
        assert_eq!(
            origin(invalid).unwrap_err().kind,
            "invalid_argument",
            "{invalid}"
        );
    }
}

#[test]
fn confirmed_certificates_are_saved_per_hub() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("nested").join(FILE);
    assert_eq!(pinned_at(&path, "https://a:1").unwrap(), None);
    pin_at(&path, "https://a:1", "AA").unwrap();
    pin_at(&path, "https://b:1", "BB").unwrap();
    pin_at(&path, "https://a:1", "CC").unwrap();
    assert_eq!(
        pinned_at(&path, "https://a:1").unwrap().as_deref(),
        Some("CC")
    );
    assert_eq!(
        pinned_at(&path, "https://b:1").unwrap().as_deref(),
        Some("BB")
    );
    std::fs::write(&path, b"not json").unwrap();
    assert_eq!(
        pinned_at(&path, "https://a:1").unwrap_err().kind,
        "internal"
    );
    assert_eq!(
        pin_at(&path, "https://a:1", "AA").unwrap_err().kind,
        "internal"
    );
    let blocked = directory.path().join("file");
    std::fs::write(&blocked, b"").unwrap();
    assert_eq!(
        pin_at(&blocked.join(FILE), "https://a:1", "AA")
            .unwrap_err()
            .kind,
        "unavailable"
    );
    assert_eq!(
        pinned_at(directory.path(), "https://a:1").unwrap_err().kind,
        "unavailable"
    );
}

#[tokio::test]
async fn a_name_with_an_unreachable_address_still_reaches_the_hub() {
    // "localhost" also resolves to ::1, where nothing listens; the IPv4 hub still answers.
    let hub = hub().await;
    let local = hub.origin.replace("127.0.0.1", "localhost");
    assert_eq!(
        presented(&local, Duration::from_secs(5)).await.unwrap(),
        hub.fingerprint
    );
    hub.server.abort();
}
