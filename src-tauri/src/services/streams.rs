use crate::repositories::{
    server::{ServerError, StreamInput},
    streams,
};
use std::{collections::HashMap, sync::Arc};
use tauri::{async_runtime::JoinHandle, Emitter, Manager};
use tokio::sync::Mutex;

const EVENT: &str = "vulture:server-stream";

#[derive(Clone, Default)]
pub struct StreamRegistry {
    tasks: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamEvent {
    stream_id: String,
    kind: String,
    payload: Option<serde_json::Value>,
    error: Option<ServerError>,
}

impl StreamEvent {
    fn new(stream_id: &str, kind: &str) -> Self {
        Self {
            stream_id: stream_id.into(),
            kind: kind.into(),
            payload: None,
            error: None,
        }
    }
}

pub async fn open<R: tauri::Runtime + 'static>(
    app: tauri::AppHandle<R>,
    input: StreamInput,
) -> Result<(), ServerError> {
    streams::validate(&input)?;
    if input.stream_id.is_empty() {
        return Err(ServerError::invalid("Stream id is required."));
    }
    let registry = app.state::<StreamRegistry>();
    let mut tasks = registry.tasks.lock().await;
    if tasks.contains_key(&input.stream_id) {
        return Err(ServerError::invalid("Stream id is already active."));
    }
    let task_registry = registry.inner().clone();
    let task_app = app.clone();
    let stream_id = input.stream_id.clone();
    let event_id = stream_id.clone();
    let emit = move |payload| {
        let mut event = StreamEvent::new(&event_id, "data");
        event.payload = Some(payload);
        let _ = task_app.emit(EVENT, event);
    };
    let task_id = stream_id.clone();
    let task_app = app.clone();
    let handle = tauri::async_runtime::spawn(async move {
        let result = streams::run(input, emit).await;
        if let Err(error) = result {
            let mut event = StreamEvent::new(&task_id, "error");
            event.error = Some(error);
            let _ = task_app.emit(EVENT, event);
        }
        let _ = task_app.emit(EVENT, StreamEvent::new(&task_id, "end"));
        task_registry.tasks.lock().await.remove(&task_id);
    });
    tasks.insert(stream_id, handle);
    drop(tasks);
    Ok(())
}

pub async fn close<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    stream_id: String,
) -> Result<(), ServerError> {
    let registry = app.state::<StreamRegistry>();
    let task = registry.tasks.lock().await.remove(&stream_id);
    if let Some(task) = task {
        task.abort();
    }
    app.emit(EVENT, StreamEvent::new(&stream_id, "end"))
        .map_err(|_| ServerError::new("internal", "Could not close server stream."))
}
