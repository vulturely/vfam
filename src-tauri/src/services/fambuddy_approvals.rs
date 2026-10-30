use crate::repositories::notification;
use serde::Deserialize;

/// What a `FamBuddy` approval notification says. Never the question or answer itself.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApprovalNoticeInput {
    pub title: String,
    pub body: String,
}

fn shown(text: &str, max: usize) -> bool {
    !text.trim().is_empty() && text.chars().count() <= max && !text.chars().any(char::is_control)
}

pub fn validate(input: &ApprovalNoticeInput) -> Result<(), String> {
    if shown(&input.title, 120) && shown(&input.body, 200) {
        Ok(())
    } else {
        Err("Invalid FamBuddy approval notice.".into())
    }
}

/// Shows that a `FamBuddy` question or answer waits for approval.
pub fn notice<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    input: &ApprovalNoticeInput,
) -> Result<(), String> {
    validate(input)?;
    notification::fambuddy_approval(app, &input.title, &input.body)
}

#[cfg(test)]
mod tests {
    use super::{notice, validate, ApprovalNoticeInput};

    fn input(title: &str, body: &str) -> ApprovalNoticeInput {
        ApprovalNoticeInput {
            title: title.into(),
            body: body.into(),
        }
    }

    #[test]
    fn accepts_short_plain_text_only() {
        assert!(validate(&input(
            "Kitchen needs your approval",
            "An answer is waiting."
        ))
        .is_ok());
        for bad in [
            input("", "body"),
            input("title", "   "),
            input(&"t".repeat(121), "body"),
            input("title", &"b".repeat(201)),
            input("line\nbreak", "body"),
        ] {
            assert!(validate(&bad).is_err());
        }
        let app = tauri::test::mock_app().handle().clone();
        assert!(notice(&app, &input("", "body")).is_err());
    }
}
