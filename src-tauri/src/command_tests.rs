#![cfg(test)]

use crate::{
    cache_types::CacheRequest,
    commands::{
        auth::{self, oidc},
        chat, chat_transport, fambuddy, server, storage, streams,
    },
    repositories::{
        auth::oidc::DiscoveryInput,
        chat_transport::{
            AttachmentDownloadInput, AttachmentUploadInput, ChatCommandInput, ChatConnectInput,
            ChatSubscriptionInput,
        },
        server::{StreamInput, UnaryInput},
    },
    services::{
        auth::oidc::AccountInput,
        chat_transport::{ChatConnections, ChatRegistry},
        streams::StreamRegistry,
    },
};
use tauri::Manager;

fn unary(service: &str, method: &str) -> UnaryInput {
    UnaryInput {
        server_url: "not a url".into(),
        service: service.into(),
        method: method.into(),
        token: None,
        payload: serde_json::json!({}),
        timeout_ms: Some(10),
    }
}

#[test]
fn commands_delegate_validation_and_errors_through_services() {
    let app = tauri::test::mock_app().handle().clone();
    app.manage(StreamRegistry::default());
    app.manage(ChatRegistry::default());
    app.manage(ChatConnections::default());
    assert!(tauri::async_runtime::block_on(auth::start_auth_callback(
        app.clone(),
        "invalid".into()
    ))
    .is_err());
    assert!(tauri::async_runtime::block_on(storage::local_cache(
        app.clone(),
        CacheRequest {
            action: "get".into(),
            namespace: String::new(),
            key: Some("family".into()),
            value: None,
            ttl_seconds: None,
            include_expired: None,
        },
        None,
    ))
    .is_err());
    assert!(tauri::async_runtime::block_on(chat::family_chat_crypto(
        app.clone(),
        "account".into(),
        serde_json::json!({"action":"unsupported"})
    ))
    .is_err());
    assert!(tauri::async_runtime::block_on(fambuddy::fambuddy_storage(
        app.clone(),
        "server".into(),
        String::new(),
        serde_json::json!({"action":"get"})
    ))
    .is_err());
    assert!(
        tauri::async_runtime::block_on(server::server_unary(unary("unknown", "Health"))).is_err()
    );
    assert!(
        tauri::async_runtime::block_on(oidc::oidc_discovery(DiscoveryInput {
            authority: "http://example.com".into(),
        }))
        .is_err()
    );
    assert!(tauri::async_runtime::block_on(chat_transport::chat_command(
        app.clone(),
        ChatCommandInput {
            server_url: "not a url".into(),
            token: None,
            command: serde_json::json!({}),
        }
    ))
    .is_err());
    assert!(
        tauri::async_runtime::block_on(chat_transport::chat_subscribe(
            app.clone(),
            ChatSubscriptionInput {
                family_id: None,
                subscription_id: "subscription".into(),
                server_url: "not a url".into(),
                token: None,
            }
        ))
        .is_err()
    );
    assert!(
        tauri::async_runtime::block_on(chat_transport::chat_unsubscribe(
            app.clone(),
            "subscription".into(),
        ))
        .is_ok()
    );
    assert!(
        tauri::async_runtime::block_on(chat_transport::chat_attachment_upload(
            app,
            AttachmentUploadInput {
                upload_id: "upload".into(),
                server_url: "https://localhost".into(),
                token: "token".into(),
                family_id: "family".into(),
                bytes: "not base64".into(),
            }
        ))
        .is_err()
    );
    assert!(
        tauri::async_runtime::block_on(chat_transport::chat_attachment_download(
            AttachmentDownloadInput {
                server_url: "not a url".into(),
                token: "token".into(),
                family_id: "family".into(),
                object_key: "object".into(),
            }
        ))
        .is_err()
    );
}

#[test]
fn stream_commands_manage_open_duplicates_and_close() {
    let app = tauri::test::mock_app().handle().clone();
    app.manage(StreamRegistry::default());
    let mut input = StreamInput {
        stream_id: String::new(),
        unary: UnaryInput {
            server_url: "http://127.0.0.1:9".into(),
            service: "fambuddy_relay".into(),
            method: "WatchEnvelopes".into(),
            token: None,
            payload: serde_json::json!({}),
            timeout_ms: Some(10),
        },
    };
    assert!(tauri::async_runtime::block_on(streams::server_stream_open(
        app.clone(),
        input.clone()
    ))
    .is_err());
    input.stream_id = "stream".into();
    tauri::async_runtime::block_on(streams::server_stream_open(app.clone(), input.clone()))
        .expect("open stream");
    assert!(
        tauri::async_runtime::block_on(streams::server_stream_open(app.clone(), input)).is_err()
    );
    tauri::async_runtime::block_on(streams::server_stream_close(app, "stream".into()))
        .expect("close stream");
}

#[test]
fn oidc_commands_delegate_validation() {
    tauri::async_runtime::block_on(oidc::oidc_account_input(AccountInput {
        display_name: "Parent".into(),
        email: Some("parent@example.com".into()),
    }))
    .expect("valid account");
    assert!(
        tauri::async_runtime::block_on(oidc::oidc_account_input(AccountInput {
            display_name: "Parent".into(),
            email: Some("invalid".into()),
        }))
        .is_err()
    );
}

#[test]
fn chat_connection_commands_delegate_to_the_shared_connection() {
    let app = tauri::test::mock_app().handle().clone();
    app.manage(ChatConnections::default());
    app.manage(crate::services::help_alerts::HelpAlerts::default());
    assert!(tauri::async_runtime::block_on(chat_transport::chat_connect(
        app.clone(),
        ChatConnectInput {
            server_url: "not a url".into(),
            token: None,
        }
    ))
    .is_err());
    assert!(tauri::async_runtime::block_on(chat_transport::chat_disconnect(app)).is_ok());
}

#[test]
fn speech_command_delegates_to_the_device_voice_service() {
    use crate::commands::speech::{speech_speak, SpeechInput};
    let error = tauri::async_runtime::block_on(speech_speak(SpeechInput { text: " ".into() }))
        .expect_err("empty text");
    assert_eq!(error.kind, "invalid_argument");
}

#[test]
fn fambuddy_certificate_commands_delegate_to_the_trust_service() {
    let error = tauri::async_runtime::block_on(fambuddy::fambuddy_certificate("not a url".into()))
        .expect_err("invalid address");
    assert_eq!(error.kind, "invalid_argument");
    let error = tauri::async_runtime::block_on(fambuddy::fambuddy_trust(
        crate::services::fambuddy_trust::TrustInput {
            server_url: "http://fambuddy.local:5443".into(),
            fingerprint: "AA".into(),
        },
    ))
    .expect_err("HTTPS required");
    assert_eq!(error.kind, "invalid_argument");
}

#[test]
fn approval_notice_command_refuses_invalid_text() {
    let app = tauri::test::mock_app().handle().clone();
    assert!(
        tauri::async_runtime::block_on(fambuddy::fambuddy_approval_notice(
            app,
            crate::services::fambuddy_approvals::ApprovalNoticeInput {
                title: String::new(),
                body: "An answer is waiting.".into(),
            },
        ))
        .is_err()
    );
}
