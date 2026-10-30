<script lang="ts">
	import UiRefreshCw from "lucide-svelte/icons/refresh-cw";
	import UiSparkles from "lucide-svelte/icons/sparkles";
	import UiBookOpen from "lucide-svelte/icons/book-open";
	import UiSave from "lucide-svelte/icons/save";
	import UiX from "lucide-svelte/icons/x";
	import UiCheck from "lucide-svelte/icons/check";
	import UiEye from "lucide-svelte/icons/eye";
	import UiLightbulb from "lucide-svelte/icons/lightbulb";
	import UiArrowRight from "lucide-svelte/icons/arrow-right";
	import UiClipboardCheck from "lucide-svelte/icons/clipboard-check";
	import { getContext, onMount, untrack } from "svelte";
	import type { Runtime } from "../runtime/registry.svelte";
	import {
		SourceVersion,
		GeneratePracticeResponse,
		ParentPracticeQuestion,
		PracticeQuestion,
		PracticeQuestionKind,
		HomeworkAnswer,
		type SourceSegment,
		type TutorPracticeResponse,
		type UncertainPracticeAnswer,
	} from "../api/protocol";
	import { Button, ErrorToast, Input } from "../components/index";
	import QuestionSummary from "./QuestionSummary.svelte";
	import ExtractionReview from "./ExtractionReview.svelte";
	import { practiceKind } from "../homework/questionTypes";
	let {
		source,
		subject: sourceSubject,
		onsourcechanged,
	}: {
		source: SourceVersion;
		subject: string;
		/** Approving the text creates a new source version; the parent reloads and remounts us. */
		onsourcechanged?: () => Promise<void>;
	} = $props();
	const runtime = getContext<Runtime>("vulture:runtime");
	let subject = $state(untrack(() => (/math/i.test(sourceSubject) ? "math" : "spelling")));
	let difficulty = $state("standard");
	let aiOptIn = $state(false);
	let count = $state("6");
	let sets = $state<GeneratePracticeResponse[]>([]);
	let selected = $state<GeneratePracticeResponse>();
	// Assigned sets mirror the homework's own questions; they are edited there and reassigned.
	const assigned = $derived(selected?.practice?.origin === "assigned");
	const assignedQuestions = $derived(
		(selected?.questions ?? []).map(
			(q) =>
				new HomeworkAnswer({
					kind: practiceKind(q.question?.kind ?? PracticeQuestionKind.UNSPECIFIED),
					question: q.question?.prompt ?? "",
					answer: q.expectedAnswer,
					explanation: q.explanation,
					choices: q.question?.choices ?? [],
					answers: q.answers,
					items: q.question?.items ?? [],
					say: q.question?.say ?? "",
				}),
		),
	);
	let title = $state("");
	let approvedSource = $state(false);
	// Avoid flashing the text review before the source state is known.
	let loaded = $state(false);
	let sourceSegments = $state<SourceSegment[]>([]);
	let dirty = $state(false);
	let busy = $state(false);
	let error = $state("");
	let tutor = $state<TutorPracticeResponse>();
	let answer = $state("");
	let hintsSeen = $state(0);
	let uncertain = $state<UncertainPracticeAnswer[]>([]);
	async function run(action: () => Promise<void>) {
		if (busy) return;
		busy = true;
		error = "";
		try {
			await action();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Practice request failed. Retry later.";
		} finally {
			busy = false;
		}
	}
	async function load() {
		const review = await runtime.services.extraction.load(source);
		approvedSource = review.state === "confirmed";
		sourceSegments = review.segments;
		sets = await runtime.services.practice.list(source);
		loaded = true;
	}
	onMount(() => {
		void run(load);
	});
	function select(set: GeneratePracticeResponse) {
		selected = set;
		title = set.practice?.title ?? "";
		dirty = false;
		tutor = undefined;
		uncertain = [];
		answer = "";
		hintsSeen = 0;
	}
	async function generate() {
		await run(async () => {
			const set = await runtime.services.practice.generate(
				source,
				subject,
				difficulty,
				Number(count),
				aiOptIn,
			);
			aiOptIn = false;
			await load();
			select(set);
		});
	}
	function update(index: number, change: (q: ParentPracticeQuestion) => void) {
		if (!selected || busy) return;
		const questions = selected.questions.map((q, i) => {
			const next = new ParentPracticeQuestion({
				...q,
				question: new PracticeQuestion(q.question),
			});
			if (i === index) change(next);
			return next;
		});
		selected = new GeneratePracticeResponse({ ...selected, questions });
		dirty = true;
		tutor = undefined;
	}
	function arithmetic(index: number, field: "a" | "b" | "operation", value: string) {
		if (field !== "operation" && (!/^\d*$/.test(value) || Number(value) > 10000)) {
			error = "Use whole numbers from 0 to 10000.";
			return false;
		}
		error = "";
		update(index, (q) => {
			if (field === "operation") q.operation = value;
			else q[field] = BigInt(value || "0");
			const op = q.operation === "add" ? "+" : q.operation === "subtract" ? "-" : "×";
			q.question!.prompt = `What is ${q.a} ${op} ${q.b}?`;
			q.expectedAnswer = String(
				q.operation === "add" ? q.a + q.b : q.operation === "subtract" ? q.a - q.b : q.a * q.b,
			);
		});
		return true;
	}
	async function revise(reject = false) {
		if (!selected?.practice?.practice) return;
		await run(async () => {
			const next = await runtime.services.practice.revise(
				selected!.practice!.practice!,
				title,
				selected!.questions,
				reject,
			);
			await load();
			select(next);
		});
	}
	async function approve() {
		if (!selected?.practice?.practice) return;
		await run(async () => {
			const result = await runtime.services.practice.approve(selected!.practice!.practice!);
			selected = new GeneratePracticeResponse({
				...selected,
				practice: result.practice,
			});
			dirty = false;
			await load();
		});
	}
	async function preview(position = 1) {
		if (!selected?.practice?.practice) return;
		await run(async () => {
			tutor = await runtime.services.practice.tutor(
				selected!.practice!.practice!,
				tutor?.sessionId,
				position,
			);
			hintsSeen = 0;
			answer = "";
		});
	}
	async function step(hint: boolean) {
		if (!selected?.practice?.practice || !tutor?.question) return;
		await run(async () => {
			tutor = await runtime.services.practice.tutor(
				selected!.practice!.practice!,
				tutor!.sessionId,
				tutor!.question!.position,
				hint ? undefined : answer,
				hint,
			);
			if (hint) hintsSeen++;
			uncertain = await runtime.services.practice.uncertain(selected!.practice!.practice!);
		});
	}
</script>

<section aria-label="Parent practice review">
	<h4>Parent-reviewed practice</h4>
	<p>
		Start with spelling or math. Age and grade come from this child's learning profile. Review every
		prompt, answer, hint and source before approval.
	</p>
	{#if error}<ErrorToast message={error} />
		<Button icon={UiRefreshCw} variant="ghost" disabled={busy} onclick={() => run(load)}
			>Reload practice</Button
		>{/if}
	{#if loaded && !approvedSource}
		<p role="status">
			Step 1 of 2: check the worksheet text. Practice is written only from text you confirm.
		</p>
		<ExtractionReview {source} onconfirmed={onsourcechanged ?? (() => run(load))} />
	{:else if loaded}
		<div class="settings">
			<label
				>Practice subject<select disabled={busy} bind:value={subject}
					><option value="spelling">Spelling</option><option value="math">Math</option></select
				></label
			>
			<label
				>Practice difficulty<select disabled={busy} bind:value={difficulty}
					><option value="easy">Easy</option><option value="standard">Standard</option><option
						value="hard">Hard</option
					></select
				></label
			>
			<Input label="Maximum questions (1–12)" type="number" bind:value={count} />
		</div>
		<label class="ai-consent">
			<input type="checkbox" bind:checked={aiOptIn} disabled={busy} />
			I allow AI processing of approved worksheet text for this draft.
		</label>
		<p class="privacy-note">
			Your AI provider receives approved text, source references, age band and grade: your family's
			own provider when it is set up on this device, otherwise the platform's AI. Remove personal
			details from the approved text before opting in. Raw images and submitted answers are not
			sent. Vulture asks providers not to store responses where supported; provider retention
			policies still apply. Uncheck to stop new AI requests. Homework and linked learning data
			expire after 30 days; deleting homework removes them sooner.
		</p>
		<Button icon={UiSparkles} disabled={busy || !approvedSource || !aiOptIn} onclick={generate}
			>{busy ? "Working…" : "Generate practice draft"}</Button
		>
	{/if}
	<ul aria-label="Practice sets">
		{#each sets as set (set.practice!.practice!.id)}<li>
				<Button icon={UiBookOpen} variant="ghost" disabled={busy} onclick={() => select(set)}
					>{set.practice!.title} · {set.practice!.reviewState} · v{set.practice!.practice!
						.version}</Button
				>
			</li>{/each}
	</ul>
	{#if selected?.practice && assigned}
		<p role="status">
			Assigned from this homework's questions. To change them, edit the questions on the homework
			and assign it again.
		</p>
		<div class="question-cards">
			{#each assignedQuestions as question, index (index)}<QuestionSummary
					{question}
					number={index + 1}
				/>{/each}
		</div>
	{:else if selected?.practice}
		<p role="status">
			Practice status: {selected.practice.reviewState}{dirty ? " · unsaved edits" : ""}
		</p>
		<label
			>Practice title<input
				disabled={busy}
				value={title}
				oninput={(e) => {
					title = e.currentTarget.value;
					dirty = true;
				}}
				maxlength="160"
			/></label
		>
		{#each selected.questions as q, index (index)}
			{@const original = sourceSegments.find((s) => s.id === q.sourceSegmentId)}
			<fieldset>
				<legend>Question {index + 1}</legend>
				<label
					>Prompt {index + 1}<input
						disabled={busy}
						value={q.question!.prompt}
						oninput={(e) =>
							update(index, (v) => {
								v.question!.prompt = e.currentTarget.value;
							})}
					/></label
				>
				{#if q.question!.kind !== PracticeQuestionKind.SPELLING}
					<div class="settings">
						<label
							>First number {index + 1}<input
								disabled={busy}
								type="number"
								min="0"
								value={String(q.a)}
								oninput={(e) => {
									if (!arithmetic(index, "a", e.currentTarget.value))
										e.currentTarget.value = String(q.a);
								}}
							/></label
						>
						<label
							>Second number {index + 1}<input
								disabled={busy}
								type="number"
								min="0"
								value={String(q.b)}
								oninput={(e) => {
									if (!arithmetic(index, "b", e.currentTarget.value))
										e.currentTarget.value = String(q.b);
								}}
							/></label
						>
						<label
							>Operation {index + 1}<select
								disabled={busy}
								value={q.operation}
								onchange={(e) => arithmetic(index, "operation", e.currentTarget.value)}
								><option value="add">Add</option><option value="subtract">Subtract</option><option
									value="multiply">Multiply</option
								></select
							></label
						>
					</div>
				{/if}
				<label
					>Answer key {index + 1}<input
						disabled={busy}
						value={q.expectedAnswer}
						readonly={q.question!.kind !== PracticeQuestionKind.SPELLING}
						oninput={(e) =>
							update(index, (v) => {
								v.expectedAnswer = e.currentTarget.value;
							})}
					/></label
				>
				{#each [0, 1] as h (h)}<label
						>Hint {h + 1} for question {index + 1}<input
							disabled={busy}
							value={q.hints[h] ?? ""}
							oninput={(e) =>
								update(index, (v) => {
									v.hints = [...v.hints];
									v.hints[h] = e.currentTarget.value;
								})}
						/></label
					>{/each}
				{#if q.question!.kind === PracticeQuestionKind.MULTIPLE_CHOICE}<label
						>Choices for question {index + 1} (four comma-separated numbers)<input
							disabled={busy}
							value={q.question!.choices.join(", ")}
							oninput={(e) =>
								update(index, (v) => {
									v.question!.choices = e.currentTarget.value.split(",").map((s) => s.trim());
								})}
						/></label
					>{/if}
				<p>
					Approved source{original
						? `, page ${original.pageNumber}, region ${original.ordinal + 1}`
						: ""}: <q>{q.sourceQuote}</q>
				</p>
			</fieldset>
		{/each}
		<div class="actions">
			<Button icon={UiSave} variant="ghost" disabled={busy || !dirty} onclick={() => revise()}
				>Save practice edits as draft</Button
			>
			<Button
				icon={UiX}
				variant="danger"
				disabled={busy || selected.practice.reviewState === "rejected"}
				onclick={() => revise(true)}>Reject practice set</Button
			>
			<Button
				icon={UiCheck}
				disabled={busy || dirty || selected.practice.reviewState !== "draft"}
				onclick={approve}>Approve practice set</Button
			>
			<Button
				icon={UiEye}
				variant="ghost"
				disabled={busy || dirty || selected.practice.reviewState !== "approved"}
				onclick={() => preview()}>Preview tutor</Button
			>
		</div>
		{#if tutor?.question}
			<section aria-label="Tutor preview">
				<h4>{tutor.question.prompt}</h4>
				{#if tutor.question.choices.length}<p>
						Choices: {tutor.question.choices.join(", ")}
					</p>{/if}
				<Input label="Tutor answer" bind:value={answer} />
				<div class="v-button-row">
					<Button icon={UiCheck} disabled={busy} onclick={() => step(false)}>Check answer</Button>
					<Button
						icon={UiLightbulb}
						variant="ghost"
						disabled={busy || Boolean(tutor.revealedAnswer)}
						onclick={() => step(true)}
						>{hintsSeen < 2 ? "Get next hint" : "Show answer after hints"}</Button
					>
				</div>
				{#if tutor.hint}<p role="status">Hint: {tutor.hint}</p>{/if}
				{#if tutor.revealedAnswer}<p role="status">
						Answer: {tutor.revealedAnswer}
					</p>{/if}
				{#if tutor.result}<p role="status">
						{tutor.result === "needs_review"
							? "Uncertain grading — parent review needed"
							: `Result: ${tutor.result}`}
					</p>{/if}
				{#if tutor.question.position < selected.questions.length}<Button
						icon={UiArrowRight}
						variant="ghost"
						disabled={busy}
						onclick={() => preview(tutor!.question!.position + 1)}>Next preview question</Button
					>{/if}
			</section>
		{/if}
		<Button
			icon={UiClipboardCheck}
			variant="ghost"
			disabled={busy}
			onclick={() =>
				run(async () => {
					uncertain = await runtime.services.practice.uncertain(selected!.practice!.practice!);
				})}>Load answers needing parent review</Button
		>
		{#if uncertain.length}<ul aria-label="Answers needing parent review">
				{#each uncertain as a, index (index)}<li>
						{a.prompt} — {a.answer} · Parent review needed
					</li>{/each}
			</ul>{/if}
	{/if}
</section>

<style>
	section,
	label,
	fieldset {
		display: grid;
		gap: var(--v-space);
	}
	section {
		padding-block: var(--v-space);
	}
	p {
		color: var(--v-muted);
		overflow-wrap: anywhere;
	}
	label {
		font-weight: 600;
	}
	input,
	select {
		width: 100%;
		box-sizing: border-box;
		min-height: 44px;
		padding: var(--v-space);
		font: inherit;
		color: var(--v-fg);
		background: var(--v-bg);
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius-sm);
	}
	select:focus-visible {
		outline: 2px solid var(--v-ring);
	}
	fieldset {
		min-width: 0;
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius-sm);
		padding: var(--v-space);
	}
	.ai-consent {
		display: flex;
		align-items: center;
		gap: var(--v-space);
	}
	.ai-consent input {
		width: 20px;
		min-width: 20px;
		min-height: 20px;
		accent-color: var(--v-primary);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--v-space);
	}
	.settings {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr));
		gap: var(--v-space);
	}
	ul {
		padding-left: var(--v-space);
	}
	.question-cards {
		display: grid;
		gap: 0.75rem;
	}
</style>
