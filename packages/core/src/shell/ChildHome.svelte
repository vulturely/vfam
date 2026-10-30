<script lang="ts">
	import { getContext, onMount } from "svelte";
	import BookOpen from "lucide-svelte/icons/book-open";
	import ListChecks from "lucide-svelte/icons/list-checks";
	import Bell from "lucide-svelte/icons/bell";
	import RefreshCw from "lucide-svelte/icons/refresh-cw";
	import Play from "lucide-svelte/icons/play";
	import Send from "lucide-svelte/icons/send";
	import Clock from "lucide-svelte/icons/clock";
	import PartyPopper from "lucide-svelte/icons/party-popper";
	import Smile from "lucide-svelte/icons/smile";
	import { Badge, Button, ErrorToast, IconButton } from "../components/index";
	import type { Runtime } from "../runtime/registry.svelte";
	import {
		LearningSessionState,
		TaskStatus,
		type ChildPractice,
		type GetChildPolicyResponse,
		type Task,
	} from "../api/protocol";
	import { childReminders } from "../child-home/reminders";
	let { name, onlearn }: { name: string; onlearn: () => void } = $props();
	const runtime = getContext<Runtime>("vulture:runtime");
	let loading = $state(true);
	let error = $state("");
	let busyTask = $state("");
	let tasks = $state<Task[]>([]);
	let homework = $state<ChildPractice[] | null>(null);
	let policy = $state<GetChildPolicyResponse | null>(null);
	const todo = $derived(
		homework?.filter((item) => item.state !== LearningSessionState.COMPLETED) ?? [],
	);
	const openTasks = $derived(
		tasks.filter((t) => ![TaskStatus.COMPLETED, TaskStatus.CANCELLED].includes(t.status)),
	);
	const reminders = $derived(
		childReminders({
			now: new Date(),
			tasks,
			homework: todo.length,
			learning: policy
				? {
						allowed: policy.allowed,
						nextAllowedAt: policy.nextAllowedAt,
						timezone: policy.timezone,
					}
				: undefined,
		}),
	);
	const statusText: Partial<Record<TaskStatus, string>> = {
		[TaskStatus.TODO]: "To do",
		[TaskStatus.IN_PROGRESS]: "Doing it",
		[TaskStatus.IN_REVIEW]: "Waiting for a guardian",
		[TaskStatus.REJECTED]: "Try again",
	};
	async function refresh() {
		loading = true;
		error = "";
		const [taskResult, policyResult] = await Promise.allSettled([
			runtime.services.childHome.tasks(),
			runtime.services.timetable.policy("learning"),
		]);
		tasks = taskResult.status === "fulfilled" ? taskResult.value : [];
		policy = policyResult.status === "fulfilled" ? policyResult.value : null;
		// Homework is only listed during learning time.
		homework = policy?.allowed
			? await runtime.services.childLearning.list().catch(() => null)
			: null;
		if (taskResult.status === "rejected") error = "Could not load your tasks. Please retry.";
		loading = false;
	}
	async function mark(task: Task, status: TaskStatus.IN_PROGRESS | TaskStatus.IN_REVIEW) {
		if (busyTask) return;
		busyTask = task.id;
		error = "";
		try {
			const updated = await runtime.services.childHome.markTask(task.id, status);
			tasks = tasks.map((t) => (t.id === updated.id ? updated : t));
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Could not update the task.";
		} finally {
			busyTask = "";
		}
	}
	function due(task: Task) {
		if (!task.endAt) return "";
		const at = new Date(task.endAt);
		return Number.isNaN(at.getTime())
			? ""
			: `Due ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(at)}`;
	}
	onMount(() => {
		void refresh();
	});
</script>

<section class="child-home" aria-labelledby="child-home-title" aria-busy={loading}>
	<div class="home-heading">
		<Badge>Your day</Badge>
		<IconButton
			label="Refresh home"
			icon={RefreshCw}
			disabled={loading}
			onclick={() => void refresh()}
		/>
	</div>
	<h2 id="child-home-title">Hi, {name}!</h2>
	<ErrorToast message={error} />
	{#if reminders.length}<ul class="reminders" aria-label="Reminders">
			{#each reminders as reminder (reminder.id)}<li class={reminder.tone}>
					<Bell size={15} aria-hidden="true" />{reminder.text}
				</li>{/each}
		</ul>{/if}
	<div class="panels">
		<section class="panel homework" aria-labelledby="child-homework-title">
			<header>
				<span class="panel-icon"><BookOpen size={20} aria-hidden="true" /></span>
				<h3 id="child-homework-title">Homework</h3>
				{#if todo.length}<span class="count">{todo.length}</span>{/if}
			</header>
			{#if loading}<p class="empty-text">Loading…</p>
			{:else if !policy?.allowed}<div class="empty">
					<Clock size={36} strokeWidth={1.5} aria-hidden="true" />
					<p>Homework opens during learning time.</p>
				</div>
			{:else if homework === null}<div class="empty">
					<RefreshCw size={36} strokeWidth={1.5} aria-hidden="true" />
					<p>Could not load homework. Please retry.</p>
				</div>
			{:else if !todo.length}<div class="empty">
					<PartyPopper size={36} strokeWidth={1.5} aria-hidden="true" />
					<p>All done. No homework right now.</p>
				</div>
			{:else}<ul class="rows">
					{#each todo as item, i (item.practice?.id ?? i)}<li>
							<button class="row" type="button" onclick={onlearn}>
								<span class="row-text"
									><strong>{item.title || "Practice"}</strong><span>{item.subject}</span></span
								>
								<span class="action"
									>{item.state === LearningSessionState.ACTIVE ? "Continue" : "Start"}</span
								>
							</button>
						</li>{/each}
				</ul>{/if}
		</section>
		<section class="panel tasks" aria-labelledby="child-tasks-title">
			<header>
				<span class="panel-icon"><ListChecks size={20} aria-hidden="true" /></span>
				<h3 id="child-tasks-title">Tasks</h3>
				{#if openTasks.length}<span class="count">{openTasks.length}</span>{/if}
			</header>
			{#if loading}<p class="empty-text">Loading…</p>
			{:else if !openTasks.length}<div class="empty">
					<Smile size={36} strokeWidth={1.5} aria-hidden="true" />
					<p>No tasks for you right now.</p>
				</div>
			{:else}<ul class="rows">
					{#each openTasks as task (task.id)}<li>
							<article class="row" aria-label={task.title}>
								<span class="row-text"
									><strong>{task.title}</strong><span
										>{statusText[task.status] ?? ""}{due(task) ? ` · ${due(task)}` : ""}</span
									></span
								>
								{#if task.status === TaskStatus.TODO || task.status === TaskStatus.REJECTED}<Button
										variant="ghost"
										icon={Play}
										disabled={!!busyTask}
										onclick={() => void mark(task, TaskStatus.IN_PROGRESS)}>Start</Button
									>
								{:else if task.status === TaskStatus.IN_PROGRESS}<Button
										variant="ghost"
										icon={Send}
										disabled={!!busyTask}
										onclick={() => void mark(task, TaskStatus.IN_REVIEW)}>I’m done</Button
									>{/if}
							</article>
						</li>{/each}
				</ul>{/if}
		</section>
	</div>
</section>

<style>
	.child-home {
		width: min(100%, 960px);
		margin: auto;
		display: grid;
		gap: 14px;
		padding-block: 24px;
	}
	.home-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	h2 {
		margin: 0;
		font-size: clamp(1.8rem, 4vw, 2.6rem);
		line-height: 1.12;
		overflow-wrap: anywhere;
	}
	p {
		margin: 0;
		color: var(--v-muted);
	}
	.reminders {
		display: grid;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.reminders li {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px;
		border: 1px solid var(--v-border);
		border-radius: 10px;
		font-size: 0.9rem;
	}
	.reminders li.overdue {
		border-color: var(--v-danger, #d14343);
	}
	.reminders li.soon {
		border-color: var(--v-primary);
	}
	.panels {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
		gap: 16px;
		margin-top: 8px;
	}
	.panel {
		display: flex;
		flex-direction: column;
		gap: 12px;
		min-width: 0;
		min-height: 220px;
		padding: 20px;
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius);
		background: var(--v-glass, var(--v-surface));
		box-shadow: var(--v-shadow);
	}
	.panel header {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.panel h3 {
		margin: 0;
		font-size: 1.05rem;
	}
	.panel-icon {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border-radius: 10px;
		background: color-mix(in srgb, var(--v-primary) 14%, transparent);
		color: var(--v-primary-text, var(--v-primary));
	}
	.tasks .panel-icon {
		background: color-mix(in srgb, var(--v-success, #2f9e6b) 16%, transparent);
		color: var(--v-success, #2f9e6b);
	}
	.count {
		margin-left: auto;
		min-width: 1.6rem;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--v-fg) 8%, transparent);
		font-size: 0.8rem;
		font-weight: 650;
		text-align: center;
	}
	/* A calm, friendly empty state instead of a bare line of text. */
	.empty {
		display: grid;
		flex: 1;
		place-content: center;
		justify-items: center;
		gap: 10px;
		padding: 12px;
		color: color-mix(in srgb, var(--v-muted) 70%, transparent);
		text-align: center;
	}
	.empty p {
		max-width: 26ch;
		color: var(--v-muted);
	}
	.empty-text {
		margin: auto;
	}
	.rows {
		display: grid;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		min-width: 0;
		padding: 12px 14px;
		border: 1px solid var(--v-border);
		border-radius: 12px;
		background: transparent;
		color: var(--v-fg);
		font: inherit;
		text-align: left;
	}
	button.row {
		cursor: pointer;
	}
	button.row:hover {
		border-color: var(--v-primary);
	}
	.row-text {
		display: grid;
		flex: 1;
		gap: 2px;
		min-width: 0;
	}
	.row-text strong {
		overflow-wrap: anywhere;
	}
	.row-text span {
		color: var(--v-muted);
		font-size: 0.85rem;
	}
	.action {
		color: var(--v-primary-text, var(--v-primary));
		font-weight: 650;
	}
</style>
