import {
	ApprovePracticeResponse,
	ChildPractice,
	ConfirmSourceResponse,
	GatewayOutput,
	GenerateHomeworkDraftResponse,
	GeneratePracticeResponse,
	GetChildPolicyResponse,
	GetHomeworkResponse,
	GetLearningSessionResponse,
	GetSourceSegmentsResponse,
	LearningAttempt,
	LearningProfile,
	ParseWorksheetDraftResponse,
	SubmitLearningAnswerResponse,
	Timetable,
	TutorPracticeResponse,
	UncertainPracticeAnswer,
	FamBudCommand,
	FamBudDevice,
	FamilyLicense,
	RegisteredFamBuddy,
	Task,
	bytes,
} from "../api/protocol";

export function decodeNativeResponse(method: string, value: unknown): unknown {
	switch (method) {
		case "ListLearningProfiles":
			return list(value, "profiles", (profile) => new LearningProfile(profile));
		case "ListChildPractice":
			return list(value, "activities", (activity) => new ChildPractice(activity));
		case "ReviewLearningSessions":
			return list(value, "attempts", (attempt) => new LearningAttempt(attempt));
		case "GetLearningSession":
		case "ControlLearningSession":
			return new GetLearningSessionResponse(value);
		case "SubmitLearningAnswer":
			return new SubmitLearningAnswerResponse(value);
		case "ListPractice":
			return list(value, "sets", (set) => new GeneratePracticeResponse(set));
		case "GeneratePractice":
		case "RevisePractice":
			return new GeneratePracticeResponse(value);
		case "ApprovePractice":
			return new ApprovePracticeResponse(value);
		case "TutorPractice":
			return new TutorPracticeResponse(value);
		case "GetSourceSegments":
		case "ExtractHomework":
			return new GetSourceSegmentsResponse(value);
		case "ConfirmSource":
			return new ConfirmSourceResponse(value);
		case "ParseWorksheetDraft":
			return new ParseWorksheetDraftResponse(value);
		case "GenerateHomeworkDraft":
			return new GenerateHomeworkDraftResponse(value);
		case "GetHomework":
		case "UpdateHomework":
			return new GetHomeworkResponse(value);
		case "ListHomework":
			return list(value, "items", (item) => new GetHomeworkResponse(item));
		case "GetTimetable":
			return object(value, (response) => ({
				...response,
				timetable: response.timetable ? new Timetable(response.timetable) : undefined,
			}));
		case "GetChildPolicy":
			return new GetChildPolicyResponse(value);
		case "OpenTalk":
			return new GatewayOutput(value);
		case "WatchParent":
		case "ParentCommand":
			return object(value, (response) => ({
				...response,
				output: response.output ? new GatewayOutput(response.output) : undefined,
			}));
		case "GetLearningProfile":
		case "CreateLearningProfile":
		case "UpdateLearningProgression":
		case "AddLearningGuardian":
		case "RemoveLearningGuardian":
			return object(value, (response) => ({
				...response,
				profile: response.profile ? new LearningProfile(response.profile) : undefined,
			}));
		case "ListRobots":
			return object(value, (response) => ({
				...response,
				devices: Array.isArray(response.devices)
					? response.devices.map((device) => new FamBudDevice(device))
					: [],
				commands: Array.isArray(response.commands)
					? response.commands.map((command) => new FamBudCommand(command))
					: [],
			}));
		case "ListFamBuddies":
			return list(value, "devices", (device) => new RegisteredFamBuddy(device));
		case "RegisterFamBuddy":
			return object(value, (response) => ({
				...response,
				device: response.device ? new RegisteredFamBuddy(response.device) : undefined,
			}));
		case "SetFamilyLicense":
		case "GetFamilyLicense":
			return object(value, (response) => ({
				...response,
				license: new FamilyLicense(response.license ?? {}),
			}));
		case "GetUncertainAnswers":
			return list(value, "answers", (answer) => new UncertainPracticeAnswer(answer));
		case "ListTasks":
		case "ListChildTasks":
			return list(value, "tasks", (task) => new Task(task));
		case "CreateTask":
		case "UpdateTask":
		case "MarkTaskStatus":
		case "MarkChildTaskStatus":
			return object(value, (response) => ({
				...response,
				task: response.task ? new Task(response.task) : undefined,
			}));
		case "DownloadHomework":
		case "DownloadTaskDocument":
			return object(value, (response) => ({ ...response, content: bytes(response.content) }));
		case "GetProfileAvatar":
			return object(value, (response) => ({ ...response, image: bytes(response.image) }));
		case "GetQuestionAudio":
			return object(value, (response) => ({ ...response, audio: bytes(response.audio) }));
		default:
			return value;
	}
}

function object(value: unknown, decode: (value: Record<string, unknown>) => unknown): unknown {
	return value && typeof value === "object" && !Array.isArray(value)
		? decode(value as Record<string, unknown>)
		: value;
}

function list(value: unknown, key: string, decode: (value: unknown) => unknown): unknown {
	return object(value, (response) => ({
		...response,
		[key]: Array.isArray(response[key]) ? response[key].map(decode) : [],
	}));
}
