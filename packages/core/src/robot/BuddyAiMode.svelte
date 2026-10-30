<script lang="ts">
	import type { BuddyAiMode, BuddySettings } from "./buddy";
	import { ON_DEVICE_AI, allows } from "./license";

	let {
		settings,
		busy,
		onmode,
	}: {
		settings: BuddySettings;
		busy: boolean;
		/** Saves the family AI mode. Rejects when the change was not saved. */
		onmode: (mode: BuddyAiMode) => Promise<unknown>;
	} = $props();
	const id = $props.id();
	let sending = $state(false);

	const modes: { value: BuddyAiMode; label: string; note: string }[] = [
		{
			value: "local_only",
			label: "Local only",
			note: "Every question is answered on the FamBuddy.",
		},
		{
			value: "local_first",
			label: "Local first, cloud when needed",
			note: "A parent's question goes to the cloud AI when the FamBuddy can't answer it.",
		},
		{
			value: "cloud_only",
			label: "Cloud only",
			note: "A parent's question goes straight to the cloud AI.",
		},
	];

	const available = $derived(settings.local_ai === true);
	const licensed = $derived(allows(settings.license, ON_DEVICE_AI));

	async function choose(mode: BuddyAiMode) {
		if (mode === settings.ai_mode) return;
		sending = true;
		try {
			await onmode(mode);
		} catch {
			// The caller shows why it failed; the choice stays available for a retry.
		} finally {
			sending = false;
		}
	}
</script>

<div class="buddy-ai-mode">
	<h4>Family AI</h4>
	<p>Children's questions never go to a cloud AI unless a parent chooses Ask cloud AI.</p>
	<p class="ai-status" role="status">
		{available
			? "On-device AI: available"
			: "On-device AI: not available (needs a 4 GB+ FamBuddy and a license with On-device AI)"}
	</p>
	{#if !available && licensed}
		<p>Licensed for On-device AI, but this FamBuddy's AI isn't running.</p>
	{/if}
	<fieldset disabled={busy || sending}>
		<legend>Family AI mode</legend>
		{#each modes as mode (mode.value)}
			<label>
				<input
					type="radio"
					name="{id}-ai-mode"
					value={mode.value}
					checked={settings.ai_mode === mode.value}
					onchange={() => void choose(mode.value)}
				/>
				<span><strong>{mode.label}</strong> {mode.note}</span>
			</label>
		{/each}
	</fieldset>
</div>

<style>
	.buddy-ai-mode {
		display: grid;
		min-width: 0;
		gap: var(--v-space);
	}
	h4,
	p {
		margin: 0;
	}
	h4 {
		font-size: 0.875rem;
		font-weight: 600;
	}
	p,
	label span {
		color: var(--v-muted);
		font-size: 0.8125rem;
		line-height: 1.6;
	}
	.ai-status,
	label strong {
		color: var(--v-fg);
		font-weight: 600;
	}
	fieldset {
		display: grid;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		border: 0;
	}
	legend {
		margin-bottom: 0.35rem;
		font-size: 0.8125rem;
		font-weight: 600;
	}
	label {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		cursor: pointer;
	}
	input {
		margin-top: 0.3rem;
		accent-color: var(--v-primary);
	}
	fieldset:disabled label {
		cursor: default;
		opacity: 0.6;
	}
</style>
