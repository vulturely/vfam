<script lang="ts">
	import UiPlus from "lucide-svelte/icons/plus";
	import UiTrash2 from "lucide-svelte/icons/trash-2";
	import UiX from "lucide-svelte/icons/x";
	import { Button, IconButton } from "../components/index";
	import type { HomeworkAnswer } from "../api/protocol";
	import {
		QUESTION_KINDS,
		blankQuestion,
		changeKind,
		kindOf,
		prepare,
		problem,
		type QuestionKind,
	} from "../homework/questionTypes";
	let {
		questions = $bindable<HomeworkAnswer[]>([]),
		disabled = false,
		max = 50,
		showIssues = false,
	}: {
		questions?: HomeworkAnswer[];
		disabled?: boolean;
		max?: number;
		/** Show every question's problem, e.g. after a save attempt. */
		showIssues?: boolean;
	} = $props();
	type Draft = {
		kind: QuestionKind;
		question: string;
		answer: string;
		explanation: string;
		choices: string[];
		answers: string[];
		items: string[];
		say: string;
	};
	function toDraft(q: HomeworkAnswer): Draft {
		const kind = kindOf(q);
		const draft: Draft = {
			kind,
			question: q.question,
			answer: q.answer,
			explanation: q.explanation,
			choices: [...(q.choices ?? [])],
			answers: [...(q.answers ?? [])],
			items: [...(q.items ?? [])],
			say: q.say ?? "",
		};
		// The answer field holds a readable summary for these kinds; edit the parts instead.
		if (kind === "choose_many" || kind === "matching") draft.answer = "";
		return draft;
	}
	// Plain objects so every field edit re-renders; the bound value is the prepared copy.
	let drafts = $state<Draft[]>(questions.map(toDraft));
	$effect(() => {
		questions = drafts.map((d) => prepare(d as unknown as HomeworkAnswer));
	});
	const issues = $derived(drafts.map((d) => problem(prepare(d as unknown as HomeworkAnswer))));
	let uid = $props.id();
	function add() {
		drafts.push(toDraft(blankQuestion()));
	}
	function setKind(index: number, kind: QuestionKind) {
		drafts[index] = toDraft(changeKind(prepare(drafts[index] as unknown as HomeworkAnswer), kind));
	}
	function correct(d: Draft, choice: string) {
		return d.answers.includes(choice);
	}
	function toggle(d: Draft, choice: string, on: boolean) {
		d.answers = on ? [...d.answers, choice] : d.answers.filter((a) => a !== choice);
	}
	function renameChoice(d: Draft, index: number, value: string) {
		const old = d.choices[index];
		d.choices[index] = value;
		if (d.answer === old) d.answer = value;
		d.answers = d.answers.map((a) => (a === old ? value : a));
	}
	function removeChoice(d: Draft, index: number) {
		const [old] = d.choices.splice(index, 1);
		if (d.answer === old) d.answer = "";
		d.answers = d.answers.filter((a) => a !== old);
	}
</script>

<div class="questions" aria-label="Questions">
	{#each drafts as d, i (i)}
		{@const n = i + 1}
		<fieldset class="question" {disabled}>
			<legend>Question {n}</legend>
			<div class="row">
				<label class="type"
					>Type<select
						value={d.kind}
						onchange={(e) => setKind(i, e.currentTarget.value as QuestionKind)}
					>
						{#each QUESTION_KINDS as kind (kind.id)}<option value={kind.id}>{kind.label}</option
							>{/each}
					</select></label
				>
				<IconButton
					icon={UiTrash2}
					label={`Remove question ${n}`}
					onclick={() => drafts.splice(i, 1)}
				/>
			</div>
			<small class="help">{QUESTION_KINDS.find((k) => k.id === d.kind)?.help}</small>
			<label>Question<textarea rows="2" maxlength="3000" bind:value={d.question}></textarea></label>
			{#if d.kind === "short_answer"}
				<label>Answer<input maxlength="3000" bind:value={d.answer} /></label>
				<label
					>Other accepted answers <span class="optional">optional, comma separated</span><input
						value={d.answers.join(", ")}
						oninput={(e) => (d.answers = e.currentTarget.value.split(","))}
						placeholder="e.g. seven"
					/></label
				>
			{:else if d.kind === "spelling"}
				<label>Word to spell<input maxlength="40" bind:value={d.answer} /></label>
				<label
					>Read aloud <span class="optional">optional, defaults to the word</span><input
						maxlength="500"
						bind:value={d.say}
						placeholder="e.g. Banana. I ate a banana."
					/></label
				>
			{:else if d.kind === "true_false"}
				<div class="options" role="radiogroup" aria-label={`Correct answer for question ${n}`}>
					{#each ["True", "False"] as value (value)}<label class="option"
							><input
								type="radio"
								name={`${uid}-tf-${i}`}
								checked={d.answer === value}
								onchange={() => (d.answer = value)}
							/>{value}</label
						>{/each}
				</div>
			{:else if d.kind === "multiple_choice" || d.kind === "choose_many"}
				<div class="options">
					<small
						>{d.kind === "multiple_choice"
							? "Select the correct option."
							: "Tick every correct option."}</small
					>
					{#each d.choices as choice, c (c)}
						<div class="option">
							{#if d.kind === "multiple_choice"}<input
									type="radio"
									name={`${uid}-mc-${i}`}
									aria-label={`Option ${c + 1} is correct`}
									checked={!!choice && d.answer === choice}
									onchange={() => (d.answer = choice)}
								/>
							{:else}<input
									type="checkbox"
									aria-label={`Option ${c + 1} is correct`}
									checked={!!choice && correct(d, choice)}
									onchange={(e) => toggle(d, choice, e.currentTarget.checked)}
								/>{/if}
							<input
								aria-label={`Option ${c + 1}`}
								maxlength="500"
								value={choice}
								oninput={(e) => renameChoice(d, c, e.currentTarget.value)}
							/>
							<IconButton
								icon={UiX}
								label={`Remove option ${c + 1}`}
								onclick={() => removeChoice(d, c)}
							/>
						</div>
					{/each}
					{#if d.choices.length < 10}<Button
							variant="ghost"
							icon={UiPlus}
							onclick={() => d.choices.push("")}>Add option</Button
						>{/if}
				</div>
			{:else if d.kind === "matching"}
				<div class="pairs">
					<small>Each item and its match. The child sees the matches shuffled.</small>
					{#each d.items, p (p)}
						<div class="pair">
							<input
								aria-label={`Item ${p + 1}`}
								maxlength="500"
								bind:value={d.items[p]}
								placeholder="Item"
							/>
							<span aria-hidden="true">→</span>
							<input
								aria-label={`Match for item ${p + 1}`}
								maxlength="500"
								bind:value={d.answers[p]}
								placeholder="Match"
							/>
							<IconButton
								icon={UiX}
								label={`Remove pair ${p + 1}`}
								onclick={() => {
									d.items.splice(p, 1);
									d.answers.splice(p, 1);
								}}
							/>
						</div>
					{/each}
					{#if d.items.length < 10}<Button
							variant="ghost"
							icon={UiPlus}
							onclick={() => {
								d.items.push("");
								d.answers.push("");
							}}>Add pair</Button
						>{/if}
				</div>
			{/if}
			<label
				>Explanation <span class="optional">optional, for guardians</span><textarea
					rows="2"
					maxlength="3000"
					bind:value={d.explanation}></textarea></label
			>
			{#if issues[i] && (showIssues || d.question.trim())}<p class="issue">{issues[i]}</p>{/if}
		</fieldset>
	{/each}
	{#if drafts.length < max}<Button variant="ghost" icon={UiPlus} {disabled} onclick={add}
			>Add question</Button
		>{/if}
</div>

<style>
	.questions {
		display: grid;
		gap: 1rem;
	}
	.question {
		display: grid;
		gap: 0.6rem;
		margin: 0;
		padding: 0.9rem;
		border: 1px solid color-mix(in srgb, var(--v-fg) 12%, transparent);
		border-radius: 12px;
		min-width: 0;
	}
	legend {
		padding: 0 0.3rem;
		font-weight: 600;
	}
	.row {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 0.5rem;
	}
	label {
		display: grid;
		gap: 0.3rem;
		font-size: 0.85rem;
	}
	.type {
		flex: 1;
	}
	input:not([type="radio"], [type="checkbox"]),
	select,
	textarea {
		width: 100%;
		box-sizing: border-box;
		padding: 0.55rem 0.65rem;
		border: 1px solid color-mix(in srgb, var(--v-fg) 15%, transparent);
		border-radius: 8px;
		background: transparent;
		color: var(--v-fg);
		font: inherit;
	}
	.options,
	.pairs {
		display: grid;
		gap: 0.4rem;
	}
	.option,
	.pair {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.option input[type="radio"],
	.option input[type="checkbox"] {
		flex: none;
		width: 1.1rem;
		height: 1.1rem;
	}
	.pair span {
		color: var(--v-muted);
	}
	.help,
	small,
	.optional {
		color: var(--v-muted);
		font-size: 0.78rem;
	}
	.issue {
		margin: 0;
		color: var(--v-danger, #b42318);
		font-size: 0.8rem;
	}
</style>
