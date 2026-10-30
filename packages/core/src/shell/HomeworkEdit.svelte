<script lang="ts">
	import { getContext, untrack } from "svelte";
	import Check from "lucide-svelte/icons/check";
	import X from "lucide-svelte/icons/x";
	import { ErrorToast, IconButton, Input } from "../components/index";
	import type { Runtime } from "../runtime/registry.svelte";
	import type { Homework } from "../homework/service";
	import { HomeworkMediaType, type HomeworkAnswer } from "../api/protocol";
	import { problem, sameQuestions } from "../homework/questionTypes";
	import HomeworkWritingEditor from "./HomeworkWritingEditor.svelte";
	import HomeworkFilePicker from "./HomeworkFilePicker.svelte";
	import QuestionsEditor from "./QuestionsEditor.svelte";
	let {
		item,
		content,
		onsaved,
		oncancel,
	}: {
		item: Homework;
		content: string;
		onsaved: (updated: Homework) => void;
		oncancel: () => void;
	} = $props();
	const runtime = getContext<Runtime>("vulture:runtime");
	const original = untrack(() => ({
		title: item.homework!.title,
		subject: item.homework!.subject,
		content,
		questions: item.answerKey,
	}));
	let title = $state(original.title);
	let subject = $state(original.subject);
	let text = $state(original.content);
	let questions = $state<HomeworkAnswer[]>(untrack(() => item.answerKey));
	let files = $state<globalThis.FileList>();
	let showIssues = $state(false);
	let busy = $state(false);
	let error = $state("");
	const typed = $derived(item.sources[0]?.mediaType === HomeworkMediaType.TEXT);
	const questionsChanged = $derived(!sameQuestions(questions, original.questions));
	const dirty = $derived(
		title.trim() !== original.title ||
			subject.trim() !== original.subject ||
			(typed && text !== original.content) ||
			!!files?.[0] ||
			questionsChanged,
	);
	async function save(event: globalThis.SubmitEvent) {
		event.preventDefault();
		if (busy || !dirty) return;
		error = "";
		// Questions are only checked when edited, so titles of worksheets with
		// unanswered extracted questions can still be changed.
		if (questionsChanged && !files?.[0] && questions.some((q) => problem(q))) {
			showIssues = true;
			error = "Fix the questions marked below.";
			return;
		}
		busy = true;
		try {
			const source = item.sources[0]?.source;
			if (!source) throw new Error("Reload homework before editing.");
			const updated = await runtime.services.homework.update(
				item.homework!.id,
				source,
				title,
				subject,
				typed && text !== original.content ? text : files?.[0],
				questionsChanged && !files?.[0] ? questions : undefined,
			);
			onsaved(updated);
		} catch (e) {
			error = e instanceof Error ? e.message : "Could not save homework. Please retry.";
		} finally {
			busy = false;
		}
	}
</script>

<form class="homework-edit" onsubmit={save}>
	<div class="edit-body">
		{#if typed}<HomeworkWritingEditor bind:title bind:subject bind:text />
		{:else}<div class="file-edit">
				<Input label="Homework title" bind:value={title} /><Input
					label="Homework subject"
					bind:value={subject}
				/><HomeworkFilePicker
					label="Replace worksheet (optional)"
					accept="image/jpeg,image/png,application/pdf"
					hint="Keep the original file, or choose a replacement"
					bind:files
				/>
			</div>{/if}
		{#if files?.[0]}<p class="edit-notice">
				A new worksheet clears the questions read from the old one.
			</p>
		{:else}
			<section class="questions" aria-label="Questions for your child">
				<h3>Questions for your child</h3>
				<QuestionsEditor bind:questions disabled={busy} {showIssues} />
			</section>
			{#if item.answerKey.length && dirty}<p class="edit-notice">
					Assign the questions again after saving so your child gets this version.
				</p>{/if}
		{/if}
	</div>
	<ErrorToast message={error} />
	<div class="edit-actions">
		<IconButton icon={X} label="Cancel editing homework" disabled={busy} onclick={oncancel} /><span
			aria-live="polite">{busy ? "Saving…" : ""}</span
		>{#if dirty}<IconButton
				icon={Check}
				type="submit"
				label="Save homework changes"
				disabled={busy}
			/>{/if}
	</div>
</form>

<style>
	.homework-edit {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		min-width: 0;
	}
	.edit-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding-bottom: 16px;
	}
	.file-edit {
		display: grid;
		gap: 16px;
		padding: 20px;
	}
	.questions {
		display: grid;
		gap: 0.75rem;
		padding: 16px 20px 0;
	}
	h3 {
		margin: 0;
		font-size: 0.95rem;
	}
	.edit-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		flex-shrink: 0;
		border-top: 1px solid var(--v-border);
	}
	.edit-actions span {
		flex: 1;
		font-size: 0.75rem;
		color: var(--v-muted);
	}
	p {
		font-size: 0.75rem;
		padding: 4px 20px;
		margin: 0;
	}
	.edit-notice {
		color: var(--v-muted);
	}
</style>
