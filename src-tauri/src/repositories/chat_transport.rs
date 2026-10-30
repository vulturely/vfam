use super::server::ServerError;
use futures_util::{stream, FutureExt};
use rust_socketio::{
    asynchronous::{Client, ClientBuilder},
    Event, Payload, TransportType,
};
use serde::Deserialize;
use std::time::Duration;
use tauri::Emitter;

const CHAT_EVENT: &str = "vulture:chat-changed";
const UPLOAD_EVENT: &str = "vulture:chat-upload";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatCommandInput {
    pub server_url: String,
    pub token: Option<String>,
    pub command: serde_json::Value,
}

/// Opens the chat connection ahead of the first command, as the app loads.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatConnectInput {
    pub server_url: String,
    pub token: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSubscriptionInput {
    pub subscription_id: String,
    pub server_url: String,
    pub token: Option<String>,
    /// The family whose change notifications to receive.
    #[serde(default)]
    pub family_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentDownloadInput {
    pub server_url: String,
    pub token: String,
    pub family_id: String,
    pub object_key: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentUploadInput {
    pub upload_id: String,
    pub server_url: String,
    pub token: String,
    pub family_id: String,
    pub bytes: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatEvent {
    subscription_id: String,
    family_id: Option<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadEvent {
    upload_id: String,
    progress: f64,
}

/// Resolves once the server admits (or rejects) the namespace connection.
type Admission = std::sync::Arc<tokio::sync::Mutex<Option<tokio::sync::oneshot::Sender<bool>>>>;

async fn admitted(admission: &Admission, value: bool) {
    let sender = admission.lock().await.take();
    if let Some(sender) = sender {
        let _ = sender.send(value);
    }
}

/// A `/chat` connection the server has admitted, reused for commands until it closes.
#[derive(Clone)]
pub struct ChatConnection {
    client: Client,
    open: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

impl ChatConnection {
    pub fn is_open(&self) -> bool {
        self.open.load(std::sync::atomic::Ordering::Acquire)
    }
    /// Whether both handles refer to the same underlying connection.
    pub fn same(&self, other: &Self) -> bool {
        std::sync::Arc::ptr_eq(&self.open, &other.open)
    }
}

/// A child asked their guardian for help. Sent by the server to the guardian's sockets only.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HelpAlert {
    /// `practice` (Ask for help) or `ai` (an AI hint waiting for a guardian's device).
    pub kind: String,
    pub profile_id: String,
    pub child_name: String,
    pub title: String,
    pub request_id: String,
    pub at: String,
}

/// A `FamBuddy` question or answer waits for a guardian's approval. Ids and the
/// `FamBuddy`'s name only: the server never has what was asked or answered.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApprovalAlert {
    pub registration_id: String,
    pub name: String,
    /// `question` or `answer`.
    pub kind: String,
    pub turn_id: String,
    pub at: String,
}

/// What the server tells a guardian's sockets.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ServerAlert {
    Help(HelpAlert),
    Approval(ApprovalAlert),
}

/// Why a command did not complete.
#[derive(Debug)]
pub enum SendError {
    /// The command never left: the connection had closed. Safe to send again.
    NotSent,
    /// The command may have reached the server; sending it again could repeat it.
    Failed(ServerError),
}

/// Opens a `/chat` connection and waits until the server admits it.
pub async fn connect(server_url: &str, token: &str) -> Result<ChatConnection, ServerError> {
    // `connect()` returns once the request is sent; commands must wait for the
    // server's answer or they can arrive before the server has admitted the socket.
    let (ready, answer) = tokio::sync::oneshot::channel();
    let admission: Admission = std::sync::Arc::new(tokio::sync::Mutex::new(Some(ready)));
    let open = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
    let on_connect = admission.clone();
    let on_error = admission.clone();
    let on_close = open.clone();
    let client = tokio::time::timeout(
        Duration::from_secs(15),
        ClientBuilder::new(endpoint(server_url)?)
            .namespace("/chat")
            .transport_type(TransportType::Websocket)
            .auth(serde_json::json!({"token": token}))
            // A dropped connection is replaced on the next command instead of retried here.
            .reconnect(false)
            .on(Event::Connect, move |_, _| {
                let admission = on_connect.clone();
                async move { admitted(&admission, true).await }.boxed()
            })
            .on(Event::Error, move |_, _| {
                let admission = on_error.clone();
                async move { admitted(&admission, false).await }.boxed()
            })
            .on(Event::Close, move |_, _| {
                on_close.store(false, std::sync::atomic::Ordering::Release);
                async {}.boxed()
            })
            .connect(),
    )
    .await
    .map_err(|_| {
        ServerError::new(
            "deadline_exceeded",
            "Chat connection timed out. Please retry.",
        )
    })?
    .map_err(|_| ServerError::unavailable("Chat connection failed."))?;
    match tokio::time::timeout(Duration::from_secs(15), answer).await {
        Ok(Ok(true)) => Ok(ChatConnection { client, open }),
        // The server refuses a connection only when the session is not valid.
        Ok(Ok(false)) => {
            close_in_background(client);
            Err(ServerError::new(
                "unauthenticated",
                "Sign in again to use family chat.",
            ))
        }
        Ok(Err(_)) | Err(_) => {
            close_in_background(client);
            Err(ServerError::new(
                "deadline_exceeded",
                "Chat connection timed out. Please retry.",
            ))
        }
    }
}

/// Opens a `/chat` connection that forwards `help:requested` alerts. It reconnects by
/// itself after a drop; the server re-checks the session each time.
pub async fn listen(
    server_url: &str,
    token: &str,
    alerts: tokio::sync::mpsc::UnboundedSender<ServerAlert>,
) -> Result<Client, ServerError> {
    let (ready, answer) = tokio::sync::oneshot::channel();
    let admission: Admission = std::sync::Arc::new(tokio::sync::Mutex::new(Some(ready)));
    let on_connect = admission.clone();
    let on_error = admission.clone();
    let client = tokio::time::timeout(
        Duration::from_secs(15),
        ClientBuilder::new(endpoint(server_url)?)
            .namespace("/chat")
            .transport_type(TransportType::Websocket)
            .auth(serde_json::json!({"token": token}))
            .reconnect_delay(1_000, 30_000)
            .on("help:requested", {
                let alerts = alerts.clone();
                move |payload, _| {
                    // Anything that is not a well-formed alert is ignored.
                    if let Some(alert) = payload_value(payload)
                        .ok()
                        .and_then(|value| serde_json::from_value::<HelpAlert>(value).ok())
                    {
                        let _ = alerts.send(ServerAlert::Help(alert));
                    }
                    async {}.boxed()
                }
            })
            .on("fambuddy:approval", move |payload, _| {
                if let Some(alert) = payload_value(payload)
                    .ok()
                    .and_then(|value| serde_json::from_value::<ApprovalAlert>(value).ok())
                    .filter(|alert| matches!(alert.kind.as_str(), "question" | "answer"))
                {
                    let _ = alerts.send(ServerAlert::Approval(alert));
                }
                async {}.boxed()
            })
            .on(Event::Connect, move |_, _| {
                let admission = on_connect.clone();
                async move { admitted(&admission, true).await }.boxed()
            })
            .on(Event::Error, move |_, _| {
                let admission = on_error.clone();
                async move { admitted(&admission, false).await }.boxed()
            })
            .connect(),
    )
    .await
    .map_err(|_| ServerError::new("deadline_exceeded", "Help alerts timed out."))?
    .map_err(|_| ServerError::unavailable("Help alerts are unavailable."))?;
    match tokio::time::timeout(Duration::from_secs(15), answer).await {
        Ok(Ok(true)) => Ok(client),
        Ok(Ok(false)) => {
            close_in_background(client);
            Err(ServerError::new("unauthenticated", "Sign in again."))
        }
        Ok(Err(_)) | Err(_) => {
            close_in_background(client);
            Err(ServerError::new(
                "deadline_exceeded",
                "Help alerts timed out.",
            ))
        }
    }
}

/// Stops listening for help alerts without waiting for the server.
pub fn stop_listening(client: Client) {
    close_in_background(client);
}

/// Sends one `chat:command` and waits for the server's answer.
pub async fn send(
    connection: &ChatConnection,
    command: serde_json::Value,
) -> Result<serde_json::Value, SendError> {
    if !connection.is_open() {
        return Err(SendError::NotSent);
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = std::sync::Arc::new(tokio::sync::Mutex::new(Some(sender)));
    connection
        .client
        .emit_with_ack(
            "chat:command",
            command,
            Duration::from_secs(15),
            move |payload, _| {
                let sender = sender.clone();
                async move {
                    let sender = sender.lock().await.take();
                    if let Some(sender) = sender {
                        let _ = sender.send(payload);
                    }
                }
                .boxed()
            },
        )
        .await
        .map_err(|_| SendError::NotSent)?;
    let payload = tokio::time::timeout(Duration::from_secs(15), receiver)
        .await
        .map_err(|_| {
            SendError::Failed(ServerError::new(
                "deadline_exceeded",
                "Chat request timed out. Please retry.",
            ))
        })?
        .map_err(|_| SendError::Failed(ServerError::unavailable("Chat connection ended.")))?;
    let response = payload_value(payload).map_err(SendError::Failed)?;
    if response.get("ok").and_then(serde_json::Value::as_bool) != Some(true) {
        return Err(SendError::Failed(ServerError::new(
            "unavailable",
            response
                .get("error")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("Chat unavailable."),
        )));
    }
    Ok(response
        .get("result")
        .cloned()
        .unwrap_or(serde_json::Value::Null))
}

/// Closes a connection without waiting: an unresponsive server must not hold up the
/// next connection or the caller.
pub fn disconnect(connection: ChatConnection) {
    connection
        .open
        .store(false, std::sync::atomic::Ordering::Release);
    close_in_background(connection.client);
}

fn close_in_background(client: Client) {
    tauri::async_runtime::spawn(async move {
        let _ = tokio::time::timeout(Duration::from_secs(5), client.disconnect()).await;
    });
}

pub async fn subscribe<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    input: ChatSubscriptionInput,
) -> Result<Client, ServerError> {
    if input.subscription_id.is_empty() {
        return Err(ServerError::invalid("Chat subscription id is required."));
    }
    let changed_app = app.clone();
    let changed_id = input.subscription_id.clone();
    let resync_app = app.clone();
    let resync_id = input.subscription_id.clone();
    let connect_app = app.clone();
    let connect_id = input.subscription_id.clone();
    ClientBuilder::new(endpoint(&input.server_url)?)
        .namespace("/chat")
        .transport_type(TransportType::Websocket)
        .auth(serde_json::json!({
            "token": input.token.unwrap_or_default(),
            "familyId": input.family_id,
        }))
        .reconnect_delay(250, 10_000)
        .on("chat:changed", move |payload, _| {
            let app = changed_app.clone();
            let subscription_id = changed_id.clone();
            async move {
                let family_id = payload_value(payload)
                    .ok()
                    .and_then(|value| value.get("familyId")?.as_str().map(str::to_owned));
                let _ = app.emit(
                    CHAT_EVENT,
                    ChatEvent {
                        subscription_id,
                        family_id,
                    },
                );
            }
            .boxed()
        })
        .on("chat:resync", move |_, _| {
            let app = resync_app.clone();
            let subscription_id = resync_id.clone();
            async move {
                let _ = app.emit(
                    CHAT_EVENT,
                    ChatEvent {
                        subscription_id,
                        family_id: None,
                    },
                );
            }
            .boxed()
        })
        .on(Event::Connect, move |_, _| {
            let app = connect_app.clone();
            let subscription_id = connect_id.clone();
            async move {
                let _ = app.emit(
                    CHAT_EVENT,
                    ChatEvent {
                        subscription_id,
                        family_id: None,
                    },
                );
            }
            .boxed()
        })
        .connect()
        .await
        .map_err(|_| ServerError::unavailable("Chat connection failed."))
}

pub async fn upload<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    input: AttachmentUploadInput,
) -> Result<String, ServerError> {
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &input.bytes)
        .map_err(|_| ServerError::invalid("Invalid attachment bytes."))?;
    if bytes.is_empty() || bytes.len() > 20 * 1024 * 1024 + 16 {
        return Err(ServerError::invalid("Chat attachment size is invalid."));
    }
    let url = format!(
        "{}/chat/attachments/{}",
        endpoint(&input.server_url)?.trim_end_matches('/'),
        urlencoding(&input.family_id)
    );
    let client = http_client()?;
    let upload_id = input.upload_id.clone();
    let chunks = stream::unfold(
        (bytes, 0, app.clone(), upload_id),
        |(bytes, offset, app, id)| async move {
            if offset >= bytes.len() {
                return None;
            }
            let end = (offset + 65_536).min(bytes.len());
            let chunk = bytes[offset..end].to_vec();
            let progress =
                f64::from(u32::try_from(end * 1000 / bytes.len()).unwrap_or(1000)) / 1000.0;
            let _ = app.emit(
                UPLOAD_EVENT,
                UploadEvent {
                    upload_id: id.clone(),
                    progress,
                },
            );
            Some((Ok::<_, ServerError>(chunk), (bytes, end, app, id)))
        },
    );
    let response = client
        .put(url)
        .bearer_auth(&input.token)
        .header("content-type", "application/octet-stream")
        .body(reqwest::Body::wrap_stream(chunks))
        .send()
        .await
        .map_err(|_| ServerError::unavailable("Chat attachment upload failed."))?;
    if !response.status().is_success() {
        return Err(ServerError::unavailable("Chat attachment upload failed."));
    }
    let value: serde_json::Value = response
        .json()
        .await
        .map_err(|_| ServerError::new("internal", "Chat attachment upload failed."))?;
    value
        .get("objectKey")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| ServerError::new("internal", "Chat attachment upload failed."))
}

pub async fn download(input: AttachmentDownloadInput) -> Result<String, ServerError> {
    let url = format!(
        "{}/chat/attachments/download",
        endpoint(&input.server_url)?.trim_end_matches('/')
    );
    let response = http_client()?
        .post(url)
        .bearer_auth(&input.token)
        .json(&serde_json::json!({"familyId": input.family_id, "objectKey": input.object_key}))
        .send()
        .await
        .map_err(|_| ServerError::unavailable("Chat attachment download failed."))?;
    if !response.status().is_success() {
        return Err(ServerError::unavailable("Chat attachment download failed."));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| ServerError::unavailable("Chat attachment download failed."))?;
    Ok(base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        bytes,
    ))
}

fn payload_value(payload: Payload) -> Result<serde_json::Value, ServerError> {
    let value = match payload {
        Payload::Text(values) => values
            .into_iter()
            .next()
            .ok_or_else(|| ServerError::new("internal", "Invalid chat response."))?,
        #[allow(deprecated)]
        Payload::String(value) => serde_json::from_str(&value)
            .map_err(|_| ServerError::new("internal", "Invalid chat response."))?,
        Payload::Binary(_) => return Err(ServerError::new("internal", "Invalid chat response.")),
    };
    match value {
        serde_json::Value::Array(mut values) if values.len() == 1 => Ok(values.remove(0)),
        serde_json::Value::Array(_) => Err(ServerError::new("internal", "Invalid chat response.")),
        value => Ok(value),
    }
}

fn endpoint(server_url: &str) -> Result<String, ServerError> {
    let url = url::Url::parse(server_url)
        .map_err(|_| ServerError::invalid("Invalid chat server URL."))?;
    let secure = url.scheme() == "https";
    let loopback = url.scheme() == "http"
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if !secure && !loopback {
        return Err(ServerError::invalid("Chat requires HTTPS."));
    }
    Ok(url.origin().ascii_serialization())
}

fn http_client() -> Result<reqwest::Client, ServerError> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| ServerError::new("internal", "Chat HTTP client unavailable."))
}

fn urlencoding(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes())
        .collect::<String>()
        .replace('+', "%20")
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio_tungstenite::tungstenite::Message;

    /// What a fake `/chat` server does with one connection.
    pub struct Script {
        /// Refuse the namespace connection instead of admitting it.
        pub refuse: bool,
        /// Commands to acknowledge, echoing their position.
        pub commands: usize,
        /// Close the socket after the commands instead of waiting for the client.
        pub close: bool,
        /// Events sent once the connection is admitted, before any command.
        pub alerts: Vec<&'static str>,
    }

    /// A fake Socket.IO server that serves one connection per script, in order.
    pub async fn fake_chat_server(
        scripts: Vec<Script>,
    ) -> (std::net::SocketAddr, tokio::task::JoinHandle<Vec<String>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind chat server");
        let address = listener.local_addr().expect("chat server address");
        let server = tokio::spawn(async move {
            let mut seen = Vec::new();
            for script in scripts {
                let (stream, _) = listener.accept().await.expect("accept chat socket");
                let mut socket = tokio_tungstenite::accept_async(stream)
                    .await
                    .expect("chat websocket handshake");
                socket
                    .send(Message::Text(
                        r#"0{"sid":"test","upgrades":[],"pingInterval":25000,"pingTimeout":20000}"#
                            .into(),
                    ))
                    .await
                    .expect("engine opening");
                loop {
                    let frame = socket
                        .next()
                        .await
                        .expect("namespace frame")
                        .expect("frame");
                    let text = frame.to_text().expect("namespace text").to_owned();
                    if text.starts_with("40/chat") {
                        seen.push(text);
                        break;
                    }
                }
                if script.refuse {
                    socket
                        .send(Message::Text(
                            r#"44/chat,{"message":"Sign in again to use family chat."}"#.into(),
                        ))
                        .await
                        .expect("connect error");
                    continue;
                }
                socket
                    .send(Message::Text(r#"40/chat,{"sid":"namespace"}"#.into()))
                    .await
                    .expect("namespace acknowledgement");
                for alert in &script.alerts {
                    socket
                        .send(Message::Text(format!("42/chat,{alert}")))
                        .await
                        .expect("alert");
                }
                for index in 0..script.commands {
                    let command = loop {
                        let frame = socket
                            .next()
                            .await
                            .expect("command frame")
                            .expect("command");
                        let text = frame.to_text().expect("command text").to_owned();
                        if text.starts_with("42/chat,") {
                            break text;
                        }
                    };
                    seen.push(command.clone());
                    let acknowledgement = command
                        .strip_prefix("42/chat,")
                        .and_then(|value| value.split('[').next())
                        .expect("command acknowledgement id")
                        .to_owned();
                    socket
                        .send(Message::Text(format!(
                            r#"43/chat,{acknowledgement}[{{"ok":true,"result":{{"index":{index}}}}}]"#
                        )))
                        .await
                        .expect("command acknowledgement");
                }
                if script.close {
                    socket.close(None).await.expect("close chat socket");
                } else {
                    let _disconnect = socket.next().await;
                }
            }
            seen
        });
        (address, server)
    }

    #[tokio::test]
    async fn one_admitted_connection_carries_many_commands() {
        let (address, server) = fake_chat_server(vec![Script {
            refuse: false,
            commands: 2,
            close: false,
            alerts: Vec::new(),
        }])
        .await;
        let connection = connect(&format!("http://{address}"), "token")
            .await
            .expect("admitted connection");
        for index in 0..2 {
            let result = send(&connection, serde_json::json!({"action": "send"}))
                .await
                .expect("chat command response");
            assert_eq!(result, serde_json::json!({ "index": index }));
        }
        disconnect(connection.clone());
        assert!(matches!(
            send(&connection, serde_json::json!({})).await,
            Err(SendError::NotSent)
        ));
        let seen = server.await.expect("chat server completion");
        assert!(seen[0].contains(r#""token":"token""#));
        assert!(seen[1..]
            .iter()
            .all(|command| command.contains("chat:command")));
    }

    #[tokio::test]
    async fn a_refused_connection_asks_to_sign_in_again() {
        let (address, server) = fake_chat_server(vec![Script {
            refuse: true,
            commands: 0,
            close: false,
            alerts: Vec::new(),
        }])
        .await;
        let refused = connect(&format!("http://{address}"), "expired")
            .await
            .err()
            .expect("refused connection");
        assert_eq!(refused.kind, "unauthenticated");
        server.await.expect("chat server completion");
    }

    #[tokio::test]
    async fn help_alerts_arrive_and_malformed_ones_are_ignored() {
        let (address, server) = fake_chat_server(vec![
            Script {
                refuse: false,
                commands: 0,
                close: false,
                alerts: vec![
                    r#"["help:requested",{"kind":"practice"}]"#,
                    r#"["help:requested",{"kind":"ai","profileId":"p","childName":"Jamie","title":"Spelling","requestId":"r","at":"now"}]"#,
                ],
            },
            Script {
                refuse: true,
                commands: 0,
                close: false,
                alerts: Vec::new(),
            },
        ])
        .await;
        let (sender, mut alerts) = tokio::sync::mpsc::unbounded_channel();
        let client = listen(&format!("http://{address}"), "token", sender.clone())
            .await
            .expect("admitted listener");
        let alert = tokio::time::timeout(Duration::from_secs(5), alerts.recv())
            .await
            .expect("alert in time")
            .expect("alert");
        let ServerAlert::Help(alert) = alert else {
            panic!("help alert");
        };
        assert_eq!(alert.child_name, "Jamie");
        assert_eq!(alert.kind, "ai");
        stop_listening(client);
        let refused = listen(&format!("http://{address}"), "expired", sender)
            .await
            .err()
            .expect("refused listener");
        assert_eq!(refused.kind, "unauthenticated");
        server.await.expect("chat server completion");
    }

    #[tokio::test]
    async fn attachments_roundtrip_through_native_http() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind attachment server");
        let address = listener.local_addr().expect("attachment server address");
        let server = tokio::spawn(async move {
            for index in 0..2 {
                let (mut stream, _) = listener.accept().await.expect("accept attachment request");
                let mut request = [0; 8192];
                let count = stream.read(&mut request).await.expect("read request");
                let request = String::from_utf8_lossy(&request[..count]);
                if index == 0 {
                    assert!(request.starts_with("PUT /chat/attachments/family%20one"));
                    assert!(request.contains("Bearer token"));
                } else {
                    assert!(request.starts_with("POST /chat/attachments/download"));
                    assert!(request.contains("object"));
                }
                let body: &[u8] = if index == 0 {
                    br#"{"objectKey":"stored"}"#
                } else {
                    &[0, 1, 255]
                };
                let headers = format!(
                    "HTTP/1.1 200 OK\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                    body.len()
                );
                stream.write_all(headers.as_bytes()).await.expect("headers");
                stream.write_all(body).await.expect("body");
            }
        });
        let app = tauri::test::mock_app().handle().clone();
        let object = upload(
            app,
            AttachmentUploadInput {
                upload_id: "upload".into(),
                server_url: format!("http://{address}"),
                token: "token".into(),
                family_id: "family one".into(),
                bytes: "AQID".into(),
            },
        )
        .await
        .expect("upload attachment");
        assert_eq!(object, "stored");
        let bytes = download(AttachmentDownloadInput {
            server_url: format!("http://{address}"),
            token: "token".into(),
            family_id: "family".into(),
            object_key: "object".into(),
        })
        .await
        .expect("download attachment");
        assert_eq!(bytes, "AAH/");
        server.await.expect("attachment server completion");
    }

    #[test]
    fn decodes_socket_payloads_and_rejects_invalid_shapes() {
        assert_eq!(
            payload_value(Payload::Text(vec![serde_json::json!({"ok": true})]))
                .expect("text payload"),
            serde_json::json!({"ok": true})
        );
        assert_eq!(
            payload_value(Payload::Text(vec![serde_json::json!([{"ok": true}])]))
                .expect("acknowledgement payload"),
            serde_json::json!({"ok": true})
        );
        assert!(payload_value(Payload::Text(Vec::new())).is_err());
        assert!(payload_value(Payload::Text(vec![serde_json::json!([1, 2])])).is_err());
        #[allow(deprecated)]
        let string = Payload::String(r#"{"ok":true}"#.into());
        assert!(payload_value(string).is_ok());
        assert!(payload_value(Payload::Binary(vec![1].into())).is_err());
        assert_eq!(urlencoding("family one"), "family%20one");
    }
}
