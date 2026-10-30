<script lang="ts">
	import type { HomeworkAnswer } from "../api/protocol";
	import { answerSummary, kindLabel, kindOf } from "../homework/questionTypes";
	let { question, number }: { question: HomeworkAnswer; number: number } = $props();
	const kind = $derived(kindOf(question));
</script>

<article class="summary">
	<div class="heading">
		<span class="number">{number}</span>
		<h4>{question.question}</h4>
		<small class="kind">{kindLabel(question)}</small>
	</div>
	{#if (kind === "multiple_choice" || kind === "choose_many") && question.choices.length}
		<ul class="choices" aria-label={`Options for question ${number}`}>
			{#each question.choices as choice (choice)}
				{@const right =
					kind === "multiple_choice"
						? choice === question.answer
						: question.answers.includes(choice)}
				<li class:right>
					{choice}{#if right}<span class="mark"> · correct</span>{/if}
				</li>
			{/each}
		</ul>
	{/if}
	<div class="answer">
		<small>{kind === "spelling" ? "Word" : "Answer"}</small>
		<p>{answerSummary(question) || "Not found in worksheet"}</p>
	</div>
	{#if kind === "spelling" && question.say && question.say !== question.answer}<div class="answer">
			<small>Read aloud</small>
			<p>{question.say}</p>
		</div>{/if}
	{#if question.explanation}<div class="answer">
			<small>Explanation</small>
			<p>{question.explanation}</p>
		</div>{/if}
</article>

<style>
	.summary {
		display: grid;
		gap: 0.45rem;
		padding: 0.85rem 1rem;
		border: 1px solid var(--v-border);
		border-radius: 10px;
		background: transparent;
	}
	.heading {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}
	.number {
		color: var(--v-muted);
		font-variant-numeric: tabular-nums;
	}
	h4 {
		flex: 1;
		margin: 0;
		font-size: 0.95rem;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.kind,
	small {
		color: var(--v-muted);
		font-size: 0.75rem;
	}
	.choices {
		margin: 0;
		padding-left: 1.2rem;
		font-size: 0.85rem;
	}
	.right {
		font-weight: 600;
	}
	.mark {
		color: var(--v-muted);
		font-weight: 400;
	}
	.answer p {
		margin: 0.15rem 0 0;
		font-size: 0.88rem;
		overflow-wrap: anywhere;
	}
</style>
