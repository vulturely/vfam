<script lang="ts">
	import { onDestroy } from "svelte";
	import UiSparkles from "lucide-svelte/icons/sparkles";
	import { Button, ErrorToast } from "../components/index";
	import type { ChildFamilyAiService, ChildHelp } from "../family-ai/child";

	let {
		service,
		practiceId,
		version,
		position,
	}: {
		service: ChildFamilyAiService;
		practiceId: string;
		version: number;
		position: number;
	} = $props();

	let open = $state(false);
	let message = $state("");
	let help = $state<ChildHelp>();
	let busy = $state(false);
	let error = $state("");
	let watching: globalThis.AbortController | undefined;
	onDestroy(() => watching?.abort());

	const statusText: Record<ChildHelp["status"], string> = {
		waiting_for_parent: "Waiting for a grown-up to say yes…",
		answering: "The tutor is thinking…",
		answered: "",
		declined: "A grown-up said not this time. You can ask them directly.",
		expired: "This question expired. You can ask again.",
	};

	async function ask(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		busy = true;
		error = "";
		try {
			help = await service.askForHelp({ practiceId, version, position, question: message });
			message = "";
			if (help.status === "waiting_for_parent" || help.status === "answering") {
				watching?.abort();
				watching = new globalThis.AbortController();
				for await (const update of service.follow(help.jobId, watching.signal)) help = update;
			}
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Could not ask the tutor. Try again.";
		} finally {
			busy = false;
		}
	}
</script>

<section class="ai-help" aria-label="AI tutor">
	{#if !open}
		<Button icon={UiSparkles} variant="ghost" onclick={() => (open = true)}>Ask the AI tutor</Button
		>
	{:else}
		<p class="note">The tutor gives hints and steps, not the answer.</p>
		{#if help?.reply}
			<p class="reply" role="status"><strong>Tutor:</strong> {help.reply}</p>
		{:else if help}
			<p role="status">{statusText[help.status]}</p>
		{/if}
		{#if !help || !["waiting_for_parent", "answering"].includes(help.status)}
			<form onsubmit={ask}>
				<label for="ai-help-{position}">What are you stuck on?</label>
				<textarea
					id="ai-help-{position}"
					bind:value={message}
					maxlength="500"
					rows="2"
					required
					disabled={busy}></textarea>
				<Button type="submit" disabled={busy || !message.trim()}>Ask</Button>
			</form>
		{/if}
		<ErrorToast message={error} />
	{/if}
</section>

<style>
	.ai-help {
		display: grid;
		gap: var(--v-space);
		margin-top: var(--v-space);
	}
	form {
		display: grid;
		gap: calc(var(--v-space) / 2);
	}
	textarea {
		font: inherit;
		padding: var(--v-space);
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius-sm);
		background: var(--v-bg);
		color: var(--v-fg);
		resize: vertical;
	}
	.note {
		margin: 0;
		font-size: 0.85rem;
		color: var(--v-muted);
	}
	.reply {
		margin: 0;
		padding: var(--v-space);
		border-radius: var(--v-radius-sm);
		background: color-mix(in srgb, var(--v-primary) 8%, transparent);
	}
</style>
