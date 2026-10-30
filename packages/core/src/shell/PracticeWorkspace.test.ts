import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ApprovePracticeResponse,
	GeneratePracticeResponse,
	GetSourceSegmentsResponse,
	PracticeQuestionKind,
	SourceVersion,
	TutorPracticeResponse,
	UncertainPracticeAnswer,
} from "../api/protocol";
import Provider from "./TestPracticeProvider.svelte";
import { toastService } from "../services/toast.svelte";

afterEach(cleanup);
function draft(version = 1, reviewState = "draft", spelling = false) {
	return new GeneratePracticeResponse({
		practice: {
			practice: { id: "set", version },
			title: "Practice",
			reviewState,
		},
		questions: [
			{
				question: {
					position: 1,
					kind: spelling ? PracticeQuestionKind.SPELLING : PracticeQuestionKind.SHORT_ANSWER,
					prompt: spelling ? "Spell the fruit" : "What is 2 + 2?",
				},
				expectedAnswer: spelling ? "apple" : "4",
				hints: ["Count one group", "Count both groups"],
				sourceSegmentId: "region",
				sourceQuote: spelling ? "apple" : "Add 2 + 2",
				a: 2n,
				b: 2n,
				operation: "add",
			},
		],
	});
}
function services(sets: GeneratePracticeResponse[] = [], state = "confirmed") {
	return {
		practice: {
			list: vi.fn().mockResolvedValue(sets),
			generate: vi.fn(),
			revise: vi.fn(),
			approve: vi.fn(),
			tutor: vi.fn(),
			uncertain: vi.fn().mockResolvedValue([]),
		},
		extraction: {
			load: vi.fn().mockResolvedValue(new GetSourceSegmentsResponse({ state })),
			extract: vi.fn(),
			confirm: vi.fn(),
		},
	};
}
async function select() {
	await fireEvent.click(await screen.findByRole("button", { name: "Practice · draft · v1" }));
	await waitFor(() => expect(screen.getByLabelText("Practice title")).toBeEnabled());
}

describe("Parent practice workspace", () => {
	it("shows assigned homework questions read-only and points back to the homework", async () => {
		const assigned = new GeneratePracticeResponse({
			practice: {
				practice: { id: "set", version: 2 },
				title: "Animals",
				reviewState: "approved",
				origin: "assigned",
			},
			questions: [
				{
					question: {
						position: 1,
						kind: PracticeQuestionKind.MATCHING,
						prompt: "Match the babies",
						items: ["Puppy", "Kitten"],
						choices: ["Cat", "Dog"],
					},
					expectedAnswer: "Puppy → Dog; Kitten → Cat",
					answers: ["Dog", "Cat"],
					explanation: "Young animals.",
				},
			],
		});
		render(Provider, services([assigned]));
		await fireEvent.click(await screen.findByRole("button", { name: "Animals · approved · v2" }));
		expect(screen.getByText(/edit the questions on the homework/)).toBeVisible();
		expect(screen.getByText("Puppy → Dog; Kitten → Cat")).toBeVisible();
		expect(screen.getByText("Matching")).toBeVisible();
		expect(screen.queryByLabelText("Practice title")).toBeNull();
		expect(screen.queryByRole("button", { name: "Approve practice set" })).toBeNull();
	});

	it("rejects decimal or exponential math edits without changing the stored arithmetic", async () => {
		const mocks = services([draft()]);
		render(Provider, mocks);
		await select();
		const first = screen.getByLabelText("First number 1");
		await fireEvent.input(first, { target: { value: "1.5" } });
		expect(screen.getAllByRole("alert").at(-1)).toHaveTextContent("Use whole numbers");
		expect(first).toHaveValue(2);
		expect(screen.getByLabelText("Prompt 1")).toHaveValue("What is 2 + 2?");
		await fireEvent.input(first, { target: { value: "1e3" } });
		expect(first).toHaveValue(2);
		await fireEvent.input(first, { target: { value: "3" } });
		toastService.clear();
		await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
		expect(screen.getByLabelText("Prompt 1")).toHaveValue("What is 3 + 2?");
		expect(screen.getByLabelText("Answer key 1")).toHaveValue("5");
	});

	it("disables operation and content edits while approval is pending", async () => {
		const mocks = services([draft()]);
		let finish!: (value: ApprovePracticeResponse) => void;
		mocks.practice.approve.mockReturnValue(
			new Promise<ApprovePracticeResponse>((resolve) => {
				finish = resolve;
			}),
		);
		render(Provider, mocks);
		await select();
		await fireEvent.click(screen.getByRole("button", { name: "Approve practice set" }));
		await waitFor(() => expect(mocks.practice.approve).toHaveBeenCalledOnce());
		for (const label of [
			"Operation 1",
			"First number 1",
			"Prompt 1",
			"Hint 1 for question 1",
			"Practice title",
		])
			expect(screen.getByLabelText(label)).toBeDisabled();
		finish(new ApprovePracticeResponse({ practice: draft(1, "approved").practice }));
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Preview tutor" })).toBeEnabled(),
		);
		expect(screen.getByLabelText("Prompt 1")).toHaveValue("What is 2 + 2?");
	});

	it("reviews the worksheet text first, then offers generation once it is approved", async () => {
		const mocks = services([], "review");
		const segment = {
			id: "region",
			pageNumber: 1,
			ordinal: 0,
			text: "Add 2 + 2",
			confidence: 0.9,
			region: [0, 0, 10, 10],
		};
		mocks.extraction.load.mockResolvedValueOnce(
			new GetSourceSegmentsResponse({ state: "review", segments: [segment] }),
		);
		mocks.extraction.load.mockResolvedValueOnce(
			new GetSourceSegmentsResponse({ state: "review", segments: [segment] }),
		);
		mocks.extraction.confirm.mockResolvedValue(
			new GetSourceSegmentsResponse({ state: "confirmed", segments: [segment] }),
		);
		render(Provider, mocks);
		expect(await screen.findByText(/Step 1 of 2: check the worksheet text/)).toBeVisible();
		expect(screen.queryByRole("button", { name: "Generate practice draft" })).toBeNull();
		mocks.extraction.load.mockResolvedValue(
			new GetSourceSegmentsResponse({ state: "confirmed", segments: [segment] }),
		);
		await fireEvent.click(
			await screen.findByRole("button", { name: "Approve corrected source text" }),
		);
		const generate = await screen.findByRole("button", { name: "Generate practice draft" });
		expect(generate).toBeDisabled();
		expect(screen.queryByText(/Step 1 of 2/)).toBeNull();
		expect(mocks.practice.generate).not.toHaveBeenCalled();
	});

	it("requires explicit opt-in and stops new generation when unchecked", async () => {
		const mocks = services();
		render(Provider, mocks);
		const consent = await screen.findByRole("checkbox", { name: /I allow AI/ });
		const generate = await screen.findByRole("button", {
			name: "Generate practice draft",
		});
		expect(consent).not.toBeChecked();
		expect(generate).toBeDisabled();
		await fireEvent.click(consent);
		expect(generate).toBeEnabled();
		await fireEvent.click(consent);
		expect(generate).toBeDisabled();
		expect(mocks.practice.generate).not.toHaveBeenCalled();
	});

	it("clears provider errors after retry and selects generated draft", async () => {
		const mocks = services();
		mocks.practice.generate
			.mockRejectedValueOnce(new Error("Provider unavailable"))
			.mockResolvedValue(draft());
		render(Provider, mocks);
		await fireEvent.click(await screen.findByRole("checkbox", { name: /I allow AI/ }));
		await fireEvent.click(await screen.findByRole("button", { name: "Generate practice draft" }));
		expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
			"Provider unavailable",
		);
		await fireEvent.click(await screen.findByRole("button", { name: "Generate practice draft" }));
		await screen.findByLabelText("Practice title");
		expect(screen.getByRole("checkbox", { name: /I allow AI/ })).not.toBeChecked();
		toastService.clear();
		await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
		expect(mocks.practice.generate).toHaveBeenLastCalledWith(
			new SourceVersion({ id: "source", version: 2 }),
			"math",
			"standard",
			6,
			true,
		);
		expect(screen.getByRole("button", { name: "Preview tutor" })).toBeDisabled();
	});

	it("saves title and hint corrections as a new draft before approval", async () => {
		const mocks = services([draft()]);
		const next = draft(2);
		next.practice!.title = "Corrected practice";
		next.questions[0].hints[0] = "Count each group";
		mocks.practice.revise.mockResolvedValue(next);
		mocks.practice.approve.mockResolvedValue(
			new ApprovePracticeResponse({
				practice: { ...next.practice, reviewState: "approved" },
			}),
		);
		render(Provider, mocks);
		await select();
		await fireEvent.input(screen.getByLabelText("Practice title"), {
			target: { value: "Corrected practice" },
		});
		await fireEvent.input(screen.getByLabelText("Hint 1 for question 1"), {
			target: { value: "Count each group" },
		});
		expect(screen.getByRole("button", { name: "Approve practice set" })).toBeDisabled();
		await fireEvent.click(screen.getByRole("button", { name: "Save practice edits as draft" }));
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Approve practice set" })).toBeEnabled(),
		);
		expect(mocks.practice.revise).toHaveBeenCalledWith(
			expect.objectContaining({ id: "set", version: 1 }),
			"Corrected practice",
			[
				expect.objectContaining({
					hints: ["Count each group", "Count both groups"],
				}),
			],
			false,
		);
		await fireEvent.click(screen.getByRole("button", { name: "Approve practice set" }));
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Preview tutor" })).toBeEnabled(),
		);
		expect(mocks.practice.approve).toHaveBeenCalledWith(expect.objectContaining({ version: 2 }));
	});

	it("edits spelling keys and rejects without enabling approval or tutor", async () => {
		const mocks = services([draft(1, "draft", true)]);
		mocks.practice.revise.mockResolvedValue(draft(2, "rejected", true));
		render(Provider, { ...mocks, subject: "Spelling" });
		await select();
		expect(screen.getByLabelText("Answer key 1")).not.toHaveAttribute("readonly");
		expect(screen.queryByLabelText("First number 1")).toBeNull();
		await fireEvent.input(screen.getByLabelText("Answer key 1"), {
			target: { value: "pear" },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Reject practice set" }));
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Reject practice set" })).toBeDisabled(),
		);
		expect(mocks.practice.revise).toHaveBeenCalledWith(
			expect.objectContaining({ version: 1 }),
			"Practice",
			[expect.objectContaining({ expectedAnswer: "pear" })],
			true,
		);
		expect(screen.getByRole("button", { name: "Approve practice set" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "Preview tutor" })).toBeDisabled();
	});

	it("shows two hints before revealing the answer and queues uncertain grading", async () => {
		const set = draft(1, "approved");
		const mocks = services([set]);
		const question = set.questions[0].question;
		mocks.practice.tutor
			.mockResolvedValueOnce(new TutorPracticeResponse({ sessionId: "session", question }))
			.mockResolvedValueOnce(
				new TutorPracticeResponse({
					sessionId: "session",
					question,
					hint: "Count one group",
				}),
			)
			.mockResolvedValueOnce(
				new TutorPracticeResponse({
					sessionId: "session",
					question,
					hint: "Count both groups",
				}),
			)
			.mockResolvedValueOnce(
				new TutorPracticeResponse({
					sessionId: "session",
					question,
					revealedAnswer: "4",
				}),
			)
			.mockResolvedValueOnce(
				new TutorPracticeResponse({
					sessionId: "session",
					question,
					result: "needs_review",
				}),
			);
		render(Provider, mocks);
		await fireEvent.click(await screen.findByRole("button", { name: "Practice · approved · v1" }));
		await fireEvent.click(screen.getByRole("button", { name: "Preview tutor" }));
		await screen.findByRole("region", { name: "Tutor preview" });
		for (const hint of ["Count one group", "Count both groups"]) {
			await fireEvent.click(await screen.findByRole("button", { name: "Get next hint" }));
			await screen.findByText(`Hint: ${hint}`);
			expect(screen.queryByText("Answer: 4")).toBeNull();
			await waitFor(() =>
				expect(screen.getByRole("button", { name: "Check answer" })).toBeEnabled(),
			);
		}
		await fireEvent.click(screen.getByRole("button", { name: "Show answer after hints" }));
		await screen.findByText("Answer: 4");
		expect(screen.getByRole("button", { name: "Show answer after hints" })).toBeDisabled();
		await waitFor(() => expect(screen.getByRole("button", { name: "Check answer" })).toBeEnabled());
		mocks.practice.uncertain.mockResolvedValue([
			new UncertainPracticeAnswer({
				prompt: "What is 2 + 2?",
				answer: "four things",
				position: 1,
				sessionId: "session",
			}),
		]);
		await fireEvent.input(screen.getByLabelText("Tutor answer"), {
			target: { value: "four things" },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
		await screen.findByText("Uncertain grading — parent review needed");
		expect(
			await screen.findByRole("list", {
				name: "Answers needing parent review",
			}),
		).toHaveTextContent("four things · Parent review needed");
		expect(mocks.practice.tutor).toHaveBeenLastCalledWith(
			expect.objectContaining({ version: 1 }),
			"session",
			1,
			"four things",
			false,
		);
	});
});
