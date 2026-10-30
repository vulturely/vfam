<script lang="ts">
	import { onDestroy } from "svelte";
	import { Button, ErrorToast } from "../components/index";
	import type { BuddyService } from "./buddy";
	import type { FamilyAiService } from "../family-ai/service";
	import { setFamBuddyAi, type FamBuddyAiMode } from "./family-answer";

	let {
		service,
		device,
		familyAi,
		local,
	}: {
		service: BuddyService;
		device: string;
		familyAi: FamilyAiService;
		/** Present only on a direct home-network connection to the device. */
		local?: { gateway: string; token: string };
	} = $props();

	let mode = $state<FamBuddyAiMode>("parent_device");
	let busy = $state(false);
	let error = $state("");
	let status = $state("");
	let alive = true;
	onDestroy(() => {
		alive = false;
	});

	async function save() {
		if (busy) return;
		busy = true;
		error = "";
		status = "";
		try {
			await setFamBuddyAi(mode, { service, device, familyAi, local });
			if (alive)
				status =
					mode === "device_key"
						? "This FamBuddy now uses its own copy of the family AI key. Pending questions were cancelled; new questions still need your approval."
						: "This FamBuddy now gets answers from your devices. Pending questions were cancelled; new questions still need your approval.";
		} catch (cause) {
			if (alive) error = cause instanceof Error ? cause.message : "Unable to save AI settings.";
		} finally {
			if (alive) busy = false;
		}
	}
</script>

<details class="family-provider">
	<summary>AI answers</summary>
	<p>You approve every question before it is answered and every answer before FamBuddy speaks.</p>
	<fieldset disabled={busy}>
		<legend>Where answers come from</legend>
		<label
			><input type="radio" name="fambuddy-ai-{device}" value="parent_device" bind:group={mode} />
			<span
				><strong>Answer from my devices</strong> Your family AI key stays on your devices. This device
				answers each question you approve.</span
			></label
		>
		<label
			><input
				type="radio"
				name="fambuddy-ai-{device}"
				value="device_key"
				bind:group={mode}
				disabled={!local}
			/>
			<span
				><strong>Store the key on this FamBuddy</strong> FamBuddy calls your provider itself after
				you approve. Someone with the device could extract the key, so set a spending limit with
				your provider.{#if !local}
					Available when connected on your home network.{/if}</span
			></label
		>
	</fieldset>
	<Button type="button" disabled={busy} onclick={() => void save()}>Save AI setting</Button>
	{#if status}<p role="status">{status}</p>{/if}
	<ErrorToast message={error} />
</details>

<style>
	.family-provider {
		overflow-wrap: anywhere;
	}
	fieldset {
		display: grid;
		gap: var(--v-space);
		margin: var(--v-space) 0;
		padding: 0;
		border: 0;
	}
	legend {
		font-weight: 600;
		margin-bottom: var(--v-space);
	}
	label {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--v-space);
		align-items: start;
	}
	label span {
		display: grid;
		gap: 2px;
	}
	input[type="radio"] {
		margin-top: 0.25rem;
		min-width: 20px;
		min-height: 20px;
	}
</style>
