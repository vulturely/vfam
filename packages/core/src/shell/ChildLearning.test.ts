import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import ChildLearning from "./ChildLearning.svelte";
import LearningAttempts from "./LearningAttempts.svelte";
import {
	ChildPractice,
	GetLearningSessionResponse,
	LearningSessionState as State,
	LearningSessionAction as Action,
	LearningAnswerResult as Result,
	SubmitLearningAnswerResponse,
	LearningAttempt,
	PracticeQuestionKind,
} from "../api/protocol";
afterEach(cleanup);
function view(position = 1) {
	return new GetLearningSessionResponse({
		session: {
			id: "session",
			state: position > 2 ? State.COMPLETED : State.ACTIVE,
		},
		answered: position - 1,
		total: 2,
		question:
			position <= 2
				? {
						position,
						prompt: position === 1 ? "Spell the fruit" : "What is 2 + 2?",
						hintCount: 2,
					}
				: undefined,
		lastResult: position > 1 ? Result.CORRECT : undefined,
	});
}
function service(active = false) {
	return {
		list: vi.fn().mockResolvedValue([
			new ChildPractice({
				practice: { id: "set", version: 1 },
				title: "Practice",
				sessionId: active ? "session" : undefined,
				state: active ? State.ACTIVE : State.UNSPECIFIED,
			}),
		]),
		start: vi.fn().mockResolvedValue("session"),
		get: vi.fn().mockResolvedValue(view()),
		answer: vi.fn().mockResolvedValue(
			new SubmitLearningAnswerResponse({
				answerId: "a",
				result: Result.CORRECT,
			}),
		),
		control: vi.fn().mockResolvedValue(view()),
		review: vi.fn().mockResolvedValue([]),
		audio: vi.fn().mockRejectedValue(new Error("Spoken words are unavailable.")),
	};
}
it("starts practice, focuses typed input and completes both questions", async () => {
	const s = service();
	render(ChildLearning, { service: s });
	await fireEvent.click(await screen.findByRole("button", { name: "Start practice" }));
	const input = await screen.findByLabelText("Your answer");
	await waitFor(() => expect(input).toHaveFocus());
	await fireEvent.input(input, { target: { value: "apple" } });
	s.get.mockResolvedValueOnce(view(2));
	await fireEvent.submit(input.closest("form")!);
	await screen.findByRole("heading", { name: "What is 2 + 2?" });
	expect(s.answer).toHaveBeenCalledWith("session", 1, "apple", expect.any(String));
	await fireEvent.input(screen.getByLabelText("Your answer"), {
		target: { value: "4" },
	});
	s.get.mockResolvedValueOnce(view(3));
	await fireEvent.submit(screen.getByLabelText("Your answer").closest("form")!);
	await screen.findByRole("heading", { name: "Practice complete!" });
	expect(screen.getByText("2 of 2 done")).toBeVisible();
});
it("resumes from server and retries exact answer after a lost response", async () => {
	const s = service(true);
	s.get.mockResolvedValue(view(2));
	render(ChildLearning, { service: s });
	const input = await screen.findByLabelText("Your answer");
	expect(s.start).not.toHaveBeenCalled();
	s.answer.mockRejectedValueOnce(new Error("Connection lost"));
	await fireEvent.input(input, { target: { value: "4" } });
	await fireEvent.submit(input.closest("form")!);
	await screen.findByRole("alert");
	expect(input).toBeDisabled();
	const first = s.answer.mock.calls[0];
	s.get.mockResolvedValueOnce(view(3));
	await fireEvent.click(screen.getByRole("button", { name: "Retry saving answer" }));
	await screen.findByRole("heading", { name: "Practice complete!" });
	expect(s.answer.mock.calls[1]).toEqual(first);
});
it("does not duplicate answer when fetching progress fails after save", async () => {
	const s = service(true);
	render(ChildLearning, { service: s });
	const input = await screen.findByLabelText("Your answer");
	await fireEvent.input(input, { target: { value: "apple" } });
	s.get.mockRejectedValueOnce(new Error("Offline"));
	await fireEvent.submit(input.closest("form")!);
	await screen.findByRole("alert");
	const original = s.answer.mock.calls[0];
	s.get.mockResolvedValueOnce(view(2));
	await fireEvent.click(screen.getByRole("button", { name: "Retry saving answer" }));
	await screen.findByText("1 of 2 done");
	expect(s.answer.mock.calls[1]).toEqual(original);
});
it("retries the same hint request, persists help and stops", async () => {
	const s = service(true);
	render(ChildLearning, { service: s });
	await screen.findByLabelText("Your answer");
	s.control.mockRejectedValueOnce(new Error("Offline"));
	await fireEvent.click(screen.getByRole("button", { name: "Hint" }));
	await screen.findByRole("alert");
	const original = s.control.mock.calls[0];
	s.control.mockResolvedValueOnce(new GetLearningSessionResponse({ ...view(), hint: "A fruit" }));
	await fireEvent.click(screen.getByRole("button", { name: "Retry request" }));
	await screen.findByText("Hint: A fruit");
	expect(s.control.mock.calls[1]).toEqual(original);
	s.control.mockResolvedValueOnce(
		new GetLearningSessionResponse({ ...view(), helpRequested: true }),
	);
	await fireEvent.click(screen.getByRole("button", { name: "Ask for help" }));
	await screen.findByText(/Help requested/);
	expect(s.control.mock.calls[2][2]).toBe(Action.HELP);
	s.control.mockResolvedValueOnce(
		new GetLearningSessionResponse({
			session: { id: "session", state: State.CANCELLED },
			total: 2,
		}),
	);
	await fireEvent.click(screen.getByRole("button", { name: "Stop practice" }));
	await screen.findByRole("heading", { name: "Practice stopped" });
	expect(screen.queryByLabelText("Your answer")).toBeNull();
});
it("handles catalog failure and empty approved catalog with refresh", async () => {
	const s = service();
	s.list.mockRejectedValueOnce(new Error("Expired"));
	render(ChildLearning, { service: s });
	await screen.findByRole("alert");
	s.list.mockResolvedValue([]);
	await fireEvent.click(screen.getByRole("button", { name: "Refresh activities" }));
	await screen.findByText(/No activities are available/);
});
it("shows read-only original attempts including uncertain grading, help and stop", async () => {
	const s = service();
	s.review.mockResolvedValue([
		new LearningAttempt({
			session: {
				id: "attempt",
				profileId: "profile",
				state: State.CANCELLED,
				createdAt: "2026-10-15",
			},
			helpRequested: true,
			answers: [
				{
					id: "a",
					position: 1,
					prompt: "Spell the fruit",
					answer: "aple",
					result: Result.NEEDS_REVIEW,
					createdAt: "2026-10-15",
				},
			],
		}),
	]);
	render(LearningAttempts, { service: s, profileId: "profile" });
	await screen.findByText("aple", { exact: true });
	expect(screen.getByText(/Needs review/)).toBeVisible();
	expect(screen.getByText("Help requested")).toBeVisible();
	expect(screen.queryByRole("textbox")).toBeNull();
	expect(s.review).toHaveBeenCalledWith("profile");
});
it("rejects oversized multibyte input without locking the answer or sending it", async () => {
	const s = service(true);
	render(ChildLearning, { service: s });
	const input = await screen.findByLabelText("Your answer");
	await fireEvent.input(input, { target: { value: "🍎".repeat(600) } });
	await fireEvent.submit(input.closest("form")!);
	await screen.findByRole("alert");
	expect(input).not.toBeDisabled();
	expect(s.answer).not.toHaveBeenCalled();
});
it("answers assigned choose-many questions by ticking options, without hints", async () => {
	const s = service(true);
	s.get.mockResolvedValue(
		new GetLearningSessionResponse({
			session: { id: "session", state: State.ACTIVE },
			answered: 0,
			total: 1,
			question: {
				position: 1,
				kind: PracticeQuestionKind.CHOOSE_MANY,
				prompt: "Pick the even numbers",
				choices: ["2", "3", "4"],
				hintCount: 0,
			},
		}),
	);
	render(ChildLearning, { service: s });
	await screen.findByRole("heading", { name: "Pick the even numbers" });
	expect(screen.queryByRole("button", { name: "Hint" })).toBeNull();
	const check = screen.getByRole("button", { name: "Check answer" });
	expect(check).toBeDisabled();
	await fireEvent.click(screen.getByRole("checkbox", { name: "2" }));
	await fireEvent.click(screen.getByRole("checkbox", { name: "4" }));
	await fireEvent.click(check);
	await waitFor(() =>
		expect(s.answer).toHaveBeenCalledWith("session", 1, '["2","4"]', expect.any(String)),
	);
});
