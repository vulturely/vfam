<script lang="ts">
	import type { LearningProfile } from "../learning/types";
	import SideForm from "../components/forms/SideForm.svelte";
	import UiPlus from "lucide-svelte/icons/plus";
	import { ErrorToast, IconButton, Input, MultiSelectCombobox } from "../components/index";
	import type { FamilyMemberRecord, FamilyService } from "../family/service";
	import RichTextEditor from "./RichTextEditor.svelte";
	import TaskCard from "./TaskCard.svelte";
	import { SvelteSet } from "svelte/reactivity";
	import type { TaskRecord, TaskRepeat, TaskService, TaskStatus } from "../tasks/service";

	interface MemberOption {
		value: string;
		label: string;
		avatarUrl?: string | null;
		subtitle?: string;
	}

	interface SelectedFile {
		name: string;
		type: string;
		size: number;
		arrayBuffer: () => Promise<ArrayBuffer>;
	}

	interface TaskTemplate {
		id: string;
		title: string;
		details: string;
		repeat: TaskRepeat;
		isChore?: boolean;
	}

	const kidTaskTemplates: TaskTemplate[] = [
		{
			isChore: true,
			id: "fix-bed",
			title: "Fix bed",
			details: "Make the bed and tidy pillows/blankets.",
			repeat: "daily",
		},
		{
			id: "homework",
			title: "Do homework",
			details: "Finish homework and ask questions if stuck.",
			repeat: "daily",
		},
		{
			isChore: true,
			id: "school-bag",
			title: "Pack school bag",
			details: "Pack books, homework, lunch, and water bottle.",
			repeat: "daily",
		},
		{
			id: "reading",
			title: "Read 20 minutes",
			details: "Read for 20 minutes.",
			repeat: "daily",
		},
	];

	const choreTemplates: TaskTemplate[] = [
		{
			id: "trash",
			title: "Take out the trash",
			details: "Empty the bins and replace the liners.",
			repeat: "weekly",
			isChore: true,
		},
		{
			id: "dishwasher",
			title: "Load the dishwasher",
			details: "Load the dishwasher and tidy the kitchen.",
			repeat: "daily",
			isChore: true,
		},
	];
	let {
		familyId,
		members,
		childProfiles = [],
		service,
		familyService,
		currentAccountId = null,
		initialFilter = "all",
		readOnly = false,
	}: {
		initialFilter?: string;
		readOnly?: boolean;
		familyId: string | null;
		members: FamilyMemberRecord[];
		childProfiles?: LearningProfile[];
		service: TaskService;
		familyService: FamilyService;
		currentAccountId?: string | null;
	} = $props();

	let tasks = $state<TaskRecord[]>([]);
	let editingTaskId = $state<string | null>(null);
	let title = $state("");
	let details = $state("");
	let detailsDocJson = $state(emptyRichTextDocumentJson());
	let richTextEditorKey = $state(0);
	let assigneeAccountIds = $state<string[]>([]);
	let reviewerAccountIds = $state<string[]>([]);
	let startAt = $state("");
	let endAt = $state("");
	let repeat = $state<TaskRepeat>("none");
	let category = $state("task");
	let taskFilter = $derived(initialFilter === "chores" ? "chores" : "all");
	const visibleTasks = $derived(tasks.filter((task) => taskFilter !== "chores" || task.isChore));
	let taskModalOpen = $state(false);
	let commentDrafts = $state<Record<string, string>>({});
	let loading = $state(false);
	let saving = $state(false);
	let errorMessage = $state("");

	const openTasks = $derived(
		visibleTasks.filter(
			(task) =>
				task.status === "todo" || task.status === "in_progress" || task.status === "in_review",
		),
	);
	const closedTasks = $derived(
		visibleTasks.filter(
			(task) =>
				task.status === "rejected" || task.status === "completed" || task.status === "cancelled",
		),
	);
	const memberOptions = $derived<MemberOption[]>(
		members.map((member) => {
			const info = memberInfo[member.accountId];
			return {
				value: member.accountId,
				label: info?.displayName ?? member.accountId,
				avatarUrl: info?.avatarUrl ?? null,
				subtitle: member.accountId,
			};
		}),
	);
	const assigneeOptions = $derived<MemberOption[]>([
		...memberOptions,
		...childProfiles.map((child) => ({
			value: `profile:${child.id}`,
			label: child.displayName,
			subtitle: "Child profile",
		})),
	]);
	let memberInfo = $state<Record<string, { displayName: string; avatarUrl: string | null }>>({});
	const createdObjectUrls = new SvelteSet<string>();

	$effect(() => {
		if (!familyId) return;
		for (const member of members) {
			if (memberInfo[member.accountId]) continue;
			void (async () => {
				try {
					const account = await familyService.getAccount(member.accountId);
					const avatar = await familyService.getAvatar(member.accountId);
					let avatarUrl: string | null = null;
					if (avatar && avatar.image.length > 0) {
						avatarUrl = URL.createObjectURL(
							new Blob([new Uint8Array(avatar.image)], {
								type: avatar.contentType,
							}),
						);
						createdObjectUrls.add(avatarUrl);
					}
					memberInfo = {
						...memberInfo,
						[member.accountId]: {
							displayName: account?.displayName ?? member.accountId,
							avatarUrl,
						},
					};
				} catch {
					// Leave the account id as the display label if enrichment fails.
				}
			})();
		}
	});

	$effect(() => {
		return () => {
			for (const url of createdObjectUrls) URL.revokeObjectURL(url);
			createdObjectUrls.clear();
		};
	});

	$effect(() => {
		if (!familyId) {
			tasks = [];
			return;
		}
		void loadTasks();
	});

	async function loadTasks() {
		if (!familyId) return;
		loading = true;
		errorMessage = "";
		try {
			tasks = await service.listTasks(familyId);
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : "Could not load tasks.";
		} finally {
			loading = false;
		}
	}

	function resetTaskForm() {
		editingTaskId = null;
		title = "";
		details = "";
		detailsDocJson = emptyRichTextDocumentJson();
		richTextEditorKey += 1;
		assigneeAccountIds = [];
		reviewerAccountIds = [];
		startAt = "";
		endAt = "";
		repeat = "none";
		category = taskFilter === "chores" ? "chore" : "task";
	}

	function openCreateModal() {
		resetTaskForm();
		taskModalOpen = true;
	}

	function closeTaskModal() {
		taskModalOpen = false;
		resetTaskForm();
	}

	function startEdit(task: TaskRecord) {
		editingTaskId = task.id;
		title = task.title;
		details = task.details;
		detailsDocJson = task.detailsDocJson;
		richTextEditorKey += 1;
		assigneeAccountIds = [
			...task.assigneeAccountIds,
			...(task.assigneeProfileIds ?? []).map((id) => `profile:${id}`),
		];
		reviewerAccountIds = [...task.reviewerAccountIds];
		startAt = task.startAt ?? "";
		endAt = task.endAt ?? "";
		repeat = task.repeat;
		category = task.isChore ? "chore" : "task";
		taskModalOpen = true;
	}

	function applyTemplateById(templateId: string) {
		const template = [...kidTaskTemplates, ...choreTemplates].find(
			(candidate) => candidate.id === templateId,
		);
		if (!template) return;
		title = template.title;
		details = template.details;
		detailsDocJson = richTextDocumentJsonFromText(template.details);
		richTextEditorKey += 1;
		repeat = template.repeat;
		category = template.isChore ? "chore" : "task";
		if (assigneeAccountIds.length === 0 && members.length > 0) {
			assigneeAccountIds = [members[0].accountId];
		}
	}

	function emptyRichTextDocumentJson() {
		return JSON.stringify({
			type: "doc",
			content: [{ type: "paragraph" }],
		});
	}

	function richTextDocumentJsonFromText(text: string) {
		const trimmed = text.trim();
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

	async function uploadEditorImage(file: {
		name: string;
		type: string;
		size: number;
		arrayBuffer: () => Promise<ArrayBuffer>;
	}) {
		const bytes = new Uint8Array(await file.arrayBuffer());
		// If the task isn't saved yet, embed the image locally as a data URL so
		// paste works in the create modal; it persists with the task on save.
		if (!editingTaskId) {
			return dataUrlFromBytes(bytes, file.type || "image/png");
		}
		const uploaded = await service.addDocuments(editingTaskId, [
			{
				name: file.name || "pasted-image",
				contentType: file.type || "image/png",
				size: file.size,
				content: bytes,
				image: true,
			},
		]);
		const document = uploaded.documents[uploaded.documents.length - 1];
		if (!document) {
			throw new Error("Image upload did not return a URL.");
		}
		return service.getDocumentUrl(editingTaskId, document.id);
	}

	async function downloadDocument(taskId: string, documentId: string, name: string) {
		errorMessage = "";
		try {
			const url = await service.getDocumentUrl(taskId, documentId);
			const link = document.createElement("a");
			link.href = url;
			link.download = name;
			link.click();
		} catch {
			errorMessage = "Document download failed. Check your access and try again.";
		}
	}

	function dataUrlFromBytes(bytes: Uint8Array, contentType: string) {
		let binary = "";
		for (const byte of bytes) binary += String.fromCharCode(byte);
		return `data:${contentType};base64,${globalThis.btoa(binary)}`;
	}

	async function saveTask() {
		if (!familyId) return;
		saving = true;
		errorMessage = "";
		try {
			if (editingTaskId) {
				await service.updateTask(editingTaskId, {
					title,
					details,
					detailsDocJson,
					assigneeAccountIds: assigneeAccountIds.filter((id) => !id.startsWith("profile:")),
					assigneeProfileIds: assigneeAccountIds
						.filter((id) => id.startsWith("profile:"))
						.map((id) => id.slice(8)),
					reviewerAccountIds,
					startAt,
					endAt,
					repeat,
					isChore: category === "chore",
				});
			} else {
				await service.createTask(familyId, {
					title,
					details,
					detailsDocJson,
					assigneeAccountIds: assigneeAccountIds.filter((id) => !id.startsWith("profile:")),
					assigneeProfileIds: assigneeAccountIds
						.filter((id) => id.startsWith("profile:"))
						.map((id) => id.slice(8)),
					reviewerAccountIds,
					startAt,
					endAt,
					repeat,
					isChore: category === "chore",
				});
			}
			closeTaskModal();
			await loadTasks();
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : "Could not save task.";
		} finally {
			saving = false;
		}
	}

	async function setStatus(task: TaskRecord, status: TaskStatus) {
		errorMessage = "";
		try {
			await service.markTaskStatus(task.id, status);
			await loadTasks();
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : "Could not update task.";
		}
	}

	async function deleteTask(task: TaskRecord) {
		errorMessage = "";
		try {
			await service.deleteTask(task.id);
			if (editingTaskId === task.id) closeTaskModal();
			await loadTasks();
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : "Could not delete task.";
		}
	}

	async function addComment(task: TaskRecord) {
		const text = commentDrafts[task.id] ?? "";
		errorMessage = "";
		try {
			await service.addComment(task.id, text, currentAccountId);
			commentDrafts = { ...commentDrafts, [task.id]: "" };
			await loadTasks();
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : "Could not add comment.";
		}
	}

	async function uploadDocuments(task: TaskRecord, files: ArrayLike<SelectedFile> | null) {
		if (!files || files.length === 0) return;
		errorMessage = "";
		try {
			await service.addDocuments(
				task.id,
				await Promise.all(
					Array.from(files).map(async (file) => ({
						name: file.name,
						contentType: file.type,
						size: file.size,
						content: new Uint8Array(await file.arrayBuffer()),
						dataUrl: await fileDataUrl(file),
					})),
				),
			);
			await loadTasks();
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : "Could not upload document.";
		}
	}

	async function fileDataUrl(file: SelectedFile) {
		const bytes = new Uint8Array(await file.arrayBuffer());
		let binary = "";
		for (const byte of bytes) binary += String.fromCharCode(byte);
		const contentType = file.type || "application/octet-stream";
		return `data:${contentType};base64,${globalThis.btoa(binary)}`;
	}

	function assigneeName(accountIds: string[], profileIds: string[] = []) {
		const names = [
			...accountIds.map((id) => memberInfo[id]?.displayName ?? id),
			...profileIds.map(
				(id) => childProfiles.find((child) => child.id === id)?.displayName ?? "Child profile",
			),
		];
		return names.length ? names.join(", ") : "Unassigned";
	}

	function reviewerName(accountIds: string[]) {
		if (accountIds.length === 0) return "No reviewers";
		return accountIds
			.map((accountId) => {
				const member = members.find((candidate) => candidate.accountId === accountId);
				return member ? member.accountId : accountId;
			})
			.join(", ");
	}

	function statusLabel(status: TaskStatus) {
		switch (status) {
			case "in_progress":
				return "In progress";
			case "in_review":
				return "In review";
			case "rejected":
				return "Rejected";
			case "completed":
				return "Completed";
			case "cancelled":
				return "Cancelled";
			default:
				return "Open";
		}
	}

	function repeatLabel(value: TaskRepeat) {
		switch (value) {
			case "daily":
				return "Repeats every day";
			case "weekly":
				return "Repeats every week";
			case "monthly":
				return "Repeats every month";
			case "yearly":
				return "Repeats every year";
			default:
				return "Does not repeat";
		}
	}

	function formattedTimeline(value: string | null) {
		if (!value) return "No timeline";
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return value;
		return new Intl.DateTimeFormat(undefined, {
			dateStyle: "medium",
			timeStyle: "short",
		}).format(date);
	}

	function formattedRange(start: string | null, end: string | null) {
		if (!start && !end) return "No timeline";
		const startLabel = formattedTimeline(start);
		const endLabel = formattedTimeline(end);
		if (start && end) return `${startLabel} – ${endLabel}`;
		return start ? `Starts ${startLabel}` : `Ends ${endLabel}`;
	}
</script>

<div class="v-task-workspace">
	<div class="v-family-section-head">
		<div class="v-task-title-row">
			<h3>Tasks</h3>
			<IconButton
				label="Create task"
				icon={UiPlus}
				disabled={!familyId || readOnly || tasks.some((task) => task.stale)}
				onclick={openCreateModal}
			/>
		</div>
		<p>Plan tasks and chores for your family.</p>
		<label class="task-filter"
			>Show<select aria-label="Filter tasks" bind:value={taskFilter}
				><option value="all">All tasks</option><option value="chores">Chores</option></select
			></label
		>
	</div>

	{#if tasks.some((task) => task.stale)}
		<p role="status">Showing saved tasks while offline. Changes still require a connection.</p>
	{/if}

	<ErrorToast message={errorMessage} />

	{#if taskModalOpen}
		<SideForm
			title={editingTaskId ? "Edit task ticket" : "Create task ticket"}
			subtitle="Task details"
			onclose={closeTaskModal}
			onsave={saveTask}
			disabled={saving || !familyId}
			saveLabel={saving ? "Saving…" : editingTaskId ? "Save task" : "Add task"}
		>
			<div class="v-ticket-layout">
				<div class="v-ticket-main">
					{#if !editingTaskId}
						<label class="v-task-field compact">
							<span>Template</span>
							<select onchange={(event) => applyTemplateById(event.currentTarget.value)}>
								<option value="">Custom task</option>
								<optgroup label="Chores">
									{#each choreTemplates as template (template.id)}<option value={template.id}
											>{template.title}</option
										>{/each}
								</optgroup>
								<optgroup label="Kids">
									{#each kidTaskTemplates as template (template.id)}
										<option value={template.id}>{template.title}</option>
									{/each}
								</optgroup>
							</select>
						</label>
					{/if}

					<Input
						bind:value={title}
						label="Summary"
						placeholder="Fix bed, do homework, grocery shopping…"
					/>
					<div class="v-task-field description">
						<span>Description</span>
						{#key richTextEditorKey}
							<RichTextEditor
								bind:docJson={detailsDocJson}
								bind:text={details}
								placeholder="Add instructions, checklist, notes, or questions…"
								onUploadImage={uploadEditorImage}
							/>
						{/key}
						<small>Rich text is saved as Tiptap/ProseMirror JSON.</small>
					</div>
				</div>

				<aside class="v-ticket-sidebar" aria-label="Task details">
					<label class="v-task-field"
						><span>Category</span><select aria-label="Task category" bind:value={category}
							><option value="task">Task</option><option value="chore">Chore</option></select
						></label
					>
					<MultiSelectCombobox
						label="Assign to"
						options={assigneeOptions}
						bind:selected={assigneeAccountIds}
						placeholder="Select assignees…"
						searchPlaceholder="Search relatives and children…"
					/>
					<MultiSelectCombobox
						label="Reviewers"
						options={memberOptions}
						bind:selected={reviewerAccountIds}
						placeholder="Select reviewers…"
						searchPlaceholder="Search members…"
					/>
					<label class="v-task-field">
						<span>Start</span>
						<input type="datetime-local" bind:value={startAt} />
					</label>
					<label class="v-task-field">
						<span>End</span>
						<input type="datetime-local" bind:value={endAt} />
					</label>
					<label class="v-task-field">
						<span>Repeat</span>
						<select bind:value={repeat}>
							<option value="none">Does not repeat</option>
							<option value="daily">Every day</option>
							<option value="weekly">Every week</option>
							<option value="monthly">Every month</option>
							<option value="yearly">Every year</option>
						</select>
					</label>
				</aside>
			</div>
		</SideForm>
	{/if}

	{#if loading}
		<p class="v-task-empty">Loading tasks…</p>
	{:else if visibleTasks.length === 0}
		<div class="v-task-empty-card">
			<h4>{taskFilter === "chores" ? "No chores yet" : "No tasks yet"}</h4>
			<p>Add a task or choose a chore template to get started.</p>
		</div>
	{:else}
		<div class="v-task-columns">
			<section class="v-task-column" aria-label="Open tasks">
				<h4>Open</h4>
				<div class="v-task-list">
					{#each openTasks as task (task.id)}
						<article class="v-task-card" data-status={task.status}>
							<TaskCard
								{task}
								ondownload={(document) =>
									void downloadDocument(task.id, document.id, document.name)}
								assignee={assigneeName(task.assigneeAccountIds, task.assigneeProfileIds)}
								reviewer={reviewerName(task.reviewerAccountIds)}
								timeline={formattedRange(task.startAt, task.endAt)}
								repeat={repeatLabel(task.repeat)}
								status={statusLabel(task.status)}
								comment={commentDrafts[task.id] ?? ""}
								onedit={() => startEdit(task)}
								ondelete={() => void deleteTask(task)}
								oncomplete={() => void setStatus(task, "completed")}
								oncancel={() => void setStatus(task, "cancelled")}
								onreopen={() => void setStatus(task, "todo")}
								onstart={() => void setStatus(task, "in_progress")}
								onreview={() => void setStatus(task, "in_review")}
								onreject={() => void setStatus(task, "rejected")}
								oncomment={(value: string) =>
									(commentDrafts = { ...commentDrafts, [task.id]: value })}
								onaddcomment={() => void addComment(task)}
								ondocuments={(files: ArrayLike<SelectedFile> | null) =>
									void uploadDocuments(task, files)}
							/>
						</article>
					{/each}
				</div>
			</section>

			{#if closedTasks.length > 0}
				<section class="v-task-column" aria-label="Completed and cancelled tasks">
					<h4>Done / cancelled</h4>
					<div class="v-task-list compact">
						{#each closedTasks as task (task.id)}
							<article class="v-task-card muted" data-status={task.status}>
								<TaskCard
									{task}
									{readOnly}
									ondownload={(document) =>
										void downloadDocument(task.id, document.id, document.name)}
									assignee={assigneeName(task.assigneeAccountIds, task.assigneeProfileIds)}
									reviewer={reviewerName(task.reviewerAccountIds)}
									timeline={formattedRange(task.startAt, task.endAt)}
									repeat={repeatLabel(task.repeat)}
									status={statusLabel(task.status)}
									comment={commentDrafts[task.id] ?? ""}
									onedit={() => startEdit(task)}
									ondelete={() => void deleteTask(task)}
									oncomplete={() => void setStatus(task, "completed")}
									oncancel={() => void setStatus(task, "cancelled")}
									onreopen={() => void setStatus(task, "todo")}
									onstart={() => void setStatus(task, "in_progress")}
									onreview={() => void setStatus(task, "in_review")}
									onreject={() => void setStatus(task, "rejected")}
									oncomment={(value: string) =>
										(commentDrafts = { ...commentDrafts, [task.id]: value })}
									onaddcomment={() => void addComment(task)}
									ondocuments={(files: ArrayLike<SelectedFile> | null) =>
										void uploadDocuments(task, files)}
								/>
							</article>
						{/each}
					</div>
				</section>
			{/if}
		</div>
	{/if}
</div>

<style>
	.task-filter {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.75rem;
		color: var(--v-muted);
	}
	.task-filter select {
		background: transparent;
		color: var(--v-fg);
		border: 0;
		padding: 0.3rem;
		font: inherit;
	}

	.v-task-workspace {
		display: grid;
		gap: calc(var(--v-space) * 1.5);
	}
	.v-task-empty-card,
	.v-task-card {
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius-sm);
		background: var(--v-surface);
	}
	.v-task-empty-card,
	.v-task-card {
		background: color-mix(in srgb, var(--v-fg) 2%, transparent);
		border-color: var(--v-border);
	}
	.v-family-section-head {
		display: grid;
		gap: 8px;
	}
	.v-family-section-head h3,
	.v-family-section-head p {
		margin: 0;
	}
	.v-task-title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.v-task-title-row h3 {
		font-size: 0.9rem;
		font-weight: 550;
	}
	.v-family-section-head > p,
	.v-task-empty-card p {
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--v-muted);
	}
	.v-task-column h4,
	.v-task-empty-card h4 {
		font-size: 0.82rem;
		font-weight: 550;
	}
	.v-task-column h4,
	.v-task-empty-card h4 {
		margin: 0;
		color: var(--v-fg);
	}
	.v-ticket-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		min-height: 24rem;
	}
	.v-ticket-main,
	.v-ticket-sidebar {
		display: grid;
		align-content: start;
		gap: calc(var(--v-space) * 1.25);
		padding: calc(var(--v-space) * 1.5);
		min-width: 0;
	}
	.v-ticket-sidebar {
		border-top: 1px solid var(--v-border);
		background: color-mix(in srgb, var(--v-surface) 55%, var(--v-bg));
	}
	.v-task-field,
	.v-ticket-main :global(.v-field) {
		display: flex;
		flex-direction: column;
		gap: calc(var(--v-space) * 0.55);
		color: var(--v-fg);
		font-size: 0.95rem;
		font-weight: 600;
	}
	.v-task-field > span,
	.v-ticket-main :global(.v-field-label) {
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--v-muted);
	}
	.v-task-field small {
		color: var(--v-muted);
		font-size: 0.78rem;
		font-weight: 500;
	}
	.v-task-field.compact {
		max-width: 20rem;
	}
	.v-task-field input,
	.v-task-field select {
		width: 100%;
		min-height: max(var(--v-control-h), 44px);
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius-sm);
		background: var(--v-bg);
		color: var(--v-fg);
		font: inherit;
		padding: 0 calc(var(--v-space) * 1.25);
	}
	.v-task-field select:focus-visible {
		outline: 2px solid var(--v-ring);
		outline-offset: 1px;
	}

	.v-task-empty,
	.v-task-empty-card p {
		margin: 0;
		color: var(--v-muted);
	}
	.v-task-empty-card {
		padding: 1rem;
	}
	.v-task-columns {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(18rem, 0.55fr);
		gap: calc(var(--v-space) * 1.5);
		align-items: start;
	}
	.v-task-column,
	.v-task-list {
		display: grid;
		gap: var(--v-space);
	}
	.v-task-card {
		padding: calc(var(--v-space) * 1.25);
	}
	.v-task-card.muted {
		opacity: 0.82;
	}

	@media (max-width: 920px) {
		.v-ticket-layout,
		.v-task-columns {
			grid-template-columns: 1fr;
		}
	}
</style>
