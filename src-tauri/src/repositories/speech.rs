use super::server::ServerError;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;

/// An installed text-to-speech program that reads the text from standard input.
pub struct Speaker {
    pub program: &'static str,
    pub args: &'static [&'static str],
}

/// The operating system's own voices, tried in order. Text always goes over stdin, so a
/// word can never be read as a command-line option.
#[cfg(target_os = "macos")]
pub const SPEAKERS: &[Speaker] = &[Speaker {
    program: "/usr/bin/say",
    // The system voice, a little slower than conversation so children hear each sound.
    args: &["-r", "165", "-f", "-"],
}];
#[cfg(target_os = "linux")]
pub const SPEAKERS: &[Speaker] = &[
    Speaker {
        program: "espeak-ng",
        args: &["--stdin"],
    },
    Speaker {
        program: "spd-say",
        args: &["--pipe-mode", "--wait"],
    },
];
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub const SPEAKERS: &[Speaker] = &[];

/// Speaks with the first speaker that is installed, waiting until it finishes or until
/// `stopped` resolves, which silences it at once. `unavailable` means no voice started;
/// `aborted` means one started, so part of the text may already have been heard.
pub async fn speak(
    speakers: &[Speaker],
    text: &str,
    stopped: impl std::future::Future<Output = ()>,
) -> Result<(), ServerError> {
    for speaker in speakers {
        let Ok(mut child) = tokio::process::Command::new(speaker.program)
            .args(speaker.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
        else {
            continue;
        };
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(text.as_bytes())
                .await
                .map_err(|_| ServerError::new("aborted", "The device voice stopped."))?;
        }
        let status = tokio::select! {
            status = tokio::time::timeout(Duration::from_secs(20), child.wait()) => status
                .map_err(|_| ServerError::new("aborted", "The device voice took too long."))?
                .map_err(|_| ServerError::new("aborted", "The device voice stopped."))?,
            () = stopped => {
                let _ = child.kill().await;
                return Ok(());
            }
        };
        return if status.success() {
            Ok(())
        } else {
            Err(ServerError::new(
                "aborted",
                "The device voice could not speak.",
            ))
        };
    }
    Err(ServerError::unavailable(
        "This device has no voice for reading aloud.",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn speaks_through_the_first_installed_program_using_stdin() {
        let speakers = [
            Speaker {
                program: "vfam-missing-speaker",
                args: &[],
            },
            Speaker {
                program: "cat",
                args: &[],
            },
        ];
        speak(&speakers, "-v not an option", std::future::pending())
            .await
            .expect("spoken");
    }

    #[tokio::test]
    async fn reports_missing_and_failing_voices() {
        let missing = speak(
            &[Speaker {
                program: "vfam-missing-speaker",
                args: &[],
            }],
            "word",
            std::future::pending(),
        )
        .await
        .expect_err("no voice");
        assert_eq!(missing.kind, "unavailable");
        let failing = speak(
            &[Speaker {
                program: "false",
                args: &[],
            }],
            "word",
            std::future::pending(),
        )
        .await
        .expect_err("voice failed");
        assert_eq!(failing.message, "The device voice could not speak.");
        assert_eq!(failing.kind, "aborted");
        assert!(speak(&[], "word", std::future::pending()).await.is_err());
    }

    #[tokio::test]
    async fn stopping_silences_the_voice_at_once() {
        // A long-running program stands in for a voice that is still speaking.
        let speakers = [Speaker {
            program: "sleep",
            args: &["30"],
        }];
        let started = std::time::Instant::now();
        speak(&speakers, "word", std::future::ready(()))
            .await
            .expect("stopped");
        assert!(started.elapsed() < Duration::from_secs(5));
    }
}
