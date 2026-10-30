use crate::repositories::app_lifecycle::Lifecycle;

/// Quits the desktop app. Signing out is separate: the saved session stays.
pub fn exit(app: &impl Lifecycle) {
    app.quit();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[derive(Default)]
    struct Recorder(Cell<u32>);
    impl Lifecycle for Recorder {
        fn quit(&self) {
            self.0.set(self.0.get() + 1);
        }
    }

    #[test]
    fn exit_quits_the_app_once() {
        let app = Recorder::default();
        exit(&app);
        assert_eq!(app.0.get(), 1);
    }
}
