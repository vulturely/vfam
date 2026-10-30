<script lang="ts">
	import type { Homework } from "../homework/service";
	import { questionsReady } from "../homework/questionTypes";
	import QuestionSummary from "./QuestionSummary.svelte";
	// Edit and Assign live in the homework detail toolbar while this view is open.
	let { item }: { item: Homework } = $props();
	const questions = $derived(item.answerKey);
</script>

<section class="assigned" aria-label="Questions for your child">
	<h3>Questions for your child</h3>
	{#if questions.length}
		{#if !questionsReady(questions)}<p class="hint">
				Some questions are missing answers. Edit them before assigning.
			</p>{/if}
		<div class="list">
			{#each questions as question, i (i)}<QuestionSummary {question} number={i + 1} />{/each}
		</div>
	{:else}<p class="hint">
			No questions yet. Use Edit to add questions with their answers: typed answers, one or many
			choices, true or false, matching or spelling.
		</p>{/if}
</section>

<style>
	.assigned {
		display: grid;
		gap: 0.75rem;
		padding: 20px;
		overflow-y: auto;
		min-height: 0;
	}
	h3 {
		margin: 0;
		font-size: 1rem;
	}
	.list {
		display: grid;
		gap: 0.75rem;
	}
	.hint {
		margin: 0;
		color: var(--v-muted);
		font-size: 0.85rem;
	}
</style>
