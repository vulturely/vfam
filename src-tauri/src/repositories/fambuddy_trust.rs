//! Certificates of `FamBuddy` hubs on the home network. A hub signs its certificate with its
//! own private authority, so neither the system trust store nor host names apply: a hub is
//! trusted only by the exact certificate the parent confirmed against the one it prints.
use super::server::ServerError;
use rustls::{
    client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier},
    crypto::{ring, verify_tls12_signature, verify_tls13_signature, CryptoProvider},
    pki_types::{CertificateDer, ServerName, UnixTime},
    DigitallySignedStruct, SignatureScheme,
};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, PoisonError, RwLock},
    time::Duration,
};
use tonic::transport::{Channel, Endpoint, Uri};

const FILE: &str = "fambuddy-certificates.json";
static ROOT: RwLock<Option<PathBuf>> = RwLock::new(None);

/// Where confirmed certificates are kept; set once as the app starts.
pub fn set_root(root: PathBuf) {
    *ROOT.write().unwrap_or_else(PoisonError::into_inner) = Some(root);
}

fn file() -> Result<PathBuf, ServerError> {
    ROOT.read()
        .unwrap_or_else(PoisonError::into_inner)
        .as_ref()
        .map(|root| root.join(FILE))
        .ok_or_else(|| ServerError::unavailable("FamBuddy certificates are unavailable."))
}

/// A hub's address as `https://host:port`, which certificates are kept under.
pub fn origin(server_url: &str) -> Result<String, ServerError> {
    let url = url::Url::parse(server_url)
        .map_err(|_| ServerError::invalid("Enter the device’s HTTPS address."))?;
    let host = url.host_str().filter(|_| url.scheme() == "https");
    match (host, url.port_or_known_default()) {
        (Some(host), Some(port)) if url.username().is_empty() && url.password().is_none() => {
            Ok(format!("https://{host}:{port}"))
        }
        _ => Err(ServerError::invalid("Enter the device’s HTTPS address.")),
    }
}

/// The SHA-256 fingerprint as `openssl x509 -fingerprint -sha256` prints it.
pub fn fingerprint(der: &[u8]) -> String {
    Sha256::digest(der)
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}

fn read(path: &Path) -> Result<BTreeMap<String, String>, ServerError> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| {
            ServerError::new("internal", "Saved FamBuddy certificates are unreadable.")
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
        Err(_) => Err(ServerError::unavailable(
            "FamBuddy certificates are unavailable.",
        )),
    }
}

pub fn pinned_at(path: &Path, origin: &str) -> Result<Option<String>, ServerError> {
    Ok(read(path)?.remove(origin))
}

pub fn pin_at(path: &Path, origin: &str, fingerprint: &str) -> Result<(), ServerError> {
    let unavailable = |_| ServerError::unavailable("FamBuddy certificates could not be saved.");
    let mut pins = read(path)?;
    pins.insert(origin.to_owned(), fingerprint.to_owned());
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(unavailable)?;
    }
    let partial = path.with_extension("json.partial");
    let body = serde_json::to_vec(&pins)
        .map_err(|_| ServerError::new("internal", "Invalid certificate."))?;
    std::fs::write(&partial, body).map_err(unavailable)?;
    std::fs::rename(&partial, path).map_err(unavailable)
}

pub fn pinned(origin: &str) -> Result<Option<String>, ServerError> {
    pinned_at(&file()?, origin)
}

pub fn pin(origin: &str, fingerprint: &str) -> Result<(), ServerError> {
    pin_at(&file()?, origin, fingerprint)
}

/// Accepts only the expected certificate and records what the hub presented. With no
/// expected certificate it accepts nothing, so reading a fingerprint never connects.
#[derive(Debug)]
struct Pinned {
    expected: Option<String>,
    seen: Arc<Mutex<Option<String>>>,
    provider: Arc<CryptoProvider>,
}
impl ServerCertVerifier for Pinned {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _: &[CertificateDer<'_>],
        _: &ServerName<'_>,
        _: &[u8],
        _: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let seen = fingerprint(end_entity.as_ref());
        let accepted = self.expected.as_deref() == Some(seen.as_str());
        *self.seen.lock().unwrap_or_else(PoisonError::into_inner) = Some(seen);
        if accepted {
            Ok(ServerCertVerified::assertion())
        } else {
            Err(rustls::Error::General(
                "Unconfirmed FamBuddy certificate".into(),
            ))
        }
    }
    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(
            message,
            cert,
            signature,
            &self.provider.signature_verification_algorithms,
        )
    }
    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(
            message,
            cert,
            signature,
            &self.provider.signature_verification_algorithms,
        )
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

struct Target {
    host: String,
    port: u16,
}
fn target(origin: &str) -> Result<Target, ServerError> {
    let url = url::Url::parse(origin)
        .map_err(|_| ServerError::invalid("Enter the device’s HTTPS address."))?;
    Ok(Target {
        host: url
            .host_str()
            .ok_or_else(|| ServerError::invalid("Enter the device’s HTTPS address."))?
            .trim_start_matches('[')
            .trim_end_matches(']')
            .to_owned(),
        port: url
            .port_or_known_default()
            .ok_or_else(|| ServerError::invalid("Enter the device’s HTTPS address."))?,
    })
}

/// Tries every address the name resolves to at once. A `.local` name often resolves to an
/// IPv6 address first that the device's firewall silently drops; waiting on it in turn
/// would use up the whole timeout before the working IPv4 address is tried.
async fn connect(target: &Target) -> std::io::Result<tokio::net::TcpStream> {
    let attempts: Vec<_> = tokio::net::lookup_host((target.host.as_str(), target.port))
        .await?
        .map(|address| Box::pin(tokio::net::TcpStream::connect(address)))
        .collect();
    if attempts.is_empty() {
        return Err(std::io::Error::from(std::io::ErrorKind::NotFound));
    }
    Ok(futures_util::future::select_ok(attempts).await?.0)
}

async fn handshake(
    target: &Target,
    verifier: Arc<Pinned>,
    wait: Duration,
) -> std::io::Result<tokio_rustls::client::TlsStream<tokio::net::TcpStream>> {
    let provider = verifier.provider.clone();
    let mut config = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(std::io::Error::other)?
        .dangerous()
        .with_custom_certificate_verifier(verifier)
        .with_no_client_auth();
    config.alpn_protocols = vec![b"h2".to_vec()];
    let name = ServerName::try_from(target.host.clone()).map_err(std::io::Error::other)?;
    let tcp = tokio::time::timeout(wait, connect(target))
        .await
        .map_err(|_| std::io::Error::from(std::io::ErrorKind::TimedOut))??;
    tokio::time::timeout(
        wait,
        tokio_rustls::TlsConnector::from(Arc::new(config)).connect(name, tcp),
    )
    .await
    .map_err(|_| std::io::Error::from(std::io::ErrorKind::TimedOut))?
}

fn verifier(expected: Option<String>) -> Arc<Pinned> {
    Arc::new(Pinned {
        expected,
        seen: Arc::default(),
        provider: Arc::new(ring::default_provider()),
    })
}

/// The fingerprint of the certificate the hub presents, without connecting to it.
pub async fn presented(origin: &str, wait: Duration) -> Result<String, ServerError> {
    let target = target(origin)?;
    let verifier = verifier(None);
    let _ = handshake(&target, verifier.clone(), wait).await;
    let seen = verifier
        .seen
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .take();
    seen.ok_or_else(|| ServerError::unavailable("The FamBuddy is unavailable."))
}

/// A gRPC channel that only talks to the hub presenting the confirmed certificate.
pub async fn channel(origin: &str, expected: &str, wait: Duration) -> Result<Channel, ServerError> {
    let target = Arc::new(target(origin)?);
    let verifier = verifier(Some(expected.to_owned()));
    let connector = {
        let (target, verifier) = (target.clone(), verifier.clone());
        tower::service_fn(move |_: Uri| {
            let (target, verifier) = (target.clone(), verifier.clone());
            async move {
                let stream = handshake(&target, verifier, wait).await?;
                Ok::<_, std::io::Error>(hyper_util::rt::TokioIo::new(stream))
            }
        })
    };
    // TLS is done by the connector above, so tonic's own HTTPS handling stays off.
    let connected = Endpoint::from_shared(origin.replacen("https://", "http://", 1))
        .map_err(|_| ServerError::invalid("Enter the device’s HTTPS address."))?
        .connect_timeout(wait)
        // Pings keep the live device stream open on the home network and notice a dead one.
        .http2_keep_alive_interval(Duration::from_secs(20))
        .keep_alive_timeout(Duration::from_secs(10))
        .keep_alive_while_idle(true)
        .connect_with_connector(connector)
        .await;
    connected.map_err(|_| {
        let seen = verifier
            .seen
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone();
        match seen {
            Some(seen) if seen != expected => ServerError::new(
                "permission_denied",
                "This FamBuddy's certificate changed. Check it and pair again.",
            ),
            _ => ServerError::unavailable("The FamBuddy is unavailable."),
        }
    })
}

#[cfg(test)]
#[path = "fambuddy_trust_tests.rs"]
pub mod tests;
