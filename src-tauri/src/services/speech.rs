use crate::repositories::{
    server::ServerError,
    speech::{self, SPEAKERS},
};

/// Words and short sentences only; children hear spelling words and tutor replies.
const MAX_CHARS: usize = 500;

/// Text the device voice may read: trimmed, single-line and bounded.
pub fn speakable(text: &str) -> Result<String, ServerError> {
    let text: String = text
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .trim()
        .to_owned();
    if text.is_empty() {
        return Err(ServerError::invalid("Nothing to read aloud."));
    }
    if text.chars().count() > MAX_CHARS {
        return Err(ServerError::invalid("That is too long to read aloud."));
    }
    Ok(text)
}

/// Silences whatever the device voice is saying; only one word is ever spoken at a time.
static CURRENT: std::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>> =
    std::sync::Mutex::new(None);

fn replace_current(next: Option<tokio::sync::oneshot::Sender<()>>) {
    let previous = match CURRENT.lock() {
        Ok(mut current) => std::mem::replace(&mut *current, next),
        Err(poisoned) => std::mem::replace(&mut *poisoned.into_inner(), next),
    };
    if let Some(previous) = previous {
        let _ = previous.send(());
    }
}

/// Reads text aloud with the operating system's own voice, stopping any earlier word.
pub async fn speak(text: String) -> Result<(), ServerError> {
    let text = speakable(&text)?;
    let (stop, stopped) = tokio::sync::oneshot::channel();
    replace_current(Some(stop));
    speech::speak(SPEAKERS, &text, async {
        let _ = stopped.await;
    })
    .await
}

/// Stops the device voice, for example when the child leaves the question.
pub fn stop() {
    replace_current(None);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_text_short_single_line_and_present() {
        assert_eq!(speakable("  apple\n").unwrap(), "apple");
        assert_eq!(speakable("a\tb\u{0}c").unwrap(), "a b c");
        assert!(speakable(" \n ").is_err());
        assert!(speakable(&"a".repeat(501)).is_err());
        assert!(speakable(&"a".repeat(500)).is_ok());
    }

    #[test]
    fn stopping_with_nothing_spoken_is_harmless() {
        stop();
        let (sender, mut receiver) = tokio::sync::oneshot::channel();
        replace_current(Some(sender));
        stop();
        assert!(receiver.try_recv().is_ok());
    }

    #[tokio::test]
    async fn rejects_invalid_text_before_speaking() {
        assert_eq!(
            speak("   ".into()).await.unwrap_err().kind,
            "invalid_argument"
        );
    }
}
