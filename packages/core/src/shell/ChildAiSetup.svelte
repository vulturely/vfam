<script lang="ts">
	import { onDestroy, onMount } from "svelte";
	import { Button, ErrorToast } from "../components/index";
	import type { ChildFamilyAiService } from "../family-ai/child";

	let { service }: { service: ChildFamilyAiService } = $props();

	let needed = $state(false);
	let code = $state("");
	let ready = $state(false);
	let busy = $state(false);
	let error = $state("");
	let waiting: globalThis.AbortController | undefined;
	onDestroy(() => waiting?.abort());

	onMount(() => {
		void (async () => {
			try {
				// Also removes a key a parent has revoked.
				if ((await service.mode()) === "child_device") needed = !(await service.installed());
			} catch {
				needed = false;
			}
		})();
	});

	async function start() {
		if (busy) return;
		busy = true;
		error = "";
		code = "";
		try {
			const transfer = await service.offerKey();
			waiting?.abort();
			waiting = new globalThis.AbortController();
			for await (const step of service.waitForKey(transfer, waiting.signal)) {
				code = step.code ?? "";
				if (step.installed) {
					ready = true;
					needed = false;
				}
			}
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Setup did not finish. Try again.";
		} finally {
			busy = false;
		}
	}
</script>

{#if needed}
	<section class="ai-setup" aria-label="AI tutor setup">
		<p>A grown-up allowed the AI tutor on this device.</p>
		{#if code}
			<p role="status">
				Show this code to your grown-up: <strong class="code"
					>{code.slice(0, 3)} {code.slice(3)}</strong
				>
			</p>
			<p class="note">They will check it matches the code on their screen.</p>
		{:else if busy}
			<p role="status">Waiting for your grown-up to open AI settings…</p>
		{/if}
		{#if !busy}<Button onclick={() => void start()}>Set up the AI tutor</Button>{/if}
		<ErrorToast message={error} />
	</section>
{:else if ready}
	<p role="status">The AI tutor is ready on this device.</p>
{/if}

<style>
	.ai-setup {
		display: grid;
		gap: var(--v-space);
		margin-bottom: var(--v-space);
	}
	.code {
		font-size: 1.4rem;
		letter-spacing: 0.15em;
	}
	.note {
		margin: 0;
		font-size: 0.85rem;
		color: var(--v-muted);
	}
</style>
