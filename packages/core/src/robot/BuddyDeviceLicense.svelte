<script lang="ts">
	import { Button } from "../components/index";
	import { licenseSummary, type FamBuddyLicense } from "./license";

	let {
		license,
		familyLicense,
		busy,
		oninstall,
	}: {
		/** What this FamBuddy reports; undefined until it reports one. */
		license?: FamBuddyLicense;
		/** The family's license on the family server, when known. */
		familyLicense?: FamBuddyLicense;
		busy: boolean;
		/** Installs the pasted key on this FamBuddy. Rejects when it was not installed. */
		oninstall: (token: string) => Promise<unknown>;
	} = $props();
	const id = $props.id();
	let open = $state(false);
	/** Held only while typed; this app never keeps the license key. */
	let key = $state("");
	let sending = $state(false);
	let problem = $state("");
	const offer = $derived(familyLicense?.state === "valid" && license?.state === "none");

	async function install(event: SubmitEvent) {
		event.preventDefault();
		sending = true;
		problem = "";
		try {
			await oninstall(key.trim());
			key = "";
			open = false;
		} catch (cause) {
			problem = cause instanceof Error ? cause.message : "The license was not installed.";
		} finally {
			sending = false;
		}
	}
</script>

<div class="device-license">
	<h4>FamBuddy license</h4>
	<p class="license-line" role="status">
		{licenseSummary(license)}{license?.edition ? ` · ${license.edition} edition` : ""}
	</p>
	{#if offer}
		<p>Your family has a license that this FamBuddy does not have yet.</p>
		{#if open}
			<form class="license-form" onsubmit={install} autocomplete="off">
				<label for="{id}-key">License key</label>
				<input
					id="{id}-key"
					type="password"
					autocomplete="off"
					spellcheck="false"
					bind:value={key}
				/>
				<p>This app does not keep your key; paste it again from Swavan.</p>
				{#if problem}<p class="license-problem" role="alert">{problem}</p>{/if}
				<div class="license-actions">
					<Button type="submit" disabled={busy || sending || !key.trim()}>Install</Button>
					<Button
						variant="ghost"
						onclick={() => {
							open = false;
							key = "";
							problem = "";
						}}>Cancel</Button
					>
				</div>
			</form>
		{:else}
			<div class="license-actions">
				<Button variant="ghost" disabled={busy} onclick={() => (open = true)}
					>Install on this FamBuddy</Button
				>
			</div>
		{/if}
	{/if}
</div>

<style>
	.device-license,
	.license-form {
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
	.license-line {
		color: var(--v-fg);
		font-weight: 600;
	}
	label {
		font-size: 0.8125rem;
		font-weight: 600;
	}
	input {
		min-width: 0;
		padding: calc(var(--v-space) * 1.1) calc(var(--v-space) * 1.5);
		border: 1px solid var(--v-border);
		border-radius: 12px;
		background: var(--v-surface);
		color: var(--v-fg);
		font: inherit;
	}
	.license-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--v-space);
	}
</style>
