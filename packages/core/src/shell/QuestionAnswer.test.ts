import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import { PracticeQuestion, PracticeQuestionKind as Kind } from "../api/protocol";
import QuestionAnswer from "./QuestionAnswer.svelte";
afterEach(cleanup);

function setup(question: Partial<PracticeQuestion>, speak = vi.fn()) {
	const onchange = vi.fn();
	const view = render(QuestionAnswer, {
		question: new PracticeQuestion({ position: 1, prompt: "Question", ...question }),
		onchange,
		output: { speak, stop: vi.fn() },
	});
	return { onchange, speak, view };
}

it("types an answer for typed questions and reports when it is ready", async () => {
	const { onchange } = setup({ kind: Kind.SHORT_ANSWER });
	expect(onchange).toHaveBeenLastCalledWith("", false);
	await fireEvent.input(screen.getByLabelText("Your answer"), { target: { value: " 7 " } });
	expect(onchange).toHaveBeenLastCalledWith(" 7 ", true);
});

it("picks one option or true/false by tapping", async () => {
	const { onchange } = setup({ kind: Kind.MULTIPLE_CHOICE, choices: ["Cat", "Dog"] });
	await fireEvent.click(screen.getByRole("radio", { name: "Dog" }));
	expect(onchange).toHaveBeenLastCalledWith("Dog", true);
	cleanup();
	const tf = setup({ kind: Kind.TRUE_FALSE, choices: ["True", "False"] });
	await fireEvent.click(screen.getByRole("radio", { name: "False" }));
	expect(tf.onchange).toHaveBeenLastCalledWith("False", true);
});

it("sends every ticked option in display order for choose-many", async () => {
	const { onchange } = setup({ kind: Kind.CHOOSE_MANY, choices: ["2", "3", "4"] });
	await fireEvent.click(screen.getByRole("checkbox", { name: "4" }));
	await fireEvent.click(screen.getByRole("checkbox", { name: "2" }));
	expect(onchange).toHaveBeenLastCalledWith('["2","4"]', true);
	await fireEvent.click(screen.getByRole("checkbox", { name: "2" }));
	await fireEvent.click(screen.getByRole("checkbox", { name: "4" }));
	expect(onchange).toHaveBeenLastCalledWith("[]", false);
});

it("is ready for matching only once every item has a match", async () => {
	const { onchange } = setup({
		kind: Kind.MATCHING,
		items: ["Puppy", "Kitten"],
		choices: ["Cat", "Dog"],
	});
	await fireEvent.change(screen.getByLabelText("Puppy"), { target: { value: "Dog" } });
	expect(onchange).toHaveBeenLastCalledWith('["Dog",""]', false);
	await fireEvent.change(screen.getByLabelText("Kitten"), { target: { value: "Cat" } });
	expect(onchange).toHaveBeenLastCalledWith('["Dog","Cat"]', true);
});

it("reads spelling words aloud and explains when the device has no voice", async () => {
	const speak = vi.fn((_text: string, _done: () => void, fail: () => void) => fail());
	const { onchange } = setup({ kind: Kind.SPELLING, say: "Banana. I ate a banana." }, speak);
	await fireEvent.click(screen.getByRole("button", { name: "Hear the word" }));
	expect(speak).toHaveBeenCalledWith(
		"Banana. I ate a banana.",
		expect.any(Function),
		expect.any(Function),
	);
	expect(screen.getByRole("status")).toHaveTextContent("can't read the word aloud");
	await fireEvent.input(screen.getByLabelText("Your answer"), { target: { value: "banana" } });
	expect(onchange).toHaveBeenLastCalledWith("banana", true);
	cleanup();
	// AI spelling practice uses a written clue, so there is nothing to read aloud.
	setup({ kind: Kind.SPELLING, say: "" });
	expect(screen.queryByRole("button", { name: "Hear the word" })).toBeNull();
});

it("focuses the first control and accepts a voice draft", async () => {
	const { view, onchange } = setup({ kind: Kind.SHORT_ANSWER });
	const api = view.component as unknown as { focus(): void; set(value: string): void };
	api.focus();
	expect(screen.getByLabelText("Your answer")).toHaveFocus();
	api.set("seven");
	await vi.waitFor(() => expect(onchange).toHaveBeenLastCalledWith("seven", true));
});

it("silences the word when the question changes or goes away", async () => {
	const output = { speak: vi.fn(), stop: vi.fn() };
	const question = (say: string) =>
		new PracticeQuestion({
			position: 1,
			prompt: "Spell it",
			kind: Kind.SPELLING,
			say,
		});
	const view = render(QuestionAnswer, {
		question: question("apple"),
		output,
		onchange: vi.fn(),
	});
	await fireEvent.click(screen.getByRole("button", { name: "Hear the word" }));
	expect(output.speak).toHaveBeenCalledWith("apple", expect.any(Function), expect.any(Function));
	await view.rerender({ question: question("pear"), output, onchange: vi.fn() });
	expect(output.stop).toHaveBeenCalled();
	const stops = output.stop.mock.calls.length;
	view.unmount();
	expect(output.stop.mock.calls.length).toBeGreaterThan(stops);
});
