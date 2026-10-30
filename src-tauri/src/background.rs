//! Desktop background mode. Closing the window hides the app to the menu bar or tray,
//! so `FamBuddy` approvals and help alerts keep arriving; it starts at login. "Quit
//! VFAM" in the tray stops it.
#![cfg(desktop)]
use tauri::{Manager, Runtime};

/// Brings the hidden window back.
pub fn show<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Closing the window hides it instead of quitting.
pub fn hide_on_close<R: Runtime>(window: &tauri::Window<R>, event: &tauri::WindowEvent) {
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
    }
}

/// The tray icon with "Open VFAM" and "Quit VFAM", and starting at login once.
pub fn setup<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;
    use tauri_plugin_autostart::ManagerExt;
    let open = MenuItem::with_id(app, "open", "Open VFAM", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit VFAM", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut tray = TrayIconBuilder::with_id("vfam")
        .tooltip("VFAM")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show(app),
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    let marker = app.path().app_data_dir()?.join("autostart-configured");
    let launcher = app.autolaunch();
    let _ = crate::repositories::autostart::configure_once(&marker, || {
        launcher
            .enable()
            .map_err(|_| "Could not start VFAM at login.".to_owned())
    });
    Ok(())
}
