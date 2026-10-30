import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import HomeworkCreator from "./HomeworkCreator.svelte";
import WorksheetParser from "./WorksheetParser.svelte";
import HomeworkQuestions from "./HomeworkQuestions.svelte";
import { DEFAULT_PARSER_YAML } from "../homework/questions";
import type { Runtime } from "../runtime/registry.svelte";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function runtime(homework: Record<string, unknown>) {
	return { services: { homework } } as unknown as Runtime;
}

it("offers typed and uploaded homework sources and validates the upload", async () => {
	const homework = {
		createText: vi.fn(async () => {}),
		generateDraft: vi.fn(),
		upload: vi.fn(),
	};
	render(HomeworkCreator, {
		props: { profileId: "child", oncreated: vi.fn(async () => {}) },
		context: new Map([["vulture:runtime", runtime(homework)]]),
	});
	await fireEvent.click(screen.getByRole("button", { name: /Manually/ }));
	await fireEvent.click(screen.getByRole("button", { name: "Next step" }));
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Choose a homework source",
	);
	expect(screen.getByRole("button", { name: /Type it/ })).toBeVisible();
	expect(screen.queryByRole("button", { name: /Email/ })).toBeNull();
	expect(screen.queryByRole("button", { name: /Web page/ })).toBeNull();
	await fireEvent.click(screen.getByRole("button", { name: /Upload/ }));
	expect(screen.getByRole("heading", { name: "Upload a worksheet" })).toBeVisible();
	const form = screen.getByRole("button", { name: "Read worksheet" }).closest("form")!;
	await fireEvent.submit(form);
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Enter a title and subject",
	);
	await fireEvent.input(screen.getByLabelText("Homework title"), { target: { value: "Research" } });
	await fireEvent.input(screen.getByLabelText("Homework subject"), {
		target: { value: "Science" },
	});
	await fireEvent.submit(form);
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Choose a worksheet file",
	);
	expect(homework.upload).not.toHaveBeenCalled();
});

it("requires AI consent, generates a reviewable answer key, and saves it", async () => {
	const homework = {
		createText: vi.fn(async () => {}),
		generateDraft: vi.fn(async () => ({
			title: "Adding",
			questions: [{ question: "2+2?", answer: "4", explanation: "Add two pairs." }],
		})),
	};
	render(HomeworkCreator, {
		props: {
			profileId: "child",
			oncreated: vi.fn(async () => {}),
		},
		context: new Map([["vulture:runtime", runtime(homework)]]),
	});
	await fireEvent.click(screen.getByRole("button", { name: /Automatically/ }));
	await fireEvent.submit(
		screen.getByRole("button", { name: "Generate homework" }).closest("form")!,
	);
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		/allow AI generation/,
	);
	await fireEvent.input(screen.getByLabelText("Topic"), { target: { value: "Addition" } });
	await fireEvent.input(screen.getByLabelText("Subject", { exact: true }), {
		target: { value: "Math" },
	});
	await fireEvent.input(screen.getByLabelText(/Context/), { target: { value: "Beginner" } });
	await fireEvent.input(screen.getByLabelText("Number of questions"), { target: { value: "3" } });
	await fireEvent.click(screen.getByRole("checkbox"));
	await fireEvent.click(screen.getByRole("button", { name: "Generate homework" }));
	expect(await screen.findByDisplayValue("2+2?")).toBeVisible();
	await fireEvent.input(screen.getByLabelText("Answer"), { target: { value: "Four" } });
	expect(screen.getByLabelText("Answer")).toHaveValue("Four");
	await fireEvent.click(screen.getByRole("button", { name: "Previous step" }));
	await fireEvent.click(screen.getByRole("button", { name: "Generate homework" }));
	await fireEvent.click(screen.getByRole("button", { name: "Save homework" }));
	await waitFor(() =>
		expect(homework.createText).toHaveBeenCalledWith("child", "Adding", "Math", "", [
			expect.objectContaining({
				kind: "short_answer",
				question: "2+2?",
				answer: "4",
				explanation: "Add two pairs.",
			}),
		]),
	);
});

it("requires current parser review before an upload can be saved", async () => {
	const homework = {
		upload: vi.fn(async () => {}),
		parseWorksheet: vi.fn(async () => ({ segments: [], questions: [], warnings: [] })),
	};
	render(HomeworkCreator, {
		props: {
			profileId: "child",
			oncreated: vi.fn(async () => {}),
		},
		context: new Map([["vulture:runtime", runtime(homework)]]),
	});
	await fireEvent.click(screen.getByRole("button", { name: /Manually/ }));
	await fireEvent.click(screen.getByRole("button", { name: /Upload/ }));
	await fireEvent.input(screen.getByLabelText("Homework title"), {
		target: { value: "Worksheet" },
	});
	await fireEvent.input(screen.getByLabelText("Homework subject"), { target: { value: "Math" } });
	await fireEvent.submit(screen.getByRole("button", { name: "Read worksheet" }).closest("form")!);
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Choose a worksheet file",
	);
	vi.stubGlobal("URL", { createObjectURL: () => "blob:worksheet", revokeObjectURL: vi.fn() });
	await fireEvent.change(screen.getByLabelText("Worksheet file"), {
		target: { files: [new File(["png"], "sheet.png", { type: "image/png" })] },
	});
	await fireEvent.submit(screen.getByRole("button", { name: "Read worksheet" }).closest("form")!);
	await fireEvent.click(await screen.findByRole("button", { name: "Save homework" }));
	expect(
		await screen.findByText(/Apply the current YAML parser and review the extracted questions/),
	).toBeVisible();
});

it("applies local parsing and AI-assisted rules, then renders every worksheet view", async () => {
	const result = {
		segments: [
			{
				pageNumber: 1,
				region: [1, 2, 3, 4],
				text: "Question line",
				words: [{ text: "Question", region: [1, 2, 3, 4] }],
			},
		],
		questions: [{ question: "Q1", answer: "", explanation: "Reason" }],
		warnings: ["Answer missing"],
	};
	const homework = {
		parseWorksheet: vi.fn(async () => result),
		suggestParser: vi.fn(async () => DEFAULT_PARSER_YAML),
	};
	render(WorksheetParser, {
		props: {
			profileId: "child",
			file: new File(["png"], "sheet.png", { type: "image/png" }),
			rawUrl: "blob:sheet",
			rawType: "image/png",
		},
		context: new Map([["vulture:runtime", runtime(homework)]]),
	});
	await fireEvent.click(screen.getByRole("button", { name: "Apply YAML parser" }));
	expect(await screen.findByText("Not found in worksheet")).toBeVisible();
	await fireEvent.click(screen.getByRole("button", { name: "I don’t know how to write a parser" }));
	await fireEvent.click(screen.getByRole("button", { name: "Write parser with AI" }));
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		/Allow AI/,
	);
	await fireEvent.click(screen.getByRole("checkbox"));
	await fireEvent.input(screen.getByLabelText(/Describe the layout/), {
		target: { value: "questions left" },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Write parser with AI" }));
	await waitFor(() => expect(homework.suggestParser).toHaveBeenCalled());
	await fireEvent.click(screen.getByRole("tab", { name: "Parser YAML" }));
	await fireEvent.click(screen.getByRole("tab", { name: "Extracted text" }));
	expect(screen.getByText("Question line")).toBeVisible();
	await fireEvent.click(screen.getByText("Word coordinates"));
	await fireEvent.click(screen.getByRole("tab", { name: "Original" }));
	expect(screen.getByAltText("Worksheet preview: Worksheet")).toBeVisible();
	await fireEvent.click(screen.getByRole("tab", { name: "Q&A preview" }));
	expect(screen.getByText("Answer missing")).toBeVisible();
});

it("shows YAML validation errors and raw PDF content", async () => {
	render(HomeworkQuestions, {
		yaml: "not: [valid",
		questions: [],
		segments: [],
		rawUrl: "blob:pdf",
		rawType: "application/pdf",
	});
	await fireEvent.click(screen.getByRole("tab", { name: "Parser YAML" }));
	expect(screen.getByRole("alert")).toBeVisible();
	await fireEvent.click(screen.getByRole("tab", { name: "Original" }));
	expect(screen.getByTitle("Original worksheet PDF")).toHaveAttribute("src", "blob:pdf");
});

it("keeps the tab a guardian opened while the worksheet is still being read", async () => {
	let finish!: (value: unknown) => void;
	const homework = {
		parseWorksheet: vi.fn(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		),
	};
	render(WorksheetParser, {
		props: {
			profileId: "child",
			file: new File(["png"], "sheet.png", { type: "image/png" }),
			rawUrl: "blob:sheet",
			rawType: "image/png",
			autoApply: true,
		},
		context: new Map([["vulture:runtime", runtime(homework)]]),
	});
	await waitFor(() => expect(homework.parseWorksheet).toHaveBeenCalled());
	await fireEvent.click(screen.getByRole("tab", { name: "Original" }));
	finish({
		segments: [],
		questions: [{ question: "Q", answer: "A", explanation: "" }],
		warnings: [],
	});
	await waitFor(() =>
		expect(screen.getByRole("tab", { name: "Original" })).toHaveAttribute("aria-selected", "true"),
	);
	expect(screen.getByRole("img", { name: /Worksheet preview/ })).toBeVisible();
});
