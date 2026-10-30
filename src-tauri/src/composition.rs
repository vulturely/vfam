use crate::{
    commands::{
        app_lifecycle, auth, chat, chat_transport, fambuddy, family_ai, server, speech, storage,
        streams,
    },
    services::{
        chat_transport::{ChatConnections, ChatRegistry},
        family_ai_keys::KeyTransferRegistry,
        streams::StreamRegistry,
    },
};

pub fn builder() -> tauri::Builder<tauri::Wry> {
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .on_window_event(crate::background::hide_on_close);
    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(StreamRegistry::default())
        .manage(ChatRegistry::default())
        .manage(ChatConnections::default())
        .manage(crate::services::help_alerts::HelpAlerts::default())
        .manage(KeyTransferRegistry::default())
        .setup(|app| {
            use tauri::Manager;
            crate::repositories::fambuddy_trust::set_root(app.path().app_data_dir()?);
            #[cfg(desktop)]
            crate::background::setup(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            auth::start_auth_callback,
            storage::local_cache,
            chat::family_chat_crypto,
            fambuddy::fambuddy_storage,
            fambuddy::fambuddy_certificate,
            fambuddy::fambuddy_trust,
            fambuddy::fambuddy_approval_notice,
            server::server_unary,
            app_lifecycle::app_exit,
            speech::speech_speak,
            speech::speech_stop,
            family_ai::family_ai_settings,
            family_ai::family_ai_run,
            family_ai::family_ai_answer,
            family_ai::family_ai_provision_robot,
            family_ai::family_ai_key_transfer,
            streams::server_stream_open,
            streams::server_stream_close,
            chat_transport::chat_command,
            chat_transport::chat_connect,
            chat_transport::chat_disconnect,
            chat_transport::chat_subscribe,
            chat_transport::chat_unsubscribe,
            chat_transport::chat_attachment_upload,
            chat_transport::chat_attachment_download,
            auth::oidc::oidc_discovery,
            auth::oidc::oidc_account_input,
        ])
}

#[cfg(test)]
mod tests {
    use super::builder;

    #[test]
    fn constructs_application_builder() {
        drop(builder());
    }
}
