<script lang="ts">
	import { onMount } from "svelte";
	import RefreshCw from "lucide-svelte/icons/refresh-cw";
	import Clock from "lucide-svelte/icons/clock";
	import History from "lucide-svelte/icons/history";
	import { ErrorToast, IconButton } from "../components/index";
	import { animateDetails } from "../components/animateDetails";
	import { responseText } from "../homework/questionTypes";
	import type { ChildLearningService } from "../child-learning/service";
	import {
		LearningAnswerResult as Result,
		LearningSessionState as State,
		type LearningAttempt,
	} from "../api/protocol";
	let {
		service,
		profileId,
		mode = "history",
	}: {
		service: ChildLearningService;
		profileId: string;
		mode?: "history" | "attempts";
	} = $props();
	let attempts = $state<LearningAttempt[]>([]);
	let loading = $state(true);
	let error = $state("");
	let request = 0;
	async function load() {
		const current = ++request;
		loading = true;
		error = "";
		try {
			const result = await service.review(profileId);
			if (current === request)
				attempts = result
					.filter((a) => a.session?.profileId === profileId)
					.sort((a, b) => Date.parse(b.session!.createdAt) - Date.parse(a.session!.createdAt));
		} catch {
			if (current === request)
				error =
					mode === "attempts"
						? "Could not load attempts. Please try again."
						: "Could not load test history. Please try again.";
		} finally {
			if (current === request) loading = false;
		}
	}
	onMount(() => {
		void load();
		return () => {
			request++;
		};
	});
	function date(value?: string) {
		const timestamp = Date.parse(value ?? "");
		return Number.isFinite(timestamp)
			? new Intl.DateTimeFormat(undefined, {
					dateStyle: "medium",
					timeStyle: "short",
				}).format(timestamp)
			: "Date unavailable";
	}
	function duration(attempt: LearningAttempt) {
		if (attempt.session?.state === State.ACTIVE) return "In progress";
		const start = Date.parse(attempt.session?.createdAt ?? "");
		const end = Date.parse(attempt.session?.updatedAt ?? "");
		if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "Unavailable";
		const seconds = Math.round((end - start) / 1000);
		if (seconds < 60) return `${seconds}s`;
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
		return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
	}
	function status(state?: State) {
		return state === State.COMPLETED
			? "Completed"
			: state === State.CANCELLED
				? "Stopped"
				: state === State.ACTIVE
					? "In progress"
					: "Unavailable";
	}
	function outcome(result: Result) {
		return result === Result.CORRECT
			? "Correct"
			: result === Result.INCORRECT
				? "Incorrect"
				: "Needs review";
	}
</script>

<section
	class="history"
	aria-label={mode === "attempts" ? "Child attempts" : "Homework test history"}
	aria-busy={loading}
>
	<header>
		<div>
			<h3>{mode === "attempts" ? "Attempts" : "Homework history"}</h3>
			<p>
				{mode === "attempts"
					? "Answers, results, and requests for help."
					: "Previous tests, results, and time to finish."}
			</p>
		</div>
		<IconButton
			icon={RefreshCw}
			label={mode === "attempts" ? "Refresh attempts" : "Refresh test history"}
			disabled={loading}
			onclick={() => void load()}
		/>
	</header>
	{#if error}<ErrorToast message={error} />
	{:else if loading}<p class="empty" role="status">
			{mode === "attempts" ? "Loading attempts…" : "Loading test history…"}
		</p>
	{:else if !attempts.length}<div class="empty">
			<History size={24} strokeWidth={1.4} aria-hidden="true" /><strong>No tests yet</strong>
			<p>Tests will appear here when your child starts a homework activity.</p>
		</div>
	{:else}
		<div class="tests">
			{#each attempts as attempt (attempt.session!.id)}
				{@const session = attempt.session!}
				{@const correct = attempt.answers.filter((a) => a.result === Result.CORRECT).length}
				{@const pending = attempt.answers.filter(
					(a) => a.result !== Result.CORRECT && a.result !== Result.INCORRECT,
				).length}
				{@const total = attempt.totalQuestions || attempt.answers.length}
				<details class="test" open={mode === "attempts"} use:animateDetails>
					<summary>
						<div class="test-name">
							<strong>{attempt.homeworkTitle || "Homework test"}</strong><span
								>{attempt.subject ? `${attempt.subject} · ` : ""}{date(session.createdAt)}</span
							>
						</div>
						<span
							class="status"
							class:completed={session.state === State.COMPLETED}
							class:stopped={session.state === State.CANCELLED}>{status(session.state)}</span
						>
						<div class="metric">
							<small>Score</small><strong>{correct} / {total} <span>correct</span></strong
							>{#if pending}<small>{pending} needs review</small>{/if}
						</div>
						<div class="metric">
							<small
								><Clock size={12} aria-hidden="true" />{session.state === State.CANCELLED
									? "Time spent"
									: "Time to finish"}</small
							><strong>{duration(attempt)}</strong>
						</div>
					</summary>
					<div class="test-body accordion-body">
						<div class="test-meta">
							<span>{attempt.answers.length} / {total} answered</span
							>{#if session.state !== State.ACTIVE && session.updatedAt}<span
									>{session.state === State.COMPLETED ? "Finished" : "Stopped"}
									{date(session.updatedAt)}</span
								>{/if}{#if attempt.helpRequested}<span>Help requested</span>{/if}
						</div>
						{#if attempt.answers.length}<ol aria-label="Test answers">
								{#each [...attempt.answers].sort((a, b) => a.position - b.position) as answer (answer.id)}
									<li value={answer.position}>
										<div class="answer-head">
											<strong>{answer.prompt}</strong><span
												class="result"
												class:correct={answer.result === Result.CORRECT}
												class:incorrect={answer.result === Result.INCORRECT}
												>{outcome(answer.result)}</span
											>
										</div>
										<p>
											<small>Child’s answer</small><span
												>{responseText(answer.answer) || "No answer entered"}</span
											>
										</p>
										{#if answer.detail}<p class="detail">{answer.detail}</p>{/if}
									</li>
								{/each}
							</ol>{:else}<p class="no-answers">No answers submitted for this test.</p>{/if}
					</div>
				</details>
			{/each}
		</div>
	{/if}
</section>

<style>
	.history {
		min-width: 0;
		display: grid;
		gap: 1.25rem;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
	}
	h3 {
		margin: 0;
		font-size: 1.05rem;
	}
	header p {
		margin: 0.3rem 0 0;
		font-size: 0.8rem;
		color: var(--v-muted);
	}
	.tests {
		border: 1px solid var(--v-border);
		border-radius: 14px;
		overflow: hidden;
		background: color-mix(in srgb, var(--v-surface) 45%, transparent);
	}
	.test + .test {
		border-top: 1px solid var(--v-border);
	}
	summary {
		display: grid;
		grid-template-columns:
			minmax(0, 1.8fr) minmax(90px, 0.8fr) minmax(90px, 0.8fr)
			minmax(100px, 0.8fr);
		gap: 1rem;
		align-items: center;
		padding: 1rem 1.25rem;
		cursor: pointer;
		list-style: none;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	summary:hover {
		background: color-mix(in srgb, var(--v-fg) 3%, transparent);
	}
	summary:focus-visible {
		outline: 2px solid var(--v-primary);
		outline-offset: -2px;
	}
	.test-name,
	.metric {
		display: grid;
		gap: 0.3rem;
		min-width: 0;
	}
	.test-name strong {
		font-size: 0.9rem;
		overflow-wrap: anywhere;
	}
	.test-name > span,
	small {
		color: var(--v-muted);
		font-size: 0.72rem;
		font-weight: 400;
	}
	.metric small {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}
	.metric strong {
		font-size: 0.85rem;
		font-weight: 550;
	}
	.metric strong span {
		font-size: 0.72rem;
		color: var(--v-muted);
		font-weight: 400;
	}
	.status,
	.result {
		font-size: 0.72rem;
		color: var(--v-primary-text, var(--v-primary));
	}
	.completed,
	.correct {
		color: var(--v-success, #288365);
	}
	.stopped {
		color: var(--v-muted);
	}
	.incorrect {
		color: var(--v-danger);
	}
	.test-body {
		border-top: 1px solid var(--v-border);
		padding: 1rem 1.25rem;
	}
	.test-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.25rem;
		font-size: 0.72rem;
		color: var(--v-muted);
	}
	ol {
		margin: 1rem 0 0;
		padding-left: 1.25rem;
	}
	li {
		padding: 0.75rem 0 0.75rem 0.3rem;
		font-size: 0.85rem;
	}
	li + li {
		border-top: 1px solid var(--v-border);
	}
	li::marker {
		color: var(--v-muted);
		font-size: 0.75rem;
	}
	.answer-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	.answer-head strong {
		font-weight: 500;
		overflow-wrap: anywhere;
	}
	.result {
		flex-shrink: 0;
	}
	li p {
		display: grid;
		gap: 0.3rem;
		margin: 0.5rem 0 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.empty {
		display: grid;
		justify-items: center;
		gap: 0.75rem;
		padding: 3rem 1rem;
		text-align: center;
		color: var(--v-muted);
		font-size: 0.85rem;
	}
	.empty p {
		max-width: 300px;
		margin: 0;
		font-size: 0.8rem;
		line-height: 1.5;
	}
	.empty strong {
		color: var(--v-fg);
		font-weight: 500;
	}
	.no-answers {
		font-size: 0.8rem;
		color: var(--v-muted);
		margin-bottom: 0;
	}
	@media (max-width: 700px) {
		summary {
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 0.85rem;
			padding: 1rem;
		}
		.test-body {
			padding: 1rem;
		}
		.status {
			text-align: right;
		}
		.answer-head {
			flex-wrap: wrap;
			gap: 0.35rem;
		}
	}
	.detail {
		color: var(--v-muted);
		font-size: 0.8rem;
	}
</style>
