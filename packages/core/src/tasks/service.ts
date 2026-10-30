import { createNativeClient } from "../repositories/nativeClient";
import { randomUUID } from "@vulture/data";
import { TaskRepeat as ProtoTaskRepeat, TaskStatus as ProtoTaskStatus } from "../api/protocol";
import type { OidcAuth } from "../auth/oidc";
import {
	createCacheService,
	isCacheOfflineError,
	type CacheService,
} from "../services/storage/cache";
import { createLocalStateService, type LocalStateService } from "../services/storage/localState";

export type TaskStatus =
	"todo" | "in_progress" | "in_review" | "rejected" | "completed" | "cancelled";
export type TaskRepeat = "none" | "daily" | "weekly" | "monthly" | "yearly";

export interface TaskCommentRecord {
	id: string;
	authorAccountId: string | null;
	text: string;
	createdAt: string;
}

export interface TaskDocumentRecord {
	id: string;
	taskId: string | null;
	objectKey: string | null;
	name: string;
	contentType: string;
	size: number;
	dataUrl: string | null;
	image: boolean;
	uploadedAt: string;
}

export interface TaskRecord {
	isChore?: boolean;
	id: string;
	familyId: string;
	title: string;
	details: string;
	detailsDocJson: string;
	assigneeAccountIds: string[];
	assigneeProfileIds?: string[];
	reviewerAccountIds: string[];
	startAt: string | null;
	endAt: string | null;
	repeat: TaskRepeat;
	status: TaskStatus;
	comments: TaskCommentRecord[];
	documents: TaskDocumentRecord[];
	createdAt: string;
	updatedAt: string;
	stale?: boolean;
}

export interface TaskDraft {
	isChore?: boolean;
	title: string;
	details?: string;
	detailsDocJson?: string;
	assigneeAccountIds?: string[];
	assigneeProfileIds?: string[];
	reviewerAccountIds?: string[];
	startAt?: string | null;
	endAt?: string | null;
	repeat?: TaskRepeat;
}

export interface TaskUpdate {
	isChore?: boolean;
	title?: string;
	details?: string;
	detailsDocJson?: string;
	assigneeAccountIds?: string[];
	assigneeProfileIds?: string[];
	reviewerAccountIds?: string[];
	startAt?: string | null;
	endAt?: string | null;
	repeat?: TaskRepeat;
}

export interface TaskDocumentInput {
	name: string;
	contentType?: string;
	size: number;
	dataUrl?: string | null;
	content?: Uint8Array;
	image?: boolean;
}

export interface TaskService {
	getDocumentUrl(taskId: string, documentId: string): Promise<string>;
	listTasks(familyId: string): Promise<TaskRecord[]>;
	createTask(familyId: string, draft: TaskDraft): Promise<TaskRecord>;
	updateTask(taskId: string, update: TaskUpdate): Promise<TaskRecord>;
	deleteTask(taskId: string): Promise<void>;
	markTaskStatus(taskId: string, status: TaskStatus): Promise<TaskRecord>;
	addComment(taskId: string, text: string, authorAccountId?: string | null): Promise<TaskRecord>;
	addDocuments(taskId: string, documents: TaskDocumentInput[]): Promise<TaskRecord>;
}

interface TaskStorage {
	read(): TaskRecord[] | Promise<TaskRecord[]>;
	write(tasks: TaskRecord[]): void | Promise<void>;
}

const STORAGE_KEY = "vulture:family-tasks:v1";

export function createTaskService(storage = createLocalTaskStorage()): TaskService {
	async function saveMapped(
		taskId: string,
		mapTask: (task: TaskRecord) => TaskRecord,
	): Promise<TaskRecord> {
		let updated: TaskRecord | undefined;
		const tasks = (await storage.read()).map((task) => {
			if (task.id !== taskId) return task;
			updated = mapTask(task);
			return updated;
		});
		if (!updated) throw new Error(`Task not found: ${taskId}`);
		await storage.write(tasks);
		return updated;
	}

	return {
		async getDocumentUrl(taskId, documentId) {
			const document = (await storage.read())
				.find((task) => task.id === taskId)
				?.documents.find((document) => document.id === documentId);
			if (!document?.dataUrl) throw new Error("Document is unavailable.");
			return document.dataUrl;
		},
		async listTasks(familyId) {
			return sortTasks((await storage.read()).filter((task) => task.familyId === familyId));
		},

		async createTask(familyId, draft) {
			const title = draft.title.trim();
			if (!title) throw new Error("Task title is required");
			const now = new Date().toISOString();
			const task: TaskRecord = {
				id: randomUUID(),
				isChore: draft.isChore === true,
				familyId,
				title,
				details: (draft.details ?? "").trim(),
				detailsDocJson: normalizeRichTextDocumentJson(draft.detailsDocJson, draft.details),
				assigneeAccountIds: normalizeIds(draft.assigneeAccountIds),
				assigneeProfileIds: normalizeIds(draft.assigneeProfileIds),
				reviewerAccountIds: normalizeIds(draft.reviewerAccountIds),
				startAt: normalizeOptional(draft.startAt),
				endAt: normalizeOptional(draft.endAt),
				repeat: normalizeRepeat(draft.repeat),
				status: "todo",
				comments: [],
				documents: [],
				createdAt: now,
				updatedAt: now,
			};
			await storage.write([...(await storage.read()), task]);
			return task;
		},

		async updateTask(taskId, update) {
			return saveMapped(taskId, (task) => {
				const title = update.title === undefined ? task.title : update.title.trim();
				if (!title) throw new Error("Task title is required");
				return {
					...task,
					isChore: update.isChore ?? task.isChore ?? false,
					title,
					details: update.details === undefined ? task.details : update.details.trim(),
					detailsDocJson:
						update.detailsDocJson === undefined
							? task.detailsDocJson
							: normalizeRichTextDocumentJson(
									update.detailsDocJson,
									update.details ?? task.details,
								),
					assigneeAccountIds:
						update.assigneeAccountIds === undefined
							? task.assigneeAccountIds
							: normalizeIds(update.assigneeAccountIds),
					assigneeProfileIds:
						update.assigneeProfileIds === undefined
							? (task.assigneeProfileIds ?? [])
							: normalizeIds(update.assigneeProfileIds),
					reviewerAccountIds:
						update.reviewerAccountIds === undefined
							? task.reviewerAccountIds
							: normalizeIds(update.reviewerAccountIds),
					startAt: update.startAt === undefined ? task.startAt : normalizeOptional(update.startAt),
					endAt: update.endAt === undefined ? task.endAt : normalizeOptional(update.endAt),
					repeat: update.repeat === undefined ? task.repeat : normalizeRepeat(update.repeat),
					updatedAt: new Date().toISOString(),
				};
			});
		},

		async deleteTask(taskId) {
			const tasks = await storage.read();
			const next = tasks.filter((task) => task.id !== taskId);
			if (next.length === tasks.length) throw new Error(`Task not found: ${taskId}`);
			await storage.write(next);
		},

		async markTaskStatus(taskId, status) {
			return saveMapped(taskId, (task) => ({
				...task,
				status,
				updatedAt: new Date().toISOString(),
			}));
		},

		async addComment(taskId, text, authorAccountId = null) {
			const trimmed = text.trim();
			if (!trimmed) throw new Error("Comment is required");
			return saveMapped(taskId, (task) => ({
				...task,
				comments: [
					...task.comments,
					{
						id: randomUUID(),
						authorAccountId: normalizeOptional(authorAccountId),
						text: trimmed,
						createdAt: new Date().toISOString(),
					},
				],
				updatedAt: new Date().toISOString(),
			}));
		},

		async addDocuments(taskId, documents) {
			const validDocuments = documents.filter((document) => document.name.trim());
			if (validDocuments.length === 0) throw new Error("Document is required");
			return saveMapped(taskId, (task) => ({
				...task,
				documents: [
					...task.documents,
					...validDocuments.map((document) => ({
						id: randomUUID(),
						taskId: task.id,
						objectKey: null,
						name: document.name.trim(),
						contentType: document.contentType || "application/octet-stream",
						size: document.size,
						dataUrl: document.dataUrl ?? null,
						image: document.image ?? false,
						uploadedAt: new Date().toISOString(),
					})),
				],
				updatedAt: new Date().toISOString(),
			}));
		},
	};
}

export function createRemoteTaskService(
	serverUrl: string,
	auth: OidcAuth,
	cache: CacheService = createCacheService(serverUrl, auth),
): TaskService {
	const client = createNativeClient("control", serverUrl);
	const taskCache = new Map<string, TaskRecord>();
	const taskExtras = new Map<string, Pick<TaskRecord, "comments">>();

	async function headers(): Promise<Record<string, string>> {
		const token = await auth.getAccessToken();
		return token ? { authorization: `Bearer ${token}` } : {};
	}

	function cacheRemoteTask(task: TaskRecord): TaskRecord {
		const extras = taskExtras.get(task.id) ?? { comments: [] };
		const merged = {
			...task,
			comments: extras.comments,
		};
		taskCache.set(task.id, merged);
		return merged;
	}

	async function cachedTasks(
		familyId: string,
		load: () => Promise<TaskRecord[]>,
	): Promise<TaskRecord[]> {
		const key = `family:${familyId}:tasks`;
		const fresh = await cache.get<TaskRecord[]>(key).catch(() => null);
		if (fresh !== null) return fresh.map(cacheRemoteTask);
		try {
			const tasks = await load();
			await cache.put(key, tasks).catch(() => {});
			return tasks;
		} catch (error) {
			if (isCacheOfflineError(error)) {
				const stale = await cache.get<TaskRecord[]>(key, true).catch(() => null);
				if (stale !== null) return stale.map((task) => cacheRemoteTask({ ...task, stale: true }));
			}
			throw error;
		}
	}

	async function invalidate(): Promise<void> {
		await cache.clear().catch(() => {});
	}

	return {
		async getDocumentUrl(taskId, documentId) {
			const response = (await client.downloadTaskDocument(
				{ taskId, documentId },
				{ headers: await headers() },
			)) as { content: Uint8Array; contentType: string };
			let binary = "";
			for (const byte of response.content) binary += String.fromCharCode(byte);
			// Attachment bytes stay in this page; no reusable public URL enters task metadata.
			return `data:${response.contentType};base64,${globalThis.btoa(binary)}`;
		},
		async listTasks(familyId) {
			return cachedTasks(familyId, async () => {
				const response = (await client.listTasks({ familyId }, { headers: await headers() })) as {
					tasks?: import("../api/protocol").Task[];
				};
				return (response.tasks ?? []).map((task) => cacheRemoteTask(taskFromProto(task)));
			});
		},

		async createTask(familyId, draft) {
			const response = (await client.createTask(
				{
					familyId,
					title: draft.title,
					description: richTextDescription(draft),
					assigneeAccountIds: normalizeIds(draft.assigneeAccountIds),
					assigneeProfileIds: normalizeIds(draft.assigneeProfileIds),
					isChore: draft.isChore === true,
					reviewerAccountIds: normalizeIds(draft.reviewerAccountIds),
					startAt: toRfc3339(draft.startAt),
					endAt: toRfc3339(draft.endAt),
					repeat: repeatToProto(normalizeRepeat(draft.repeat)),
				},
				{ headers: await headers() },
			)) as { task?: import("../api/protocol").Task };
			if (!response.task) throw new Error("Server did not return a task.");
			await invalidate();
			return cacheRemoteTask(taskFromProto(response.task));
		},

		async updateTask(taskId, update) {
			const response = (await client.updateTask(
				{
					taskId,
					title: update.title ?? "",
					description: richTextDescription(update),
					assigneeAccountIds: normalizeIds(update.assigneeAccountIds),
					assigneeProfileIds: normalizeIds(update.assigneeProfileIds),
					updateProfileAssignees: update.assigneeProfileIds !== undefined,
					isChore: update.isChore,
					reviewerAccountIds: normalizeIds(update.reviewerAccountIds),
					startAt: toRfc3339(update.startAt),
					endAt: toRfc3339(update.endAt),
					repeat: repeatToProto(normalizeRepeat(update.repeat)),
				},
				{ headers: await headers() },
			)) as { task?: import("../api/protocol").Task };
			if (!response.task) throw new Error("Server did not return a task.");
			await invalidate();
			return cacheRemoteTask(taskFromProto(response.task));
		},

		async deleteTask(taskId) {
			await client.deleteTask({ taskId }, { headers: await headers() });
			taskCache.delete(taskId);
			taskExtras.delete(taskId);
			await invalidate();
		},

		async markTaskStatus(taskId, status) {
			const response = (await client.markTaskStatus(
				{ taskId, status: statusToProto(status) },
				{ headers: await headers() },
			)) as { task?: import("../api/protocol").Task };
			if (!response.task) throw new Error("Server did not return a task.");
			await invalidate();
			return cacheRemoteTask(taskFromProto(response.task));
		},

		// Comments are local overlays until the backend gets collaboration RPCs.
		async addComment(taskId, text, authorAccountId = null) {
			const trimmed = text.trim();
			if (!trimmed) throw new Error("Comment is required");
			const task = taskCache.get(taskId);
			if (!task) throw new Error(`Task not found: ${taskId}`);
			const extras = taskExtras.get(taskId) ?? { comments: [] };
			taskExtras.set(taskId, {
				...extras,
				comments: [
					...extras.comments,
					{
						id: randomUUID(),
						authorAccountId: normalizeOptional(authorAccountId),
						text: trimmed,
						createdAt: new Date().toISOString(),
					},
				],
			});
			await invalidate();
			return cacheRemoteTask(task);
		},
		async addDocuments(taskId, documents) {
			const validDocuments = documents.filter((document) => document.name.trim());
			if (validDocuments.length === 0) throw new Error("Document is required");
			const task = taskCache.get(taskId);
			if (!task) throw new Error(`Task not found: ${taskId}`);
			const uploaded = await Promise.all(
				validDocuments.map(async (document) => {
					const response = (await client.uploadTaskDocument(
						{
							taskId,
							name: document.name,
							contentType: document.contentType || "application/octet-stream",
							content: new Uint8Array(document.content ?? new Uint8Array(0)),
							image: document.image ?? false,
						},
						{ headers: await headers() },
					)) as { document?: import("../api/protocol").TaskDocument };
					if (!response.document) {
						throw new Error("Server did not return an uploaded document.");
					}
					return taskDocumentFromProto(response.document);
				}),
			);
			await invalidate();
			return cacheRemoteTask({
				...task,
				documents: [...task.documents, ...uploaded],
			});
		},
	};
}

function richTextDescription(draft: Pick<TaskDraft, "details" | "detailsDocJson">) {
	const text = (draft.details ?? "").trim();
	return {
		docJson: normalizeRichTextDocumentJson(draft.detailsDocJson, text),
		text,
	};
}

function taskFromProto(task: import("../api/protocol").Task): TaskRecord {
	const details = task.description?.text ?? "";
	return {
		id: task.id,
		isChore: task.isChore === true,
		familyId: task.familyId,
		title: task.title,
		details,
		detailsDocJson: normalizeRichTextDocumentJson(task.description?.docJson, details),
		assigneeAccountIds: task.assigneeAccountIds ?? [],
		assigneeProfileIds: task.assigneeProfileIds ?? [],
		reviewerAccountIds: task.reviewerAccountIds ?? [],
		startAt: fromRfc3339(task.startAt),
		endAt: fromRfc3339(task.endAt),
		repeat: repeatFromProto(task.repeat),
		status: statusFromProto(task.status),
		comments: [],
		documents: (task.documents ?? []).map(taskDocumentFromProto),
		createdAt: task.createdAt,
		updatedAt: task.updatedAt,
	};
}

function taskDocumentFromProto(
	document: import("../api/protocol").TaskDocument,
): TaskDocumentRecord {
	return {
		id: document.id,
		taskId: document.taskId,
		objectKey: null,
		name: document.name,
		contentType: document.contentType || "application/octet-stream",
		size: Number(document.size),
		dataUrl: null,
		image: document.image,
		uploadedAt: document.uploadedAt,
	};
}

function repeatToProto(repeat: TaskRepeat): ProtoTaskRepeat {
	switch (repeat) {
		case "daily":
			return ProtoTaskRepeat.DAILY;
		case "weekly":
			return ProtoTaskRepeat.WEEKLY;
		case "monthly":
			return ProtoTaskRepeat.MONTHLY;
		case "yearly":
			return ProtoTaskRepeat.YEARLY;
		default:
			return ProtoTaskRepeat.NONE;
	}
}

function repeatFromProto(repeat: ProtoTaskRepeat | string): TaskRepeat {
	switch (repeat) {
		case ProtoTaskRepeat.DAILY:
		case "TASK_REPEAT_DAILY":
			return "daily";
		case ProtoTaskRepeat.WEEKLY:
		case "TASK_REPEAT_WEEKLY":
			return "weekly";
		case ProtoTaskRepeat.MONTHLY:
		case "TASK_REPEAT_MONTHLY":
			return "monthly";
		case ProtoTaskRepeat.YEARLY:
		case "TASK_REPEAT_YEARLY":
			return "yearly";
		default:
			return "none";
	}
}

function statusToProto(status: TaskStatus): ProtoTaskStatus {
	switch (status) {
		case "in_progress":
			return ProtoTaskStatus.IN_PROGRESS;
		case "in_review":
			return ProtoTaskStatus.IN_REVIEW;
		case "rejected":
			return ProtoTaskStatus.REJECTED;
		case "completed":
			return ProtoTaskStatus.COMPLETED;
		case "cancelled":
			return ProtoTaskStatus.CANCELLED;
		default:
			return ProtoTaskStatus.TODO;
	}
}

function statusFromProto(status: ProtoTaskStatus | string): TaskStatus {
	switch (status) {
		case ProtoTaskStatus.IN_PROGRESS:
		case "TASK_STATUS_IN_PROGRESS":
			return "in_progress";
		case ProtoTaskStatus.IN_REVIEW:
		case "TASK_STATUS_IN_REVIEW":
			return "in_review";
		case ProtoTaskStatus.REJECTED:
		case "TASK_STATUS_REJECTED":
			return "rejected";
		case ProtoTaskStatus.COMPLETED:
		case "TASK_STATUS_COMPLETED":
			return "completed";
		case ProtoTaskStatus.CANCELLED:
		case "TASK_STATUS_CANCELLED":
			return "cancelled";
		default:
			return "todo";
	}
}

function toRfc3339(value: string | null | undefined): string | undefined {
	const normalized = normalizeOptional(value);
	if (!normalized) return undefined;
	const date = new Date(normalized);
	return Number.isNaN(date.getTime()) ? normalized : date.toISOString();
}

function fromRfc3339(value: string | undefined): string | null {
	if (!value) return null;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	const offset = date.getTimezoneOffset();
	const local = new Date(date.getTime() - offset * 60_000);
	return local.toISOString().slice(0, 16);
}

export function createMemoryTaskStorage(initialTasks: TaskRecord[] = []): TaskStorage {
	let tasks = [...initialTasks];
	return {
		read: () => [...tasks],
		write(nextTasks) {
			tasks = [...nextTasks];
		},
	};
}

export function createLocalTaskStorage(
	state: LocalStateService = createLocalStateService(),
): TaskStorage {
	return {
		async read() {
			const parsed = await state.read<unknown>(STORAGE_KEY);
			return Array.isArray(parsed) ? parsed.map(normalizeTask).filter(isTaskRecord) : [];
		},
		async write(tasks) {
			await state.put(STORAGE_KEY, tasks);
		},
	};
}

function normalizeOptional(value: string | null | undefined): string | null {
	const trimmed = value?.trim() ?? "";
	return trimmed ? trimmed : null;
}

function normalizeIds(value: string[] | null | undefined): string[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	return value
		.map((id) => id.trim())
		.filter((id) => id.length > 0)
		.filter((id) => {
			if (seen.has(id)) return false;
			seen.add(id);
			return true;
		});
}

function normalizeRepeat(value: TaskRepeat | null | undefined): TaskRepeat {
	switch (value) {
		case "daily":
		case "weekly":
		case "monthly":
		case "yearly":
			return value;
		default:
			return "none";
	}
}

function emptyRichTextDocumentJson(): string {
	return JSON.stringify({
		type: "doc",
		content: [{ type: "paragraph" }],
	});
}

function richTextDocumentJsonFromText(text: string | null | undefined): string {
	const trimmed = text?.trim() ?? "";
	if (!trimmed) return emptyRichTextDocumentJson();
	return JSON.stringify({
		type: "doc",
		content: [
			{
				type: "paragraph",
				content: [{ type: "text", text: trimmed }],
			},
		],
	});
}

function normalizeRichTextDocumentJson(
	docJson: string | null | undefined,
	fallbackText: string | null | undefined,
): string {
	const trimmed = docJson?.trim() ?? "";
	if (!trimmed) return richTextDocumentJsonFromText(fallbackText);
	try {
		JSON.parse(trimmed);
		return trimmed;
	} catch {
		return richTextDocumentJsonFromText(fallbackText);
	}
}

function isTaskRecord(task: TaskRecord | null): task is TaskRecord {
	return task !== null;
}

function isTaskDocumentRecord(document: TaskDocumentRecord | null): document is TaskDocumentRecord {
	return document !== null;
}

function normalizeDocument(value: unknown): TaskDocumentRecord | null {
	if (!value || typeof value !== "object") return null;
	const document = value as Partial<TaskDocumentRecord>;
	if (!document.id || !document.name) return null;
	return {
		id: String(document.id),
		taskId: document.taskId ? String(document.taskId) : null,
		objectKey: document.objectKey ? String(document.objectKey) : null,
		name: String(document.name),
		contentType: document.contentType ? String(document.contentType) : "application/octet-stream",
		size: typeof document.size === "number" ? document.size : 0,
		dataUrl: document.dataUrl ? String(document.dataUrl) : null,
		image: document.image === true,
		uploadedAt: document.uploadedAt ? String(document.uploadedAt) : new Date().toISOString(),
	};
}

function normalizeTask(value: unknown): TaskRecord | null {
	if (!value || typeof value !== "object") return null;
	const task = value as Partial<TaskRecord>;
	if (!task.id || !task.familyId || !task.title) return null;
	return {
		id: String(task.id),
		isChore: task.isChore === true,
		familyId: String(task.familyId),
		title: String(task.title),
		details: task.details ? String(task.details) : "",
		detailsDocJson: normalizeRichTextDocumentJson(task.detailsDocJson, task.details),
		assigneeAccountIds: normalizeIds(task.assigneeAccountIds),
		assigneeProfileIds: normalizeIds(task.assigneeProfileIds),
		reviewerAccountIds: normalizeIds(task.reviewerAccountIds),
		startAt: task.startAt ? String(task.startAt) : null,
		endAt: task.endAt ? String(task.endAt) : null,
		repeat: normalizeRepeat(task.repeat),
		status:
			task.status === "completed" ||
			task.status === "cancelled" ||
			task.status === "in_progress" ||
			task.status === "in_review" ||
			task.status === "rejected"
				? task.status
				: "todo",
		comments: Array.isArray(task.comments) ? task.comments : [],
		documents: Array.isArray(task.documents)
			? task.documents.map(normalizeDocument).filter(isTaskDocumentRecord)
			: [],
		createdAt: task.createdAt ? String(task.createdAt) : new Date().toISOString(),
		updatedAt: task.updatedAt ? String(task.updatedAt) : new Date().toISOString(),
	};
}

function sortTasks(tasks: TaskRecord[]): TaskRecord[] {
	return [...tasks].sort((a, b) => {
		const statusRank = statusSortRank(a.status) - statusSortRank(b.status);
		if (statusRank !== 0) return statusRank;
		const aTime = a.startAt ?? a.endAt ?? a.createdAt;
		const bTime = b.startAt ?? b.endAt ?? b.createdAt;
		return aTime.localeCompare(bTime);
	});
}

function statusSortRank(status: TaskStatus): number {
	switch (status) {
		case "todo":
			return 0;
		case "in_progress":
			return 1;
		case "in_review":
			return 2;
		case "rejected":
			return 3;
		case "completed":
			return 4;
		case "cancelled":
			return 5;
	}
}
