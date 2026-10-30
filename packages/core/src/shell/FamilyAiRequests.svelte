<script lang="ts">
	import { onDestroy, onMount } from "svelte";
	import { Button, ErrorToast } from "../components/index";
	import type { FamilyAiService, HelpRequest } from "../family-ai/service";

	let { service }: { service: FamilyAiService } = $props();

	let requests = $state<HelpRequest[]>([]);
	let answered = $state<{ question: string; reply: string }>();
	let busy = $state(false);
	let error = $state("");
	let timer: ReturnType<typeof setInterval> | undefined;

	async function load() {
		try {
			requests = await service.helpRequests();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Help requests are unavailable.";
		}
	}
	onMount(() => {
		void load();
		timer = setInterval(() => {
			if (!busy) void load();
		}, 15_000);
	});
	onDestroy(() => clearInterval(timer));

	async function act(request: HelpRequest, approve: boolean) {
		if (busy) return;
		busy = true;
		error = "";
		answered = undefined;
		try {
			if (approve) {
				answered = { question: request.question, reply: await service.approveHelp(request.id) };
			} else {
				await service.declineHelp(request.id);
			}
			await load();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Could not answer this request.";
			await load();
		} finally {
			busy = false;
		}
	}
</script>

<section class="family-ai-requests" aria-label="AI help requests">
	<h3>AI help requests</h3>
	{#if !requests.length}
		<p class="note">No help requests waiting.</p>
	{/if}
	<ul>
		{#each requests as request (request.id)}
			<li>
				<span class="summary">{request.summary}</span>
				<q>{request.question}</q>
				<div class="actions">
					<Button disabled={busy} onclick={() => void act(request, true)}>Approve and answer</Button
					>
					<Button variant="ghost" disabled={busy} onclick={() => void act(request, false)}
						>Decline</Button
					>
				</div>
			</li>
		{/each}
	</ul>
	{#if answered}
		<p role="status">Sent a hint for “{answered.question}”: {answered.reply}</p>
	{/if}
	<ErrorToast message={error} />
</section>

<style>
	.family-ai-requests {
		display: grid;
		gap: var(--v-space);
		margin-top: calc(var(--v-space) * 2);
	}
	h3 {
		margin: 0;
		font-size: 1rem;
	}
	ul {
		display: grid;
		gap: var(--v-space);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: grid;
		gap: 4px;
		overflow-wrap: anywhere;
	}
	.summary,
	.note {
		font-size: 0.85rem;
		color: var(--v-muted);
	}
	.note {
		margin: 0;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--v-space);
	}
</style>
