import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import {
	ChildPractice,
	GetChildPolicyResponse,
	LearningSessionState,
	Task,
	TaskStatus,
} from "../api/protocol";
import type { Runtime } from "../runtime/registry.svelte";
import ChildHome from "./ChildHome.svelte";
afterEach(cleanup);

function setup({
	allowed = true,
	tasks = [
		new Task({ id: "t1", title: "Feed the cat", status: TaskStatus.TODO }),
		new Task({
			id: "t2",
			title: "Read a book",
			status: TaskStatus.IN_PROGRESS,
			endAt: "2099-01-01T10:00:00Z",
		}),
		new Task({ id: "t3", title: "Old", status: TaskStatus.COMPLETED }),
	],
	homework = [
		new ChildPractice({ practice: { id: "p1", version: 1 }, title: "Adding", subject: "Math" }),
		new ChildPractice({
			practice: { id: "p2", version: 1 },
			title: "Spelling",
			state: LearningSessionState.ACTIVE,
		}),
		new ChildPractice({
			practice: { id: "p3", version: 1 },
			title: "Done",
			state: LearningSessionState.COMPLETED,
		}),
	],
}: { allowed?: boolean; tasks?: Task[]; homework?: ChildPractice[] } = {}) {
	const childHome = {
		tasks: vi.fn(async () => tasks),
		markTask: vi.fn(
			async (id: string, status: TaskStatus) =>
				new Task({ ...tasks.find((t) => t.id === id), status }),
		),
	};
	const policy = vi.fn(
		async () =>
			new GetChildPolicyResponse({
				allowed,
				nextAllowedAt: allowed ? undefined : "2099-01-01T16:00:00Z",
				timezone: "UTC",
			}),
	);
	const list = vi.fn(async () => homework);
	const runtime = {
		services: { childHome, timetable: { policy }, childLearning: { list } },
	} as unknown as Runtime;
	const onlearn = vi.fn();
	render(ChildHome, {
		props: { name: "Ana", onlearn },
		context: new Map([["vulture:runtime", runtime]]),
	});
	return { childHome, policy, list, onlearn };
}

it("shows homework and task cards with reminders", async () => {
	const { onlearn, childHome } = setup();
	expect(screen.getByRole("heading", { name: "Hi, Ana!" })).toBeVisible();
	await screen.findByText("Adding");
	expect(screen.getByText("Continue")).toBeVisible();
	expect(screen.queryByText("Done")).toBeNull();
	expect(screen.queryByText("Old")).toBeNull();
	expect(screen.getByText("You have 2 homework to finish")).toBeVisible();
	await fireEvent.click(screen.getByRole("button", { name: /Adding/ }));
	expect(onlearn).toHaveBeenCalled();
	await fireEvent.click(screen.getByRole("button", { name: "Start" }));
	await waitFor(() =>
		expect(childHome.markTask).toHaveBeenCalledWith("t1", TaskStatus.IN_PROGRESS),
	);
	await waitFor(() => expect(screen.getAllByRole("button", { name: "I’m done" })).toHaveLength(2));
	await fireEvent.click(screen.getAllByRole("button", { name: "I’m done" })[0]!);
	await waitFor(() => expect(childHome.markTask).toHaveBeenCalledWith("t1", TaskStatus.IN_REVIEW));
	expect(await screen.findByText(/Waiting for a guardian/)).toBeVisible();
});

it("explains closed learning time and empty lists", async () => {
	const { list } = setup({ allowed: false, tasks: [] });
	await screen.findByText("Homework opens during learning time.");
	expect(list).not.toHaveBeenCalled();
	expect(screen.getByText("No tasks for you right now.")).toBeVisible();
	expect(screen.getByText(/^Learning opens /)).toBeVisible();
});

it("reports load and update failures", async () => {
	const { childHome, list } = setup({ homework: [] });
	await screen.findByText("All done. No homework right now.");
	childHome.markTask.mockRejectedValueOnce(new Error("Ask a guardian."));
	await fireEvent.click(screen.getByRole("button", { name: "Start" }));
	expect(await screen.findByText("Ask a guardian.")).toBeVisible();
	childHome.tasks.mockRejectedValueOnce(new Error("down"));
	list.mockRejectedValueOnce(new Error("down"));
	await fireEvent.click(screen.getByRole("button", { name: "Refresh home" }));
	expect(await screen.findByText("Could not load your tasks. Please retry.")).toBeVisible();
	expect(screen.getByText("Could not load homework. Please retry.")).toBeVisible();
});
