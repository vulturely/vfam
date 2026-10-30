<script lang="ts">
	import UiRefreshCw from "lucide-svelte/icons/refresh-cw";
	import { onMount } from "svelte";
	import { ErrorToast, IconButton } from "../components/index";
	import { loadNotifications } from "../parent-learning/notifications";
	import type { DashboardServices } from "../parent-learning/dashboard";
	let { services, profileId }: { services: DashboardServices; profileId: string } = $props();
	let data = $state<Awaited<ReturnType<typeof loadNotifications>>>();
	let busy = $state(false),
		error = $state("");
	let active = true;
	const count = $derived(data ? data.review.length + data.uncertain.length + data.help.length : 0);
	async function refresh() {
		if (busy) return;
		busy = true;
		error = "";
		try {
			const result = await loadNotifications(services, profileId);
			if (active) data = result;
		} catch {
			if (active) error = "Could not refresh notifications. Please try again.";
		} finally {
			if (active) busy = false;
		}
	}
	onMount(() => {
		active = true;
		void refresh();
		const timer = setInterval(() => void refresh(), 5000);
		return () => {
			active = false;
			clearInterval(timer);
		};
	});
</script>

<section class="learning-dashboard" aria-label="Learning notifications">
	<div class="dashboard-intro">
		<div>
			<h3>Notifications</h3>
			<p>
				{data
					? count
						? `${count} ${count === 1 ? "item needs" : "items need"} your attention`
						: "You’re all caught up."
					: "Updates for this child"}
			</p>
		</div>
		<IconButton
			icon={UiRefreshCw}
			label="Refresh notifications"
			disabled={busy}
			onclick={() => void refresh()}
		/>
	</div>
	<ErrorToast message={error ? error + (data ? " Showing the last available updates." : "") : ""} />
	{#if !data && busy}<p role="status">Loading notifications…</p>{/if}
	{#if data}
		{#if data.help.length}
			<section class="dashboard-block" aria-label="Requests for help">
				<h4>Help requested <span>{data.help.length}</span></h4>
				<ul>
					{#each data.help as attempt (attempt.session!.id)}<li>
							<strong>{attempt.homeworkTitle || "Learning session"}</strong>
							<p>{new Date(attempt.session!.createdAt).toLocaleString()}</p>
						</li>{/each}
				</ul>
				<p>Open Attempts to review their answers and help.</p>
			</section>
		{/if}
		{#if data.uncertain.length}
			<section class="dashboard-block" aria-label="Answers needing review">
				<h4>Answers to review <span>{data.uncertain.length}</span></h4>
				<ul>
					{#each data.uncertain as answer (answer.id)}<li>
							<strong>{answer.prompt}</strong>
							<p>Answer: {answer.answer || "No answer"}</p>
						</li>{/each}
				</ul>
				<p>Open Attempts to review these answers.</p>
			</section>
		{/if}
		{#if data.review.length}
			<section class="dashboard-block" aria-label="Practice awaiting approval">
				<h4>Practice to approve <span>{data.review.length}</span></h4>
				<ul>
					{#each data.review as set (set.practice!.practice!.id)}<li>
							{set.practice!.title}
						</li>{/each}
				</ul>
				<p>Open Homework to review and approve practice.</p>
			</section>
		{/if}
	{/if}
</section>

<style>
	.learning-dashboard {
		display: grid;
		gap: 0.8rem;
		min-width: 0;
		padding: 0.25rem;
	}
	.dashboard-intro {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	h3 {
		font-size: 1rem;
	}
	.dashboard-intro p {
		margin-top: 0.2rem;
		font-size: 0.75rem;
	}
	.dashboard-block {
		min-width: 0;
		border: 1px solid var(--v-border);
		border-radius: 9px;
		background: color-mix(in srgb, var(--v-fg) 2%, transparent);
		overflow: clip;
	}
	section.dashboard-block {
		display: grid;
		gap: 0.65rem;
		padding: 0.8rem;
	}
	strong {
		color: var(--v-fg);
		font-weight: 500;
	}
	h4 span {
		color: var(--v-muted);
		font-size: 0.72rem;
		margin-left: 0.35rem;
	}
	h4 {
		font-size: 0.85rem;
	}
	h3,
	h4,
	p,
	ul {
		margin: 0;
	}
	p,
	li {
		font-size: 0.78rem;
		line-height: 1.5;
		color: var(--v-muted);
		overflow-wrap: anywhere;
	}
	ul {
		list-style: none;
		padding: 0;
	}
	li {
		padding: 0.5rem 0;
	}
	li + li {
		border-top: 1px solid var(--v-border);
	}
	ul:empty {
		display: none;
	}
	.dashboard-intro :global(.v-icon-btn::after) {
		right: 0;
		left: auto;
		transform: none;
	}
</style>
