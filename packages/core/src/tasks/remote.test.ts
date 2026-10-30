import { beforeEach, describe, expect, it, vi } from "vitest";
import { Task, TaskDocument, TaskRepeat, TaskStatus } from "../api/protocol";
import type { OidcAuth } from "../auth/oidc";
import { createRemoteTaskService } from "./service";

const client = vi.hoisted(() => ({
	listTasks: vi.fn(),
	createTask: vi.fn(),
	updateTask: vi.fn(),
	deleteTask: vi.fn(),
	markTaskStatus: vi.fn(),
	downloadTaskDocument: vi.fn(),
	uploadTaskDocument: vi.fn(),
}));
vi.mock("../repositories/nativeClient", () => ({ createNativeClient: () => client }));
const getAccessToken = vi.fn();
const auth = { getAccessToken } as unknown as OidcAuth;
const attachment = new TaskDocument({
	id: "doc",
	taskId: "task",
	name: "private.txt",
	url: "https://old-public.invalid/private",
	objectKey: "private/key",
});

beforeEach(() => {
	vi.resetAllMocks();
	getAccessToken.mockResolvedValue("vps_current");
	client.listTasks.mockResolvedValue({
		tasks: [
			new Task({
				id: "task",
				familyId: "family",
				title: "Homework",
				documents: [attachment],
			}),
		],
	});
});

describe("authenticated task attachments", () => {
	it("keeps persisted attachments after reload without trusting legacy URLs or keys", async () => {
		const service = createRemoteTaskService("https://server.invalid", auth);
		const [task] = await service.listTasks("family");
		expect(task.documents).toMatchObject([{ id: "doc", dataUrl: null, objectKey: null }]);
		expect(client.listTasks).toHaveBeenCalledWith(
			{ familyId: "family" },
			{ headers: { authorization: "Bearer vps_current" } },
		);
		expect(client.downloadTaskDocument).not.toHaveBeenCalled();
	});

	it("fetches bytes with current credentials on every download and propagates denial", async () => {
		const service = createRemoteTaskService("https://server.invalid", auth);
		client.downloadTaskDocument.mockResolvedValue({
			content: new Uint8Array([104, 105]),
			contentType: "text/plain",
		});
		expect(await service.getDocumentUrl("task", "doc")).toBe("data:text/plain;base64,aGk=");
		getAccessToken.mockResolvedValue("vps_rotated");
		client.downloadTaskDocument.mockRejectedValue(new Error("permission denied"));
		await expect(service.getDocumentUrl("other-task", "doc")).rejects.toThrow("permission denied");
		expect(client.downloadTaskDocument).toHaveBeenLastCalledWith(
			{ taskId: "other-task", documentId: "doc" },
			{ headers: { authorization: "Bearer vps_rotated" } },
		);
	});

	it("retains existing and newly uploaded attachment metadata", async () => {
		const service = createRemoteTaskService("https://server.invalid", auth);
		await service.listTasks("family");
		client.uploadTaskDocument.mockResolvedValue({
			document: new TaskDocument({
				id: "new",
				taskId: "task",
				name: "second.txt",
			}),
		});
		const task = await service.addDocuments("task", [
			{ name: "second.txt", size: 2, content: new Uint8Array([104, 105]) },
		]);
		expect(task.documents.map((document) => document.id)).toEqual(["doc", "new"]);
		expect(task.documents.every((document) => document.dataUrl === null)).toBe(true);
	});
});

it("sends chore category on create, restores it, and leaves absent update category unset for compatibility", async () => {
	const chore = new Task({
		id: "chore",
		familyId: "family",
		title: "Dishes",
		isChore: true,
	});
	client.createTask.mockResolvedValue({ task: chore });
	client.updateTask.mockResolvedValue({ task: chore });
	const service = createRemoteTaskService("https://server.invalid", auth);
	expect(await service.createTask("family", { title: "Dishes", isChore: true })).toMatchObject({
		isChore: true,
	});
	expect(client.createTask.mock.calls[0][0]).toMatchObject({ isChore: true });
	await service.updateTask("chore", { title: "Dishes" });
	expect(client.updateTask.mock.calls[0][0].isChore).toBeUndefined();
	await service.updateTask("chore", { isChore: false });
	expect(client.updateTask.mock.calls[1][0].isChore).toBe(false);
});

it("maps every repeat and task status in both directions", async () => {
	const service = createRemoteTaskService("https://server.invalid", auth);
	const repeats = [
		["none", TaskRepeat.NONE],
		["daily", TaskRepeat.DAILY],
		["weekly", TaskRepeat.WEEKLY],
		["monthly", TaskRepeat.MONTHLY],
		["yearly", TaskRepeat.YEARLY],
	] as const;
	for (const [repeat, protocolRepeat] of repeats) {
		client.createTask.mockResolvedValueOnce({
			task: new Task({ id: repeat, familyId: "family", title: repeat, repeat: protocolRepeat }),
		});
		await expect(service.createTask("family", { title: repeat, repeat })).resolves.toMatchObject({
			repeat,
		});
		expect(client.createTask).toHaveBeenLastCalledWith(
			expect.objectContaining({ repeat: protocolRepeat }),
			expect.anything(),
		);
	}

	const statuses = [
		["todo", TaskStatus.TODO],
		["in_progress", TaskStatus.IN_PROGRESS],
		["in_review", TaskStatus.IN_REVIEW],
		["rejected", TaskStatus.REJECTED],
		["completed", TaskStatus.COMPLETED],
		["cancelled", TaskStatus.CANCELLED],
	] as const;
	for (const [status, protocolStatus] of statuses) {
		client.markTaskStatus.mockResolvedValueOnce({
			task: new Task({ id: "task", familyId: "family", title: "Task", status: protocolStatus }),
		});
		await expect(service.markTaskStatus("task", status)).resolves.toMatchObject({ status });
		expect(client.markTaskStatus).toHaveBeenLastCalledWith(
			{ taskId: "task", status: protocolStatus },
			expect.anything(),
		);
	}
});

it("normalizes remote dates and supports unauthenticated request headers", async () => {
	getAccessToken.mockResolvedValue(null);
	client.listTasks.mockResolvedValue({
		tasks: [
			new Task({
				id: "task",
				familyId: "family",
				title: "Task",
				startAt: "2026-01-01T12:00:00Z",
				endAt: "not-a-date",
				description: { text: " Details ", docJson: "bad json" },
			}),
		],
	});
	const service = createRemoteTaskService("https://server.invalid", auth);
	const [task] = await service.listTasks("family");
	expect(task.startAt).toMatch(/^2026-01-01T/);
	expect(task.endAt).toBe("not-a-date");
	expect(task.detailsDocJson).toContain("Details");
	expect(client.listTasks).toHaveBeenCalledWith({ familyId: "family" }, { headers: {} });
});

it("keeps local comments across remote reloads and validates comment targets", async () => {
	const service = createRemoteTaskService("https://server.invalid", auth);
	await expect(service.addComment("missing", "Comment")).rejects.toThrow("Task not found");
	await service.listTasks("family");
	await expect(service.addComment("task", " ")).rejects.toThrow("Comment is required");
	const updated = await service.addComment("task", " Remember ", " ");
	expect(updated.comments).toMatchObject([{ text: "Remember", authorAccountId: null }]);
	client.listTasks.mockResolvedValue({
		tasks: [new Task({ id: "task", familyId: "family", title: "Homework" })],
	});
	expect((await service.listTasks("family"))[0].comments).toEqual(updated.comments);
});

it("deletes tasks and rejects missing server results", async () => {
	const service = createRemoteTaskService("https://server.invalid", auth);
	await service.deleteTask("task");
	expect(client.deleteTask).toHaveBeenCalledWith(
		{ taskId: "task" },
		{ headers: { authorization: "Bearer vps_current" } },
	);

	client.createTask.mockResolvedValue({});
	client.updateTask.mockResolvedValue({});
	client.markTaskStatus.mockResolvedValue({});
	await expect(service.createTask("family", { title: "Task" })).rejects.toThrow(
		"Server did not return a task.",
	);
	await expect(service.updateTask("task", {})).rejects.toThrow("Server did not return a task.");
	await expect(service.markTaskStatus("task", "todo")).rejects.toThrow(
		"Server did not return a task.",
	);
});

it("validates remote document uploads and missing upload results", async () => {
	const service = createRemoteTaskService("https://server.invalid", auth);
	await expect(service.addDocuments("task", [{ name: " ", size: 0 }])).rejects.toThrow(
		"Document is required",
	);
	await expect(service.addDocuments("task", [{ name: "doc", size: 0 }])).rejects.toThrow(
		"Task not found",
	);
	await service.listTasks("family");
	client.uploadTaskDocument.mockResolvedValue({});
	await expect(service.addDocuments("task", [{ name: "doc", size: 0 }])).rejects.toThrow(
		"Server did not return an uploaded document.",
	);
});

it("uses fresh cached tasks without calling the server", async () => {
	const seed = createRemoteTaskService("https://server.invalid", auth);
	const [task] = await seed.listTasks("family");
	client.listTasks.mockClear();
	const cache = {
		get: vi.fn().mockResolvedValue([task]),
		put: vi.fn(),
		delete: vi.fn(),
		clear: vi.fn(),
	};
	const service = createRemoteTaskService("https://server.invalid", auth, cache);
	await expect(service.listTasks("family")).resolves.toEqual([task]);
	expect(client.listTasks).not.toHaveBeenCalled();
	expect(cache.get).toHaveBeenCalledWith("family:family:tasks");
});

it("falls back to explicitly stale cached tasks when the server is offline", async () => {
	const seed = createRemoteTaskService("https://server.invalid", auth);
	const [task] = await seed.listTasks("family");
	const cache = {
		get: vi
			.fn()
			.mockImplementation((_key, includeExpired) =>
				Promise.resolve(includeExpired ? [task] : null),
			),
		put: vi.fn().mockRejectedValue(new Error("cache unavailable")),
		delete: vi.fn(),
		clear: vi.fn(),
	};
	const service = createRemoteTaskService("https://server.invalid", auth, cache);
	client.listTasks.mockRejectedValue(new TypeError("fetch failed"));
	await expect(service.listTasks("family")).resolves.toMatchObject([{ id: "task", stale: true }]);
	expect(cache.get).toHaveBeenCalledWith("family:family:tasks", true);
});
