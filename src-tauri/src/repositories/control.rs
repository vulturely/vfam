use super::server::{authenticated, channel, decode, encode, ServerError, UnaryInput};
use vulture_protocol::server::v1::vulture_control_client::VultureControlClient;

macro_rules! unary {
    ($client:ident, $input:ident, $method:ident) => {{
        let mut $client = VultureControlClient::new(channel(&$input).await?);
        let request = decode(&$input.payload)?;
        let response = $client.$method(authenticated(&$input, request)?).await?;
        drop($client);
        encode(response.into_inner())
    }};
}

pub async fn execute(input: UnaryInput) -> Result<serde_json::Value, ServerError> {
    if input.method.contains("FamilyAi") {
        return family_ai(input).await;
    }
    let result = match input.method.as_str() {
        "BeginParentSignIn" => unary!(client, input, begin_parent_sign_in),
        "ExchangeAuthCode" => unary!(client, input, exchange_auth_code),
        "GetParentSession" => unary!(client, input, get_parent_session),
        "StartChildSession" => unary!(client, input, start_child_session),
        "GetAccountSetup" => unary!(client, input, get_account_setup),
        "UpdateAccountSetup" => unary!(client, input, update_account_setup),
        "GetParentPinAccess" => unary!(client, input, get_parent_pin_access),
        "SetParentPin" => unary!(client, input, set_parent_pin),
        "UnlockParent" => unary!(client, input, unlock_parent),
        "VerifyParentPin" => unary!(client, input, verify_parent_pin),
        "GetChildPinAccess" => unary!(client, input, get_child_pin_access),
        "SetChildPin" => unary!(client, input, set_child_pin),
        "SignInChild" => unary!(client, input, sign_in_child),
        "GetChildSession" => unary!(client, input, get_child_session),
        "RevokeSession" => unary!(client, input, revoke_session),
        "CreateAccount" => unary!(client, input, create_account),
        "CreateFamily" => unary!(client, input, create_family),
        "GetMyFamily" => unary!(client, input, get_my_family),
        "RenameFamily" => unary!(client, input, rename_family),
        "UpdateFamilyDescription" => unary!(client, input, update_family_description),
        "GetAccount" => unary!(client, input, get_account),
        "AddFamilyMember" => unary!(client, input, add_family_member),
        "ListFamilyMembers" => unary!(client, input, list_family_members),
        "SetFamilyRelationship" => unary!(client, input, set_family_relationship),
        "SetAvatar" => unary!(client, input, set_avatar),
        "GetAvatar" => unary!(client, input, get_avatar),
        "SetFamilyAvatar" => unary!(client, input, set_family_avatar),
        "GetFamilyAvatar" => unary!(client, input, get_family_avatar),
        "FamilyResources" => unary!(client, input, family_resources),
        "VoiceAssistant" => unary!(client, input, voice_assistant),
        "FamilyCall" => unary!(client, input, family_call),
        "SaveCalendar" => unary!(client, input, save_calendar),
        "SetProfileTimezone" => unary!(client, input, set_profile_timezone),
        "GetTimetable" => unary!(client, input, get_timetable),
        "SaveTimetable" => unary!(client, input, save_timetable),
        "OverrideTimetable" => unary!(client, input, override_timetable),
        "GetChildPolicy" => unary!(client, input, get_child_policy),
        "ListChildPractice" => unary!(client, input, list_child_practice),
        "ListChildTasks" => unary!(client, input, list_child_tasks),
        "MarkChildTaskStatus" => unary!(client, input, mark_child_task_status),
        "SetProfileAvatar" => unary!(client, input, set_profile_avatar),
        "GetProfileAvatar" => unary!(client, input, get_profile_avatar),
        "ListChildFamily" => unary!(client, input, list_child_family),
        "StartLearningSession" => unary!(client, input, start_learning_session),
        "GetLearningSession" => unary!(client, input, get_learning_session),
        "GetQuestionAudio" => unary!(client, input, get_question_audio),
        "SubmitLearningAnswer" => unary!(client, input, submit_learning_answer),
        "ControlLearningSession" => unary!(client, input, control_learning_session),
        "ReviewLearningSessions" => unary!(client, input, review_learning_sessions),
        "GeneratePractice" => unary!(client, input, generate_practice),
        "ListPractice" => unary!(client, input, list_practice),
        "RevisePractice" => unary!(client, input, revise_practice),
        "ApprovePractice" => unary!(client, input, approve_practice),
        "TutorPractice" => unary!(client, input, tutor_practice),
        "GetUncertainAnswers" => unary!(client, input, get_uncertain_answers),
        "ExtractHomework" => unary!(client, input, extract_homework),
        "GetSourceSegments" => unary!(client, input, get_source_segments),
        "ConfirmSource" => unary!(client, input, confirm_source),
        "SuggestWorksheetParser" => unary!(client, input, suggest_worksheet_parser),
        "ParseWorksheetDraft" => unary!(client, input, parse_worksheet_draft),
        "GenerateHomeworkDraft" => unary!(client, input, generate_homework_draft),
        "CreateHomework" => unary!(client, input, create_homework),
        "ListHomework" => unary!(client, input, list_homework),
        "GetHomework" => unary!(client, input, get_homework),
        "DownloadHomework" => unary!(client, input, download_homework),
        "UpdateHomework" => unary!(client, input, update_homework),
        "DeleteHomework" => unary!(client, input, delete_homework),
        "AssignHomework" => unary!(client, input, assign_homework),
        "GetLearningJob" => unary!(client, input, get_learning_job),
        "CancelLearningJob" => unary!(client, input, cancel_learning_job),
        "CreateLearningProfile" => unary!(client, input, create_learning_profile),
        "GetLearningSchool" => unary!(client, input, get_learning_school),
        "SaveLearningSchool" => unary!(client, input, save_learning_school),
        "UpdateLearningProgression" => unary!(client, input, update_learning_progression),
        "ListLearningProfiles" => unary!(client, input, list_learning_profiles),
        "GetLearningProfile" => unary!(client, input, get_learning_profile),
        "AddLearningGuardian" => unary!(client, input, add_learning_guardian),
        "RemoveLearningGuardian" => unary!(client, input, remove_learning_guardian),
        "ListTasks" => unary!(client, input, list_tasks),
        "CreateTask" => unary!(client, input, create_task),
        "UpdateTask" => unary!(client, input, update_task),
        "DeleteTask" => unary!(client, input, delete_task),
        "MarkTaskStatus" => unary!(client, input, mark_task_status),
        "DownloadTaskDocument" => unary!(client, input, download_task_document),
        "UploadTaskDocument" => unary!(client, input, upload_task_document),
        "RegisterDevice" => unary!(client, input, register_device),
        "Health" => unary!(client, input, health),
        _ => Err(ServerError::invalid("Unsupported Vulture control method.")),
    };
    result
}

/// Family-owned AI jobs, help requests, child modes and key transfers.
async fn family_ai(input: UnaryInput) -> Result<serde_json::Value, ServerError> {
    match input.method.as_str() {
        "PrepareFamilyAiJob" => unary!(client, input, prepare_family_ai_job),
        "GetFamilyAiJob" => unary!(client, input, get_family_ai_job),
        "ListFamilyAiJobs" => unary!(client, input, list_family_ai_jobs),
        "CompleteFamilyAiJob" => unary!(client, input, complete_family_ai_job),
        "CancelFamilyAiJob" => unary!(client, input, cancel_family_ai_job),
        "ApproveFamilyAiJob" => unary!(client, input, approve_family_ai_job),
        "RequestFamilyAiHelp" => unary!(client, input, request_family_ai_help),
        "GetFamilyAiHelp" => unary!(client, input, get_family_ai_help),
        "ListFamilyAiChildSettings" => unary!(client, input, list_family_ai_child_settings),
        "SetFamilyAiChildSetting" => unary!(client, input, set_family_ai_child_setting),
        "GetFamilyAiChildStatus" => unary!(client, input, get_family_ai_child_status),
        "OfferFamilyAiKey" => unary!(client, input, offer_family_ai_key),
        "ListFamilyAiKeyTransfers" => unary!(client, input, list_family_ai_key_transfers),
        "RespondFamilyAiKeyTransfer" => unary!(client, input, respond_family_ai_key_transfer),
        "SendFamilyAiKey" => unary!(client, input, send_family_ai_key),
        "GetFamilyAiKeyTransfer" => unary!(client, input, get_family_ai_key_transfer),
        _ => Err(ServerError::invalid("Unsupported Vulture control method.")),
    }
}
