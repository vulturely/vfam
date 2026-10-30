<script lang="ts">
	import { parserJson } from "../homework/questions";
	import { ErrorToast } from "../components/index";
	import type { HomeworkAnswer, SourceSegment } from "../api/protocol";
	let {
		yaml = $bindable(""),
		questions = [],
		segments = [],
		warnings = [],
		stale = false,
		rawUrl = "",
		rawType = "",
		rawText = "",
		title = "Worksheet",
		readonly = false,
		view = $bindable("preview"),
	}: {
		yaml?: string;
		questions?: HomeworkAnswer[];
		segments?: SourceSegment[];
		warnings?: string[];
		stale?: boolean;
		rawUrl?: string;
		rawType?: string;
		rawText?: string;
		title?: string;
		readonly?: boolean;
		view?: "preview" | "yaml" | "raw" | "text";
	} = $props();
	const yamlError = $derived.by(() => {
		try {
			parserJson(yaml);
			return "";
		} catch (e) {
			return e instanceof Error ? e.message : "Invalid YAML parser.";
		}
	});
</script>

<section class="questions-editor" aria-label="Worksheet questions and answers">
	<div class="view-tabs" role="tablist" aria-label="Worksheet views">
		{#each [{ id: "preview", label: "Q&A preview" }, { id: "yaml", label: "Parser YAML" }, { id: "text", label: "Extracted text" }, { id: "raw", label: "Original" }] as tab (tab.id)}
			<button
				type="button"
				role="tab"
				aria-selected={view === tab.id}
				onclick={() => (view = tab.id as typeof view)}>{tab.label}</button
			>
		{/each}
	</div>
	<ErrorToast message={view === "yaml" ? yamlError : ""} />
	<div class="view-content">
		{#if view === "yaml"}
			<textarea
				aria-label="Worksheet parser YAML"
				bind:value={yaml}
				spellcheck="false"
				wrap="off"
				{readonly}></textarea>
		{:else if view === "text"}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard scrolling) -->
			<div class="raw-content" tabindex="0" role="region" aria-label="Scrollable extracted text">
				<p class="coordinate-help">Page regions use [x, y, width, height] on a 0–1000 grid.</p>
				{#each segments as line, index (index)}<div class="ocr-line">
						<small>Page {line.pageNumber} · [{line.region.join(", ")}]</small>
						<pre>{line.text}</pre>
						{#if line.words.length}<details>
								<summary>Word coordinates</summary>
								<pre>{line.words
										.map((word) => `${word.text} [${word.region.join(", ")}]`)
										.join("\n")}</pre>
							</details>{/if}
					</div>{/each}
				{#if !segments.length}<p>Apply the parser to read this worksheet locally.</p>{/if}
			</div>
		{:else if view === "raw"}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard scrolling) -->
			<div class="raw-content" tabindex="0" role="region" aria-label="Scrollable original content">
				{#if rawType === "application/pdf" && rawUrl}<iframe
						title="Original worksheet PDF"
						src={rawUrl}
					></iframe>
				{:else if rawUrl}<img src={rawUrl} alt={`Worksheet preview: ${title}`} />
				{:else}<pre>{rawText || "No original content available."}</pre>{/if}
			</div>
		{:else}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard scrolling) -->
			<div class="qa-preview" tabindex="0" role="region" aria-label="Scrollable Q&A preview">
				{#if stale}<p class="coordinate-help">
						The parser changed. Apply it to refresh this preview before saving.
					</p>
				{:else}
					{#each questions as item, index (index)}
						<article>
							<div class="question-heading">
								<span>{index + 1}</span>
								<h4>{item.question}</h4>
							</div>
							<div class="answer">
								<small>Answer</small>
								<p>{item.answer || "Not found in worksheet"}</p>
							</div>
							{#if item.explanation}<div class="explanation">
									<small>Explanation</small>
									<p>{item.explanation}</p>
								</div>{/if}
						</article>
					{/each}
					{#if !questions.length}<p class="coordinate-help">
							No questions matched. Adjust the parser using the extracted text or page regions.
						</p>{/if}
				{/if}
				{#if warnings.length}<ul class="parser-warnings">
						{#each warnings as warning, index (index)}<li>{warning}</li>{/each}
					</ul>{/if}
			</div>
		{/if}
	</div>
</section>

<style>
	.questions-editor {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		height: 100%;
		flex: 1;
		overflow: hidden;
	}
	.view-tabs {
		flex-wrap: wrap;
		display: flex;
		flex-shrink: 0;
		gap: 4px;
		padding: 6px 12px;
		border-bottom: 1px solid var(--v-border);
	}
	.view-tabs button {
		background: transparent;
		color: var(--v-muted);
		font: inherit;
		font-size: 0.75rem;
		border: 0;
		padding: 8px 12px;
		cursor: pointer;
		border-bottom: 2px solid transparent;
	}
	.view-tabs button[aria-selected="true"] {
		color: var(--v-primary-text, var(--v-primary));
		border-bottom-color: currentColor;
	}
	.view-content {
		display: flex;
		flex: 1;
		min-height: 0;
		min-width: 0;
		overflow: hidden;
	}
	textarea {
		flex: 1;
		box-sizing: border-box;
		width: 100%;
		min-height: 0;
		resize: none;
		overflow: auto;
		padding: 16px;
		background: transparent;
		color: var(--v-fg);
		border: 0;
		font:
			0.8rem/1.65 ui-monospace,
			monospace;
		tab-size: 2;
	}
	textarea:focus {
		outline: none;
	}
	.raw-content,
	.qa-preview {
		flex: 1;
		min-height: 0;
		min-width: 0;
		overflow: auto;
		overscroll-behavior: contain;
		padding: 16px;
	}
	.raw-content img {
		display: block;
		max-width: 100%;
		height: auto;
		margin: auto;
	}
	.raw-content iframe {
		width: 100%;
		height: 100%;
		min-height: 600px;
		border: 0;
	}
	pre {
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font:
			0.8rem/1.6 ui-monospace,
			monospace;
	}
	article {
		padding: 16px 0;
		border-bottom: 1px solid var(--v-border);
	}
	article:first-child {
		padding-top: 0;
	}
	article:last-child {
		border-bottom: 0;
	}
	.question-heading {
		display: flex;
		align-items: baseline;
		gap: 12px;
	}
	.question-heading span {
		color: var(--v-muted);
		font-size: 0.75rem;
	}
	h4,
	p {
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	h4 {
		font-size: 0.9rem;
		font-weight: 500;
	}
	.answer,
	.explanation {
		margin: 12px 0 0 24px;
	}
	small {
		color: var(--v-muted);
		font-size: 0.68rem;
		font-weight: 300;
	}
	p {
		font-size: 0.8rem;
		line-height: 1.65;
	}
	.explanation p {
		color: var(--v-muted);
	}
	.coordinate-help,
	.parser-warnings {
		font-size: 0.72rem;
		color: var(--v-muted);
		line-height: 1.5;
	}
	.ocr-line :global(summary) {
		font-size: 0.68rem;
		color: var(--v-muted);
		cursor: pointer;
	}
	.ocr-line {
		padding: 8px 0;
	}
</style>
