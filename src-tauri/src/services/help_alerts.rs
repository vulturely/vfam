use crate::repositories::{
    chat_transport::{self, ApprovalAlert, HelpAlert, ServerAlert},
    notification,
    server::ServerError,
};
use std::{sync::Arc, time::Duration};
use tauri::{Emitter, Manager};
use tokio::sync::{mpsc, watch, Mutex};

const HELP_EVENT: &str = "vulture:help-requested";
const APPROVAL_EVENT: &str = "vulture:fambuddy-approval";

/// What reaches the app: a help alert to show, or a `FamBuddy` approval for the window,
/// which also watches its `FamBuddy`s directly and shows each approval once.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Delivered {
    Help(Shown),
    Approval(ApprovalAlert),
}
const MAX_RETRY: Duration = Duration::from_secs(30);

/// The guardian's help-alert listener, kept for as long as the app runs and the
/// session lasts, whether or not the window is in front.
#[derive(Clone, Default)]
pub struct HelpAlerts {
    current: Arc<Mutex<Option<Running>>>,
}

struct Running {
    server_url: String,
    token: String,
    /// Dropping this stops the listener.
    _stop: watch::Sender<()>,
}

/// What the app shows for one alert, and where "Open" goes.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Shown {
    pub title: String,
    pub body: String,
    pub screen: &'static str,
    pub alert: HelpAlert,
}

pub fn shown(alert: HelpAlert) -> Shown {
    let child = alert.child_name.trim();
    let homework = alert.title.trim();
    let (title, body, screen) = if alert.kind == "ai" {
        (
            format!("{child} wants a hint"),
            format!("{homework}: approve or decline it in Family."),
            "family:manage",
        )
    } else {
        (
            format!("{child} needs help"),
            format!("{child} asked for help with {homework}."),
            "learning:profiles",
        )
    };
    Shown {
        title,
        body,
        screen,
        alert,
    }
}

impl HelpAlerts {
    /// Listens for this guardian session's alerts. Child sessions get none.
    pub async fn start<F>(&self, server_url: &str, token: &str, deliver: F)
    where
        F: Fn(Delivered) + Send + 'static,
    {
        let mut current = self.current.lock().await;
        if token.is_empty() || token.starts_with("vcs_") {
            *current = None;
            return;
        }
        if current
            .as_ref()
            .is_some_and(|running| running.server_url == server_url && running.token == token)
        {
            return;
        }
        let (stop, stopped) = watch::channel(());
        *current = Some(Running {
            server_url: server_url.to_owned(),
            token: token.to_owned(),
            _stop: stop,
        });
        drop(current);
        tauri::async_runtime::spawn(listen(
            server_url.to_owned(),
            token.to_owned(),
            stopped,
            deliver,
        ));
    }

    pub async fn stop(&self) {
        self.current.lock().await.take();
    }
}

/// Connects (retrying while the server is unreachable), then hands each alert
/// to `deliver` until stopped. The connection reconnects by itself after a drop.
async fn listen<F>(server_url: String, token: String, mut stopped: watch::Receiver<()>, deliver: F)
where
    F: Fn(Delivered) + Send + 'static,
{
    let (sender, mut alerts) = mpsc::unbounded_channel();
    let mut delay = Duration::from_secs(1);
    let client = loop {
        tokio::select! {
            _ = stopped.changed() => return,
            result = chat_transport::listen(&server_url, &token, sender.clone()) => match result {
                Ok(client) => break client,
                // An ended session stays ended; signing in again starts a new listener.
                Err(ServerError { kind, .. }) if kind == "unauthenticated" => return,
                Err(_) => {}
            },
        }
        tokio::select! {
            _ = stopped.changed() => return,
            () = tokio::time::sleep(delay) => {}
        }
        delay = (delay * 2).min(MAX_RETRY);
    };
    loop {
        tokio::select! {
            _ = stopped.changed() => break,
            Some(alert) = alerts.recv() => deliver(match alert {
                ServerAlert::Help(alert) => Delivered::Help(shown(alert)),
                ServerAlert::Approval(alert) => Delivered::Approval(alert),
            }),
        }
    }
    chat_transport::stop_listening(client);
}

/// Shows a help alert as an OS notification and tells the window; approvals go to
/// the window, which decides whether it has already shown them.
fn deliver<R: tauri::Runtime>(app: &tauri::AppHandle<R>, delivered: &Delivered) {
    match delivered {
        Delivered::Help(shown) => {
            let _ = notification::help_request(app, &shown.title, &shown.body);
            let _ = app.emit(HELP_EVENT, shown);
        }
        Delivered::Approval(alert) => {
            let _ = app.emit(APPROVAL_EVENT, alert);
        }
    }
}

pub async fn start<R: tauri::Runtime>(app: &tauri::AppHandle<R>, server_url: &str, token: &str) {
    let handle = app.clone();
    app.state::<HelpAlerts>()
        .start(server_url, token, move |delivered| {
            deliver(&handle, &delivered);
        })
        .await;
}

pub async fn stop<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    app.state::<HelpAlerts>().stop().await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repositories::chat_transport::tests::{fake_chat_server, Script};

    fn alert(kind: &str) -> HelpAlert {
        HelpAlert {
            kind: kind.into(),
            profile_id: "p".into(),
            child_name: " Jamie ".into(),
            title: "Spelling".into(),
            request_id: "r".into(),
            at: "now".into(),
        }
    }

    #[test]
    fn alerts_say_who_needs_what_and_where_to_answer() {
        let practice = shown(alert("practice"));
        assert_eq!(practice.title, "Jamie needs help");
        assert_eq!(practice.body, "Jamie asked for help with Spelling.");
        assert_eq!(practice.screen, "learning:profiles");
        let ai = shown(alert("ai"));
        assert_eq!(ai.title, "Jamie wants a hint");
        assert_eq!(ai.body, "Spelling: approve or decline it in Family.");
        assert_eq!(ai.screen, "family:manage");
    }

    #[tokio::test]
    async fn a_guardian_hears_alerts_after_retrying_and_children_never_listen() {
        let (address, server) = fake_chat_server(vec![Script {
            refuse: false,
            commands: 0,
            close: false,
            alerts: vec![
                r#"["help:requested",{"kind":"practice","profileId":"p","childName":"Jamie","title":"Spelling","requestId":"r","at":"now"}]"#,
                r#"["fambuddy:approval",{"registrationId":"reg","name":"Kitchen","kind":"secret","turnId":"t0","at":"now"}]"#,
                r#"["fambuddy:approval",{"registrationId":"reg","name":"Kitchen","kind":"answer","turnId":"t1","at":"now"}]"#,
            ],
        }])
        .await;
        let alerts = HelpAlerts::default();
        let (sender, mut received) = mpsc::unbounded_channel();
        let deliver = move |delivered: Delivered| {
            let _ = sender.send(delivered);
        };
        // A child session starts nothing.
        alerts
            .start(&format!("http://{address}"), "vcs_child", deliver.clone())
            .await;
        assert!(alerts.current.lock().await.is_none());
        alerts
            .start(&format!("http://{address}"), "vps_parent", deliver.clone())
            .await;
        // The same session does not open a second listener.
        alerts
            .start(&format!("http://{address}"), "vps_parent", deliver)
            .await;
        let shown = tokio::time::timeout(Duration::from_secs(10), received.recv())
            .await
            .expect("alert in time")
            .expect("alert");
        let Delivered::Help(shown) = shown else {
            panic!("help alert first");
        };
        assert_eq!(shown.title, "Jamie needs help");
        // An approval with an unknown kind is ignored.
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(10), received.recv())
                .await
                .expect("approval in time")
                .expect("approval"),
            Delivered::Approval(ApprovalAlert {
                registration_id: "reg".into(),
                name: "Kitchen".into(),
                kind: "answer".into(),
                turn_id: "t1".into(),
                at: "now".into(),
            })
        );
        alerts.stop().await;
        let seen = server.await.expect("chat server completion");
        assert_eq!(seen.len(), 1);
        assert!(seen[0].contains("vps_parent"));
    }

    #[tokio::test]
    async fn an_unreachable_server_is_retried_until_stopped_and_a_refusal_ends_it() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("free port");
        let unused = listener.local_addr().expect("address");
        drop(listener);
        let (stop, stopped) = watch::channel(());
        let retrying = tokio::spawn(listen(
            format!("http://{unused}"),
            "vps_parent".into(),
            stopped,
            |_| {},
        ));
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert!(!retrying.is_finished(), "still retrying");
        drop(stop);
        tokio::time::timeout(Duration::from_secs(20), retrying)
            .await
            .expect("stops when asked")
            .expect("listener task");
        let (address, server) = fake_chat_server(vec![Script {
            refuse: true,
            commands: 0,
            close: false,
            alerts: Vec::new(),
        }])
        .await;
        let (_stop, stopped) = watch::channel(());
        tokio::time::timeout(
            Duration::from_secs(20),
            listen(
                format!("http://{address}"),
                "vps_old".into(),
                stopped,
                |_| {},
            ),
        )
        .await
        .expect("a refused session gives up");
        server.await.expect("chat server completion");
    }
}
