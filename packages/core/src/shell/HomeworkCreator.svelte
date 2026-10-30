<script lang="ts">
	import { getContext, tick } from "svelte";
	import ArrowLeft from "lucide-svelte/icons/arrow-left";
	import ArrowRight from "lucide-svelte/icons/arrow-right";
	import Check from "lucide-svelte/icons/check";
	import Sparkles from "lucide-svelte/icons/sparkles";
	import Pencil from "lucide-svelte/icons/pencil";
	import Upload from "lucide-svelte/icons/upload";
	import type { Runtime } from "../runtime/registry.svelte";
	import { HomeworkAnswer } from "../api/protocol";
	import { ErrorToast, IconButton } from "../components/index";
	import WorksheetParser from "./WorksheetParser.svelte";
	import { DEFAULT_PARSER_YAML } from "../homework/questions";
	import HomeworkWritingEditor from "./HomeworkWritingEditor.svelte";
	import QuestionsEditor from "./QuestionsEditor.svelte";
	import QuestionSummary from "./QuestionSummary.svelte";
	import { problem } from "../homework/questionTypes";
	import HomeworkFilePicker from "./HomeworkFilePicker.svelte";
	let { profileId, oncreated }: { profileId: string; oncreated: () => Promise<void> } = $props();
	const runtime = getContext<Runtime>("vulture:runtime");
	let mode = $state<"manual" | "automatic">();
	let source = $state<"type" | "upload">();
	let stage = $state(0);
	let stageHeading = $state<globalThis.HTMLElement>();
	$effect(() => {
		void stage;
		void tick().then(() => {
			stageHeading?.focus({ preventScroll: true });
			stageHeading?.scrollIntoView?.({ block: "nearest" });
		});
	});

	let title = $state("");
	let subject = $state("");
	let text = $state("");
	let topic = $state("");
	let context = $state("");
	let count = $state(5);
	let consent = $state(false);
	let files = $state<globalThis.FileList>();
	let reference = $state<globalThis.FileList>();
	let questions = $state<HomeworkAnswer[]>([]);
	// Questions typed for "Type it"; the AI draft and upload use `questions`.
	let typedQuestions = $state<HomeworkAnswer[]>([]);
	let showIssues = $state(false);
	let yaml = $state(DEFAULT_PARSER_YAML);
	let appliedYaml = $state("");
	let rawUrl = $state("");
	let rawType = $state("");
	$effect(() => {
		const selected = files?.[0];
		const url = selected ? URL.createObjectURL(selected) : "";
		rawUrl = url;
		rawType = selected?.type ?? "";
		yaml = DEFAULT_PARSER_YAML;
		appliedYaml = "";
		questions = [];
		return () => {
			if (url) URL.revokeObjectURL(url);
		};
	});
	let busy = $state(false);
	let error = $state("");
	const steps = $derived(
		mode === "automatic"
			? ["Method", "Context", "Review"]
			: ["Method", "Source", "Content", "Review"],
	);
	function back() {
		error = "";
		stage = Math.max(0, stage - 1);
	}
	function next() {
		error = "";
		if (stage === 0 && !mode) {
			error = "Choose how to create homework.";
			return;
		}
		if (mode === "manual" && stage === 1 && !source) {
			error = "Choose a homework source.";
			return;
		}
		if (mode === "manual" && stage === 2) {
			if (!title.trim() || !subject.trim()) {
				error = "Enter a title and subject.";
				return;
			}
			if (source === "upload" && !files?.[0]) {
				error = "Choose a worksheet file.";
				return;
			}
			if (source === "type") {
				if (!text.trim() && !typedQuestions.length) {
					error = "Add instructions or at least one question.";
					return;
				}
				if (typedQuestions.some((q) => problem(q))) {
					showIssues = true;
					error = "Fix the questions marked below.";
					return;
				}
			}
		}
		if (mode === "manual" && source === "upload" && stage === 2) {
			stage = 3;
			return;
		}
		stage++;
	}
	async function generate() {
		if (busy) return;
		error = "";
		if (!topic.trim() || !subject.trim() || !consent) {
			error = "Enter a topic and subject, and allow AI generation.";
			return;
		}
		busy = true;
		try {
			const draft = await runtime.services.homework.generateDraft({
				profileId,
				topic,
				context,
				subject,
				questionCount: count,
				aiOptIn: consent,
				reference: reference?.[0],
			});
			title = draft.title;
			questions = draft.questions;
			stage = 2;
		} catch (e) {
			error = e instanceof Error ? e.message : "Could not generate homework. Please retry.";
		} finally {
			busy = false;
		}
	}
	async function save() {
		if (busy) return;
		if (source === "upload" && (!questions.length || appliedYaml !== yaml)) {
			error = "Apply the current YAML parser and review the extracted questions before saving.";
			return;
		}
		const authored = mode === "automatic" ? questions : source === "type" ? typedQuestions : [];
		if (authored.some((q) => problem(q))) {
			showIssues = true;
			error = "Fix the questions marked below before saving.";
			return;
		}
		busy = true;
		error = "";
		try {
			if (mode === "automatic")
				await runtime.services.homework.createText(profileId, title, subject, "", questions);
			else if (source === "upload")
				await runtime.services.homework.upload(
					profileId,
					title,
					subject,
					files![0],
					questions,
					yaml,
				);
			else
				await runtime.services.homework.createText(profileId, title, subject, text, typedQuestions);
			await oncreated();
		} catch (e) {
			error = e instanceof Error ? e.message : "Could not save homework. Please retry.";
		} finally {
			busy = false;
		}
	}
</script>

<form
	class="creator"
	class:editor-mode={source === "upload" && stage === 3}
	class:method-step={stage === 0}
	class:choice-step={stage === 0 || (mode === "manual" && stage === 1)}
	onsubmit={(event) => {
		event.preventDefault();
		if (mode === "automatic" && stage === 1) void generate();
		else if (stage === steps.length - 1) void save();
		else next();
	}}
>
	<ol class="steps" aria-label="Homework creation steps">
		{#each steps as step, i (step)}<li
				class:current={stage === i}
				class:complete={stage > i}
				aria-current={stage === i ? "step" : undefined}
			>
				<span>{stage > i ? "✓" : i + 1}</span>{step}
			</li>{/each}
	</ol>
	<div class="stage">
		{#if stage === 0}
			<h4 class="method-heading" bind:this={stageHeading} tabindex="-1">
				How would you like to create homework?
			</h4>
			<div class="choices method-choices">
				<button
					type="button"
					class:selected={mode === "manual"}
					aria-pressed={mode === "manual"}
					onclick={() => {
						mode = "manual";
						next();
					}}
					><Pencil size={18} /><span>Manually<small>Type it or upload a worksheet.</small></span
					></button
				>
				<button
					type="button"
					class:selected={mode === "automatic"}
					aria-pressed={mode === "automatic"}
					onclick={() => {
						mode = "automatic";
						next();
					}}
					><Sparkles size={18} /><span
						>Automatically<small>Generate questions, answers and explanations with AI.</small></span
					></button
				>
			</div>
		{:else if mode === "manual" && stage === 1}
			<h4 class="method-heading" bind:this={stageHeading} tabindex="-1">
				Where is the homework coming from?
			</h4>
			<div class="choices method-choices">
				{#each [{ id: "type", label: "Type it", icon: Pencil, help: "Write or paste the questions." }, { id: "upload", label: "Upload", icon: Upload, help: "Add a PDF or photographed worksheet." }] as option (option.id)}
					<button
						type="button"
						aria-pressed={source === option.id}
						onclick={() => {
							source = option.id as typeof source;
							next();
						}}
						><option.icon size={18} /><span>{option.label}<small>{option.help}</small></span
						></button
					>
				{/each}
			</div>
		{:else if mode === "automatic" && stage === 1}
			<h4 bind:this={stageHeading} tabindex="-1">What should they learn?</h4>
			<label
				>Topic<input
					required
					maxlength="500"
					bind:value={topic}
					placeholder="e.g. Adding fractions"
				/></label
			>
			<label
				>Subject<input
					required
					maxlength="80"
					bind:value={subject}
					placeholder="e.g. Mathematics"
				/></label
			>
			<label
				>Context <span class="optional">optional</span><textarea
					rows="3"
					maxlength="8000"
					bind:value={context}
					placeholder="Learning goals, difficulty, or anything to focus on…"></textarea></label
			>
			<HomeworkFilePicker
				label="Reference document (optional)"
				accept="text/plain,application/pdf,image/jpeg,image/png"
				hint="Text, PDF, JPEG or PNG · up to 10 MiB"
				bind:files={reference}
			/>
			<label
				>Number of questions<input
					type="number"
					min="1"
					max="12"
					required
					bind:value={count}
				/></label
			>
			<label class="consent"
				><input type="checkbox" bind:checked={consent} required /><span
					>Allow the family AI provider to use this context and reference to create a draft.</span
				></label
			>
			<p class="help">
				Uses this child’s age group and grade. You’ll review the questions, answer key and
				explanations before saving.
			</p>
		{:else if mode === "manual" && stage === 2}
			{#if source === "type"}
				<h4 class="editor-heading" bind:this={stageHeading} tabindex="-1">Write the homework</h4>
				<HomeworkWritingEditor bind:title bind:subject bind:text />
				<h5 class="questions-heading">Questions for your child</h5>
				<p class="help">
					Add questions with answers so your child can answer them in the app once you assign this
					homework.
				</p>
				<QuestionsEditor bind:questions={typedQuestions} disabled={busy} {showIssues} />
			{:else}
				<h4 bind:this={stageHeading} tabindex="-1">Upload a worksheet</h4>
				<label>Homework title<input required maxlength="160" bind:value={title} /></label>
				<label>Homework subject<input required maxlength="80" bind:value={subject} /></label>
				<HomeworkFilePicker
					label="Worksheet file"
					accept="image/jpeg,image/png,application/pdf"
					hint="JPEG, PNG or PDF · up to 10 MiB and 20 pages"
					required
					bind:files
				/>
			{/if}
		{:else}
			<h4 bind:this={stageHeading} tabindex="-1">Review homework</h4>
			<label>Homework title<input required maxlength="160" bind:value={title} /></label>
			<p class="help">{subject}</p>
			{#if mode === "automatic"}
				<p class="help">
					Check each answer and explanation. AI can make mistakes. The answer key stays available to
					guardians and is stored separately from the questions.
				</p>
				<QuestionsEditor bind:questions disabled={busy} {showIssues} max={12} />
			{:else if source === "upload"}<p class="help">
					Review the Q&A extracted from the worksheet before saving.
				</p>
				<WorksheetParser
					{profileId}
					file={files?.[0]}
					bind:yaml
					bind:questions
					bind:appliedYaml
					bind:busy
					autoApply
					{rawUrl}
					{rawType}
					{title}
				/>
			{:else}
				{#if text.trim()}<p class="content-preview">{text}</p>{/if}
				{#if typedQuestions.length}<h5 class="questions-heading">Questions for your child</h5>
					<div class="question-cards">
						{#each typedQuestions as question, i (i)}<QuestionSummary
								{question}
								number={i + 1}
							/>{/each}
					</div>{/if}{/if}
		{/if}
		<ErrorToast message={error} />
		<div class="actions">
			{#if stage > 0}<IconButton
					icon={ArrowLeft}
					label="Previous step"
					disabled={busy}
					onclick={back}
				/>{/if}
			<span class="status" aria-live="polite"
				>{busy
					? mode === "automatic" && stage === 1
						? "Generating homework…"
						: "Saving homework…"
					: ""}</span
			>
			{#if stage === steps.length - 1}<IconButton
					icon={Check}
					type="submit"
					label="Save homework"
					disabled={busy}
				/>
			{:else if mode === "automatic" && stage === 1}<IconButton
					icon={Sparkles}
					type="submit"
					label="Generate homework"
					disabled={busy}
				/>
			{:else if stage > 0}<IconButton
					icon={ArrowRight}
					type="submit"
					label={source === "upload" && stage === 2 ? "Read worksheet" : "Next step"}
					disabled={busy}
				/>{/if}
		</div>
	</div>
</form>

<style>
	.creator {
		box-sizing: border-box;
		flex: 1 0 auto;
		display: grid;
		grid-template-columns: 110px minmax(0, 1fr);
		gap: 24px;
		align-items: start;
		min-width: 0;
		padding: 20px;
		border: 1px solid color-mix(in srgb, var(--v-fg) 10%, transparent);
		border-radius: 16px;
		background:
			linear-gradient(
				135deg,
				color-mix(in srgb, var(--v-fg) 5%, transparent),
				color-mix(in srgb, var(--v-fg) 1%, transparent)
			),
			color-mix(in srgb, var(--v-bg) 45%, transparent);
		backdrop-filter: blur(20px) saturate(120%);
		-webkit-backdrop-filter: blur(20px) saturate(120%);
	}
	.choice-step {
		align-items: stretch;
	}
	.choice-step .stage {
		align-content: center;
	}
	.method-step .actions {
		display: none;
	}
	.creator.editor-mode {
		align-items: stretch;
		display: flex;
		flex-direction: column;
		grid-template-columns: minmax(0, 1fr);
		flex: 1 1 0;
		min-height: 0;
		padding: 0;
		border: 0;
		border-radius: 0;
		background: transparent;
		backdrop-filter: none;
		-webkit-backdrop-filter: none;
	}
	.editor-mode .steps {
		display: none;
	}
	.editor-mode .stage {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		gap: 0;
	}
	.editor-heading {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.editor-mode .actions {
		flex-shrink: 0;
		padding: 8px 12px;
	}
	.steps {
		align-self: start;
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0;
		font-size: 0.75rem;
		color: var(--v-muted);
		position: sticky;
		top: 0;
	}
	.steps li {
		position: relative;
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 52px;
	}
	.steps li:not(:last-child)::after {
		content: "";
		position: absolute;
		left: 11px;
		top: 38px;
		bottom: -14px;
		width: 1px;
		background: var(--v-border);
	}
	.steps li > span {
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		border: 1px solid var(--v-border);
		border-radius: 50%;
		font-size: 0.7rem;
		flex-shrink: 0;
	}
	.steps li.current {
		color: var(--v-fg);
	}
	.steps li.current > span,
	.steps li.complete > span {
		color: var(--v-primary-text, var(--v-primary));
		border-color: currentColor;
	}
	.stage {
		display: grid;
		gap: 16px;
		min-width: 0;
	}
	.stage h4 {
		outline: none;
		margin: 0;
		font-size: 1rem;
		font-weight: 500;
	}
	.choices {
		display: grid;
		gap: 10px;
	}
	.method-heading {
		text-align: left;
		position: relative;
		top: -12px;
	}
	.method-choices {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	.choices button {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 16px;
		text-align: left;
		color: var(--v-fg);
		border: 1px solid var(--v-border);
		border-radius: 8px;
		background: color-mix(in srgb, var(--v-fg) 2%, transparent);
		font: inherit;
		cursor: pointer;
	}
	.choices button:hover,
	.choices button.selected {
		background: color-mix(in srgb, var(--v-fg) 4%, transparent);
		border-color: var(--v-primary);
	}
	.choices small {
		display: block;
		margin-top: 5px;
		color: var(--v-muted);
		font-size: 0.75rem;
		font-weight: 300;
		line-height: 1.5;
	}
	label {
		display: grid;
		gap: 6px;
		font-size: 0.8rem;
		color: var(--v-muted);
	}
	input:not([type="checkbox"]),
	textarea {
		box-sizing: border-box;
		width: 100%;
		min-width: 0;
		padding: 8px 10px;
		border: 1px solid var(--v-border);
		border-radius: 6px;
		background: color-mix(in srgb, var(--v-bg) 25%, transparent);
		color: var(--v-fg);
		font: inherit;
		outline: none;
	}
	input:focus-visible,
	textarea:focus-visible {
		border-color: var(--v-primary);
	}
	textarea {
		resize: vertical;
		line-height: 1.5;
	}
	.optional {
		font-size: 0.7rem;
		opacity: 0.65;
	}
	.consent {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		line-height: 1.5;
	}
	.consent input {
		margin-top: 3px;
	}
	.help,
	.status {
		font-size: 0.75rem;
		font-weight: 300;
		color: var(--v-muted);
		line-height: 1.5;
		margin: 0;
	}
	.content-preview {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 8px;
		padding-top: 8px;
	}
	.status {
		flex: 1;
	}
	@media (max-width: 600px) {
		.method-choices {
			grid-template-columns: minmax(0, 1fr);
		}
		.creator {
			padding: 12px;
			grid-template-columns: 1fr;
			gap: 12px;
		}
		.creator.choice-step {
			grid-template-rows: auto minmax(min-content, 1fr);
		}
		.steps {
			display: flex;
			justify-content: space-between;
			position: static;
		}
		.steps li {
			flex-direction: column;
			gap: 4px;
			min-height: 46px;
			font-size: 0.65rem;
		}
		.steps li:not(:last-child)::after {
			display: none;
		}
	}
	.questions-heading {
		margin: 1rem 0 0;
		font-size: 0.95rem;
	}
	.question-cards {
		display: grid;
		gap: 0.75rem;
	}
</style>
