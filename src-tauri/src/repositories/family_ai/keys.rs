use crate::repositories::storage::keychain;
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, Zeroizing};

const SERVICE: &str = "com.swavan.vfam.family-ai";
const UNAVAILABLE: &str =
    "Family AI key storage is locked or unavailable. Unlock the system key store and retry.";

/// Family-owned AI settings. Stored only in this device's OS credential store.
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FamilyAiConfig {
    pub provider: String,
    pub model: String,
    #[serde(default)]
    pub endpoint: String,
    pub api_key: String,
}

impl Drop for FamilyAiConfig {
    fn drop(&mut self) {
        self.api_key.zeroize();
    }
}

impl std::fmt::Debug for FamilyAiConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("FamilyAiConfig")
            .field("provider", &self.provider)
            .field("model", &self.model)
            .field("endpoint", &self.endpoint)
            .finish_non_exhaustive()
    }
}

pub fn save(scope: &str, config: &FamilyAiConfig) -> Result<(), String> {
    let secret = Zeroizing::new(serde_json::to_string(config).map_err(|_| UNAVAILABLE)?);
    keychain::entry(SERVICE, scope)
        .map_err(|()| UNAVAILABLE.to_owned())?
        .set_password(&secret)
        .map_err(|_| UNAVAILABLE.to_owned())
}

pub fn load(scope: &str) -> Result<Option<FamilyAiConfig>, String> {
    match keychain::entry(SERVICE, scope)
        .map_err(|()| UNAVAILABLE.to_owned())?
        .get_password()
    {
        Ok(secret) => {
            let secret = Zeroizing::new(secret);
            serde_json::from_str(&secret)
                .map(Some)
                .map_err(|_| UNAVAILABLE.to_owned())
        }
        Err(keyring_core::Error::NoEntry) => Ok(None),
        Err(_) => Err(UNAVAILABLE.to_owned()),
    }
}

pub fn clear(scope: &str) -> Result<(), String> {
    match keychain::entry(SERVICE, scope)
        .map_err(|()| UNAVAILABLE.to_owned())?
        .delete_credential()
    {
        Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
        Err(_) => Err(UNAVAILABLE.to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::{clear, load, save, FamilyAiConfig};

    #[test]
    fn debug_output_never_contains_the_api_key() {
        let config = FamilyAiConfig {
            provider: "openai".into(),
            model: "gpt".into(),
            endpoint: String::new(),
            api_key: "sk-secret-value".into(),
        };
        let shown = format!("{config:?}");
        assert!(shown.contains("openai"));
        assert!(!shown.contains("sk-secret-value"));
    }

    #[test]
    #[ignore = "requires an unlocked OS credential store; creates and deletes a temporary test key"]
    fn os_keychain_round_trips_and_clears_family_ai_settings() {
        let scope = format!("test:{}", uuid::Uuid::new_v4());
        assert!(load(&scope).unwrap().is_none());
        let config = FamilyAiConfig {
            provider: "claude".into(),
            model: "claude-model".into(),
            endpoint: String::new(),
            api_key: "sk-test".into(),
        };
        save(&scope, &config).unwrap();
        let loaded = load(&scope).unwrap().unwrap();
        assert_eq!(loaded.api_key, "sk-test");
        assert_eq!(loaded.model, "claude-model");
        clear(&scope).unwrap();
        clear(&scope).unwrap();
        assert!(load(&scope).unwrap().is_none());
    }
}
