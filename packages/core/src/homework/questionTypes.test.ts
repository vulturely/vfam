import { describe, expect, it } from "vitest";
import { HomeworkAnswer, PracticeQuestionKind } from "../api/protocol";
import {
	QUESTION_KINDS,
	answerSummary,
	blankQuestion,
	changeKind,
	encodeResponse,
	kindLabel,
	kindOf,
	practiceKind,
	prepare,
	problem,
	responseText,
} from "./questionTypes";

const q = (data: Partial<HomeworkAnswer>) => prepare(new HomeworkAnswer(data));

describe("question types", () => {
	it("maps delivered kinds and treats unknown or legacy kinds as typed answers", () => {
		expect(practiceKind(PracticeQuestionKind.MATCHING)).toBe("matching");
		expect(practiceKind(PracticeQuestionKind.CHOOSE_MANY)).toBe("choose_many");
		expect(practiceKind(PracticeQuestionKind.SHORT_ANSWER)).toBe("short_answer");
		expect(practiceKind(PracticeQuestionKind.UNSPECIFIED)).toBe("short_answer");
		expect(kindOf(new HomeworkAnswer({ kind: "" }))).toBe("short_answer");
		expect(kindOf(new HomeworkAnswer({ kind: "essay" }))).toBe("short_answer");
		expect(kindLabel(new HomeworkAnswer({ kind: "true_false" }))).toBe("True or false");
		expect(QUESTION_KINDS).toHaveLength(6);
	});

	it("starts each kind with rows to fill and keeps text when switching", () => {
		expect(blankQuestion("multiple_choice").choices).toEqual(["", "", ""]);
		expect(blankQuestion("true_false").choices).toEqual(["True", "False"]);
		expect(blankQuestion("matching").items).toEqual(["", ""]);
		expect(blankQuestion("spelling").question).toBe("Spell the word you hear.");
		const switched = changeKind(
			new HomeworkAnswer({ question: "Pick one", explanation: "Why", answer: "x" }),
			"multiple_choice",
		);
		expect(switched).toMatchObject({ question: "Pick one", explanation: "Why", answer: "" });
		expect(changeKind(new HomeworkAnswer({ question: " " }), "spelling").question).toBe(
			"Spell the word you hear.",
		);
	});

	it("prepares questions by trimming, dropping empty rows and fixing true/false options", () => {
		const prepared = q({
			kind: "matching",
			question: " Match ",
			items: [" Puppy ", "", "Kitten"],
			answers: ["Dog", "", " Cat "],
		});
		expect(prepared).toMatchObject({
			question: "Match",
			items: ["Puppy", "Kitten"],
			answers: ["Dog", "Cat"],
		});
		expect(q({ kind: "true_false", choices: [] }).choices).toEqual(["True", "False"]);
		expect(q({ kind: "multiple_choice", choices: ["A", " ", "B "] }).choices).toEqual(["A", "B"]);
		// Questions from older servers may lack the newer list fields.
		const legacy = prepare({ question: "Q", answer: "A" } as unknown as HomeworkAnswer);
		expect(legacy).toMatchObject({ kind: "short_answer", choices: [], answers: [], say: "" });
	});

	it("explains what each kind still needs", () => {
		expect(problem(q({ question: "" }))).toMatch(/Write the question/);
		expect(problem(q({ question: "2+2", answer: "" }))).toMatch(/Enter the answer/);
		expect(problem(q({ question: "2+2", answer: "4" }))).toBe("");
		expect(problem(q({ kind: "spelling", question: "Spell it", answer: "two words" }))).toMatch(
			/one word/,
		);
		expect(problem(q({ kind: "spelling", question: "Spell banana", answer: "banana" }))).toMatch(
			/read aloud/,
		);
		expect(problem(q({ kind: "spelling", question: "Spell it", answer: "banana" }))).toBe("");
		// Only the whole word counts: "he" is not shown by "hear".
		expect(
			problem(q({ kind: "spelling", question: "Spell the word you hear.", answer: "he" })),
		).toBe("");
		const options = { question: "Pick", choices: ["Cat", "Dog"] };
		expect(problem(q({ kind: "multiple_choice", ...options, choices: ["Cat"] }))).toMatch(
			/two different/,
		);
		expect(problem(q({ kind: "multiple_choice", ...options, answer: "Cow" }))).toMatch(/Mark/);
		expect(problem(q({ kind: "multiple_choice", ...options, answer: "dog" }))).toBe("");
		expect(problem(q({ kind: "choose_many", ...options, choices: ["Cat", "cat"] }))).toMatch(
			/two different/,
		);
		expect(problem(q({ kind: "choose_many", ...options, answers: [] }))).toMatch(/Tick/);
		expect(problem(q({ kind: "choose_many", ...options, answers: ["Cat"] }))).toBe("");
		expect(problem(q({ kind: "true_false", question: "Sky is blue", answer: "" }))).toMatch(
			/True or False/,
		);
		expect(problem(q({ kind: "true_false", question: "Sky is blue", answer: "True" }))).toBe("");
		const pairs = { kind: "matching", question: "Match" };
		expect(problem(q({ ...pairs, items: ["A"], answers: ["1"] }))).toMatch(/two complete/);
		expect(
			problem(prepare(new HomeworkAnswer({ ...pairs, items: ["A", "B"], answers: ["1", ""] }))),
		).toMatch(/both sides/);
		expect(problem(q({ ...pairs, items: ["A", "a"], answers: ["1", "2"] }))).toMatch(/different/);
		expect(problem(q({ ...pairs, items: ["A", "B"], answers: ["1", "2"] }))).toBe("");
	});

	it("summarises answers for guardians and encodes child responses", () => {
		expect(answerSummary(q({ question: "Q", answer: "7", answers: ["seven"] }))).toBe("7 or seven");
		expect(answerSummary(q({ kind: "choose_many", answers: ["2", "4"] }))).toBe("2, 4");
		expect(answerSummary(new HomeworkAnswer({ kind: "choose_many", answer: "2, 4" }))).toBe("2, 4");
		expect(
			answerSummary(q({ kind: "matching", items: ["Puppy", "Kitten"], answers: ["Dog", "Cat"] })),
		).toBe("Puppy → Dog; Kitten → Cat");
		expect(answerSummary(new HomeworkAnswer({ kind: "matching", answer: "A → 1" }))).toBe("A → 1");
		expect(answerSummary(q({ kind: "spelling", answer: "banana" }))).toBe("banana");
		expect(encodeResponse(["a", "b"])).toBe('["a","b"]');
		expect(encodeResponse("seven")).toBe("seven");
		expect(responseText('["Dog","Cat"]')).toBe("Dog, Cat");
		expect(responseText("[1,2]")).toBe("[1,2]");
		expect(responseText("seven")).toBe("seven");
	});
});
