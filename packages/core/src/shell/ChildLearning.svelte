<script lang="ts">
	import UiArrowLeft from "lucide-svelte/icons/arrow-left";
	import UiCheck from "lucide-svelte/icons/check";
	import UiRefreshCw from "lucide-svelte/icons/refresh-cw";
	import UiLightbulb from "lucide-svelte/icons/lightbulb";
	import UiHandHelping from "lucide-svelte/icons/hand-helping";
	import UiSquare from "lucide-svelte/icons/square";
	import UiPlay from "lucide-svelte/icons/play";
	import { spellingDraft } from "../voice/service";
	import VoiceTutor from "./VoiceTutor.svelte";
	import ChildAiHelp from "./ChildAiHelp.svelte";
	import QuestionAnswer from "./QuestionAnswer.svelte";
	import { deviceOutput } from "../voice/device";
	import { questionOutput } from "../voice/question";
	import type { ChildFamilyAiService } from "../family-ai/child";
	import type { VoiceService } from "../voice/service";
	import { onMount, tick } from "svelte";
	import type { ChildLearningService } from "../child-learning/service";
	import { Button, ErrorToast } from "../components/index";
	import {
		LearningSessionState as State,
		LearningSessionAction as Action,
		LearningAnswerResult as Result,
		PracticeQuestionKind,
		type ChildPractice,
		type GetLearningSessionResponse,
	} from "../api/protocol";
	let {
		service,
		voice,
		familyAi,
	}: { service: ChildLearningService; voice?: VoiceService; familyAi?: ChildFamilyAiService } =
		$props();
	let activities = $state<ChildPractice[]>([]);
	// One device voice shared by every question; each question gets its server audio.
	const deviceVoice = deviceOutput();
	const questionVoice = $derived.by(() => {
		const session = current?.session?.id;
		const position = current?.question?.position;
		return session && position
			? questionOutput(() => service.audio(session, position), deviceVoice)
			: deviceVoice;
	});
	let current = $state<GetLearningSessionResponse>();
	let busy = $state(false);
	let error = $state("");
	let answer = $state("");
	let answerReady = $state(false);
	let answerInput = $state<{ focus(): void; set(value: string): void }>();
	// Keep the same request ID and exact payload across retries after a lost response.
	let pending = $state<{
		session: string;
		position: number;
		answer: string;
		id: string;
	}>();
	let pendingControl = $state<{
		session: string;
		position: number;
		action: Action;
		id: string;
	}>();
	const feedback = (result: Result | undefined) =>
		result === Result.CORRECT
			? "Correct! Well done."
			: result === Result.INCORRECT
				? "Good try. Keep practising!"
				: result === Result.NEEDS_REVIEW
					? "Saved for your guardian to review."
					: "";
	async function run(action: () => Promise<void>) {
		if (busy) return;
		busy = true;
		error = "";
		try {
			await action();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Could not save. Please retry.";
		} finally {
			busy = false;
			await tick();
			if (!error) answerInput?.focus();
		}
	}
	async function load() {
		activities = await service.list();
		const active = activities.find((a) => a.state === State.ACTIVE && a.sessionId);
		if (active?.sessionId) current = await service.get(active.sessionId);
	}
	onMount(() => {
		void run(load);
	});
	async function start(activity: ChildPractice) {
		await run(async () => {
			if (!activity.practice) return;
			const id =
				activity.sessionId ?? (await service.start(activity.practice, crypto.randomUUID()));
			current = await service.get(id);
			answer = "";
			pending = undefined;
			pendingControl = undefined;
			await tick();
			answerInput?.focus();
		});
	}
	async function submit(event: { preventDefault(): void }) {
		event.preventDefault();
		await run(async () => {
			if (!current?.session || !current.question) return;
			if (!pending && new Blob([answer]).size > 2000)
				throw new Error("Keep your answer within 2,000 bytes.");
			pending ??= {
				session: current.session.id,
				position: current.question.position,
				answer,
				id: crypto.randomUUID(),
			};
			await service.answer(pending.session, pending.position, pending.answer, pending.id);
			current = await service.get(pending.session);
			pending = undefined;
			answer = "";
			await tick();
			answerInput?.focus();
		});
	}
	async function control(action: Action) {
		await run(async () => {
			if (!current?.session || !current.question) return;
			pendingControl ??= {
				session: current.session.id,
				position: current.question.position,
				action,
				id: crypto.randomUUID(),
			};
			current = await service.control(
				pendingControl.session,
				pendingControl.position,
				pendingControl.action,
				pendingControl.id,
			);
			pendingControl = undefined;
		});
	}
	async function back() {
		await run(async () => {
			current = undefined;
			await load();
		});
	}
</script>

<section aria-label="Learning activities" aria-busy={busy}>
	<ErrorToast message={error} />
	{#if current?.session}
		<div class="progress-row">
			<span>{current.answered} of {current.total} done</span>
			<progress value={current.answered} max={current.total || 1} aria-label="Session progress"
			></progress>
		</div>
		{#if feedback(current.lastResult)}<p class="feedback" role="status">
				{feedback(current.lastResult)}
			</p>{/if}
		{#if current.session.state === State.COMPLETED}
			<h2>Practice complete!</h2>
			<p>Your answers have been saved.</p>
			<Button icon={UiArrowLeft} disabled={busy} onclick={() => void back()}
				>Back to activities</Button
			>
		{:else if current.session.state === State.CANCELLED}
			<h2>Practice stopped</h2>
			<p>Your answers are saved for your guardian.</p>
			<Button icon={UiArrowLeft} disabled={busy} onclick={() => void back()}
				>Back to activities</Button
			>
		{:else if current.question}
			<h2 id="question-prompt" class="prompt">{current.question.prompt}</h2>
			{#if current.hint}<p class="note" role="status">Hint: {current.hint}</p>{/if}
			{#if current.revealedAnswer}<p class="note" role="status">
					Let's learn it together: {current.revealedAnswer}
				</p>{/if}
			{#if current.helpRequested}<p class="note" role="status">
					Help requested. You can ask your guardian or stop here.
				</p>{/if}
			{#if voice && !busy && !pending && !pendingControl && [PracticeQuestionKind.SHORT_ANSWER, PracticeQuestionKind.SPELLING].includes(current.question.kind)}
				{#key `${current.session.id}:${current.question.position}`}<VoiceTutor
						service={voice}
						sessionId={current.session.id}
						onAnswer={(value) => {
							answerInput?.set(
								current?.question?.kind === PracticeQuestionKind.SPELLING
									? spellingDraft(value)
									: value,
							);
						}}
					/>{/key}
			{/if}
			<form class="answer-form" onsubmit={submit}>
				<QuestionAnswer
					bind:this={answerInput}
					question={current.question}
					output={questionVoice}
					onchange={(value, ready) => {
						answer = value;
						answerReady = ready;
					}}
					disabled={busy || !!pending}
				/>
				<span class="check"
					><Button
						icon={UiCheck}
						type="submit"
						disabled={busy || (!pending && !answerReady) || !!pendingControl}
						>{pending ? "Retry saving answer" : "Check answer"}</Button
					></span
				>
			</form>
			<div class="actions more">
				{#if pendingControl}
					<Button
						icon={UiRefreshCw}
						disabled={busy}
						onclick={() => void control(pendingControl!.action)}>Retry request</Button
					>
				{:else}
					<div class="v-button-row">
						{#if current.question.hintCount > 0}<Button
								icon={UiLightbulb}
								variant="ghost"
								disabled={busy || !!pending}
								onclick={() => void control(Action.HINT)}>Hint</Button
							>{/if}
						<Button
							icon={UiHandHelping}
							variant="ghost"
							disabled={busy || !!pending || current.helpRequested}
							onclick={() => void control(Action.HELP)}>Ask for help</Button
						>
						<Button
							icon={UiSquare}
							variant="ghost"
							disabled={busy || !!pending}
							onclick={() => void control(Action.STOP)}>Stop practice</Button
						>
					</div>
				{/if}
			</div>
			{#if familyAi && current.session.practiceId}
				{#key `${current.session.id}:${current.question.position}`}<ChildAiHelp
						service={familyAi}
						practiceId={current.session.practiceId}
						version={current.session.practiceVersion}
						position={current.question.position}
					/>{/key}
			{/if}
		{/if}
	{:else}
		<h2>Your learning space</h2>
		{#if !activities.length && !busy}<p>
				No activities are available yet. Ask a guardian to approve some practice.
			</p>{/if}
		{#each activities as activity (activity.practice?.id)}
			<article>
				<h3>{activity.title}</h3>
				<p>{activity.subject}</p>
				<Button icon={UiPlay} disabled={busy} onclick={() => void start(activity)}
					>{activity.state === State.COMPLETED
						? "View completed practice"
						: activity.state === State.CANCELLED
							? "View stopped practice"
							: activity.sessionId
								? "Resume practice"
								: "Start practice"}</Button
				>
			</article>
		{/each}
		<Button icon={UiRefreshCw} variant="ghost" disabled={busy} onclick={() => void run(load)}
			>Refresh activities</Button
		>
	{/if}
</section>

<style>
	section {
		display: grid;
		gap: calc(var(--v-space) * 1.5);
		min-width: 0;
	}
	h2,
	h3,
	p {
		overflow-wrap: anywhere;
	}
	article {
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius-sm);
		padding: calc(var(--v-space) * 2);
	}
	.progress-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		color: var(--v-muted);
		font-size: 0.85rem;
		white-space: nowrap;
	}
	progress {
		flex: 1;
		width: 100%;
		height: 0.5rem;
		border: 0;
		border-radius: 999px;
		overflow: hidden;
		appearance: none;
		background: color-mix(in srgb, var(--v-fg) 12%, transparent);
		accent-color: var(--v-primary);
	}
	progress::-webkit-progress-bar {
		border-radius: 999px;
		background: color-mix(in srgb, var(--v-fg) 12%, transparent);
	}
	progress::-webkit-progress-value {
		border-radius: 999px;
		background: var(--v-primary);
	}
	progress::-moz-progress-bar {
		border-radius: 999px;
		background: var(--v-primary);
	}
	.feedback {
		margin: 0;
		padding: 0.6rem 0.9rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--v-primary) 12%, transparent);
		font-weight: 600;
		text-align: center;
	}
	.prompt {
		margin: 0.5rem 0 0;
		font-size: clamp(1.5rem, 4vw, 2rem);
		line-height: 1.25;
		text-align: center;
	}
	.note {
		margin: 0;
		color: var(--v-muted);
		text-align: center;
	}
	form {
		display: grid;
		gap: calc(var(--v-space) * 1.5);
	}
	/* The one main action, big and easy to tap. */
	.check {
		display: grid;
	}
	.check :global(.v-btn) {
		width: 100%;
		justify-content: center;
		min-height: 52px;
		font-size: 1.05rem;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--v-space);
	}
	.actions.more {
		justify-content: center;
	}
	.more :global(.v-btn) {
		font-size: 0.85rem;
		opacity: 0.85;
	}
</style>
