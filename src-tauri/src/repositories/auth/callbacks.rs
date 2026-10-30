use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, PoisonError,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

const CALLBACK_PORT: u16 = 7793;
/// Longer than a cancelled listener's 3-second read of a pending connection.
const REBIND_TIMEOUT: Duration = Duration::from_secs(4);

/// Cancellation flag of the listener waiting for the browser, so a retried
/// sign-in can release the fixed callback port instead of failing to bind it.
#[derive(Default)]
struct ActiveCallback(Mutex<Option<Arc<AtomicBool>>>);

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthCallback {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

pub async fn start_callback<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    token: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || listen(app, &token))
        .await
        .map_err(|_| "Could not start the local sign-in callback.".to_owned())?
}

fn listen<R: tauri::Runtime>(app: tauri::AppHandle<R>, token: &str) -> Result<String, String> {
    listen_on_port(app, token, CALLBACK_PORT)
}

fn listen_on_port<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    token: &str,
    callback_port: u16,
) -> Result<String, String> {
    let cancelled = Arc::new(AtomicBool::new(false));
    app.manage(ActiveCallback::default());
    let previous = app
        .state::<ActiveCallback>()
        .0
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .replace(Arc::clone(&cancelled));
    if let Some(previous) = previous {
        previous.store(true, Ordering::SeqCst);
    }
    let listener = bind_callback(callback_port).map_err(|()| {
        format!("Could not start the local sign-in callback on port {CALLBACK_PORT}. Close the application using that port and try again.")
    })?;
    let port = listener
        .local_addr()
        .map_err(|_| "Could not start the local sign-in callback.")?
        .port();
    let expected_state_prefix = format!("vulture-desktop:{port}:{token}:");
    listener
        .set_nonblocking(true)
        .map_err(|_| "Could not start the local sign-in callback.")?;
    thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(600);
        let mut completed = false;
        while Instant::now() < deadline && !cancelled.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((mut stream, address)) if address.ip().is_loopback() => {
                    let callback = read_auth_callback(&mut stream, &expected_state_prefix);
                    let (status, body) = if callback.is_some() {
                        ("200 OK", "Sign-in complete. Return to VFAM.")
                    } else {
                        (
                            "400 Bad Request",
                            "Sign-in callback was invalid. Return to VFAM and try again.",
                        )
                    };
                    let response = format!(
                        "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = stream.write_all(response.as_bytes());
                    if let Some(callback) = callback {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        let _ = app.emit("vulture-auth-callback", callback);
                        completed = true;
                        break;
                    }
                }
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(50));
                }
                Err(_) => break,
            }
        }
        if !completed && !cancelled.load(Ordering::SeqCst) {
            let _ = app.emit(
                "vulture-auth-callback",
                AuthCallback {
                    code: None,
                    state: None,
                    error: Some("Desktop sign-in timed out. Try again.".into()),
                },
            );
        }
    });
    Ok(format!("http://127.0.0.1:{port}/login/callback"))
}

/// Binds the callback port, retrying briefly while a cancelled listener releases it.
fn bind_callback(callback_port: u16) -> Result<TcpListener, ()> {
    let deadline = Instant::now() + REBIND_TIMEOUT;
    loop {
        match TcpListener::bind(("127.0.0.1", callback_port)) {
            Ok(listener) => return Ok(listener),
            Err(_) if Instant::now() < deadline => thread::sleep(Duration::from_millis(25)),
            Err(_) => return Err(()),
        }
    }
}

fn read_auth_callback(stream: &mut TcpStream, expected_state_prefix: &str) -> Option<AuthCallback> {
    stream.set_nonblocking(false).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(3))).ok()?;
    let mut request = Vec::new();
    let mut chunk = [0; 2048];
    loop {
        let count = stream.read(&mut chunk).ok()?;
        if count == 0 {
            break;
        }
        request.extend_from_slice(&chunk[..count]);
        if request.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
        if request.len() > 8192 {
            return None;
        }
    }
    parse_auth_callback_request(&request, expected_state_prefix)
}

fn parse_auth_callback_request(
    request: &[u8],
    expected_state_prefix: &str,
) -> Option<AuthCallback> {
    let line = std::str::from_utf8(request).ok()?.lines().next()?;
    let target = line.split_whitespace().nth(1)?;
    let url = url::Url::parse(&format!("http://127.0.0.1{target}")).ok()?;
    if url.path() != "/login/callback" {
        return None;
    }
    let mut code = None;
    let mut state = None;
    let mut error = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "code" => code = Some(value.into_owned()),
            "state" => state = Some(value.into_owned()),
            "error" => error = Some(value.into_owned()),
            _ => {}
        }
    }
    if error.is_none() && (code.is_none() || state.is_none()) {
        return None;
    }
    if !state
        .as_deref()
        .is_some_and(|state| state.starts_with(expected_state_prefix))
    {
        return None;
    }
    Some(AuthCallback { code, state, error })
}

#[cfg(test)]
mod tests {
    use super::{listen, listen_on_port, parse_auth_callback_request, read_auth_callback};
    use std::{
        io::{Read, Write},
        net::{TcpListener, TcpStream},
        thread,
        time::Duration,
    };

    #[test]
    fn local_auth_callback_extracts_code_and_state() {
        let callback = parse_auth_callback_request(
            b"GET /login/callback?code=auth-code&state=vulture-desktop%3A4321%3Atest-token%3Ac.s-r.f HTTP/1.1\r\nHost: localhost\r\n\r\n",
            "vulture-desktop:4321:test-token:",
        )
        .unwrap();
        assert_eq!(callback.code.as_deref(), Some("auth-code"));
        assert_eq!(
            callback.state.as_deref(),
            Some("vulture-desktop:4321:test-token:c.s-r.f")
        );
        assert_eq!(callback.error, None);
    }

    #[test]
    fn callback_rejects_wrong_path_and_state() {
        assert!(parse_auth_callback_request(
            b"GET /wrong?code=a&state=expected HTTP/1.1\r\n\r\n",
            "expected"
        )
        .is_none());
        assert!(parse_auth_callback_request(
            b"GET /login/callback?code=a&state=wrong HTTP/1.1\r\n\r\n",
            "expected"
        )
        .is_none());
    }

    #[test]
    fn callback_rejects_malformed_and_incomplete_requests() {
        for request in [
            &b"not-a-request\r\n\r\n"[..],
            &b"GET /login/callback?state=expected HTTP/1.1\r\n\r\n"[..],
            &b"GET /login/callback?code=a HTTP/1.1\r\n\r\n"[..],
            &[0xff, 0xfe][..],
        ] {
            assert!(parse_auth_callback_request(request, "expected").is_none());
        }
        let error = parse_auth_callback_request(
            b"GET /login/callback?error=denied&state=expected HTTP/1.1\r\n\r\n",
            "expected",
        )
        .unwrap();
        assert_eq!(error.error.as_deref(), Some("denied"));
    }

    #[test]
    fn callback_reads_fragmented_http_headers() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let writer = thread::spawn(move || {
            let mut stream = TcpStream::connect(address).unwrap();
            stream
                .write_all(b"GET /login/callback?code=auth-code&state=vulture-desktop:7793:token:proof HTTP/1.1\r\n")
                .unwrap();
            thread::sleep(Duration::from_millis(20));
            stream.write_all(b"Host: localhost\r\n\r\n").unwrap();
        });
        let (mut stream, _) = listener.accept().unwrap();
        let callback = read_auth_callback(&mut stream, "vulture-desktop:7793:token:").unwrap();
        assert_eq!(callback.code.as_deref(), Some("auth-code"));
        writer.join().unwrap();
    }

    #[test]
    fn listener_serves_a_valid_loopback_callback() {
        let app = tauri::test::mock_app().handle().clone();
        let url = listen_on_port(app, "123e4567-e89b-12d3-a456-426614174000", 0).unwrap();
        assert_eq!(super::CALLBACK_PORT, 7793);
        let address = url
            .strip_prefix("http://127.0.0.1:")
            .unwrap()
            .strip_suffix("/login/callback")
            .unwrap();
        let state = format!("vulture-desktop:{address}:123e4567-e89b-12d3-a456-426614174000:proof");
        let mut stream = std::net::TcpStream::connect(format!("127.0.0.1:{address}")).unwrap();
        write!(
            stream,
            "GET /login/callback?code=auth-code&state={} HTTP/1.1\r\nHost: localhost\r\n\r\n",
            url::form_urlencoded::byte_serialize(state.as_bytes()).collect::<String>()
        )
        .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        assert!(response.starts_with("HTTP/1.1 200 OK"));
        assert!(response.contains("Sign-in complete"));
        let _occupied = std::net::TcpListener::bind(("127.0.0.1", 7793)).unwrap();
        let other_app = tauri::test::mock_app().handle().clone();
        let error = listen(other_app, "123e4567-e89b-12d3-a456-426614174000").unwrap_err();
        assert!(error.contains("port 7793"));
    }

    fn send_callback(port: &str, state: &str) -> String {
        let mut stream = std::net::TcpStream::connect(format!("127.0.0.1:{port}")).unwrap();
        write!(
            stream,
            "GET /login/callback?code=auth-code&state={} HTTP/1.1\r\nHost: localhost\r\n\r\n",
            url::form_urlencoded::byte_serialize(state.as_bytes()).collect::<String>()
        )
        .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        response
    }

    #[test]
    fn restarting_sign_in_replaces_the_waiting_listener_on_the_same_port() {
        use std::sync::{Arc, Mutex};
        use tauri::Listener;

        let port = TcpListener::bind(("127.0.0.1", 0))
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let app = tauri::test::mock_app().handle().clone();
        let events = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&events);
        app.listen("vulture-auth-callback", move |event| {
            seen.lock().unwrap().push(event.payload().to_owned());
        });
        let first = listen_on_port(app.clone(), "first-token", port).unwrap();
        let second = listen_on_port(app, "second-token", port).unwrap();
        assert_eq!(first, second);
        let port = port.to_string();
        let stale = send_callback(&port, &format!("vulture-desktop:{port}:first-token:proof"));
        assert!(stale.starts_with("HTTP/1.1 400 Bad Request"));
        let fresh = send_callback(&port, &format!("vulture-desktop:{port}:second-token:proof"));
        assert!(fresh.starts_with("HTTP/1.1 200 OK"));
        thread::sleep(Duration::from_millis(200));
        let events = events.lock().unwrap().clone();
        assert_eq!(
            events.len(),
            1,
            "cancelled listener must not emit: {events:?}"
        );
        assert!(events[0].contains("second-token"));
        assert!(!events[0].contains("timed out"));
    }
}
