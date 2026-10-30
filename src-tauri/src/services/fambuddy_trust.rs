//! Confirming a `FamBuddy` hub's certificate before pairing with it.
use crate::repositories::{fambuddy_trust, server::ServerError};
use std::time::Duration;

const WAIT: Duration = Duration::from_secs(5);

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustInput {
    pub server_url: String,
    pub fingerprint: String,
}

/// The fingerprint the hub presents, for the parent to compare with the one it prints.
pub async fn certificate(server_url: String) -> Result<String, ServerError> {
    fambuddy_trust::presented(&fambuddy_trust::origin(&server_url)?, WAIT).await
}

/// Trusts the hub's certificate only if it is still the one the parent compared.
pub async fn trust(input: TrustInput) -> Result<(), ServerError> {
    let origin = fambuddy_trust::origin(&input.server_url)?;
    let presented = fambuddy_trust::presented(&origin, WAIT).await?;
    if !presented.eq_ignore_ascii_case(input.fingerprint.trim()) {
        return Err(ServerError::new(
            "permission_denied",
            "The FamBuddy's certificate changed. Check it again.",
        ));
    }
    fambuddy_trust::pin(&origin, &presented)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repositories::{fambuddy_trust::tests::hub, server::UnaryInput};

    #[tokio::test]
    async fn a_hub_is_reachable_only_after_its_certificate_is_confirmed() {
        let directory = tempfile::tempdir().unwrap();
        fambuddy_trust::set_root(directory.path().to_owned());
        let hub = hub().await;
        let gateway = UnaryInput {
            server_url: hub.origin.clone(),
            service: "fambuddy_gateway".into(),
            method: "PairPhone".into(),
            token: None,
            payload: serde_json::json!({}),
            timeout_ms: Some(5_000),
        };
        let unconfirmed = crate::repositories::server::channel(&gateway).await;
        assert_eq!(unconfirmed.unwrap_err().kind, "failed_precondition");
        assert_eq!(
            certificate(hub.origin.clone()).await.unwrap(),
            hub.fingerprint
        );
        let changed = trust(TrustInput {
            server_url: hub.origin.clone(),
            fingerprint: "00:11".into(),
        })
        .await;
        assert_eq!(changed.unwrap_err().kind, "permission_denied");
        trust(TrustInput {
            server_url: format!("{}/", hub.origin),
            fingerprint: format!(" {} ", hub.fingerprint.to_lowercase()),
        })
        .await
        .unwrap();
        crate::repositories::server::channel(&gateway)
            .await
            .expect("confirmed hub");
        // Streams have no request deadline but still connect.
        crate::repositories::server::channel(&UnaryInput {
            timeout_ms: Some(0),
            ..gateway.clone()
        })
        .await
        .expect("confirmed hub stream");
        // Other Vulture services keep using the system trust store.
        assert!(crate::repositories::server::channel(&UnaryInput {
            service: "control".into(),
            ..gateway
        })
        .await
        .is_err());
        hub.server.abort();
    }
}
