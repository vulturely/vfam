use crate::repositories::{
    chat_transport::{
        self, AttachmentDownloadInput, AttachmentUploadInput, ChatCommandInput, ChatConnectInput,
        ChatConnection, ChatSubscriptionInput, SendError,
    },
    server::ServerError,
};
use rust_socketio::asynchronous::Client;
use std::{collections::HashMap, sync::Arc};
use tauri::Manager;
use tokio::sync::Mutex;

#[derive(Clone, Default)]
pub struct ChatRegistry {
    clients: Arc<Mutex<HashMap<String, Client>>>,
}

/// The one admitted chat connection, shared by every command for its server and session.
#[derive(Clone, Default)]
pub struct ChatConnections {
    current: Arc<Mutex<Option<Shared>>>,
    /// Held while a connection opens, so commands share one attempt. The state above
    /// is never locked across that wait, so closing is never held up by a slow server.
    connecting: Arc<Mutex<()>>,
    /// Bumped on close, so a connection that finishes opening afterwards is discarded.
    closed: Arc<std::sync::atomic::AtomicU64>,
}

struct Shared {
    server_url: String,
    token: String,
    connection: ChatConnection,
}

impl ChatConnections {
    async fn reusable(&self, server_url: &str, token: &str) -> Option<ChatConnection> {
        self.current
            .lock()
            .await
            .as_ref()
            .filter(|shared| {
                shared.server_url == server_url
                    && shared.token == token
                    && shared.connection.is_open()
            })
            .map(|shared| shared.connection.clone())
    }

    /// The open connection for this server and session, opening a new one when the
    /// session changed or the old connection closed.
    async fn get(&self, server_url: &str, token: &str) -> Result<ChatConnection, ServerError> {
        if let Some(connection) = self.reusable(server_url, token).await {
            return Ok(connection);
        }
        let _connecting = self.connecting.lock().await;
        // Another command may have opened it while this one waited.
        if let Some(connection) = self.reusable(server_url, token).await {
            return Ok(connection);
        }
        // A different session must never reuse the previous session's connection.
        let old = self.current.lock().await.take();
        if let Some(old) = old {
            chat_transport::disconnect(old.connection);
        }
        let generation = self.closed.load(std::sync::atomic::Ordering::Acquire);
        let connection = chat_transport::connect(server_url, token).await?;
        let mut current = self.current.lock().await;
        if self.closed.load(std::sync::atomic::Ordering::Acquire) != generation {
            drop(current);
            chat_transport::disconnect(connection);
            return Err(ServerError::unavailable("Chat connection ended."));
        }
        *current = Some(Shared {
            server_url: server_url.to_owned(),
            token: token.to_owned(),
            connection: connection.clone(),
        });
        drop(current);
        Ok(connection)
    }

    /// Drops a connection that failed to send. A socket can die without a close
    /// event, so the failed connection is replaced even if it still looks open; a
    /// newer connection opened meanwhile by another command is kept.
    async fn forget(&self, connection: &ChatConnection) {
        let mut current = self.current.lock().await;
        if current
            .as_ref()
            .is_some_and(|shared| shared.connection.same(connection))
        {
            if let Some(old) = current.take() {
                chat_transport::disconnect(old.connection);
            }
        }
    }

    async fn close(&self) {
        self.closed
            .fetch_add(1, std::sync::atomic::Ordering::AcqRel);
        let old = self.current.lock().await.take();
        if let Some(old) = old {
            chat_transport::disconnect(old.connection);
        }
    }
}

pub async fn command<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    input: ChatCommandInput,
) -> Result<serde_json::Value, ServerError> {
    let connections = app.state::<ChatConnections>();
    let token = input.token.unwrap_or_default();
    let connection = connections.get(&input.server_url, &token).await?;
    match chat_transport::send(&connection, input.command.clone()).await {
        Ok(result) => Ok(result),
        Err(SendError::Failed(error)) => Err(error),
        // The connection closed before the command left; send it once on a new one.
        Err(SendError::NotSent) => {
            connections.forget(&connection).await;
            let connection = connections.get(&input.server_url, &token).await?;
            chat_transport::send(&connection, input.command)
                .await
                .map_err(|error| match error {
                    SendError::Failed(error) => error,
                    SendError::NotSent => ServerError::unavailable("Chat connection ended."),
                })
        }
    }
}

/// Opens the shared chat connection as the app loads, so the first command is quick.
pub async fn connect<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    input: ChatConnectInput,
) -> Result<(), ServerError> {
    let token = input.token.unwrap_or_default();
    // Guardians hear about help requests for as long as the app runs.
    super::help_alerts::start(&app, &input.server_url, &token).await;
    app.state::<ChatConnections>()
        .get(&input.server_url, &token)
        .await
        .map(|_| ())
}

/// Closes the shared chat connection when the session ends.
pub async fn disconnect<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), ServerError> {
    app.state::<ChatConnections>().close().await;
    super::help_alerts::stop(&app).await;
    Ok(())
}

pub async fn subscribe<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    input: ChatSubscriptionInput,
) -> Result<(), ServerError> {
    let registry = app.state::<ChatRegistry>();
    let mut clients = registry.clients.lock().await;
    if clients.contains_key(&input.subscription_id) {
        return Err(ServerError::invalid("Chat subscription is already active."));
    }
    let client = chat_transport::subscribe(app.clone(), input.clone()).await?;
    clients.insert(input.subscription_id, client);
    drop(clients);
    Ok(())
}

pub async fn close<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    subscription_id: String,
) -> Result<(), ServerError> {
    let registry = app.state::<ChatRegistry>();
    let client = registry.clients.lock().await.remove(&subscription_id);
    if let Some(client) = client {
        client
            .disconnect()
            .await
            .map_err(|_| ServerError::unavailable("Chat disconnect failed."))?;
    }
    Ok(())
}

pub async fn upload<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    input: AttachmentUploadInput,
) -> Result<String, ServerError> {
    chat_transport::upload(app, input).await
}

pub async fn download(input: AttachmentDownloadInput) -> Result<String, ServerError> {
    chat_transport::download(input).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repositories::chat_transport::tests::{fake_chat_server, Script};

    #[tokio::test]
    async fn commands_share_one_connection_and_replace_a_dropped_one() {
        let (address, server) = fake_chat_server(vec![
            // The connection opened as the app loads carries the first command, then drops.
            Script {
                refuse: false,
                commands: 1,
                close: true,
                alerts: Vec::new(),
            },
            // The next command finds it closed and goes out once on a new connection.
            Script {
                refuse: false,
                commands: 2,
                close: false,
                alerts: Vec::new(),
            },
            // Another session never reuses that connection.
            Script {
                refuse: false,
                commands: 1,
                close: false,
                alerts: Vec::new(),
            },
        ])
        .await;
        let app = tauri::test::mock_app().handle().clone();
        app.manage(ChatConnections::default());
        // Child tokens: a guardian token would also open a help-alert listener.
        app.manage(super::super::help_alerts::HelpAlerts::default());
        let server_url = format!("http://{address}");
        let input = |token: &str| ChatCommandInput {
            server_url: server_url.clone(),
            token: Some(token.into()),
            command: serde_json::json!({"action": "rooms"}),
        };
        connect(
            app.clone(),
            ChatConnectInput {
                server_url: server_url.clone(),
                token: Some("vcs_parent".into()),
            },
        )
        .await
        .expect("connect as the app loads");
        assert_eq!(
            command(app.clone(), input("vcs_parent"))
                .await
                .expect("first command"),
            serde_json::json!({"index": 0})
        );
        // Wait until the client has seen the server close the connection.
        let connections = app.state::<ChatConnections>();
        for _ in 0..200 {
            let open = connections
                .current
                .lock()
                .await
                .as_ref()
                .is_some_and(|shared| shared.connection.is_open());
            if !open {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        for index in 0..2 {
            assert_eq!(
                command(app.clone(), input("vcs_parent"))
                    .await
                    .expect("command"),
                serde_json::json!({ "index": index })
            );
        }
        assert_eq!(
            command(app.clone(), input("vcs_child"))
                .await
                .expect("other session"),
            serde_json::json!({"index": 0})
        );
        disconnect(app.clone()).await.expect("disconnect");
        let seen = server.await.expect("chat server completion");
        let connects: Vec<_> = seen
            .iter()
            .filter(|frame| frame.starts_with("40/chat"))
            .collect();
        assert_eq!(connects.len(), 3, "{seen:?}");
        assert!(connects[2].contains(r#""token":"vcs_child""#));
    }

    #[tokio::test]
    async fn closing_is_not_held_up_by_a_slow_connection_and_discards_it() {
        // A server that accepts but never answers keeps the connection opening.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind silent server");
        let address = listener.local_addr().expect("silent address");
        let silent = tokio::spawn(async move {
            let _held = listener.accept().await;
            std::future::pending::<()>().await;
        });
        let connections = ChatConnections::default();
        let opening = tokio::spawn({
            let connections = connections.clone();
            async move {
                connections
                    .get(&format!("http://{address}"), "vcs_child")
                    .await
            }
        });
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        tokio::time::timeout(std::time::Duration::from_secs(1), connections.close())
            .await
            .expect("close does not wait for the connection");
        assert!(connections.current.lock().await.is_none());
        opening.abort();
        silent.abort();
    }

    use futures_util::{SinkExt, StreamExt};
    use tauri::{Emitter, Listener};
    use tokio_tungstenite::tungstenite::Message;

    #[tokio::test]
    async fn subscriptions_emit_changes_reject_duplicates_and_disconnect() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind chat server");
        let address = listener.local_addr().expect("chat address");
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.expect("accept chat");
            let mut socket = tokio_tungstenite::accept_async(stream)
                .await
                .expect("websocket handshake");
            socket
                .send(Message::Text(
                    r#"0{"sid":"test","upgrades":[],"pingInterval":25000,"pingTimeout":20000}"#
                        .into(),
                ))
                .await
                .expect("engine opening");
            loop {
                let frame = socket.next().await.expect("namespace").expect("namespace");
                if frame
                    .to_text()
                    .expect("namespace text")
                    .starts_with("40/chat")
                {
                    break;
                }
            }
            socket
                .send(Message::Text(r#"40/chat,{"sid":"namespace"}"#.into()))
                .await
                .expect("namespace acknowledgement");
            socket
                .send(Message::Text(
                    r#"42/chat,["chat:changed",{"familyId":"family"}]"#.into(),
                ))
                .await
                .expect("change event");
            let _disconnect = socket.next().await;
            socket.close(None).await.expect("close chat socket");
        });
        let app = tauri::test::mock_app().handle().clone();
        app.manage(ChatRegistry::default());
        let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
        let _listener = app.listen("vulture:chat-changed", move |event| {
            sender
                .send(event.payload().to_owned())
                .expect("event receiver");
        });
        app.emit(
            "vulture:chat-changed",
            serde_json::json!({"subscriptionId": "test"}),
        )
        .expect("mock event");
        assert!(receiver
            .recv()
            .await
            .expect("mock event delivery")
            .contains("test"));
        let input = ChatSubscriptionInput {
            family_id: None,
            subscription_id: "subscription".into(),
            server_url: format!("http://{address}"),
            token: Some("token".into()),
        };
        subscribe(app.clone(), input.clone())
            .await
            .expect("subscribe chat");
        assert!(subscribe(app.clone(), input).await.is_err());
        let event = loop {
            let event = tokio::time::timeout(std::time::Duration::from_secs(5), receiver.recv())
                .await
                .expect("chat event")
                .expect("chat event channel");
            if event.contains("family") {
                break event;
            }
        };
        assert!(event.contains("subscription"));
        close(app, "subscription".into())
            .await
            .expect("close chat subscription");
        server.await.expect("chat server completion");
    }
}
