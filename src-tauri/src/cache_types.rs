#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheRequest {
    pub action: String,
    pub namespace: String,
    pub key: Option<String>,
    pub value: Option<serde_json::Value>,
    pub ttl_seconds: Option<u64>,
    pub include_expired: Option<bool>,
}
