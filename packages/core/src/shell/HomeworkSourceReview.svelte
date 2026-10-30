<script lang="ts">
	import { getContext, untrack } from "svelte";
	import Check from "lucide-svelte/icons/check";
	import X from "lucide-svelte/icons/x";
	import { ErrorToast, IconButton } from "../components/index";
	import WorksheetParser from "./WorksheetParser.svelte";
	import { DEFAULT_PARSER_YAML } from "../homework/questions";
	import type { Homework } from "../homework/service";
	import type { Runtime } from "../runtime/registry.svelte";
	let {
		item,
		rawUrl,
		rawType,
		rawText,
		onsaved,
	}: {
		item: Homework;
		rawUrl: string;
		rawType: string;
		rawText: string;
		onsaved: (item: Homework) => void;
	} = $props();
	const runtime = getContext<Runtime>("vulture:runtime");
	let current = $state(untrack(() => item));
	let baseline = $state(untrack(() => item.parserYaml || DEFAULT_PARSER_YAML));
	let yaml = $state(untrack(() => baseline));
	let questions = $state(untrack(() => item.answerKey));
	let appliedYaml = $state(untrack(() => item.parserYaml));
	let busy = $state(false);
	let error = $state("");
	const dirty = $derived(
		yaml !== baseline || JSON.stringify(questions) !== JSON.stringify(current.answerKey),
	);
	async function loadFile() {
		return new File([await runtime.services.homework.download(current.homework!.id)], "worksheet", {
			type: rawType,
		});
	}
	async function save() {
		if (busy || !dirty || appliedYaml !== yaml || !questions.length) return;
		busy = true;
		error = "";
		try {
			const source = current.sources[0]?.source;
			if (!source) throw new Error("Reload the worksheet before saving.");
			const updated = await runtime.services.homework.update(
				current.homework!.id,
				source,
				current.homework!.title,
				current.homework!.subject,
				undefined,
				questions,
				yaml,
			);
			current = updated;
			baseline = updated.parserYaml;
			yaml = baseline;
			questions = updated.answerKey;
			appliedYaml = baseline;
			onsaved(updated);
		} catch (e) {
			error = e instanceof Error ? e.message : "Could not save parser.";
		} finally {
			busy = false;
		}
	}
</script>

<div class="source-review">
	<WorksheetParser
		profileId={item.homework!.profileId}
		{loadFile}
		bind:yaml
		bind:questions
		bind:appliedYaml
		bind:busy
		{rawUrl}
		{rawType}
		{rawText}
		title={item.homework!.title}
	/>
	<ErrorToast message={error} />
	{#if dirty}<div class="save-actions">
			<IconButton
				icon={X}
				label="Cancel parser changes"
				disabled={busy}
				onclick={() => {
					yaml = baseline;
					questions = current.answerKey;
					appliedYaml = current.parserYaml;
					error = "";
				}}
			/><span>{appliedYaml !== yaml ? "Apply the parser before saving." : ""}</span><IconButton
				icon={Check}
				label="Save worksheet parser"
				disabled={busy || appliedYaml !== yaml || !questions.length}
				onclick={save}
			/>
		</div>{/if}
</div>

<style>
	.source-review {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
		min-width: 0;
		overflow: hidden;
	}
	.save-actions {
		display: flex;
		align-items: center;
		padding: 4px 12px;
		flex-shrink: 0;
		gap: 8px;
	}
	.save-actions span {
		flex: 1;
		font-size: 0.7rem;
		color: var(--v-muted);
	}
	.save-actions :global(.v-icon-btn::after) {
		left: auto;
		right: 0;
		transform: none;
	}
</style>
