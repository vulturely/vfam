use tauri_plugin_notification::NotificationExt;

pub fn family_message<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    app.notification()
        .builder()
        .title("VFAM")
        .body("New family message")
        .show()
        .map_err(|_| "Notifications are unavailable.".to_owned())
}

/// A child asked for help. Only the child's name and homework title are shown.
pub fn help_request<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    title: &str,
    body: &str,
) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|_| "Notifications are unavailable.".to_owned())
}

/// A `FamBuddy` question or answer is waiting for a parent's approval.
pub fn fambuddy_approval<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    title: &str,
    body: &str,
) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|_| "Notifications are unavailable.".to_owned())
}
