/// # Panics
///
/// Panics if the Tauri application fails during startup or runtime.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    crate::composition::builder()
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| reopen(app, &event));
}

/// Clicking the Dock icon brings back a window hidden to the menu bar.
#[cfg(target_os = "macos")]
fn reopen(app: &tauri::AppHandle, event: &tauri::RunEvent) {
    if let tauri::RunEvent::Reopen { .. } = event {
        crate::background::show(app);
    }
}
#[cfg(not(target_os = "macos"))]
const fn reopen(_: &tauri::AppHandle, _: &tauri::RunEvent) {}
