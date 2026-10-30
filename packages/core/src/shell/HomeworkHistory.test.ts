import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import HomeworkHistory from "./HomeworkHistory.svelte";
import type { ChildLearningService } from "../child-learning/service";
import {
	LearningAttempt,
	LearningSessionState as State,
	LearningAnswerResult as Result,
} from "../api/protocol";
afterEach(cleanup);
function attempt(id: string, state = State.COMPLETED) {
	return new LearningAttempt({
		homeworkTitle: "Fractions practice",
		subject: "Math",
		totalQuestions: 3,
		session: {
			id,
			profileId: "child",
			state,
			createdAt: "2026-10-19T12:00:00Z",
			updatedAt: "2026-10-19T12:04:32Z",
		},
		answers: [
			{
				id: "a",
				position: 1,
				prompt: "What is half of 8?",
				answer: "4",
				result: Result.CORRECT,
			},
			{
				id: "b",
				position: 2,
				prompt: "Explain your answer",
				answer: "I divided by two",
				result: Result.NEEDS_REVIEW,
			},
			{
				id: "c",
				position: 3,
				prompt: "Match each baby to its parent",
				answer: '["Dog","Cow","Cat"]',
				result: Result.INCORRECT,
				detail: "1 of 3 pairs",
			},
		],
	});
}
it("loads test summaries automatically and expands original answers with their outcomes", async () => {
	const review = vi.fn().mockResolvedValue([attempt("one")]);
	render(HomeworkHistory, {
		service: { review } as unknown as ChildLearningService,
		profileId: "child",
	});
	expect(await screen.findByText("Fractions practice")).toBeVisible();
	expect(review).toHaveBeenCalledExactlyOnceWith("child");
	expect(screen.getByText("Completed")).toBeVisible();
	expect(screen.getByText("4m 32s")).toBeVisible();
	expect(screen.getByText("1 needs review")).toBeVisible();
	expect(screen.queryByText("Your child's saved homework")).toBeNull();
	const summary = screen.getByText("Fractions practice").closest("summary")!;
	await fireEvent.click(summary);
	expect(screen.getByText("3 / 3 answered")).toBeVisible();
	expect(screen.getByText("What is half of 8?")).toBeVisible();
	expect(screen.getByText("I divided by two")).toBeVisible();
	// Structured answers read as a list, with how much was right.
	expect(screen.getByText("Dog, Cow, Cat")).toBeVisible();
	expect(screen.getByText("1 of 3 pairs")).toBeVisible();
});
it("does not show time to completion for ongoing tests or invalid timestamps", async () => {
	const active = attempt("active", State.ACTIVE);
	const invalid = attempt("stopped", State.CANCELLED);
	invalid.homeworkTitle = "Stopped test";
	invalid.session!.updatedAt = "invalid";
	render(HomeworkHistory, {
		service: {
			review: vi.fn().mockResolvedValue([active, invalid]),
		} as unknown as ChildLearningService,
		profileId: "child",
	});
	await screen.findByText("Stopped test");
	expect(screen.getAllByText("In progress")).toHaveLength(2);
	expect(screen.getByText("Stopped")).toBeVisible();
	expect(screen.getByText("Unavailable")).toBeVisible();
});
it("shows an empty state and allows retry after errors", async () => {
	const review = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([]);
	render(HomeworkHistory, {
		service: { review } as unknown as ChildLearningService,
		profileId: "child",
	});
	expect(await screen.findByRole("alert")).toHaveTextContent("Could not load test history");
	await fireEvent.click(screen.getByRole("button", { name: "Refresh test history" }));
	expect(await screen.findByText("No tests yet")).toBeVisible();
});
it("does not display another child's test returned by an unexpected response", async () => {
	const other = attempt("other");
	other.session!.profileId = "another-child";
	render(HomeworkHistory, {
		service: {
			review: vi.fn().mockResolvedValue([other]),
		} as unknown as ChildLearningService,
		profileId: "child",
	});
	expect(await screen.findByText("No tests yet")).toBeVisible();
});

it("shows attempts immediately with matching test rows and read-only answers", async () => {
	render(HomeworkHistory, {
		service: {
			review: vi.fn().mockResolvedValue([attempt("one")]),
		} as unknown as ChildLearningService,
		profileId: "child",
		mode: "attempts",
	});
	expect(await screen.findByText("What is half of 8?")).toBeVisible();
	expect(screen.getByRole("heading", { name: "Attempts", exact: true })).toBeVisible();
	expect(screen.getByText("I divided by two")).toBeVisible();
	expect(screen.getByRole("button", { name: "Refresh attempts" })).toBeVisible();
	expect(screen.queryByText(/Original answers are read-only/)).toBeNull();
	expect(screen.queryByRole("button", { name: "Review child attempts" })).toBeNull();
	expect(screen.queryByRole("textbox")).toBeNull();
});
