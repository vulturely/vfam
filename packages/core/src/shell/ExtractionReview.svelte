<script lang="ts">
	import UiScanText from "lucide-svelte/icons/scan-text";
	import UiCheck from "lucide-svelte/icons/check";
	import { getContext, onMount, untrack } from "svelte";
	import type { Runtime } from "../runtime/registry.svelte";
	import { SourceVersion, SourceSegment } from "../api/protocol";
	import { Button, ErrorToast } from "../components/index";
	let { source, onconfirmed }: { source: SourceVersion; onconfirmed: () => Promise<void> } =
		$props();
	const runtime = getContext<Runtime>("vulture:runtime");
	let current = $state(untrack(() => new SourceVersion(source)));
	let segments = $state<SourceSegment[]>([]);
	let extractionState = $state("pending");
	let busy = $state(false);
	let error = $state("");
	const failures: Record<string, string> = {
		provider_failed: "OCR could not finish. Retry extraction or reupload the worksheet.",
		unsupported: "This worksheet could not be read. Reupload a clearer copy.",
		invalid_output:
			"OCR returned unusable text. Retry or reupload; missing questions will not be invented.",
	};
	async function run(action: () => Promise<void>) {
		if (busy) return;
		busy = true;
		error = "";
		try {
			await action();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Extraction failed. Retry or reupload.";
		} finally {
			busy = false;
		}
	}
	async function load() {
		const result = await runtime.services.extraction.load(current);
		segments = result.segments;
		extractionState = result.state;
	}
	onMount(() => {
		void run(load);
	});
	async function extract() {
		await run(async () => {
			const result = await runtime.services.extraction.extract(current);
			segments = result.segments;
			extractionState = result.state;
		});
	}
	async function confirm() {
		await run(async () => {
			const result = await runtime.services.extraction.confirm(current, segments);
			if (result.source) current = result.source;
			segments = result.segments;
			extractionState = "confirmed";
			await onconfirmed();
		});
	}
</script>

<section aria-label="Parent text review">
	<h4>Review extracted text</h4>
	<p>
		Worksheet text is untrusted source material. Review every region against the original before
		creating practice. Correct uncertain or missing text, or reupload a clearer copy.
	</p>
	<ErrorToast message={error} />
	<ErrorToast message={failures[extractionState]} />
	{#if extractionState === "confirmed"}<p role="status">
			Source text approved. Practice can use this corrected version.
		</p>{/if}
	<Button icon={UiScanText} variant="ghost" disabled={busy} onclick={extract}
		>{busy ? "Extracting…" : "Extract / retry text"}</Button
	>
	{#each segments as segment (segment.id)}
		<label>
			<span
				>Page {segment.pageNumber}, region {segment.ordinal + 1} · {Math.round(
					segment.confidence * 100,
				)}% confidence{segment.needsReview
					? " · Uncertain — correction required"
					: " · Parent review required"}</span
			>
			<textarea
				aria-label={`Page ${segment.pageNumber} region ${segment.ordinal + 1} text`}
				value={segment.text}
				oninput={(event) => {
					segments = segments.map((s) =>
						s.id === segment.id ? new SourceSegment({ ...s, text: event.currentTarget.value }) : s,
					);
				}}
				disabled={busy || extractionState === "confirmed"}
				maxlength="5000"
				rows="4"></textarea>
			<small>Source area: {segment.region.join(", ")}</small>
		</label>
	{/each}
	{#if segments.length && extractionState !== "confirmed"}<Button
			icon={UiCheck}
			disabled={busy || segments.some((s) => !s.text.trim())}
			onclick={confirm}>Approve corrected source text</Button
		>{/if}
</section>

<style>
	section,
	label {
		display: grid;
		gap: var(--v-space);
		padding-block: var(--v-space);
	}
	p,
	small {
		color: var(--v-muted);
	}
	textarea {
		width: 100%;
		box-sizing: border-box;
		resize: vertical;
		padding: var(--v-space);
		font: inherit;
		background: var(--v-bg);
		color: var(--v-fg);
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius-sm);
	}
	textarea:focus-visible {
		border-color: var(--v-primary);
	}
</style>
