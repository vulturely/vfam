<script lang="ts">
	import { getContext, onMount, untrack } from "svelte";
	import ScanText from "lucide-svelte/icons/scan-text";
	import Sparkles from "lucide-svelte/icons/sparkles";
	import { ErrorToast, IconButton } from "../components/index";
	import { DEFAULT_PARSER_YAML, parserJson } from "../homework/questions";
	import type { Runtime } from "../runtime/registry.svelte";
	import type { HomeworkAnswer, SourceSegment } from "../api/protocol";
	import HomeworkQuestions from "./HomeworkQuestions.svelte";
	let {
		profileId,
		file,
		loadFile,
		yaml = $bindable(DEFAULT_PARSER_YAML),
		questions = $bindable([]),
		appliedYaml = $bindable(""),
		busy = $bindable(false),
		autoApply = false,
		rawUrl = "",
		rawType = "",
		rawText = "",
		title = "Worksheet",
	}: {
		profileId: string;
		file?: File;
		loadFile?: () => Promise<File>;
		yaml?: string;
		questions?: HomeworkAnswer[];
		appliedYaml?: string;
		busy?: boolean;
		autoApply?: boolean;
		rawUrl?: string;
		rawType?: string;
		rawText?: string;
		title?: string;
	} = $props();
	const runtime = getContext<Runtime>("vulture:runtime");
	let segments = $state<SourceSegment[]>([]);
	let hasOcr = $state(false);
	let warnings = $state<string[]>([]);
	let error = $state("");
	let view = $state<"preview" | "yaml" | "raw" | "text">(
		untrack(() => (questions.length || autoApply ? "preview" : "raw")),
	);
	let showHelp = $state(false);
	let layout = $state("");
	let consent = $state(false);
	async function request(recipe: string) {
		parserJson(recipe);
		const selected = file;
		const input = hasOcr ? { segments } : { file: selected ?? (await loadFile?.()) };
		if (!hasOcr && !input.file) throw new Error("Choose the original worksheet first.");
		const result = await runtime.services.homework.parseWorksheet(profileId, recipe, input);
		if (file !== selected)
			throw new Error("Worksheet changed while reading. Apply the parser again.");
		segments = result.segments;
		hasOcr = true;
		return result;
	}
	async function apply() {
		if (busy) return;
		busy = true;
		error = "";
		// Keep a tab the guardian opened while the worksheet was being read.
		const started = view;
		try {
			const recipe = yaml;
			const result = await request(recipe);
			questions = result.questions;
			warnings = result.warnings;
			appliedYaml = recipe;
			showHelp = false;
			if (view === started) view = result.questions.length ? "preview" : "yaml";
		} catch (e) {
			error = e instanceof Error ? e.message : "Could not apply the parser.";
			view = "yaml";
		} finally {
			busy = false;
		}
	}
	async function assist() {
		if (busy) return;
		if (!consent) {
			error = "Allow AI to use extracted text to write the parser.";
			return;
		}
		busy = true;
		error = "";
		try {
			if (!hasOcr) await request(DEFAULT_PARSER_YAML);
			const recipe = await runtime.services.homework.suggestParser(
				profileId,
				segments,
				layout,
				true,
			);
			yaml = recipe;
			// AI only writes rules. This separate local parser obtains every output field.
			const result = await request(recipe);
			questions = result.questions;
			warnings = result.warnings;
			appliedYaml = recipe;
			showHelp = false;
			view = result.questions.length ? "preview" : "yaml";
		} catch (e) {
			error = e instanceof Error ? e.message : "Could not write a parser. Manual YAML still works.";
		} finally {
			busy = false;
		}
	}
	onMount(() => {
		if (autoApply) void apply();
	});
</script>

<div class="parser-workspace">
	<div class="parser-controls">
		<span
			>{busy
				? "Reading worksheet…"
				: "YAML rules extract text locally. Missing answers stay empty."}</span
		><button type="button" class="help-trigger" onclick={() => (showHelp = !showHelp)}
			>I don’t know how to write a parser</button
		><IconButton icon={ScanText} label="Apply YAML parser" disabled={busy} onclick={apply} />
	</div>
	{#if showHelp}<div class="parser-assist">
			<label
				>Describe the layout (optional)<input
					bind:value={layout}
					maxlength="2000"
					placeholder="e.g. numbered questions on the left; answers on the right"
					disabled={busy}
				/></label
			><label class="consent"
				><input type="checkbox" bind:checked={consent} disabled={busy} />Allow AI to read extracted
				text and write YAML rules</label
			>
			<p>AI writes the parser. The local parser extracts the Q&A; it does not generate answers.</p>
			<IconButton icon={Sparkles} label="Write parser with AI" disabled={busy} onclick={assist} />
		</div>{/if}
	<ErrorToast message={error} />
	<HomeworkQuestions
		bind:yaml
		bind:view
		{questions}
		{segments}
		{warnings}
		stale={yaml !== appliedYaml}
		{rawUrl}
		{rawType}
		{rawText}
		{title}
		readonly={busy}
	/>
</div>

<style>
	.parser-workspace {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		min-width: 0;
		overflow: hidden;
	}
	.parser-controls {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 12px;
		flex-wrap: wrap;
		flex-shrink: 0;
	}
	.parser-controls span,
	.parser-assist p {
		font-size: 0.68rem;
		color: var(--v-muted);
		flex: 1;
	}
	.help-trigger {
		background: transparent;
		border: 0;
		color: var(--v-primary-text, var(--v-primary));
		font: inherit;
		font-size: 0.7rem;
		cursor: pointer;
		padding: 6px 0;
	}
	.parser-controls :global(.v-icon-btn::after),
	.parser-assist :global(.v-icon-btn::after) {
		left: auto;
		right: 0;
		transform: none;
	}
	.parser-assist {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 8px;
		padding: 8px 16px;
		border-bottom: 1px solid var(--v-border);
		flex-shrink: 0;
	}
	.parser-assist label {
		font-size: 0.72rem;
		color: var(--v-muted);
	}
	.parser-assist label:first-child {
		grid-column: 1/-1;
		display: grid;
		gap: 4px;
	}
	.parser-assist input:not([type="checkbox"]) {
		width: 100%;
		box-sizing: border-box;
		background: transparent;
		border: 1px solid var(--v-border);
		border-radius: 4px;
		padding: 8px;
		color: var(--v-fg);
		font: inherit;
	}
	.consent {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.parser-assist p {
		margin: 0;
		grid-column: 1;
	}
	.parser-assist :global(.v-icon-btn) {
		grid-column: 2;
		grid-row: 2/4;
	}
</style>
