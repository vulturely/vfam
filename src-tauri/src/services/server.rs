use crate::repositories::{
    control, fambuddy_gateway, fambuddy_registry, fambuddy_relay, robot,
    server::{ServerError, UnaryInput},
};

pub async fn execute(input: UnaryInput) -> Result<serde_json::Value, ServerError> {
    validate(&input)?;
    match input.service.as_str() {
        "control" => control::execute(input).await,
        "robot" => robot::execute(input).await,
        "fambuddy_gateway" => fambuddy_gateway::execute(input).await,
        "fambuddy_registry" => fambuddy_registry::execute(input).await,
        "fambuddy_relay" => fambuddy_relay::execute(input).await,
        _ => Err(ServerError::invalid("Unsupported Vulture server service.")),
    }
}

fn validate(input: &UnaryInput) -> Result<(), ServerError> {
    if input.service != "control" {
        return Ok(());
    }
    let payload = &input.payload;
    match input.method.as_str() {
        "GeneratePractice" => validate_practice(payload)?,
        "ParseWorksheetDraft" => {
            validate_file(payload, "content", "declaredMediaType", &[1, 2, 3], false)?;
        }
        "GenerateHomeworkDraft" => validate_homework_draft(payload)?,
        "SuggestWorksheetParser" => validate_worksheet_parser(payload)?,
        "PrepareFamilyAiJob" => validate_family_ai_task(payload)?,
        "CreateHomework" => {
            required_text(payload, "title", "Enter a title and subject.")?;
            required_text(payload, "subject", "Enter a title and subject.")?;
            let has_answers = payload
                .get("answerKey")
                .and_then(serde_json::Value::as_array)
                .is_some_and(|answers| !answers.is_empty());
            if !has_answers || byte_len(payload, "content")? > 0 {
                validate_file(
                    payload,
                    "content",
                    "declaredMediaType",
                    &[1, 2, 3, 4],
                    !has_answers,
                )?;
            }
        }
        "UpdateHomework" => {
            required_text(payload, "title", "Enter a title and subject.")?;
            required_text(payload, "subject", "Enter a title and subject.")?;
            // Empty text clears typed instructions; the server substitutes the questions.
            let cleared_text = payload
                .get("declaredMediaType")
                .and_then(serde_json::Value::as_i64)
                == Some(4)
                && byte_len(payload, "content")? == 0;
            if !cleared_text {
                validate_file(
                    payload,
                    "content",
                    "declaredMediaType",
                    &[1, 2, 3, 4],
                    false,
                )?;
            }
        }
        "ConfirmSource" => validate_corrections(payload)?,
        "CreateLearningProfile" | "AddLearningGuardian" => {
            validate_learning(payload, &input.method)?;
        }
        "CreateTask" => {
            required_text(payload, "title", "Task title is required")?;
        }
        "CreateAccount" => {
            required_text(payload, "displayName", "Name is required.")?;
            if payload
                .get("email")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|email| !email.is_empty() && !email.contains('@'))
            {
                return Err(ServerError::invalid("Enter a valid email address."));
            }
        }
        _ => {}
    }
    Ok(())
}

fn validate_practice(payload: &serde_json::Value) -> Result<(), ServerError> {
    let count = payload
        .get("maxQuestions")
        .and_then(serde_json::Value::as_i64)
        .ok_or_else(|| ServerError::invalid("Choose 1–12 questions."))?;
    if !(1..=12).contains(&count) {
        return Err(ServerError::invalid("Choose 1–12 questions."));
    }
    Ok(())
}

fn validate_homework_draft(payload: &serde_json::Value) -> Result<(), ServerError> {
    validate_file(
        payload,
        "referenceContent",
        "referenceMediaType",
        &[1, 2, 3, 4],
        false,
    )
}

fn validate_worksheet_parser(payload: &serde_json::Value) -> Result<(), ServerError> {
    if payload.get("aiOptIn").and_then(serde_json::Value::as_bool) != Some(true) {
        return Err(ServerError::invalid(
            "Allow AI to use extracted text to write the parser.",
        ));
    }
    Ok(())
}

/// A family AI job carries exactly one platform AI request, validated the same way.
fn validate_family_ai_task(payload: &serde_json::Value) -> Result<(), ServerError> {
    let tasks = payload
        .as_object()
        .map(|task| {
            task.iter()
                .filter(|(_, value)| value.is_object())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    match tasks.as_slice() {
        [(name, task)] if name.as_str() == "practice" => validate_practice(task),
        [(name, task)] if name.as_str() == "homeworkDraft" => validate_homework_draft(task),
        [(name, task)] if name.as_str() == "worksheetParser" => validate_worksheet_parser(task),
        _ => Err(ServerError::invalid("Choose one AI task.")),
    }
}

fn validate_corrections(payload: &serde_json::Value) -> Result<(), ServerError> {
    let corrections = payload
        .get("corrections")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| ServerError::invalid("Correct every region or reupload the worksheet."))?;
    if corrections.is_empty()
        || corrections.iter().any(|segment| {
            segment
                .get("text")
                .and_then(serde_json::Value::as_str)
                .is_none_or(|text| text.trim().is_empty())
        })
    {
        return Err(ServerError::invalid(
            "Correct every region or reupload the worksheet.",
        ));
    }
    Ok(())
}

fn validate_learning(payload: &serde_json::Value, method: &str) -> Result<(), ServerError> {
    if method == "AddLearningGuardian" {
        return required_text(
            payload,
            "guardianAccountId",
            "Choose a parent account to add as guardian.",
        )
        .map(|_| ());
    }
    required_text(
        payload,
        "familyId",
        "Choose a family and a child name with 1–80 characters.",
    )?;
    let name = required_text(
        payload,
        "displayName",
        "Choose a family and a child name with 1–80 characters.",
    )?;
    if name.chars().count() > 80 {
        return Err(ServerError::invalid(
            "Choose a family and a child name with 1–80 characters.",
        ));
    }
    let grade = payload
        .get("grade")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    if grade.chars().count() > 40 {
        return Err(ServerError::invalid(
            "Choose an age group and a grade with at most 40 characters.",
        ));
    }
    if payload
        .get("ageBand")
        .and_then(serde_json::Value::as_i64)
        .is_none_or(|band| !(1..=4).contains(&band))
    {
        return Err(ServerError::invalid(
            "Choose an age group and a grade with at most 40 characters.",
        ));
    }
    Ok(())
}

fn required_text<'a>(
    payload: &'a serde_json::Value,
    key: &str,
    message: &str,
) -> Result<&'a str, ServerError> {
    payload
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ServerError::invalid(message))
}

fn validate_file(
    payload: &serde_json::Value,
    content: &str,
    media: &str,
    allowed: &[i64],
    required: bool,
) -> Result<(), ServerError> {
    if payload.get(content).is_none_or(serde_json::Value::is_null) {
        if required {
            return Err(ServerError::invalid(
                "Choose a supported file up to 10 MiB.",
            ));
        }
        return Ok(());
    }
    let length = byte_len(payload, content)?;
    let kind = payload
        .get(media)
        .and_then(serde_json::Value::as_i64)
        .unwrap_or_default();
    if length == 0 || length > 10 * 1024 * 1024 || !allowed.contains(&kind) {
        return Err(ServerError::invalid(
            "Choose a supported file up to 10 MiB.",
        ));
    }
    Ok(())
}

fn byte_len(payload: &serde_json::Value, key: &str) -> Result<usize, ServerError> {
    use base64::Engine;
    let encoded = payload
        .get(key)
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| ServerError::invalid("Invalid file content."))?;
    base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map(|bytes| bytes.len())
        .map_err(|_| ServerError::invalid("Invalid file content."))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(method: &str, payload: serde_json::Value) -> UnaryInput {
        UnaryInput {
            server_url: "https://server.example".into(),
            service: "control".into(),
            method: method.into(),
            token: None,
            payload,
            timeout_ms: None,
        }
    }

    #[test]
    fn rejects_unknown_services_and_methods_before_network_access() {
        for (service, method) in [("unknown", "Health"), ("control", "Unknown")] {
            let input = UnaryInput {
                server_url: "https://server.example".into(),
                service: service.into(),
                method: method.into(),
                token: None,
                payload: serde_json::json!({}),
                timeout_ms: None,
            };
            let error = tauri::async_runtime::block_on(execute(input)).unwrap_err();
            assert_eq!(error.kind, "invalid_argument");
        }
    }

    #[test]
    fn validates_learning_practice_task_and_parser_rules() {
        assert!(validate(&input(
            "GeneratePractice",
            serde_json::json!({"maxQuestions": 0})
        ))
        .is_err());
        assert!(validate(&input(
            "GeneratePractice",
            serde_json::json!({"maxQuestions": 12})
        ))
        .is_ok());
        let profile = serde_json::json!({
            "familyId": "family", "displayName": "Jamie", "grade": "2", "ageBand": 2
        });
        assert!(validate(&input("CreateLearningProfile", profile)).is_ok());
        let mut invalid = input("CreateLearningProfile", serde_json::json!({}));
        invalid.payload = serde_json::json!({"familyId": "family"});
        assert!(validate(&invalid).is_err());
        assert!(validate(&input(
            "AddLearningGuardian",
            serde_json::json!({"guardianAccountId": " "})
        ))
        .is_err());
        assert!(validate(&input(
            "AddLearningGuardian",
            serde_json::json!({"guardianAccountId": "parent"})
        ))
        .is_ok());
        assert!(validate(&input("CreateTask", serde_json::json!({"title": " "}))).is_err());
        assert!(validate(&input("CreateTask", serde_json::json!({"title": "Task"}))).is_ok());
        assert!(validate(&input(
            "SuggestWorksheetParser",
            serde_json::json!({"aiOptIn": false})
        ))
        .is_err());
        assert!(validate(&input(
            "SuggestWorksheetParser",
            serde_json::json!({"aiOptIn": true})
        ))
        .is_ok());
    }

    #[test]
    fn family_ai_jobs_carry_exactly_one_task_validated_like_platform_requests() {
        for valid in [
            serde_json::json!({"practice": {"maxQuestions": 5}}),
            serde_json::json!({"homeworkDraft": {"topic": "Addition"}}),
            serde_json::json!({"worksheetParser": {"aiOptIn": true}}),
        ] {
            assert!(
                validate(&input("PrepareFamilyAiJob", valid.clone())).is_ok(),
                "{valid}"
            );
        }
        for invalid in [
            serde_json::json!({}),
            serde_json::json!({"practice": {"maxQuestions": 13}}),
            serde_json::json!({"worksheetParser": {"aiOptIn": false}}),
            serde_json::json!({"homeworkDraft": {"referenceContent": "AQI=", "referenceMediaType": 9}}),
            serde_json::json!({"practice": {"maxQuestions": 5}, "worksheetParser": {"aiOptIn": true}}),
            serde_json::json!({"chat": {"message": "hi"}}),
            serde_json::json!("practice"),
        ] {
            assert!(
                validate(&input("PrepareFamilyAiJob", invalid.clone())).is_err(),
                "{invalid}"
            );
        }
    }

    #[test]
    fn validates_homework_files_and_corrections() {
        let text = serde_json::json!({
            "title": "Addition", "subject": "Math", "content": "", "declaredMediaType": 4,
            "answerKey": [{"question": "1+1", "answer": "2"}]
        });
        assert!(validate(&input("CreateHomework", text)).is_ok());
        assert!(validate(&input(
            "CreateHomework",
            serde_json::json!({"title": "Addition", "subject": "Math", "content": ""})
        ))
        .is_err());
        assert!(validate(&input(
            "ParseWorksheetDraft",
            serde_json::json!({"content": "AQI=", "declaredMediaType": 2})
        ))
        .is_ok());
        assert!(validate(&input(
            "ParseWorksheetDraft",
            serde_json::json!({"content": "AQI=", "declaredMediaType": 5})
        ))
        .is_err());
        assert!(validate(&input(
            "ConfirmSource",
            serde_json::json!({"corrections": []})
        ))
        .is_err());
        assert!(validate(&input(
            "ConfirmSource",
            serde_json::json!({"corrections": [{"text": "Corrected"}]})
        ))
        .is_ok());
        assert!(validate(&input(
            "GenerateHomeworkDraft",
            serde_json::json!({"referenceContent": "AQI=", "referenceMediaType": 3})
        ))
        .is_ok());
        assert!(validate(&input(
            "UpdateHomework",
            serde_json::json!({"title": "Updated", "subject": "Math"})
        ))
        .is_ok());
        assert!(validate(&input(
            "UpdateHomework",
            serde_json::json!({"title": "Updated", "subject": "Math", "content": "", "declaredMediaType": 4})
        ))
        .is_ok());
        assert!(validate(&input(
            "UpdateHomework",
            serde_json::json!({"title": "Updated", "subject": "Math", "content": "", "declaredMediaType": 2})
        ))
        .is_err());
        assert!(validate(&input(
            "CreateAccount",
            serde_json::json!({"displayName": "Parent", "email": "parent@example.com"})
        ))
        .is_ok());
        assert!(validate(&input(
            "CreateAccount",
            serde_json::json!({"displayName": "Parent", "email": "invalid"})
        ))
        .is_err());
    }
}
