<script lang="ts">
	import { getContext, onMount } from "svelte";
	import { Dialog } from "bits-ui";
	import Bot from "lucide-svelte/icons/bot";
	import Link from "lucide-svelte/icons/link";
	import LoaderCircle from "lucide-svelte/icons/loader-circle";
	import MessageCircle from "lucide-svelte/icons/message-circle";
	import Settings from "lucide-svelte/icons/settings";
	import X from "lucide-svelte/icons/x";
	import type { Runtime } from "../runtime/registry.svelte";
	import type { ParentAuth } from "./remote/client";
	import { Button, ErrorToast, IconButton, Input } from "../components/index";
	import BuddySettingsModal from "./BuddySettingsModal.svelte";
	import { createFamBuddyDirectory, deviceOf, type FamBuddySession } from "./directory.svelte";
	import { licenseSummary } from "./license";

	let {
		owner,
		server,
		auth,
		registrationOpen = $bindable(false),
	}: {
		owner?: string;
		server?: string;
		auth?: ParentAuth;
		registrationOpen?: boolean;
	} = $props();
	const runtime = getContext<Runtime>("vulture:runtime");
	const directory = $derived(
		owner && server && auth
			? createFamBuddyDirectory(server, auth, () => owner)
			: runtime.services.fambuddy,
	);
	let name = $state("");
	let creating = $state(false);
	let error = $state("");
	let pairOpen = $state(false);
	let pairingId = $state("");
	let pairCode = $state("");
	let pairing = $state(false);
	let settingsOpen = $state(false);
	let settingsId = $state("");
	const activeSettings = $derived(settingsId ? directory.session(settingsId) : undefined);
	/** Only FamBuddies registered with the family server; the home one has its own section. */
	const registered = $derived(directory.sessions.filter((session) => !session.home));

	/** "License: Active until …" once the paired FamBuddy has reported one. */
	function licenseLine(session: FamBuddySession) {
		const license = session.output.settings.find(
			(item) => item.device === deviceOf(session),
		)?.license;
		return license && license.state !== "unknown" ? ` · License: ${licenseSummary(license)}` : "";
	}

	export async function refreshDevices() {
		await directory.refresh();
	}

	async function create() {
		const value = name.trim();
		if (creating || directory.loading) return;
		if (!value || new TextEncoder().encode(value).length > 80) {
			error = value ? "Choose a shorter FamBuddy name." : "Enter a name for your FamBuddy.";
			return;
		}
		creating = true;
		error = "";
		try {
			await directory.register(value);
			name = "";
			registrationOpen = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Unable to register FamBuddy.";
		} finally {
			creating = false;
		}
	}

	async function pair() {
		if (pairing || !pairCode.trim()) return;
		pairing = true;
		error = "";
		try {
			await directory.pair(pairingId, pairCode.trim());
			pairCode = "";
			pairOpen = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "FamBuddy pairing could not be completed.";
		} finally {
			pairing = false;
		}
	}

	onMount(() => void directory.refresh());
</script>

<section class="registered-buddies" aria-label="Registered FamBuddy devices">
	<ErrorToast message={error || directory.error} />
	{#if directory.loading}<div
			class="registered-loading"
			role="status"
			aria-label="Loading registered devices"
		>
			<LoaderCircle size={32} aria-hidden="true" />
		</div>
	{:else if !directory.available}
		<div class="empty-buddies">
			<Bot size={32} strokeWidth={1.4} aria-hidden="true" />
			<p>
				Away-from-home access needs your family server on HTTPS (port 443). This app is connected to {server ??
					runtime.config.serverUrl}, so it is off here.
			</p>
		</div>
	{:else if !registered.length}
		<div class="empty-buddies">
			<Bot size={32} strokeWidth={1.4} aria-hidden="true" />
			<p>None yet. Use Add (+) to register a FamBuddy with your family server.</p>
		</div>
	{:else}
		<div class="buddy-cards">
			{#each registered as session (session.registration.id)}
				<article class="buddy-card">
					<div class="buddy-card-icon" aria-hidden="true"><Bot size={24} /></div>
					<div class="buddy-card-copy">
						<h2>{session.registration.name}</h2>
						<p>
							{session.service
								? `Paired on this app${licenseLine(session)}`
								: "Registered · not paired"}
						</p>
					</div>
					<div class="buddy-card-actions">
						{#if session.service}
							<IconButton
								icon={MessageCircle}
								label={`Chat with ${session.registration.name}`}
								onclick={() => runtime.router.navigate("chat", { buddy: session.registration.id })}
							/>
							<IconButton
								icon={Settings}
								label={`Settings for ${session.registration.name}`}
								onclick={() => {
									settingsId = session.registration.id;
									settingsOpen = true;
								}}
							/>
						{:else}
							<IconButton
								icon={Link}
								label={`Pair ${session.registration.name}`}
								onclick={() => {
									pairingId = session.registration.id;
									pairOpen = true;
								}}
							/>
						{/if}
					</div>
				</article>
			{/each}
		</div>
	{/if}
</section>

<Dialog.Root bind:open={registrationOpen}>
	<Dialog.Portal>
		<Dialog.Overlay class="fambuddy-registration-overlay" />
		<Dialog.Content class="fambuddy-registration-dialog">
			<Dialog.Close class="registration-close" aria-label="Close FamBuddy registration">
				<X aria-hidden="true" size={18} />
			</Dialog.Close>
			<form
				onsubmit={(event) => {
					event.preventDefault();
					void create();
				}}
			>
				<div class="registration-copy">
					<span class="registration-icon" aria-hidden="true"><Bot size={25} /></span>
					<Dialog.Title>Create New FamBuddy</Dialog.Title>
				</div>
				<fieldset disabled={directory.loading || creating}>
					<Input bind:value={name} placeholder="FamBuddy name" />
					<Dialog.Description class="registration-hint">
						Register your device, then pair it with its one-use setup code. Your app and FamBuddy
						communicate through the encrypted relay.
					</Dialog.Description>
					<Button type="submit" disabled={!name.trim()}
						>{creating ? "Registering…" : "Register FamBuddy"}</Button
					>
				</fieldset>
			</form>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<Dialog.Root bind:open={pairOpen}>
	<Dialog.Portal>
		<Dialog.Overlay class="fambuddy-registration-overlay" />
		<Dialog.Content class="fambuddy-registration-dialog">
			<Dialog.Close class="registration-close" aria-label="Close FamBuddy pairing">
				<X aria-hidden="true" size={18} />
			</Dialog.Close>
			<form
				onsubmit={(event) => {
					event.preventDefault();
					void pair();
				}}
			>
				<div class="registration-copy">
					<span class="registration-icon" aria-hidden="true"><Link size={25} /></span>
					<Dialog.Title>Pair FamBuddy</Dialog.Title>
				</div>
				<fieldset disabled={pairing}>
					<Input type="password" bind:value={pairCode} placeholder="One-use setup code" />
					<Dialog.Description class="registration-hint">
						Generate a one-use setup code on the FamBuddy device, then paste it here. Pairing uses
						the encrypted relay.
					</Dialog.Description>
					<Button type="submit" disabled={!pairCode.trim()}
						>{pairing ? "Pairing…" : "Pair FamBuddy"}</Button
					>
				</fieldset>
			</form>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

{#if activeSettings}
	<BuddySettingsModal session={activeSettings} bind:open={settingsOpen} />
{/if}

<style>
	.registered-buddies,
	form,
	fieldset {
		display: grid;
		gap: calc(var(--v-space) * 2);
		min-width: 0;
	}
	.registered-buddies {
		position: relative;
	}
	.buddy-cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(260px, 100%), 1fr));
		gap: calc(var(--v-space) * 1.5);
		align-content: start;
	}
	.buddy-card {
		display: flex;
		align-items: center;
		gap: calc(var(--v-space) * 1.25);
		min-width: 0;
		padding: calc(var(--v-space) * 2);
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius);
		background: var(--v-surface);
		box-shadow: var(--v-shadow);
	}
	.buddy-card-icon,
	.registration-icon {
		display: grid;
		place-items: center;
		flex: 0 0 auto;
		border-radius: 16px;
		background: color-mix(in srgb, var(--v-primary) 13%, transparent);
		color: var(--v-primary-text, var(--v-primary));
	}
	.buddy-card-icon {
		width: 46px;
		height: 46px;
	}
	.buddy-card-copy {
		flex: 1;
		min-width: 0;
	}
	.buddy-card-copy h2,
	.buddy-card-copy p,
	.empty-buddies p {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.buddy-card-copy h2 {
		font-size: 1rem;
	}
	.buddy-card-copy p,
	.empty-buddies p {
		color: var(--v-muted);
		font-size: 0.8rem;
		line-height: 1.5;
	}
	.buddy-card-actions {
		display: flex;
		flex: 0 0 auto;
	}
	.empty-buddies {
		display: flex;
		align-items: center;
		gap: calc(var(--v-space) * 1.5);
		padding: calc(var(--v-space) * 1.5) calc(var(--v-space) * 2);
		border: 1px dashed var(--v-border);
		border-radius: 14px;
		color: var(--v-muted);
	}
	.registered-loading {
		position: absolute;
		inset: 0;
		z-index: 10;
		display: grid;
		min-height: 160px;
		place-items: center;
		border-radius: inherit;
		background: color-mix(in srgb, var(--v-surface) 78%, transparent);
		backdrop-filter: blur(4px);
	}
	.registered-loading :global(svg) {
		color: var(--v-primary);
		animation: registered-loading-spin 900ms linear infinite;
	}
	@keyframes registered-loading-spin {
		to {
			transform: rotate(360deg);
		}
	}
	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
		grid-template-columns: minmax(0, 1fr);
		gap: calc(var(--v-space) * 1.5);
	}
	fieldset :global(.v-btn) {
		width: 100%;
		min-height: 44px;
	}
	.registration-copy {
		display: grid;
		justify-items: center;
		gap: calc(var(--v-space) * 0.75);
		text-align: center;
	}
	.registration-icon {
		width: 50px;
		height: 50px;
		margin-bottom: calc(var(--v-space) * 0.5);
	}
	:global(.fambuddy-registration-dialog h2) {
		font-size: 1.65rem;
		font-weight: 700;
		letter-spacing: -0.02em;
	}
	:global(.fambuddy-registration-dialog p) {
		max-width: 34ch;
		margin: 0;
		color: var(--v-muted);
		font-size: 0.875rem;
		line-height: 1.55;
		overflow-wrap: anywhere;
	}
	:global(.fambuddy-registration-dialog .registration-hint) {
		max-width: none;
		color: color-mix(in srgb, var(--v-muted) 65%, transparent);
		font-size: 0.75rem;
		line-height: 1.45;
		text-align: left;
	}
	:global(.registration-close) {
		position: absolute;
		top: 12px;
		right: 12px;
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		padding: 0;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: var(--v-muted);
		cursor: pointer;
	}
	:global(.registration-close:hover) {
		background: color-mix(in srgb, var(--v-fg) 8%, transparent);
		color: var(--v-fg);
	}
	:global(.registration-close:focus-visible) {
		outline: 2px solid var(--v-ring);
		outline-offset: 2px;
	}
	:global(.fambuddy-registration-overlay) {
		position: fixed;
		inset: 0;
		z-index: 100;
		background: rgba(8, 13, 24, 0.48);
		backdrop-filter: blur(8px);
	}
	:global(.fambuddy-registration-dialog) {
		position: fixed;
		top: 50%;
		left: 50%;
		z-index: 101;
		width: min(400px, calc(100vw - 32px));
		max-height: calc(100dvh - 32px);
		overflow-y: auto;
		transform: translate(-50%, -50%);
		padding: 28px;
		border: 1px solid color-mix(in srgb, var(--v-fg) 10%, transparent);
		border-radius: 22px;
		background: color-mix(in srgb, var(--v-surface) 88%, transparent);
		backdrop-filter: blur(28px) saturate(150%);
		-webkit-backdrop-filter: blur(28px) saturate(150%);
		box-shadow: 0 24px 80px rgba(0, 0, 0, 0.28);
	}
</style>
