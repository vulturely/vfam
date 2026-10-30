<script lang="ts">
	import { onMount } from "svelte";
	import RefreshCw from "lucide-svelte/icons/refresh-cw";
	import { ErrorToast, IconButton } from "../components/index";
	import { animateDetails } from "../components/animateDetails";
	import type { VoiceService } from "../voice/service";
	let { service, profileId }: { service: VoiceService; profileId: string } = $props();
	let enabled = $state(false),
		loaded = $state(false),
		busy = $state(false),
		error = $state("");
	async function run(save = false) {
		if (busy) return;
		busy = true;
		error = "";
		try {
			enabled = (await service.policy(profileId, save ? !enabled : undefined)).enabled;
			loaded = true;
		} catch {
			loaded = false;
			error = "Voice settings unavailable. Retry before changing permission.";
		} finally {
			busy = false;
		}
	}
	onMount(() => {
		void run();
	});
</script>

<section aria-label="Voice privacy controls">
	<div class="voice-row">
		<div>
			<h4>Spoken answers</h4>
			<p id="voice-consent-note">
				Browser speech processing may send audio to its provider’s cloud under that provider’s
				privacy policy.
			</p>
		</div>
		<button
			class="switch"
			role="switch"
			type="button"
			aria-label="Allow browser speech processing"
			aria-describedby="voice-consent-note"
			aria-checked={loaded && enabled}
			disabled={!loaded || busy}
			onclick={() => void run(true)}><span></span></button
		>
	</div>
	<p class="status" role="status">
		{busy
			? "Loading voice settings…"
			: loaded
				? enabled
					? "Voice enabled"
					: "Voice disabled · off by default"
				: "Permission unavailable"}
	</p>
	<ErrorToast message={error} />
	{#if error}<div class="error-row">
			<IconButton
				icon={RefreshCw}
				label="Retry voice settings"
				disabled={busy}
				onclick={() => void run()}
			/>
		</div>{/if}
	<details use:animateDetails>
		<summary>How your child’s voice is handled</summary>
		<div class="accordion-body">
			<ul>
				<li>
					Vulture does not store raw audio or conversation transcripts. Submitted answers are saved
					in learning history.
				</li>
				<li>Read-aloud uses installed local voices.</li>
				<li>No wake word or background listening. Audio retention cannot be enabled.</li>
				<li>Review your browser provider’s privacy policy before enabling spoken answers.</li>
			</ul>
		</div>
	</details>
</section>

<style>
	section {
		display: grid;
		gap: 0.65rem;
		min-width: 0;
	}
	.voice-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	h4 {
		margin: 0 0 0.3rem;
		font-size: 0.82rem;
		font-weight: 500;
	}
	p {
		margin: 0;
		font-size: 0.72rem;
		color: var(--v-muted);
		line-height: 1.5;
	}
	.switch {
		flex: 0 0 36px;
		width: 36px;
		height: 21px;
		border: 1px solid var(--v-border);
		border-radius: 999px;
		padding: 2px;
		background: color-mix(in srgb, var(--v-fg) 10%, transparent);
		cursor: pointer;
		transition: background 160ms ease;
	}
	.switch span {
		display: block;
		width: 15px;
		height: 15px;
		border-radius: 50%;
		background: var(--v-muted);
		transition: transform 160ms ease;
	}
	.switch[aria-checked="true"] {
		background: var(--v-primary);
	}
	.switch[aria-checked="true"] span {
		transform: translateX(14px);
		background: var(--v-primary-fg);
	}
	.switch:disabled {
		cursor: default;
		opacity: 0.5;
	}
	.switch:focus-visible {
		outline: 2px solid var(--v-primary);
		outline-offset: 3px;
	}
	.status {
		font-size: 0.68rem;
	}
	details {
		border-top: 1px solid var(--v-border);
		padding-top: 0.5rem;
	}
	summary {
		cursor: pointer;
		color: var(--v-muted);
		font-size: 0.72rem;
	}
	ul {
		margin: 0.5rem 0 0;
		padding-left: 1rem;
		color: var(--v-muted);
		font-size: 0.72rem;
		line-height: 1.5;
	}
	li + li {
		margin-top: 0.4rem;
	}
	.error-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	@media (prefers-reduced-motion: reduce) {
		.switch,
		.switch span {
			transition: none;
		}
	}
</style>
