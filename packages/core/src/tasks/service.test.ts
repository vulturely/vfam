import { describe, expect, it } from "vitest";
import { createMemoryLocalStateService } from "../services/storage/localState";
import { createLocalTaskStorage, createMemoryTaskStorage, createTaskService } from "./service";

function service() {
	return createTaskService(createMemoryTaskStorage());
}

describe("taskService", () => {
	it("creates and lists family-scoped tasks with timeline and assignee", async () => {
		const tasks = service();

		const task = await tasks.createTask("family-1", {
			title: "  Grocery shopping  ",
			details: "Buy milk and fruit",
			detailsDocJson: JSON.stringify({
				type: "doc",
				content: [
					{
						type: "paragraph",
						content: [{ type: "text", text: "Buy milk and fruit" }],
					},
				],
			}),
			assigneeAccountIds: ["kid-1"],
			reviewerAccountIds: ["kid-2"],
			startAt: "2026-09-06T10:00",
			endAt: "2026-09-06T12:00",
			repeat: "daily",
		});

		expect(task).toMatchObject({
			familyId: "family-1",
			title: "Grocery shopping",
			details: "Buy milk and fruit",
			detailsDocJson: expect.stringContaining("Buy milk and fruit"),
			assigneeAccountIds: ["kid-1"],
			reviewerAccountIds: ["kid-2"],
			startAt: "2026-09-06T10:00",
			endAt: "2026-09-06T12:00",
			repeat: "daily",
			status: "todo",
		});
		await expect(tasks.listTasks("other-family")).resolves.toEqual([]);
	});

	it("rejects empty task titles", async () => {
		await expect(service().createTask("family-1", { title: "   " })).rejects.toThrow(
			"Task title is required",
		);
	});

	it("edits, completes, cancels, and deletes tasks", async () => {
		const tasks = service();
		const task = await tasks.createTask("family-1", { title: "Homework" });

		const edited = await tasks.updateTask(task.id, {
			title: "Math homework",
			assigneeAccountIds: ["kid-2"],
			reviewerAccountIds: ["kid-3"],
			repeat: "monthly",
		});
		expect(edited.title).toBe("Math homework");
		expect(edited.assigneeAccountIds).toEqual(["kid-2"]);
		expect(edited.reviewerAccountIds).toEqual(["kid-3"]);
		expect(edited.repeat).toBe("monthly");

		await expect(tasks.markTaskStatus(task.id, "in_progress")).resolves.toMatchObject({
			status: "in_progress",
		});
		await expect(tasks.markTaskStatus(task.id, "in_review")).resolves.toMatchObject({
			status: "in_review",
		});
		await expect(tasks.markTaskStatus(task.id, "rejected")).resolves.toMatchObject({
			status: "rejected",
		});
		await expect(tasks.markTaskStatus(task.id, "completed")).resolves.toMatchObject({
			status: "completed",
		});
		await expect(tasks.markTaskStatus(task.id, "cancelled")).resolves.toMatchObject({
			status: "cancelled",
		});

		await tasks.deleteTask(task.id);
		await expect(tasks.listTasks("family-1")).resolves.toHaveLength(0);
	});

	it("adds comments and uploaded document metadata", async () => {
		const tasks = service();
		const task = await tasks.createTask("family-1", { title: "School form" });

		const withComment = await tasks.addComment(task.id, " Can you review this? ", "parent-1");
		expect(withComment.comments).toMatchObject([
			{ text: "Can you review this?", authorAccountId: "parent-1" },
		]);

		const withDocs = await tasks.addDocuments(task.id, [
			{ name: "permission-slip.pdf", contentType: "application/pdf", size: 42 },
		]);
		expect(withDocs.documents).toMatchObject([
			{ name: "permission-slip.pdf", contentType: "application/pdf", size: 42 },
		]);
	});
});

describe("local attachment download", () => {
	it("returns only the requested task's stored attachment", async () => {
		const tasks = service();
		const first = await tasks.createTask("family-1", { title: "First" });
		const second = await tasks.createTask("family-1", { title: "Second" });
		const updated = await tasks.addDocuments(first.id, [
			{ name: "hi.txt", size: 2, dataUrl: "data:text/plain;base64,aGk=" },
		]);
		const document = updated.documents[0];
		await expect(tasks.getDocumentUrl(first.id, document.id)).resolves.toBe(
			"data:text/plain;base64,aGk=",
		);
		await expect(tasks.getDocumentUrl(second.id, document.id)).rejects.toThrow(
			"Document is unavailable.",
		);
		await expect(tasks.getDocumentUrl(first.id, "missing")).rejects.toThrow(
			"Document is unavailable.",
		);
	});
});

it("retains child profile assignees separately from account assignees on unrelated updates", async () => {
	const tasks = service();
	const task = await tasks.createTask("family-1", {
		title: "Homework",
		assigneeAccountIds: ["parent"],
		assigneeProfileIds: [" child-1 ", "child-1"],
	});
	expect(task.assigneeProfileIds).toEqual(["child-1"]);
	const updated = await tasks.updateTask(task.id, { title: "Math homework" });
	expect(updated.assigneeProfileIds).toEqual(["child-1"]);
	expect(updated.assigneeAccountIds).toEqual(["parent"]);
});

it("keeps chores and ordinary tasks in one list, preserving category through edits and completion", async () => {
	const storage = createMemoryTaskStorage();
	const tasks = createTaskService(storage);
	const chore = await tasks.createTask("family", {
		title: "Wash dishes",
		isChore: true,
		repeat: "daily",
	});
	const task = await tasks.createTask("family", { title: "Buy tickets" });
	expect(task.isChore).toBe(false);
	expect(
		(await tasks.listTasks("family")).filter((item) => item.isChore).map((item) => item.id),
	).toEqual([chore.id]);
	await tasks.updateTask(chore.id, { title: "Wash and dry dishes" });
	await tasks.markTaskStatus(chore.id, "completed");
	const restored = createTaskService(storage);
	expect((await restored.listTasks("family")).find((item) => item.id === chore.id)).toMatchObject({
		isChore: true,
		repeat: "daily",
		status: "completed",
	});
	expect(await restored.updateTask(chore.id, { isChore: false })).toMatchObject({ isChore: false });
});

it("validates mutations and normalizes optional fields and documents", async () => {
	const tasks = service();
	const task = await tasks.createTask("family", {
		title: "Form",
		detailsDocJson: "not json",
		details: "Details",
		assigneeAccountIds: [" child ", "child", ""],
		startAt: " ",
		repeat: "invalid" as never,
	});
	expect(task).toMatchObject({
		assigneeAccountIds: ["child"],
		startAt: null,
		repeat: "none",
		detailsDocJson: JSON.stringify({
			type: "doc",
			content: [{ type: "paragraph", content: [{ type: "text", text: "Details" }] }],
		}),
	});

	await expect(tasks.updateTask(task.id, { title: " " })).rejects.toThrow("Task title is required");
	await expect(tasks.updateTask("missing", {})).rejects.toThrow("Task not found: missing");
	await expect(tasks.deleteTask("missing")).rejects.toThrow("Task not found: missing");
	await expect(tasks.addComment(task.id, " ")).rejects.toThrow("Comment is required");
	await expect(tasks.addDocuments(task.id, [{ name: " ", size: 0 }])).rejects.toThrow(
		"Document is required",
	);
	await expect(tasks.addComment(task.id, "Done", " ")).resolves.toMatchObject({
		comments: [{ authorAccountId: null, text: "Done" }],
	});
	const updated = await tasks.updateTask(task.id, {
		details: " Updated ",
		detailsDocJson: " ",
		assigneeProfileIds: ["profile"],
		startAt: null,
		endAt: "2026-01-01",
	});
	expect(updated).toMatchObject({ details: "Updated", startAt: null, endAt: "2026-01-01" });
	const withDocuments = await tasks.addDocuments(task.id, [
		{ name: " note.txt ", size: 2, image: true },
	]);
	expect(withDocuments.documents[0]).toMatchObject({
		name: "note.txt",
		contentType: "application/octet-stream",
		dataUrl: null,
		image: true,
	});
});

it("sorts tasks by status and timeline", async () => {
	const tasks = service();
	const cancelled = await tasks.createTask("family", { title: "Cancelled" });
	const completed = await tasks.createTask("family", { title: "Completed" });
	const rejected = await tasks.createTask("family", { title: "Rejected" });
	const review = await tasks.createTask("family", { title: "Review" });
	const progress = await tasks.createTask("family", { title: "Progress" });
	await tasks.createTask("family", { title: "Later", startAt: "2026-02-01" });
	await tasks.createTask("family", {
		title: "Earlier",
		endAt: "2026-01-01",
	});
	await tasks.markTaskStatus(cancelled.id, "cancelled");
	await tasks.markTaskStatus(completed.id, "completed");
	await tasks.markTaskStatus(rejected.id, "rejected");
	await tasks.markTaskStatus(review.id, "in_review");
	await tasks.markTaskStatus(progress.id, "in_progress");

	expect((await tasks.listTasks("family")).map((task) => task.title)).toEqual([
		"Earlier",
		"Later",
		"Progress",
		"Review",
		"Rejected",
		"Completed",
		"Cancelled",
	]);
});

it("normalizes persisted tasks and recovers from malformed local storage", async () => {
	const memory = createMemoryLocalStateService();
	memory.legacy.set(
		"vulture:family-tasks:v1",
		JSON.stringify([
			null,
			"missing",
			{ id: "invalid" },
			{
				id: "task",
				familyId: "family",
				title: "Persisted",
				details: "Legacy",
				detailsDocJson: "bad json",
				assigneeAccountIds: ["one", "one"],
				status: "unknown",
				documents: [
					null,
					{},
					{ id: "doc", name: "Document", size: "unknown" },
					{
						id: "image",
						name: "Image",
						taskId: "task",
						objectKey: "key",
						contentType: "image/png",
						size: 2,
						dataUrl: "data:image/png;base64,aGk=",
						image: true,
						uploadedAt: "yesterday",
					},
				],
			},
		]),
	);
	const tasks = createTaskService(createLocalTaskStorage(memory.service));
	const [task] = await tasks.listTasks("family");
	expect(task).toMatchObject({
		id: "task",
		status: "todo",
		assigneeAccountIds: ["one"],
		assigneeProfileIds: [],
		detailsDocJson: expect.stringContaining("Legacy"),
	});
	expect(task.documents).toHaveLength(2);
	expect(task.documents[0]).toMatchObject({
		contentType: "application/octet-stream",
		size: 0,
		dataUrl: null,
		image: false,
	});
	expect(task.documents[1]).toMatchObject({ objectKey: "key", image: true });

	memory.values.set("vulture:family-tasks:v1", "not json");
	await expect(tasks.listTasks("family")).resolves.toEqual([]);
	memory.values.set("vulture:family-tasks:v1", {});
	await expect(tasks.listTasks("family")).resolves.toEqual([]);
	memory.values.delete("vulture:family-tasks:v1");
	await expect(tasks.listTasks("family")).resolves.toEqual([]);
});

it("normalizes legacy local task records and ignores malformed storage", async () => {
	const memory = createMemoryLocalStateService({
		"vulture:family-tasks:v1": [
			null,
			{ id: "invalid" },
			{
				id: "legacy",
				familyId: "family",
				title: "Legacy",
				status: "completed",
				details: "Details",
				detailsDocJson: "invalid",
				assigneeAccountIds: [" parent ", "", "parent"],
				repeat: "yearly",
				startAt: "2026-01-01",
				documents: [
					null,
					{ id: "missing-name" },
					{ id: "document", name: "Document", size: "old" },
				],
			},
		],
	});
	const service = createTaskService(createLocalTaskStorage(memory.service));
	const [task] = await service.listTasks("family");
	expect(task.status).toBe("completed");
	expect(task.assigneeAccountIds).toEqual(["parent"]);
	expect(task.detailsDocJson).toContain("Details");
	expect(task.documents).toHaveLength(1);
	expect(task.documents[0]).toMatchObject({
		contentType: "application/octet-stream",
		size: 0,
		dataUrl: null,
		image: false,
	});
	memory.values.set("vulture:family-tasks:v1", "not-json");
	expect(await service.listTasks("family")).toEqual([]);
	memory.values.set("vulture:family-tasks:v1", {});
	expect(await service.listTasks("family")).toEqual([]);
});
