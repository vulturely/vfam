<script lang="ts">
	import UiVolume2 from "lucide-svelte/icons/volume-2";
	import type { PracticeQuestion } from "../api/protocol";
	import { encodeResponse, practiceKind } from "../homework/questionTypes";
	import type { SpeechOutput } from "../voice/browser";
	import { deviceOutput } from "../voice/device";
	let {
		question,
		onchange,
		disabled = false,
		output = deviceOutput(),
	}: {
		question: PracticeQuestion;
		/**
		 * Receives the response as the server grades it (text, or a JSON list for
		 * many/matching) and whether the child has given a complete answer.
		 */
		onchange: (value: string, ready: boolean) => void;
		disabled?: boolean;
		output?: SpeechOutput;
	} = $props();
	const kind = $derived(practiceKind(question.kind));
	// Math multiple choice from AI practice also gets tappable options.
	const pick = $derived(kind === "multiple_choice" || kind === "true_false");
	let text = $state("");
	let selected = $state<string[]>([]);
	let matches = $state<string[]>([]);
	let speechError = $state("");
	let area = $state<HTMLElement>();
	const uid = $props.id();
	$effect(() => {
		// Each new question starts empty.
		void question.position;
		text = "";
		selected = [];
		matches = question.items.map(() => "");
		speechError = "";
	});
	$effect(() => {
		if (kind === "choose_many")
			onchange(
				encodeResponse(question.choices.filter((c) => selected.includes(c))),
				selected.length > 0,
			);
		else if (kind === "matching")
			onchange(encodeResponse(matches), matches.length > 0 && matches.every(Boolean));
		else onchange(text, !!text.trim());
	});
	/** Lets the parent return focus here after each question. */
	export function focus() {
		area?.querySelector<HTMLElement>("input, select")?.focus();
	}
	// Moving to the next question, or leaving practice, silences the word.
	$effect(() => {
		void question;
		return () => output.stop();
	});
	function speak() {
		speechError = "";
		output.speak(
			question.say,
			() => {},
			() => (speechError = "This device can't read the word aloud. Ask a guardian to say it."),
		);
	}
	export function set(next: string) {
		text = next;
	}
</script>

{#if kind === "spelling" && question.say}
	<div class="listen">
		<button type="button" class="hear" {disabled} onclick={speak}
			><UiVolume2 size={28} aria-hidden="true" /><span>Hear the word</span></button
		>
		{#if speechError}<p role="status">{speechError}</p>{/if}
	</div>
{/if}
<div class="answer" bind:this={area}>
	{#if pick && question.choices.length}
		<div class="choices" role="radiogroup" aria-labelledby="question-prompt">
			{#each question.choices as choice (choice)}
				<label class="choice" class:chosen={text === choice}
					><input
						type="radio"
						name={`${uid}-answer`}
						value={choice}
						bind:group={text}
						{disabled}
					/>{choice}</label
				>
			{/each}
		</div>
	{:else if kind === "choose_many"}
		<fieldset class="choices" {disabled}>
			<legend>Choose every correct answer</legend>
			{#each question.choices as choice (choice)}
				<label class="choice" class:chosen={selected.includes(choice)}
					><input type="checkbox" value={choice} bind:group={selected} />{choice}</label
				>
			{/each}
		</fieldset>
	{:else if kind === "matching"}
		<fieldset class="matching" {disabled}>
			<legend>Match each item</legend>
			{#each question.items as item, i (item)}
				<label class="pair"
					><span>{item}</span><select bind:value={matches[i]}>
						<option value="" disabled>Choose…</option>
						{#each question.choices as choice (choice)}<option value={choice}>{choice}</option
							>{/each}
					</select></label
				>
			{/each}
		</fieldset>
	{:else}
		<label class="answer-label" for={`${uid}-text`}>Your answer</label>
		<input
			class="answer-text"
			class:spelling={kind === "spelling"}
			id={`${uid}-text`}
			bind:value={text}
			aria-describedby="question-prompt"
			{disabled}
			required
			maxlength="2000"
			autocomplete="off"
			autocapitalize="off"
			spellcheck="false"
		/>
	{/if}
</div>

<style>
	.answer {
		display: grid;
		gap: var(--v-space);
	}
	.listen {
		display: grid;
		justify-items: center;
		gap: 0.4rem;
		text-align: center;
	}
	.listen p {
		margin: 0;
		color: var(--v-muted);
		font-size: 0.85rem;
	}
	/* One big, friendly button to hear the word again and again. */
	.hear {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		min-height: 56px;
		padding: 0.6rem 1.4rem;
		border: 0;
		border-radius: 999px;
		background: color-mix(in srgb, var(--v-primary) 16%, transparent);
		color: var(--v-primary-text, var(--v-primary));
		font: inherit;
		font-size: 1.05rem;
		font-weight: 650;
		cursor: pointer;
	}
	.hear:hover:not(:disabled) {
		background: color-mix(in srgb, var(--v-primary) 24%, transparent);
	}
	.hear:focus-visible {
		outline: 2px solid var(--v-ring, var(--v-primary));
		outline-offset: 3px;
	}
	.hear:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}
	.answer-label {
		color: var(--v-muted);
		font-size: 0.85rem;
	}
	.answer-text {
		font-size: 1.4rem;
		text-align: center;
	}
	.answer-text.spelling {
		letter-spacing: 0.12em;
	}
	.choices,
	.matching {
		display: grid;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		border: 0;
		min-width: 0;
	}
	legend {
		margin-bottom: 0.4rem;
		font-size: 0.9rem;
	}
	.choice {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		min-height: 44px;
		padding: 0.5rem 0.8rem;
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius-sm);
		cursor: pointer;
		overflow-wrap: anywhere;
	}
	.choice.chosen {
		border-color: var(--v-primary);
		background: color-mix(in srgb, var(--v-primary) 10%, transparent);
	}
	.choice input {
		flex: none;
		width: 1.15rem;
		height: 1.15rem;
		accent-color: var(--v-primary);
	}
	.pair {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		align-items: center;
		gap: 0.6rem;
	}
	.pair span {
		overflow-wrap: anywhere;
	}
	input:not([type="radio"], [type="checkbox"]),
	select {
		box-sizing: border-box;
		width: 100%;
		min-width: 0;
		min-height: max(var(--v-control-h), 44px);
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius-sm);
		background: var(--v-bg);
		color: var(--v-fg);
		font: inherit;
		padding: var(--v-space);
	}
	select:focus-visible {
		outline: 2px solid var(--v-ring);
		outline-offset: 2px;
	}
</style>
