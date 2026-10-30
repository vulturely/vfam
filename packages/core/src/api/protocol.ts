type JsonObject = unknown;

export enum AccountRole {
	UNSPECIFIED = 0,
	PARENT = 1,
	KID = 2,
	GRANDPARENT = 3,
}
export enum LearningAgeBand {
	UNSPECIFIED = 0,
	EARLY_YEARS = 1,
	PRIMARY = 2,
	PRETEEN = 3,
	TEEN = 4,
}
export enum TaskRepeat {
	UNSPECIFIED = 0,
	NONE = 1,
	DAILY = 2,
	WEEKLY = 3,
	MONTHLY = 4,
	YEARLY = 5,
}
export enum TaskStatus {
	UNSPECIFIED = 0,
	TODO = 1,
	IN_PROGRESS = 2,
	IN_REVIEW = 3,
	REJECTED = 4,
	COMPLETED = 5,
	CANCELLED = 6,
}
export enum HomeworkMediaType {
	UNSPECIFIED = 0,
	JPEG = 1,
	PNG = 2,
	PDF = 3,
	TEXT = 4,
	MARKDOWN = 5,
	HTML = 6,
	DOCX = 7,
	XLSX = 8,
	YAML = 9,
	CSV = 10,
}
export enum PracticeQuestionKind {
	UNSPECIFIED = 0,
	SPELLING = 1,
	SHORT_ANSWER = 2,
	/** One correct option. */
	MULTIPLE_CHOICE = 3,
	/** Select every correct option. */
	CHOOSE_MANY = 4,
	TRUE_FALSE = 5,
	MATCHING = 6,
}
export enum LearningSessionState {
	UNSPECIFIED = 0,
	ACTIVE = 1,
	COMPLETED = 2,
	CANCELLED = 3,
}
export enum LearningAnswerResult {
	UNSPECIFIED = 0,
	CORRECT = 1,
	INCORRECT = 2,
	NEEDS_REVIEW = 3,
}
export enum LearningSessionAction {
	UNSPECIFIED = 0,
	HINT = 1,
	HELP = 2,
	STOP = 3,
}
export enum RobotCapabilityValue {
	UNSPECIFIED = 0,
	START_QUIZ = 1,
	STOP_QUIZ = 2,
	SPEAK_PROMPT = 3,
	CAMERA = 4,
	SENSORS = 5,
	MOBILITY = 6,
	FLIGHT = 7,
}
export enum TurnStage {
	UNSPECIFIED = 0,
	QUESTION_PENDING = 1,
	QUESTION_APPROVED = 2,
	AWAITING_ANSWER = 3,
	ANSWER_PENDING = 4,
	ANSWER_APPROVED = 5,
	PLAYBACK_CLAIMED = 6,
	CANCELLED = 7,
	/** The on-device AI could not answer a child's question; it waits for a parent. */
	NEEDS_PARENT = 8,
}
export enum UpdateState {
	UNSPECIFIED = 0,
	CURRENT = 1,
	AVAILABLE = 2,
	INSTALLING = 3,
	FAILED = 4,
}

/** A FamBuddy's license as its hub reports it (gateway.proto LicenseState). */
export enum LicenseState {
	UNSPECIFIED = 0,
	NONE = 1,
	VALID = 2,
	EXPIRED = 3,
}

/** How a FamBuddy answers questions (gateway.proto AiMode); unspecified means the default. */
export enum AiMode {
	UNSPECIFIED = 0,
	LOCAL_ONLY = 1,
	LOCAL_FIRST = 2,
	CLOUD_ONLY = 3,
}

/** The family's license on the family server (fambuddy_registry.proto FamilyLicense.State). */
export enum FamilyLicenseState {
	UNSPECIFIED = 0,
	NONE = 1,
	VALID = 2,
	EXPIRED = 3,
}

export enum AskerRole {
	UNSPECIFIED = 0,
	CHILD = 1,
	PARENT = 2,
}

export enum AnswerSource {
	UNSPECIFIED = 0,
	PROVIDER = 1,
	PARENT_DEVICE = 2,
	LOCAL = 3,
	CLOUD = 4,
	PARENT = 5,
}

export class SourceVersion {
	id = "";
	version = 0;
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class PracticeVersion {
	id = "";
	version = 0;
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class LearningProgression {
	dateOfBirth = "";
	autoGrade = false;
	schoolYearMonth = 0;
	schoolYearDay = 0;
	country = "";
	region = "";
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class LearningProfile {
	id = "";
	familyId = "";
	displayName = "";
	ageBand = LearningAgeBand.UNSPECIFIED;
	grade = "";
	guardianAccountIds: string[] = [];
	createdAt = "";
	progression?: LearningProgression;
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class PairPhoneResponse {
	token = "";
	family = "";
	expiresAt = "";
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class WorksheetWord {
	text = "";
	region: number[] = [];
	confidence = 0;
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class SourceSegment {
	id = "";
	source?: SourceVersion;
	pageNumber = 0;
	ordinal = 0;
	text = "";
	needsReview = false;
	confirmedAt?: string;
	confidence = 0;
	region: number[] = [];
	words: WorksheetWord[] = [];
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class HomeworkItem {
	id = "";
	familyId = "";
	profileId = "";
	title = "";
	subject = "";
	uploadedBy = "";
	createdAt = "";
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class HomeworkSource {
	source?: SourceVersion;
	mediaType = HomeworkMediaType.UNSPECIFIED;
	pageCount = 0;
	emailProvenance?: EmailProvenance;
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
/** One answer-key question; an empty kind is a typed answer (`short_answer`). */
export class HomeworkAnswer {
	question = "";
	/** The correct answer; a readable summary for `choose_many` and `matching`. */
	answer = "";
	explanation = "";
	kind = "";
	/** Options for `multiple_choice` and `choose_many` (True/False for `true_false`). */
	choices: string[] = [];
	/** `choose_many`: correct options; `short_answer`: other accepted answers; `matching`: answers aligned with `items`. */
	answers: string[] = [];
	/** `matching`: left-hand items. */
	items: string[] = [];
	/** `spelling`: what the child's device reads aloud. */
	say = "";
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class GetHomeworkResponse {
	homework?: HomeworkItem;
	sources: HomeworkSource[] = [];
	answerKey: HomeworkAnswer[] = [];
	parserYaml = "";
	/** Typed homework without instructions; its stored text is just the numbered questions. */
	textFromQuestions = false;
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class GetSourceSegmentsResponse {
	segments: SourceSegment[] = [];
	state = "";
	source?: SourceVersion;
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class ConfirmSourceResponse {
	accepted = false;
	source?: SourceVersion;
	segments: SourceSegment[] = [];
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class ParseWorksheetDraftResponse {
	segments: SourceSegment[] = [];
	questions: HomeworkAnswer[] = [];
	warnings: string[] = [];
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class HomeworkQuestions {
	questions: HomeworkAnswer[] = [];
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class GenerateHomeworkDraftResponse {
	title = "";
	questions: HomeworkAnswer[] = [];
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class PracticeQuestion {
	position = 0;
	kind = PracticeQuestionKind.UNSPECIFIED;
	prompt = "";
	/** Options; for matching, the right-hand answers in shuffled order. */
	choices: string[] = [];
	/** Matching: left-hand items to pair with `choices`. */
	items: string[] = [];
	/** Spelling: what to read aloud. */
	say = "";
	hintCount = 0;
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class ParentPracticeQuestion {
	question?: PracticeQuestion;
	expectedAnswer = "";
	sourceSegmentId = "";
	sourceQuote = "";
	hints: string[] = [];
	a = 0n;
	b = 0n;
	operation = "";
	answers: string[] = [];
	explanation = "";
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class PracticeSet {
	practice?: PracticeVersion;
	source?: SourceVersion;
	profileId = "";
	familyId = "";
	title = "";
	approved = false;
	approvedBy?: string;
	approvedAt?: string;
	reviewState = "";
	subject = "";
	difficulty = "";
	/** "generated" (AI from a worksheet) or "assigned" (homework questions). */
	origin = "";
	createdAt = "";
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class GeneratePracticeResponse {
	practice?: PracticeSet;
	questions: ParentPracticeQuestion[] = [];
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class ApprovePracticeResponse {
	practice?: PracticeSet;
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class TutorPracticeResponse {
	sessionId = "";
	question?: PracticeQuestion;
	hint = "";
	revealedAnswer?: string;
	result = "";
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class UncertainPracticeAnswer {
	sessionId = "";
	position = 0;
	answer = "";
	prompt = "";
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class LearningSession {
	id = "";
	profileId = "";
	practiceId = "";
	practiceVersion = 0;
	position = 0;
	state = LearningSessionState.UNSPECIFIED;
	createdAt = "";
	updatedAt = "";
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class GetLearningSessionResponse {
	session?: LearningSession;
	question?: PracticeQuestion;
	answered = 0;
	total = 0;
	hint = "";
	revealedAnswer?: string;
	helpRequested = false;
	lastResult?: LearningAnswerResult;
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class SubmitLearningAnswerResponse {
	answerId = "";
	result = LearningAnswerResult.UNSPECIFIED;
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class ChildPractice {
	practice?: PracticeVersion;
	title = "";
	subject = "";
	sessionId?: string;
	state = LearningSessionState.UNSPECIFIED;
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class LearningAttemptAnswer {
	id = "";
	position = 0;
	prompt = "";
	answer = "";
	result = LearningAnswerResult.UNSPECIFIED;
	createdAt = "";
	/** Grading detail, e.g. "3 of 4 pairs". */
	detail = "";
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class LearningAttempt {
	session?: LearningSession;
	helpRequested = false;
	answers: LearningAttemptAnswer[] = [];
	homeworkTitle = "";
	subject = "";
	totalQuestions = 0;
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class EmailProvenance {
	sender = "";
	sentAt = "";
	subject = "";
	partName = "";
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class EmailPreviewPart {
	index = 0;
	name = "";
	contentType = "";
	text = "";
	content = new Uint8Array(0);
	unavailableReason = "";
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class PreviewHomeworkEmailResponse {
	provenance?: EmailProvenance;
	parts: EmailPreviewPart[] = [];
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class TimetableWindow {
	day = 0;
	start = 0;
	end = 0;
	kind = "";
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class CalendarEntry {
	id = "";
	date = "";
	start = 0;
	end = 0;
	kind = "";
	title = "";
	homeworkId?: string;
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class Timetable {
	timezone = "";
	windows: TimetableWindow[] = [];
	overrideUntil?: string;
	entries: CalendarEntry[] = [];
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class GetChildPolicyResponse {
	allowed = false;
	currentActivity = "";
	nextAllowedAt?: string;
	validUntil = "";
	evaluatedAt = "";
	timezone = "";
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class FamBudDevice {
	id = "";
	profileId = "";
	displayName = "";
	capabilities: RobotCapabilityValue[] = [];
	lastSeenAt?: string;
	batteryPercent?: number;
	firmware = "";
	revoked = false;
	connected = false;
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class FamBudCommand {
	commandId = "";
	target = "";
	nonce = "";
	expiresAt = "";
	state = "";
	sessionId = "";
	position = 0;
	prompt = "";
	protocolVersion = 0;
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class TaskRichTextDocument {
	text = "";
	docJson = "";
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class TaskDocument {
	id = "";
	taskId = "";
	objectKey = "";
	name = "";
	contentType = "";
	size = 0n;
	url = "";
	image = false;
	uploadedAt = "";
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class Task {
	id = "";
	familyId = "";
	title = "";
	description?: TaskRichTextDocument;
	assigneeAccountIds: string[] = [];
	reviewerAccountIds: string[] = [];
	startAt?: string;
	endAt?: string;
	repeat = TaskRepeat.UNSPECIFIED;
	status = TaskStatus.UNSPECIFIED;
	createdAt = "";
	updatedAt = "";
	documents: TaskDocument[] = [];
	assigneeProfileIds: string[] = [];
	isChore = false;
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class RegisteredFamBuddy {
	id = "";
	name = "";
	createdAt = "";
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class Account {
	id = "";
	displayName = "";
	email = "";
	role = AccountRole.UNSPECIFIED;
	createdAt = "";
	updatedAt = "";
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class TurnScope {
	family = "";
	speaker = "";
	device = "";
	session = "";
	turn = "";
	destinationRevision = "";
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class TurnReview {
	scope?: TurnScope;
	stage = TurnStage.UNSPECIFIED;
	text = "";
	review?: Uint8Array;
	expiresAt = "";
	destination = "";
	origin?: { name?: string; role?: AskerRole; channel?: string };
	answeredBy = AnswerSource.UNSPECIFIED;
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class VoiceLabel {
	speaker = "";
	name = "";
	role = AskerRole.UNSPECIFIED;
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
/** Never carries the license token. */
export class LicenseStatus {
	state = LicenseState.UNSPECIFIED;
	edition = "";
	features: string[] = [];
	expiresAt = "";
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
/** Never carries the license token. */
export class FamilyLicense {
	state = FamilyLicenseState.UNSPECIFIED;
	edition = "";
	features: string[] = [];
	expiresAt = "";
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class DeviceSettings {
	device = "";
	wakeWord = "";
	muted = false;
	cameraEnabled = false;
	captionsEnabled = false;
	screenPinSet = false;
	autoUpdate = false;
	installedVersion = "";
	availableVersion = "";
	updateState = UpdateState.UNSPECIFIED;
	updateRequested = false;
	license?: LicenseStatus;
	aiMode = AiMode.UNSPECIFIED;
	localAi = false;
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class Caption {
	device = "";
	turn = "";
	text = "";
	startedAt = "";
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class GatewayOutput {
	settings: DeviceSettings[] = [];
	turns: TurnReview[] = [];
	captions: Caption[] = [];
	playbackAllowed = false;
	talk?: string;
	audio: Uint8Array[] = [];
	voiceLabels: VoiceLabel[] = [];
	constructor(data: JsonObject = {}) {
		assignMessage(this, data);
	}
}
export class ParentCommandRequest {
	[command: string]: Record<string, unknown>;
	constructor(data: JsonObject = {}) {
		const input = data as { command?: { case: string; value: Record<string, unknown> } };
		Object.assign(this, input.command ? { [input.command.case]: input.command.value } : data);
	}
}

function assignMessage(target: object, data: JsonObject): void {
	Object.assign(target, data);
	if (target instanceof LearningProfile) {
		target.progression = target.progression
			? new LearningProgression(target.progression)
			: undefined;
	} else if (target instanceof SourceSegment) {
		target.source = target.source ? new SourceVersion(target.source) : undefined;
		target.words = target.words.map((word) => new WorksheetWord(word));
	} else if (target instanceof HomeworkSource) {
		target.source = target.source ? new SourceVersion(target.source) : undefined;
		target.emailProvenance = target.emailProvenance
			? new EmailProvenance(target.emailProvenance)
			: undefined;
	} else if (target instanceof GetHomeworkResponse) {
		target.homework = target.homework ? new HomeworkItem(target.homework) : undefined;
		target.sources = target.sources.map((source) => new HomeworkSource(source));
		target.answerKey = target.answerKey.map((answer) => new HomeworkAnswer(answer));
	} else if (target instanceof GetSourceSegmentsResponse) {
		target.source = target.source ? new SourceVersion(target.source) : undefined;
		target.segments = target.segments.map((segment) => new SourceSegment(segment));
	} else if (target instanceof ConfirmSourceResponse) {
		target.source = target.source ? new SourceVersion(target.source) : undefined;
		target.segments = target.segments.map((segment) => new SourceSegment(segment));
	} else if (target instanceof ParseWorksheetDraftResponse) {
		target.segments = target.segments.map((segment) => new SourceSegment(segment));
		target.questions = target.questions.map((question) => new HomeworkAnswer(question));
	} else if (target instanceof HomeworkQuestions) {
		target.questions = target.questions.map((question) => new HomeworkAnswer(question));
	} else if (target instanceof GenerateHomeworkDraftResponse) {
		target.questions = target.questions.map((question) => new HomeworkAnswer(question));
	} else if (target instanceof ParentPracticeQuestion) {
		target.question = target.question ? new PracticeQuestion(target.question) : undefined;
	} else if (target instanceof PracticeSet) {
		target.practice = target.practice ? new PracticeVersion(target.practice) : undefined;
		target.source = target.source ? new SourceVersion(target.source) : undefined;
	} else if (target instanceof GeneratePracticeResponse) {
		target.practice = target.practice ? new PracticeSet(target.practice) : undefined;
		target.questions = target.questions.map((question) => new ParentPracticeQuestion(question));
	} else if (target instanceof ApprovePracticeResponse) {
		target.practice = target.practice ? new PracticeSet(target.practice) : undefined;
	} else if (target instanceof TutorPracticeResponse) {
		target.question = target.question ? new PracticeQuestion(target.question) : undefined;
	} else if (target instanceof GetLearningSessionResponse) {
		target.session = target.session ? new LearningSession(target.session) : undefined;
		target.question = target.question ? new PracticeQuestion(target.question) : undefined;
	} else if (target instanceof ChildPractice) {
		target.practice = target.practice ? new PracticeVersion(target.practice) : undefined;
	} else if (target instanceof LearningAttempt) {
		target.session = target.session ? new LearningSession(target.session) : undefined;
		target.answers = target.answers.map((answer) => new LearningAttemptAnswer(answer));
	} else if (target instanceof EmailPreviewPart) {
		target.content = bytes(target.content) as Uint8Array<ArrayBuffer>;
	} else if (target instanceof PreviewHomeworkEmailResponse) {
		target.provenance = target.provenance ? new EmailProvenance(target.provenance) : undefined;
		target.parts = target.parts.map((part) => new EmailPreviewPart(part));
	} else if (target instanceof Timetable) {
		target.windows = target.windows.map((window) => new TimetableWindow(window));
		target.entries = target.entries.map((entry) => new CalendarEntry(entry));
	} else if (target instanceof Task) {
		target.description = target.description
			? new TaskRichTextDocument(target.description)
			: undefined;
		target.documents = target.documents.map((document) => new TaskDocument(document));
	} else if (target instanceof TurnReview) {
		target.scope = target.scope ? new TurnScope(target.scope) : undefined;
		target.review = target.review ? bytes(target.review) : undefined;
	} else if (target instanceof DeviceSettings) {
		target.license = target.license ? new LicenseStatus(target.license) : undefined;
	} else if (target instanceof FamilyLicense) {
		target.state = familyLicenseState(target.state);
	} else if (target instanceof GatewayOutput) {
		target.settings = target.settings.map((settings) => new DeviceSettings(settings));
		target.turns = target.turns.map((turn) => new TurnReview(turn));
		target.audio = target.audio.map(bytes);
	}
}

/**
 * FamilyLicense.State is a nested enum, so protobuf JSON names its values STATE_VALID and
 * so on. Another nested State (GetChannelStatusResponse) shares that prefix with other
 * numbers, so these names are read here rather than decoded for every response.
 */
function familyLicenseState(value: unknown): FamilyLicenseState {
	if (typeof value === "number")
		return value in FamilyLicenseState ? value : FamilyLicenseState.UNSPECIFIED;
	const name = typeof value === "string" ? value.replace(/^STATE_/, "") : "";
	const state = (FamilyLicenseState as unknown as Record<string, unknown>)[name];
	return typeof state === "number" ? state : FamilyLicenseState.UNSPECIFIED;
}

export function bytes(value: unknown): Uint8Array {
	if (value instanceof Uint8Array) return value;
	if (Array.isArray(value)) return new Uint8Array(value);
	if (typeof value === "string") {
		const binary = atob(value);
		return Uint8Array.from(binary, (character) => character.charCodeAt(0));
	}
	return new Uint8Array(0);
}
