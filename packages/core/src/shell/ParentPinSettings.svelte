<script lang="ts">
	import { onMount } from "svelte";
	import KeyRound from "lucide-svelte/icons/key-round";
	import Check from "lucide-svelte/icons/check";
	import ArrowLeft from "lucide-svelte/icons/arrow-left";
	import X from "lucide-svelte/icons/x";
	import { Button, ErrorToast } from "../components/index";
	import { animateDetails } from "../components/animateDetails";
	import type { OidcAuth } from "../auth/oidc";
	let {
		auth,
		onSave,
		onBack,
		initialOpen = false,
		resetting = false,
		onForgot,
	}: {
		auth: OidcAuth;
		onSave?: () => void;
		onBack?: () => void;
		initialOpen?: boolean;
		/** Signed in from "Forgot PIN?": set a new PIN without the old one. */
		resetting?: boolean;
		/** Starts the forgotten-PIN sign-in. */
		onForgot?: () => void;
	} = $props();
	let enabled = $state(false);
	let loading = $state(true);
	let editing = $state(false);
	let current = $state("");
	let pin = $state("");
	let confirmation = $state("");
	const needsCurrent = $derived(enabled && !resetting);
	let busy = $state(false);
	let error = $state("");
	const placeholder = "_\u3000_\u3000_\u3000_\u3000_\u3000_";
	onMount(async () => {
		try {
			enabled = (await auth.getParentPinAccess()).enabled;
		} catch {
			error = "Could not load your parent PIN settings.";
		} finally {
			loading = false;
		}
	});
	function accordion(node: globalThis.HTMLDetailsElement) {
		node.open = initialOpen;
		return animateDetails(node);
	}
	async function save(event: globalThis.SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		error = "";
		if (!/^\d{6}$/.test(pin) || pin !== confirmation) {
			error = "Enter six digits and make sure both PINs match.";
			return;
		}
		if (needsCurrent && !/^\d{6}$/.test(current)) {
			error = "Enter your current parent PIN.";
			return;
		}
		busy = true;
		try {
			enabled = (await auth.setParentPin(pin, needsCurrent ? current : "")).enabled;
			current = "";
			pin = "";
			confirmation = "";
			editing = false;
			onSave?.();
		} catch {
			error = resetting
				? "Could not reset your parent PIN. Sign in again and retry within 10 minutes."
				: needsCurrent
					? "Check your current parent PIN. After five incorrect attempts, wait 15 minutes or use Forgot PIN."
					: "Could not save your parent PIN. Please try again.";
			current = "";
		} finally {
			busy = false;
		}
	}
</script>

<details class="parent-pin" use:accordion>
	<summary
		><span><KeyRound size={15} aria-hidden="true" />Parent PIN</span>{#if enabled}<small>Set</small
			>{/if}</summary
	>
	<div class="body">
		<p>Use your PIN to return from child mode without signing in again.</p>
		{#if loading}<p role="status">Loading…</p>
		{:else if !enabled || editing || resetting}
			<form onsubmit={save}>
				{#if needsCurrent}
					<input
						class="current"
						aria-label="Current parent PIN"
						type="password"
						inputmode="numeric"
						pattern={"[0-9]{6}"}
						minlength="6"
						maxlength="6"
						autocomplete="current-password"
						{placeholder}
						bind:value={current}
						required
						disabled={busy}
					/>
				{/if}
				<div class="pin-fields">
					<input
						aria-label="New parent PIN"
						type="password"
						inputmode="numeric"
						pattern={"[0-9]{6}"}
						minlength="6"
						maxlength="6"
						autocomplete="new-password"
						{placeholder}
						bind:value={pin}
						required
						disabled={busy}
					/>
					<input
						aria-label="Confirm parent PIN"
						type="password"
						inputmode="numeric"
						pattern={"[0-9]{6}"}
						minlength="6"
						maxlength="6"
						autocomplete="new-password"
						{placeholder}
						bind:value={confirmation}
						required
						disabled={busy}
					/>
				</div>
				<div class="hints">
					<small>New PIN</small><small>Confirm PIN</small>
				</div>
				<div class="actions" class:with-back={!!onBack}>
					{#if onBack}<Button variant="ghost" icon={ArrowLeft} disabled={busy} onclick={onBack}
							>Profiles</Button
						>
					{:else if enabled && !resetting}<Button
							variant="ghost"
							icon={X}
							disabled={busy}
							onclick={() => {
								editing = false;
								current = "";
								pin = "";
								confirmation = "";
								error = "";
							}}>Cancel</Button
						>{/if}
					<Button
						type="submit"
						variant="ghost"
						icon={Check}
						disabled={busy || !pin || !confirmation}>{busy ? "Saving…" : "Save PIN"}</Button
					>
				</div>
			</form>
			{#if needsCurrent && onForgot}<Button variant="ghost" disabled={busy} onclick={onForgot}
					>Forgot PIN? Sign in to reset</Button
				>{/if}
		{:else}<Button
				variant="ghost"
				icon={KeyRound}
				onclick={() => {
					editing = true;
				}}>Change PIN</Button
			>{/if}
		<ErrorToast message={error} />
	</div>
</details>

<style>
	.parent-pin {
		margin-top: 1.25rem;
		border: 1px solid var(--v-border);
		border-radius: 12px;
		overflow: hidden;
		text-align: left;
	}
	summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 1rem;
		cursor: pointer;
		list-style: none;
		font-size: 0.85rem;
		color: var(--v-muted);
		background: color-mix(in srgb, var(--v-fg) 4%, transparent);
	}
	summary::-webkit-details-marker {
		display: none;
	}
	summary span {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.body {
		padding: 1rem;
		border-top: 1px solid var(--v-border);
	}
	p {
		margin: 0 0 1rem;
		color: var(--v-muted);
		font-size: 0.8rem;
		line-height: 1.5;
	}
	.pin-fields,
	.hints {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
	}
	.pin-fields,
	input.current {
		border: 1px solid var(--v-border);
		border-radius: 8px;
	}
	input.current {
		margin-bottom: 0.75rem;
	}
	input {
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
		padding: 0.75rem 0.25rem;
		border: 0;
		outline: none;
		background: transparent;
		color: var(--v-fg);
		text-align: center;
		font: inherit;
	}
	input + input {
		border-left: 1px solid var(--v-border);
	}
	input::placeholder {
		color: var(--v-muted);
		opacity: 0.6;
	}
	small {
		font-size: 0.7rem;
		color: var(--v-muted);
	}
	.hints {
		margin-top: 0.25rem;
		text-align: center;
	}
	.actions.with-back {
		justify-content: space-between;
		align-items: center;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}
</style>
