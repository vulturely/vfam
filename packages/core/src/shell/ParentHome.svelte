<script lang="ts">
	import { getContext, onMount } from "svelte";
	import ListChecks from "lucide-svelte/icons/list-checks";
	import BookOpen from "lucide-svelte/icons/book-open";
	import Users from "lucide-svelte/icons/users";
	import ArrowUpRight from "lucide-svelte/icons/arrow-up-right";
	import RefreshCw from "lucide-svelte/icons/refresh-cw";
	import { Badge, Button, IconButton } from "../components/index";
	import type { Runtime } from "../runtime/registry.svelte";
	import type { TaskRecord } from "../tasks/service";

	const runtime = getContext<Runtime>("vulture:runtime");
	let loading = $state(true);
	let unavailable = $state(false);
	let noFamily = $state(false);
	let tasks = $state<TaskRecord[] | null>(null);
	let profiles = $state<number | null>(null);
	let members = $state<number | null>(null);
	let admins = $state<number | null>(null);
	const open = $derived(tasks?.filter((t) => !["completed", "cancelled"].includes(t.status)));
	const completed = $derived(tasks?.filter((t) => t.status === "completed").length);
	const overdue = $derived(open?.filter((t) => t.endAt && Date.parse(t.endAt) < Date.now()).length);
	const cards = $derived([
		{
			title: "Family tasks",
			icon: ListChecks,
			value: open?.length,
			label: "open tasks",
			detail: tasks ? `${completed} completed · ${overdue} overdue` : "Task summary unavailable",
			action: "Manage tasks",
			route: "family:manage",
			params: { tab: "tasks" },
		},
		{
			title: "Children’s learning",
			icon: BookOpen,
			value: profiles,
			label: "child profiles",
			detail: "Profiles shared with you as a guardian",
			action: "Open learning",
			route: "learning:profiles",
			params: {} as Record<string, string>,
		},
		{
			title: "Your family",
			icon: Users,
			value: members,
			label: "family members",
			detail:
				admins === null
					? "Member summary unavailable"
					: `${admins} ${admins === 1 ? "admin" : "admins"} · Manage relatives and roles`,
			action: "Manage members",
			route: "family:manage",
			params: { tab: "manage" },
		},
	]);
	async function refresh() {
		loading = true;
		unavailable = false;
		try {
			const family = await runtime.services.family.getMyFamily();
			noFamily = !family;
			if (!family) {
				runtime.router.navigate("family:setup");
				tasks = [];
				profiles = 0;
				members = 0;
				admins = 0;
				return;
			}
			const [taskResult, profileResult, memberResult] = await Promise.allSettled([
				runtime.services.tasks.listTasks(family.id),
				runtime.services.learning.listProfiles(family.id),
				runtime.services.family.listMembers(family.id),
			]);
			tasks = taskResult.status === "fulfilled" ? taskResult.value : null;
			profiles = profileResult.status === "fulfilled" ? profileResult.value.length : null;
			members = memberResult.status === "fulfilled" ? memberResult.value.length : null;
			admins =
				memberResult.status === "fulfilled"
					? memberResult.value.filter((m) => m.role === "admin").length
					: null;
			unavailable = [taskResult, profileResult, memberResult].some((r) => r.status === "rejected");
		} catch {
			tasks = null;
			profiles = null;
			members = null;
			admins = null;
			unavailable = true;
		} finally {
			loading = false;
		}
	}
	onMount(() => {
		void refresh();
	});
</script>

<section class="parent-home" aria-labelledby="parent-home-title" aria-busy={loading}>
	<div class="home-heading">
		<Badge>Family overview</Badge>
		<IconButton
			label="Refresh household stats"
			icon={RefreshCw}
			disabled={loading}
			onclick={() => void refresh()}
		/>
	</div>
	<h2 id="parent-home-title">Your household, at a glance.</h2>
	<p class="intro">Keep tasks moving, support learning, and stay connected with your family.</p>
	<Button onclick={() => runtime.router.navigate("family:setup")}>
		{noFamily ? "Set up your family" : "Family setup"}
	</Button>
	{#if noFamily}<p role="status">
			Create or join your family to start your household overview.
		</p>{/if}
	{#if unavailable}<p role="status">Some stats are unavailable. Refresh to try again.</p>{/if}
	<div class="stats-grid">
		{#each cards as card (card.title)}
			{@const Icon = card.icon}
			<button
				class="stat-card"
				type="button"
				onclick={() => runtime.router.navigate(card.route, card.params)}
			>
				<span class="card-heading"
					><span class="card-icon"><Icon size={22} aria-hidden="true" /></span><span
						>{card.title}</span
					><ArrowUpRight size={18} aria-hidden="true" /></span
				>
				<span class="stat-value">{loading ? "…" : (card.value ?? "—")}</span>
				<span class="stat-label">{card.label}</span>
				<span class="stat-detail">{loading ? "Loading summary…" : card.detail}</span>
				<span class="card-action">{card.action}<ArrowUpRight size={16} aria-hidden="true" /></span>
			</button>
		{/each}
	</div>
</section>

<style>
	.parent-home {
		width: min(100%, 960px);
		margin: auto;
		display: grid;
		gap: 16px;
		padding-block: 24px;
	}
	.home-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	h2 {
		margin: 0;
		font-size: clamp(1.8rem, 4vw, 3rem);
		line-height: 1.12;
		color: var(--v-fg);
	}
	p {
		margin: 0;
		color: var(--v-muted);
		line-height: 1.5;
	}
	.stats-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 16px;
		margin-top: 8px;
	}
	.stat-card {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		min-width: 0;
		padding: 20px;
		gap: 8px;
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius);
		background: var(--v-glass, var(--v-surface));
		box-shadow: var(--v-shadow);
		color: var(--v-fg);
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition:
			background 150ms ease,
			border-color 150ms ease;
	}
	.stat-card:hover {
		background: var(--v-surface);
		border-color: var(--v-primary);
	}
	.stat-card:focus-visible {
		outline: 2px solid var(--v-ring);
		outline-offset: 3px;
	}
	.card-heading {
		display: flex;
		align-items: center;
		gap: 10px;
		font-weight: 700;
	}
	.card-heading > :global(svg) {
		margin-left: auto;
		color: var(--v-muted);
		flex-shrink: 0;
	}
	.card-icon {
		display: grid;
		place-items: center;
		color: var(--v-primary-text, var(--v-primary));
	}
	.stat-value {
		font-size: 2.75rem;
		font-weight: 750;
		line-height: 1;
		margin-top: 16px;
	}
	.stat-label {
		font-weight: 600;
	}
	.stat-detail {
		font-size: 0.85rem;
		color: var(--v-muted);
		line-height: 1.5;
		margin-bottom: 12px;
	}
	.card-action {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-top: auto;
		padding-top: 12px;
		border-top: 1px solid var(--v-border);
		color: var(--v-primary-text, var(--v-primary));
		font-size: 0.9rem;
		font-weight: 650;
	}
	@media (max-width: 900px) {
		.stats-grid {
			grid-template-columns: 1fr;
		}
		.stat-card {
			padding: 16px;
		}
		.stat-value {
			margin-top: 4px;
			font-size: 2.25rem;
		}
	}
</style>
