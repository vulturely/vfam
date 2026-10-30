use crate::{cache_types::CacheRequest, repositories::storage};
use tauri::Emitter;

const MAX_NAMESPACE: usize = 512;
const MAX_KEY: usize = 1024;
const MAX_VALUE: usize = 8 * 1024 * 1024;
const MAX_TTL: u64 = 30 * 24 * 60 * 60;

pub async fn execute<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: CacheRequest,
    source: Option<String>,
) -> Result<serde_json::Value, String> {
    validate(&request)?;
    let changed = request.namespace == "local-state-v1"
        && matches!(
            request.action.as_str(),
            "put" | "delete" | "clear_namespace"
        );
    let key = request.key.clone();
    let result = storage::execute(app.clone(), request).await?;
    if changed {
        let _ = app.emit(
            "vulture:local-state-changed",
            serde_json::json!({ "key": key, "source": source }),
        );
    }
    Ok(result)
}

fn validate(request: &CacheRequest) -> Result<(), String> {
    if request.namespace.is_empty() || request.namespace.len() > MAX_NAMESPACE {
        return Err("Invalid local cache namespace.".into());
    }
    match request.action.as_str() {
        "get" | "delete" => {
            validate_key(request)?;
        }
        "put" => {
            validate_key(request)?;
            let value = request.value.as_ref().ok_or("Missing local cache value.")?;
            if serde_json::to_vec(value)
                .map_err(|_| "Invalid local cache value.")?
                .len()
                > MAX_VALUE
            {
                return Err("Local cache value exceeds its limit.".into());
            }
            if request.ttl_seconds.is_some_and(|ttl| ttl > MAX_TTL) {
                return Err("Local cache expiry exceeds its limit.".into());
            }
        }
        "clear_namespace" => {}
        _ => return Err("Unsupported local cache operation.".into()),
    }
    Ok(())
}

fn validate_key(request: &CacheRequest) -> Result<(), String> {
    if request
        .key
        .as_deref()
        .is_none_or(|key| key.is_empty() || key.len() > MAX_KEY)
    {
        return Err("Invalid local cache key.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate;
    use crate::cache_types::CacheRequest;

    fn request(action: &str) -> CacheRequest {
        CacheRequest {
            action: action.into(),
            namespace: "account".into(),
            key: Some("family".into()),
            value: Some(serde_json::json!({ "name": "Family" })),
            ttl_seconds: Some(60),
            include_expired: None,
        }
    }

    #[test]
    fn validates_operations_and_limits() {
        assert!(validate(&request("get")).is_ok());
        assert!(validate(&request("put")).is_ok());
        assert!(validate(&request("delete")).is_ok());
        assert!(validate(&request("clear_namespace")).is_ok());
        assert!(validate(&request("unknown")).is_err());
        let mut missing = request("put");
        missing.value = None;
        assert!(validate(&missing).is_err());
        let mut expiry = request("put");
        expiry.ttl_seconds = Some(super::MAX_TTL + 1);
        assert!(validate(&expiry).is_err());
        let mut namespace = request("get");
        namespace.namespace.clear();
        assert!(validate(&namespace).is_err());
        let mut key = request("get");
        key.key = Some(String::new());
        assert!(validate(&key).is_err());
    }
}
