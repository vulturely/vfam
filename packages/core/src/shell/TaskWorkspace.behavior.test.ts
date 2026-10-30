import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import TaskWorkspace from "./TaskWorkspace.svelte";
import type { TaskRecord, TaskStatus } from "../tasks/service";
import type { FamilyService } from "../family/service";
import ToastStack from "../components/feedback/ToastStack.svelte";

function task(id: string, status: TaskStatus, isChore = false): TaskRecord {
	return {
		id,
		familyId: "family",
		title: `${id} title`,
		details: "Instructions",
		detailsDocJson: '{"type":"doc"}',
		assigneeAccountIds: ["sam"],
		assigneeProfileIds: ["child"],
		reviewerAccountIds: ["reviewer"],
		startAt: "2026-01-01T10:00:00Z",
		endAt: null,
		repeat: "yearly",
		status,
		isChore,
		comments: [{ id: "comment", authorAccountId: "sam", text: "Saved note", createdAt: "now" }],
		documents: [
			{
				id: `${id}-small`,
				taskId: id,
				objectKey: "small",
				name: `${id}-small.txt`,
				contentType: "text/plain",
				size: 512,
				dataUrl: null,
				image: false,
				uploadedAt: "now",
			},
			{
				id: `${id}-medium`,
				taskId: id,
				objectKey: "medium",
				name: `${id}-medium.txt`,
				contentType: "text/plain",
				size: 2048,
				dataUrl: null,
				image: false,
				uploadedAt: "now",
			},
			{
				id: `${id}-large`,
				taskId: id,
				objectKey: "large",
				name: `${id}-large.txt`,
				contentType: "text/plain",
				size: 2 * 1024 * 1024,
				dataUrl: null,
				image: false,
				uploadedAt: "now",
			},
		],
		createdAt: "now",
		updatedAt: "now",
	};
}

function setup(
	records = [
		task("todo", "todo"),
		task("progress", "in_progress", true),
		task("review", "in_review"),
		task("rejected", "rejected"),
		task("completed", "completed"),
		task("cancelled", "cancelled"),
	],
	listError?: Error,
) {
	const service = {
		listTasks: listError ? vi.fn().mockRejectedValue(listError) : vi.fn(async () => records),
		createTask: vi.fn(async () => records[0]),
		updateTask: vi.fn(async () => records[0]),
		markTaskStatus: vi.fn(async () => records[0]),
		deleteTask: vi.fn(async () => {}),
		addComment: vi.fn(async () => records[0]),
		addDocuments: vi.fn(async () => records[0]),
		getDocumentUrl: vi.fn(async () => "blob:document"),
	};
	const familyService = {
		getAccount: vi.fn(async () => ({ displayName: "Sam" })),
		getAvatar: vi.fn(async () => ({ image: new Uint8Array([1]), contentType: "image/png" })),
	} as unknown as FamilyService;
	const members = [
		{ id: "sam", accountId: "sam", familyId: "family", role: "member" as const, createdAt: "now" },
	];
	const childProfiles = [
		{
			id: "child",
			familyId: "family",
			displayName: "Jamie",
			ageBand: "primary" as const,
			grade: "Grade 2",
			guardianAccountIds: [],
			createdAt: "now",
		},
	];
	render(TaskWorkspace, {
		familyId: "family",
		members,
		childProfiles,
		service,
		familyService,
		currentAccountId: "parent",
	});
	return { service };
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it("runs every task transition and deletes tasks", async () => {
	const { service } = setup();
	for (const [name, status] of [
		["Start task", "in_progress"],
		["Send to review", "in_review"],
		["Reject task", "rejected"],
		["Mark completed", "completed"],
		["Cancel task", "cancelled"],
		["Reopen task", "todo"],
	] as const) {
		await fireEvent.click((await screen.findAllByRole("button", { name }))[0]);
		await waitFor(() =>
			expect(service.markTaskStatus).toHaveBeenCalledWith(expect.any(String), status),
		);
	}
	await fireEvent.click(screen.getAllByRole("button", { name: "Delete task" })[0]);
	expect(service.deleteTask).toHaveBeenCalledWith("todo");
	expect(screen.getAllByText("Saved note").length).toBeGreaterThan(0);
	expect(screen.getAllByText(/Repeats every year/).length).toBeGreaterThan(0);
	expect(screen.getAllByText(/Sam, Jamie/).length).toBeGreaterThan(0);
});

it("downloads documents, uploads files, and adds comments", async () => {
	const { service } = setup();
	await screen.findByText("todo title");
	vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
	for (const id of ["small", "medium", "large"]) {
		await fireEvent.click(screen.getByRole("button", { name: `todo-${id}.txt` }));
	}
	expect(service.getDocumentUrl).toHaveBeenCalledTimes(3);
	expect(screen.getAllByText("512 B").length).toBeGreaterThan(0);
	expect(screen.getAllByText("2 KB").length).toBeGreaterThan(0);
	expect(screen.getAllByText("2.0 MB").length).toBeGreaterThan(0);
	const input = document.querySelector('.v-task-upload input[type="file"]')!;
	await fireEvent.change(input, {
		target: { files: [new File(["body"], "notes.txt", { type: "text/plain" })] },
	});
	await waitFor(() => expect(service.addDocuments).toHaveBeenCalled());
	const comment = (await screen.findAllByLabelText("Add note or question"))[0];
	await fireEvent.input(comment, { target: { value: "New note" } });
	await fireEvent.click(screen.getAllByRole("button", { name: "Add comment" })[0]);
	await waitFor(() =>
		expect(service.addComment).toHaveBeenCalledWith("todo", "New note", "parent"),
	);
});

it("filters chores and surfaces list and document failures", async () => {
	const { service } = setup();
	await screen.findByText("todo title");
	await fireEvent.change(screen.getByLabelText("Filter tasks"), { target: { value: "chores" } });
	expect(screen.queryByText("todo title")).toBeNull();
	expect(screen.getByText("progress title")).toBeVisible();
	service.getDocumentUrl.mockRejectedValue(new Error("denied"));
	await fireEvent.click(screen.getByRole("button", { name: "progress-small.txt" }));
	await waitFor(() =>
		expect(service.getDocumentUrl).toHaveBeenCalledWith("progress", "progress-small"),
	);
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		/Document download failed/,
	);
	await fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }));
	cleanup();
	setup(undefined, new Error("Tasks unavailable"));
	render(ToastStack);
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Tasks unavailable",
	);
});
