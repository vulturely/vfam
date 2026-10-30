import { HomeworkAnswer, PracticeQuestionKind } from "../api/protocol";

/** Question kinds as stored in homework answer keys (see the server's `questions` module). */
export type QuestionKind =
	"short_answer" | "spelling" | "multiple_choice" | "choose_many" | "true_false" | "matching";

export const QUESTION_KINDS: { id: QuestionKind; label: string; help: string }[] = [
	{ id: "short_answer", label: "Typed answer", help: "The child types the answer." },
	{ id: "multiple_choice", label: "One choice", help: "The child picks one option." },
	{ id: "choose_many", label: "Choose many", help: "The child ticks every correct option." },
	{ id: "true_false", label: "True or false", help: "The child picks True or False." },
	{ id: "matching", label: "Matching", help: "The child matches each item to its pair." },
	{ id: "spelling", label: "Spelling", help: "The word is read aloud and the child spells it." },
];

const PRACTICE_KINDS: Record<number, QuestionKind> = {
	[PracticeQuestionKind.SPELLING]: "spelling",
	[PracticeQuestionKind.MULTIPLE_CHOICE]: "multiple_choice",
	[PracticeQuestionKind.CHOOSE_MANY]: "choose_many",
	[PracticeQuestionKind.TRUE_FALSE]: "true_false",
	[PracticeQuestionKind.MATCHING]: "matching",
};

/** Maps a delivered practice question kind to its answer-key kind. */
export function practiceKind(kind: PracticeQuestionKind): QuestionKind {
	return PRACTICE_KINDS[kind] ?? "short_answer";
}

export function kindOf(question: HomeworkAnswer): QuestionKind {
	return (
		QUESTION_KINDS.some((kind) => kind.id === question.kind) ? question.kind : "short_answer"
	) as QuestionKind;
}

export function kindLabel(question: HomeworkAnswer): string {
	return QUESTION_KINDS.find((kind) => kind.id === kindOf(question))!.label;
}

/** A new question of `kind`, with enough empty rows to start typing. */
export function blankQuestion(kind: QuestionKind = "short_answer"): HomeworkAnswer {
	const question = new HomeworkAnswer({ kind });
	if (kind === "multiple_choice" || kind === "choose_many") question.choices = ["", "", ""];
	if (kind === "true_false") question.choices = ["True", "False"];
	if (kind === "matching") {
		question.items = ["", ""];
		question.answers = ["", ""];
	}
	if (kind === "spelling") question.question = "Spell the word you hear.";
	return question;
}

/** Switches a question's kind, keeping its text and explanation. */
export function changeKind(question: HomeworkAnswer, kind: QuestionKind): HomeworkAnswer {
	const next = blankQuestion(kind);
	next.explanation = question.explanation;
	if (kind !== "spelling" || question.question.trim()) next.question = question.question;
	return next;
}

const normalize = (value: string) =>
	value
		.trim()
		.replace(/[.!?]+$/, "")
		.split(/\s+/)
		.join(" ")
		.toLowerCase();

function distinct(values: string[]) {
	return new Set(values.map(normalize)).size === values.length;
}

/** Drops empty option rows and fills derived fields before saving. */
export function prepare(question: HomeworkAnswer): HomeworkAnswer {
	const trim = (values: string[] = []) => values.map((v) => v.trim()).filter(Boolean);
	const out = new HomeworkAnswer({
		...question,
		kind: kindOf(question),
		question: question.question.trim(),
		answer: question.answer.trim(),
		explanation: (question.explanation ?? "").trim(),
		choices: trim(question.choices),
		say: (question.say ?? "").trim(),
	});
	if (out.kind === "matching") {
		const pairs = (question.items ?? [])
			.map((item, i) => [item.trim(), (question.answers?.[i] ?? "").trim()] as const)
			.filter(([item, answer]) => item || answer);
		out.items = pairs.map(([item]) => item);
		out.answers = pairs.map(([, answer]) => answer);
	} else out.answers = trim(question.answers);
	if (out.kind === "true_false") out.choices = ["True", "False"];
	return out;
}

/** Guardian-facing problem with a prepared question, or "" when it can be saved and assigned. */
export function problem(q: HomeworkAnswer): string {
	if (!q.question) return "Write the question.";
	const inChoices = (value: string) => q.choices.some((c) => normalize(c) === normalize(value));
	switch (q.kind) {
		case "spelling":
			if (!/^[\p{L}'-]{1,40}$/u.test(q.answer)) return "Enter one word to spell.";
			if (
				normalize(q.question)
					.split(/[^\p{L}'-]+/u)
					.includes(normalize(q.answer))
			)
				return "Don't show the spelling word in the question; it is read aloud instead.";
			return "";
		case "multiple_choice":
			if (q.choices.length < 2 || !distinct(q.choices))
				return "Add at least two different options.";
			return inChoices(q.answer) ? "" : "Mark the correct option.";
		case "choose_many":
			if (q.choices.length < 2 || !distinct(q.choices))
				return "Add at least two different options.";
			return q.answers.length && q.answers.every(inChoices)
				? ""
				: "Tick at least one correct option.";
		case "true_false":
			return inChoices(q.answer) ? "" : "Choose True or False.";
		case "matching":
			if (q.items.length < 2 || q.items.length !== q.answers.length)
				return "Add at least two complete pairs.";
			if (q.items.some((v) => !v) || q.answers.some((v) => !v))
				return "Fill in both sides of every pair.";
			return distinct(q.items) && distinct(q.answers)
				? ""
				: "Each side of the pairs must be different.";
		default:
			return q.answer ? "" : "Enter the answer.";
	}
}

/** Readable answer for guardians, e.g. "Puppy → Dog; Kitten → Cat". */
export function answerSummary(q: HomeworkAnswer): string {
	switch (kindOf(q)) {
		case "choose_many":
			return q.answers.join(", ") || q.answer;
		case "matching":
			return q.items.map((item, i) => `${item} → ${q.answers[i] ?? ""}`).join("; ") || q.answer;
		case "short_answer":
			return [q.answer, ...q.answers].filter(Boolean).join(" or ");
		default:
			return q.answer;
	}
}

/** Encodes a child's selection the way the server grades it. */
export function encodeResponse(value: string | string[]): string {
	return Array.isArray(value) ? JSON.stringify(value) : value;
}

/** Child-facing rendering of a stored response (JSON lists become "a, b"). */
export function responseText(answer: string): string {
	try {
		const parsed: unknown = JSON.parse(answer);
		if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string"))
			return parsed.join(", ");
	} catch {
		// Plain text answers are shown as typed.
	}
	return answer;
}

/** Compares question lists as guardians see them, ignoring derived summaries. */
export function sameQuestions(a: HomeworkAnswer[], b: HomeworkAnswer[]): boolean {
	const key = (list: HomeworkAnswer[]) =>
		JSON.stringify(
			list.map(prepare).map((q) => ({
				...q,
				answer: q.kind === "choose_many" || q.kind === "matching" ? "" : q.answer,
				choices: q.kind === "matching" ? [] : q.choices,
			})),
		);
	return key(a) === key(b);
}

/** True when there is at least one question and every one is complete enough to assign. */
export function questionsReady(questions: HomeworkAnswer[]): boolean {
	return questions.length > 0 && questions.every((q) => !problem(prepare(q)));
}
