<script lang="ts">
	import UiDownload from "lucide-svelte/icons/download";
	import CheckCircle from "lucide-svelte/icons/check-circle";
	import Ban from "lucide-svelte/icons/ban";
	import RotateCcw from "lucide-svelte/icons/rotate-ccw";
	import Play from "lucide-svelte/icons/play";
	import Eye from "lucide-svelte/icons/eye";
	import XCircle from "lucide-svelte/icons/x-circle";
	import Pencil from "lucide-svelte/icons/pencil";
	import Trash2 from "lucide-svelte/icons/trash-2";
	import Paperclip from "lucide-svelte/icons/paperclip";
	import MessageSquare from "lucide-svelte/icons/message-square";
	import type { TaskDocumentRecord, TaskRecord } from "../tasks/service";

	type SelectedFileList = ArrayLike<{
		name: string;
		type: string;
		size: number;
		arrayBuffer: () => Promise<ArrayBuffer>;
	}>;

	let {
		task,
		readOnly = false,
		assignee,
		reviewer,
		timeline,
		repeat,
		status,
		comment,
		onedit,
		ondelete,
		oncomplete,
		oncancel,
		onreopen,
		onstart,
		onreview,
		onreject,
		oncomment,
		onaddcomment,
		ondocuments,
		ondownload,
	}: {
		task: TaskRecord;
		readOnly?: boolean;
		ondownload: (document: TaskDocumentRecord) => void;
		assignee: string;
		reviewer: string;
		timeline: string;
		repeat: string;
		status: string;
		comment: string;
		onedit: () => void;
		ondelete: () => void;
		oncomplete: () => void;
		oncancel: () => void;
		onreopen: () => void;
		onstart: () => void;
		onreview: () => void;
		onreject: () => void;
		oncomment: (value: string) => void;
		onaddcomment: () => void;
		ondocuments: (files: SelectedFileList | null) => void;
	} = $props();

	function fileSize(size: number) {
		if (size < 1024) return `${size} B`;
		if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
		return `${(size / (1024 * 1024)).toFixed(1)} MB`;
	}
</script>

<div class="v-task-card-head">
	<div>
		<h5>{task.title}</h5>
		<p>
			{task.isChore ? "Chore · " : ""}{status} · {timeline} · {repeat} · {assignee}
		</p>
		<p class="v-task-card-reviewers">Reviewers: {reviewer}</p>
	</div>
	<fieldset
		class="v-task-actions"
		aria-label={`Actions for ${task.title}`}
		disabled={readOnly || task.stale}
	>
		{#if task.status === "todo"}
			<button type="button" onclick={onstart} aria-label="Start task" title="Start task">
				<Play aria-hidden="true" size={17} strokeWidth={2.4} />
			</button>
		{/if}
		{#if task.status === "in_progress"}
			<button type="button" onclick={onreview} aria-label="Send to review" title="Send to review">
				<Eye aria-hidden="true" size={17} strokeWidth={2.4} />
			</button>
		{/if}
		{#if task.status === "in_review"}
			<button type="button" onclick={onreject} aria-label="Reject task" title="Reject task">
				<XCircle aria-hidden="true" size={17} strokeWidth={2.4} />
			</button>
		{/if}
		{#if task.status !== "completed"}
			<button type="button" onclick={oncomplete} aria-label="Mark completed" title="Mark completed">
				<CheckCircle aria-hidden="true" size={17} strokeWidth={2.4} />
			</button>
		{/if}
		{#if task.status !== "cancelled"}
			<button type="button" onclick={oncancel} aria-label="Cancel task" title="Cancel task">
				<Ban aria-hidden="true" size={17} strokeWidth={2.4} />
			</button>
		{/if}
		{#if task.status !== "todo"}
			<button type="button" onclick={onreopen} aria-label="Reopen task" title="Reopen task">
				<RotateCcw aria-hidden="true" size={17} strokeWidth={2.4} />
			</button>
		{/if}
		<button type="button" onclick={onedit} aria-label="Edit task" title="Edit task">
			<Pencil aria-hidden="true" size={17} strokeWidth={2.4} />
		</button>
		<button type="button" onclick={ondelete} aria-label="Delete task" title="Delete task">
			<Trash2 aria-hidden="true" size={17} strokeWidth={2.4} />
		</button>
	</fieldset>
</div>

{#if task.details}
	<p class="v-task-details">{task.details}</p>
{/if}

<div class="v-task-meta">
	<span>{task.comments.length} comments</span>
	<span>{task.documents.length} docs</span>
</div>

{#if task.documents.length > 0}
	<ul class="v-task-docs" aria-label="Uploaded documents">
		{#each task.documents as document (document.id)}
			<li>
				<Paperclip aria-hidden="true" size={15} strokeWidth={2.2} />
				<button type="button" class="v-document-download" onclick={() => ondownload(document)}
					><UiDownload aria-hidden="true" size={18} strokeWidth={1.8} />
					{document.name}</button
				>
				<small>{fileSize(document.size)}</small>
			</li>
		{/each}
	</ul>
{/if}

{#if task.comments.length > 0}
	<ul class="v-task-comments" aria-label="Task comments">
		{#each task.comments as taskComment (taskComment.id)}
			<li>
				<MessageSquare aria-hidden="true" size={15} strokeWidth={2.2} />
				<span>{taskComment.text}</span>
			</li>
		{/each}
	</ul>
{/if}

<fieldset class="v-task-collab" disabled={readOnly || task.stale}>
	<label class="v-task-upload">
		<Paperclip aria-hidden="true" size={16} strokeWidth={2.2} />
		<span>Upload docs</span>
		<input
			type="file"
			multiple
			onchange={(event) => {
				ondocuments(event.currentTarget.files);
				event.currentTarget.value = "";
			}}
		/>
	</label>
	<label class="v-comment-field">
		<span class="sr-only">Add note or question</span>
		<input
			value={comment}
			placeholder="Ask a question or add a note…"
			oninput={(event) => oncomment(event.currentTarget.value)}
		/>
	</label>
	<button
		type="button"
		class="v-task-comment-btn"
		disabled={!comment.trim()}
		onclick={onaddcomment}
		aria-label="Add comment"
		title="Add comment"
	>
		<MessageSquare aria-hidden="true" size={17} strokeWidth={2.4} />
	</button>
</fieldset>

<style>
	fieldset {
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}
	.v-document-download {
		border: 0;
		padding: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		text-decoration: underline;
		cursor: pointer;
	}

	:global(.v-task-card) {
		display: grid;
		gap: var(--v-space);
	}
	.v-task-card-head,
	.v-task-actions,
	.v-task-meta,
	.v-task-collab,
	.v-task-docs li,
	.v-task-comments li {
		display: flex;
		align-items: center;
	}
	.v-task-card-head {
		justify-content: space-between;
		gap: var(--v-space);
	}
	.v-task-card-reviewers {
		color: var(--v-muted);
		font-size: 0.85rem;
		margin-top: calc(var(--v-space) * 0.25);
	}
	h5,
	p {
		margin: 0;
	}
	h5 {
		color: var(--v-fg);
	}
	p,
	.v-task-meta,
	.v-task-docs small {
		color: var(--v-muted);
	}
	:global(.v-task-card[data-status="completed"]) h5 {
		text-decoration: line-through;
	}
	.v-task-actions {
		gap: calc(var(--v-space) / 2);
		flex-wrap: wrap;
		justify-content: flex-end;
	}
	.v-task-actions button,
	.v-task-comment-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border: 1px solid var(--v-border);
		border-radius: 999px;
		background: var(--v-surface);
		color: var(--v-fg);
		cursor: pointer;
	}
	.v-task-actions button:hover,
	.v-task-comment-btn:hover {
		color: var(--v-primary);
	}
	.v-task-comment-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.v-task-details {
		color: var(--v-fg);
		overflow-wrap: anywhere;
	}
	.v-task-meta {
		gap: var(--v-space);
		font-size: 0.9rem;
	}
	.v-task-docs,
	.v-task-comments {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: calc(var(--v-space) / 2);
	}
	.v-task-docs li,
	.v-task-comments li {
		gap: calc(var(--v-space) / 2);
		min-width: 0;
		color: var(--v-fg);
	}
	.v-document-download,
	.v-task-comments span {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.v-task-collab {
		gap: calc(var(--v-space) / 2);
		flex-wrap: wrap;
	}
	.v-task-upload {
		display: inline-flex;
		align-items: center;
		gap: calc(var(--v-space) / 2);
		min-height: 2.25rem;
		padding: 0 var(--v-space);
		border: 1px solid var(--v-border);
		border-radius: 999px;
		background: var(--v-bg);
		color: var(--v-fg);
		font-weight: 700;
		cursor: pointer;
	}
	.v-task-upload input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}
	.v-comment-field {
		flex: 1 1 14rem;
		min-width: 0;
	}
	.v-comment-field input {
		width: 100%;
		min-height: 2.25rem;
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius-sm);
		background: var(--v-bg);
		color: var(--v-fg);
		font: inherit;
		padding: 0 calc(var(--v-space) * 1.25);
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	@media (max-width: 560px) {
		.v-task-card-head {
			align-items: flex-start;
			flex-direction: column;
		}
		.v-task-actions {
			justify-content: flex-start;
		}
		.v-task-collab {
			align-items: stretch;
			flex-direction: column;
		}
		.v-task-upload,
		.v-task-comment-btn {
			width: 100%;
			justify-content: center;
		}
	}
</style>
