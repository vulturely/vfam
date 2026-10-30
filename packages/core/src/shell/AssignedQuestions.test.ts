import { cleanup, render, screen, within } from "@testing-library/svelte";
import { afterEach, expect, it } from "vitest";
import { GetHomeworkResponse, HomeworkAnswer } from "../api/protocol";
import AssignedQuestions from "./AssignedQuestions.svelte";
afterEach(cleanup);

function show(answerKey: Partial<HomeworkAnswer>[] = []) {
	render(AssignedQuestions, {
		item: new GetHomeworkResponse({
			homework: { id: "hw", title: "Animals", subject: "Science" },
			answerKey: answerKey.map((q) => new HomeworkAnswer(q)),
		}),
	});
}

it("explains how to add questions when there are none", () => {
	show();
	expect(screen.getByText(/No questions yet/)).toBeVisible();
});

it("shows each question with its answer", () => {
	show([
		{
			kind: "choose_many",
			question: "Pick even",
			choices: ["2", "3"],
			answers: ["2"],
			answer: "2",
		},
		{ kind: "matching", question: "Match", items: ["Puppy", "Kitten"], answers: ["Dog", "Cat"] },
		{ kind: "spelling", question: "Spell it", answer: "banana", say: "I ate a banana." },
		{ kind: "short_answer", question: "3 + 4", answer: "7", explanation: "Count on." },
	]);
	expect(screen.getByText("Puppy → Dog; Kitten → Cat")).toBeVisible();
	expect(screen.getByText("I ate a banana.")).toBeVisible();
	expect(screen.getByText("Count on.")).toBeVisible();
	expect(
		within(screen.getByRole("list", { name: "Options for question 1" })).getByText(/correct/),
	).toBeVisible();
	expect(screen.queryByText(/missing answers/)).toBeNull();
});

it("asks for missing answers on extracted questions", () => {
	show([{ question: "Extracted question", answer: "" }]);
	expect(screen.getByText(/missing answers/)).toBeVisible();
	expect(screen.getByText("Not found in worksheet")).toBeVisible();
});
