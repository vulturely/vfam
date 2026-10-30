import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import { GetHomeworkResponse, HomeworkAnswer, HomeworkMediaType } from "../api/protocol";
import type { Runtime } from "../runtime/registry.svelte";
import HomeworkEdit from "./HomeworkEdit.svelte";
afterEach(cleanup);

function homework(answerKey: Partial<HomeworkAnswer>[] = [], mediaType = HomeworkMediaType.TEXT) {
	return new GetHomeworkResponse({
		homework: { id: "hw", title: "Animals", subject: "Science" },
		sources: [{ source: { id: "src", version: 2 }, mediaType }],
		answerKey: answerKey.map((q) => new HomeworkAnswer(q)),
	});
}

function setup(item = homework(), content = "Read page 4.") {
	const update = vi.fn<(...args: unknown[]) => Promise<typeof item>>(async () => item);
	const onsaved = vi.fn();
	const oncancel = vi.fn();
	render(HomeworkEdit, {
		props: { item, content, onsaved, oncancel },
		context: new Map([
			["vulture:runtime", { services: { homework: { update } } } as unknown as Runtime],
		]),
	});
	return { update, onsaved, oncancel };
}

const question = (n: number) => screen.getByRole("group", { name: `Question ${n}` });
const type = async (n: number, kind: string) =>
	fireEvent.change(within(question(n)).getByLabelText("Type"), { target: { value: kind } });
const fill = async (n: number, label: string | RegExp, value: string) =>
	fireEvent.input(within(question(n)).getByLabelText(label), { target: { value } });
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save homework changes" }));

it("edits the title, subject, instructions and questions of typed homework in one form", async () => {
	const { update, onsaved } = setup(homework([{ question: "3 + 4", answer: "7" }]));
	expect(screen.queryByRole("button", { name: "Save homework changes" })).toBeNull();
	await fireEvent.input(screen.getByLabelText("Homework title"), { target: { value: "Sums" } });
	await fireEvent.input(screen.getByLabelText("Homework instructions"), {
		target: { value: "Use your fingers." },
	});
	expect(screen.getByText(/Assign the questions again/)).toBeVisible();
	await fill(1, "Answer", "seven");
	await fill(1, /Other accepted answers/, "7, ");
	await fill(1, /^Explanation/, "Count on four.");
	await save();
	await waitFor(() => expect(update).toHaveBeenCalled());
	expect(update).toHaveBeenCalledWith(
		"hw",
		expect.objectContaining({ version: 2 }),
		"Sums",
		"Science",
		"Use your fingers.",
		[
			expect.objectContaining({
				kind: "short_answer",
				question: "3 + 4",
				answer: "seven",
				answers: ["7"],
				explanation: "Count on four.",
			}),
		],
	);
	expect(onsaved).toHaveBeenCalled();
});

it("leaves unchanged questions alone so worksheet titles can be edited", async () => {
	const { update } = setup(
		homework([{ question: "Extracted question", answer: "" }], HomeworkMediaType.PNG),
	);
	expect(screen.getByLabelText("Question")).toHaveValue("Extracted question");
	await fireEvent.input(screen.getByLabelText("Homework title"), { target: { value: "Renamed" } });
	await save();
	await waitFor(() => expect(update).toHaveBeenCalled());
	expect(update).toHaveBeenCalledWith(
		"hw",
		expect.anything(),
		"Renamed",
		"Science",
		undefined,
		undefined,
	);
});

it("hides the questions when a new worksheet file replaces the old one", async () => {
	const { update } = setup(homework([{ question: "Q", answer: "A" }], HomeworkMediaType.PNG));
	const file = new File(["png"], "new.png", { type: "image/png" });
	await fireEvent.change(screen.getByLabelText(/Replace worksheet/), { target: { files: [file] } });
	expect(screen.getByText(/clears the questions/)).toBeVisible();
	expect(screen.queryByRole("group", { name: "Question 1" })).toBeNull();
	await save();
	await waitFor(() => expect(update).toHaveBeenCalled());
	expect(update.mock.calls[0]).toEqual([
		"hw",
		expect.anything(),
		"Animals",
		"Science",
		file,
		undefined,
	]);
});

it("cancels without saving", async () => {
	const { update, oncancel } = setup();
	await fireEvent.click(screen.getByRole("button", { name: "Cancel editing homework" }));
	expect(oncancel).toHaveBeenCalled();
	expect(update).not.toHaveBeenCalled();
});

it("edits every question type and blocks saving incomplete ones", async () => {
	const { update } = setup();
	for (let i = 0; i < 6; i++)
		await fireEvent.click(screen.getByRole("button", { name: "Add question" }));
	await type(1, "multiple_choice");
	await fill(1, "Question", "Which animal barks?");
	await fill(1, "Option 1", "Cat");
	await fill(1, "Option 2", "Dog");
	await fireEvent.click(within(question(1)).getByRole("button", { name: "Remove option 3" }));
	await fireEvent.click(within(question(1)).getByLabelText("Option 2 is correct"));
	await fill(1, "Option 2", "Doggo");
	await type(2, "choose_many");
	await fill(2, "Question", "Pick even numbers");
	await fill(2, "Option 1", "2");
	await fill(2, "Option 2", "3");
	await fireEvent.click(within(question(2)).getByRole("button", { name: "Add option" }));
	await fill(2, "Option 4", "4");
	await fireEvent.click(within(question(2)).getByLabelText("Option 1 is correct"));
	await fireEvent.click(within(question(2)).getByLabelText("Option 4 is correct"));
	await fireEvent.click(within(question(2)).getByLabelText("Option 2 is correct"));
	await fireEvent.click(within(question(2)).getByLabelText("Option 2 is correct"));
	await type(3, "true_false");
	await fill(3, "Question", "The sun is a star.");
	await fireEvent.click(within(question(3)).getByRole("radio", { name: "True" }));
	await type(4, "matching");
	await fill(4, "Question", "Match the babies");
	await fill(4, "Item 1", "Puppy");
	await fill(4, "Match for item 1", "Dog");
	await fill(4, "Item 2", "Kitten");
	await fireEvent.click(within(question(4)).getByRole("button", { name: "Add pair" }));
	await fireEvent.click(within(question(4)).getByRole("button", { name: "Remove pair 3" }));
	await type(5, "spelling");
	await fill(5, "Word to spell", "banana");
	await fill(5, /^Read aloud/, "Banana. I ate a banana.");
	await type(6, "short_answer");
	await fireEvent.click(within(question(6)).getByRole("button", { name: "Remove question 6" }));
	await fireEvent.click(screen.getByRole("button", { name: "Save homework changes" }));
	expect(screen.getByRole("alert")).toHaveTextContent("Fix the questions marked below.");
	expect(within(question(4)).getByText("Fill in both sides of every pair.")).toBeVisible();
	expect(update).not.toHaveBeenCalled();
	await fill(4, "Match for item 2", "Cat");
	await fireEvent.click(screen.getByRole("button", { name: "Save homework changes" }));
	await waitFor(() => expect(update).toHaveBeenCalled());
	expect(update.mock.calls[0][5]).toEqual([
		expect.objectContaining({
			kind: "multiple_choice",
			choices: ["Cat", "Doggo"],
			answer: "Doggo",
		}),
		expect.objectContaining({ kind: "choose_many", choices: ["2", "3", "4"], answers: ["2", "4"] }),
		expect.objectContaining({ kind: "true_false", choices: ["True", "False"], answer: "True" }),
		expect.objectContaining({
			kind: "matching",
			items: ["Puppy", "Kitten"],
			answers: ["Dog", "Cat"],
		}),
		expect.objectContaining({
			kind: "spelling",
			question: "Spell the word you hear.",
			answer: "banana",
			say: "Banana. I ate a banana.",
		}),
	]);
});

it("clears typed instructions so the questions stand on their own", async () => {
	const { update } = setup(homework([{ question: "3 + 4", answer: "7" }]), "Old instructions");
	await fireEvent.input(screen.getByLabelText("Homework instructions"), { target: { value: "" } });
	await save();
	await waitFor(() => expect(update).toHaveBeenCalled());
	expect(update.mock.calls[0]).toEqual([
		"hw",
		expect.anything(),
		"Animals",
		"Science",
		"",
		undefined,
	]);
});
