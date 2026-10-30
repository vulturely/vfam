<script lang="ts">
	import { Button } from "../components/index";
	import { SCREEN_PIN_MAX, screenPinProblem } from "./screenPin";

	let {
		pinSet,
		busy,
		onsave,
	}: {
		/** Whether the device already has a screen PIN. */
		pinSet: boolean;
		busy: boolean;
		/** Sends the new PIN; an empty PIN removes it. Rejects when it was not saved. */
		onsave: (pin: string) => Promise<unknown>;
	} = $props();
	const id = $props.id();
	let editing = $state(false);
	let pin = $state("");
	let confirmation = $state("");
	let problem = $state("");
	let saving = $state(false);

	function reset() {
		editing = false;
		pin = "";
		confirmation = "";
		problem = "";
	}

	async function send(next: string) {
		saving = true;
		try {
			await onsave(next);
			reset();
		} catch {
			// The caller shows why it failed; keep the form so the parent can retry.
		} finally {
			saving = false;
		}
	}

	function save(event: SubmitEvent) {
		event.preventDefault();
		const reason = screenPinProblem(pin, confirmation);
		problem = reason ?? "";
		if (!reason) void send(pin);
	}
</script>

<div class="screen-pin">
	<h4>Screen PIN</h4>
	<p>Needed on the FamBuddy's own screen before changing its Wi-Fi.</p>
	<p class="pin-status">{pinSet ? "PIN set" : "No PIN"}</p>
	{#if editing}
		<form class="pin-form" onsubmit={save} novalidate>
			<label for="{id}-pin">New PIN</label>
			<input
				id="{id}-pin"
				type="password"
				inputmode="numeric"
				autocomplete="off"
				maxlength={SCREEN_PIN_MAX}
				bind:value={pin}
			/>
			<label for="{id}-confirm">Enter the PIN again</label>
			<input
				id="{id}-confirm"
				type="password"
				inputmode="numeric"
				autocomplete="off"
				maxlength={SCREEN_PIN_MAX}
				bind:value={confirmation}
			/>
			{#if problem}<p class="pin-problem" role="alert">{problem}</p>{/if}
			<div class="pin-actions">
				<Button type="submit" disabled={busy || saving}>Save PIN</Button>
				<Button variant="ghost" onclick={reset}>Cancel</Button>
			</div>
		</form>
	{:else}
		<div class="pin-actions">
			<Button variant="ghost" disabled={busy || saving} onclick={() => (editing = true)}
				>{pinSet ? "Change PIN" : "Set PIN"}</Button
			>
			{#if pinSet}<Button variant="ghost" disabled={busy || saving} onclick={() => void send("")}
					>Remove PIN</Button
				>{/if}
		</div>
	{/if}
</div>

<style>
	.screen-pin,
	.pin-form {
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
	p {
		color: var(--v-muted);
		font-size: 0.8125rem;
		line-height: 1.6;
	}
	.pin-status {
		color: var(--v-fg);
		font-weight: 600;
	}
	.pin-problem {
		color: var(--v-danger);
	}
	label {
		font-size: 0.8125rem;
		font-weight: 600;
	}
	input {
		width: 100%;
		max-width: 16rem;
		min-height: max(var(--v-control-h), 44px);
		border-radius: var(--v-radius-sm);
		border: 1px solid var(--v-border);
		background: var(--v-bg);
		color: var(--v-fg);
		padding: 0 calc(var(--v-space) * 1.5);
		font: inherit;
		letter-spacing: 0.2em;
	}
	input:focus-visible {
		border-color: var(--v-primary);
	}
	.pin-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--v-space);
	}
</style>
