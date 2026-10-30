//! Desktop process lifecycle owned by the OS integration boundary.

pub trait Lifecycle {
    /// Asks the app's event loop to quit; windows close and the process exits.
    fn quit(&self);
}

impl<R: tauri::Runtime> Lifecycle for tauri::AppHandle<R> {
    fn quit(&self) {
        self.exit(0);
    }
}
