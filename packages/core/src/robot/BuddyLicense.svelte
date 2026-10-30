<script lang="ts">
	import { onMount } from "svelte";
	import KeyRound from "lucide-svelte/icons/key-round";
	import { Button, ErrorToast } from "../components/index";
	import type { FamBuddyLicenseService } from "./license.svelte";
	import { LICENSE_FEATURES, allows, licenseSummary } from "./license";

	let { service }: { service: FamBuddyLicenseService } = $props();
	const id = $props.id();
	/** Held only while typed; cleared once installed and never saved. */
	let key = $state("");
	const license = $derived(service.license);
	const installed = $derived(license?.state === "valid" || license?.state === "expired");

	onMount(() => {
		void service.load();
		return () => {
			key = "";
		};
	});

	async function install(event: SubmitEvent) {
		event.preventDefault();
		if (await service.install(key)) key = "";
	}
</script>

<section class="buddy-license" aria-labelledby="{id}-title">
	<div class="license-heading">
		<KeyRound size={18} aria-hidden="true" />
		<div>
			<h2 id="{id}-title">FamBuddy license</h2>
			<p>
				Core features are free. A license from Swavan unlocks the paid features below for your
				family and every paired FamBuddy.
			</p>
		</div>
	</div>
	<ErrorToast message={service.error} />
	{#if !service.available}
		<p>FamBuddy licenses need your family server on HTTPS (port 443).</p>
	{:else}
		<div class="license-status" role="status" aria-label="Family license">
			{#if service.loading && !license}
				Checking your license…
			{:else}
				<strong>{licenseSummary(license)}</strong>
				{#if license?.edition}<span>{license.edition} edition</span>{/if}
			{/if}
		</div>
		<ul class="license-features" aria-label="Paid features">
			{#each LICENSE_FEATURES as feature (feature.id)}
				<li>
					<span>{feature.label}</span>
					<span class="feature-state" class:on={allows(license, feature.id)}
						>{allows(license, feature.id) ? "On" : "Off"}</span
					>
				</li>
			{/each}
		</ul>
		<form class="license-form" onsubmit={install} autocomplete="off">
			<label for="{id}-key">License key</label>
			<input
				id="{id}-key"
				type="password"
				autocomplete="off"
				spellcheck="false"
				placeholder="Paste your license key from Swavan"
				bind:value={key}
			/>
			<div class="license-actions">
				<Button type="submit" disabled={service.busy || !key.trim()}
					>{service.busy ? "Saving…" : "Install"}</Button
				>
				{#if installed}
					<Button variant="ghost" disabled={service.busy} onclick={() => void service.remove()}
						>Remove license</Button
					>
				{/if}
			</div>
		</form>
		{#if service.notice}<p class="license-notice" role="status">{service.notice}</p>{/if}
		{#if service.failures.length}
			<div class="license-failures" role="alert">
				<p>Some FamBuddies were not updated. They keep working; try again when they are online.</p>
				<ul>
					{#each service.failures as failure (failure.id)}
						<li><strong>{failure.name}</strong>: {failure.message}</li>
					{/each}
				</ul>
			</div>
		{/if}
	{/if}
</section>

<style>
	.buddy-license {
		display: grid;
		gap: calc(var(--v-space) * 1.5);
		min-width: 0;
		padding-bottom: calc(var(--v-space) * 3);
		border-bottom: 1px solid var(--v-border);
	}
	.license-heading {
		display: flex;
		align-items: flex-start;
		gap: var(--v-space);
	}
	h2,
	p {
		margin: 0;
	}
	h2 {
		font-size: 1rem;
		font-weight: 600;
	}
	p {
		max-width: 65ch;
		color: var(--v-muted);
		font-size: 0.8125rem;
		line-height: 1.6;
	}
	.license-heading p {
		margin-top: calc(var(--v-space) / 2);
	}
	.license-status {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--v-space);
		font-size: 0.875rem;
	}
	.license-status span {
		color: var(--v-muted);
		font-size: 0.8125rem;
	}
	.license-features {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr));
		gap: calc(var(--v-space) / 2) calc(var(--v-space) * 2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.license-features li {
		display: flex;
		justify-content: space-between;
		gap: var(--v-space);
		padding: calc(var(--v-space) * 0.75) 0;
		border-bottom: 1px solid var(--v-border);
		font-size: 0.8125rem;
	}
	.feature-state {
		color: var(--v-muted);
		font-weight: 600;
	}
	.feature-state.on {
		color: var(--v-primary-text, var(--v-primary));
	}
	.license-form {
		display: grid;
		gap: calc(var(--v-space) / 2);
		max-width: 480px;
	}
	.license-form label {
		font-size: 0.8125rem;
		font-weight: 600;
	}
	.license-form input {
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
		margin-top: var(--v-space);
	}
	.license-notice {
		color: var(--v-fg);
	}
	.license-failures ul {
		margin: calc(var(--v-space) / 2) 0 0;
		padding-left: calc(var(--v-space) * 2);
		font-size: 0.8125rem;
	}
</style>
