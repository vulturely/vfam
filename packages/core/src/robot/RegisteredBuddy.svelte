<script lang="ts">
	import { onMount } from "svelte";
	import { Button, Card, ErrorToast, Input } from "../components/index";
	import { famBuddyRecords } from "../api/fambuddy/fambuddyStorage";
	import BuddyControls from "./BuddyControls.svelte";
	import type { BuddyService } from "./buddy";
	import { enrollRegistered, type SavedRegisteredPair } from "./onboarding/enroll";
	import { revoke, type RegisteredFamBuddy } from "./onboarding/registry";
	import { createRemoteBuddy } from "./remote/service";
	import { relayOrigin, type ParentAuth } from "./remote/client";

	let {
		owner,
		server,
		auth,
		registration,
		onrevoked,
	}: {
		owner: string;
		server: string;
		auth: ParentAuth;
		registration: RegisteredFamBuddy;
		onrevoked: () => void;
	} = $props();
	let saved = $state<SavedRegisteredPair>();
	let service = $state<BuddyService>();
	let code = $state("");
	let restoring = $state(true);
	let pairing = $state(false);
	let revoking = $state(false);
	let revoked = $state(false);
	let error = $state("");
	let alive = false;
	let generation = 0;
	let lifetime: globalThis.AbortController;
	let attempt: globalThis.AbortController | undefined;
	let enrollment: Promise<SavedRegisteredPair> | undefined;
	const records = $derived(famBuddyRecords(server, owner));
	const key = $derived(`registered:${registration.id}`);
	function connect(value: SavedRegisteredPair) {
		if (
			value.registration !== registration.id ||
			value.pair?.origin !== relayOrigin(server) ||
			value.pair?.own?.accountId !== value.pair?.account ||
			value.pair?.account !== `fambuddy-parent:${owner}:${value.pair?.binding?.channel}` ||
			!value.pair?.binding?.family ||
			!value.pair?.binding?.device ||
			!/^vrp_[0-9a-f]{64}$/.test(value.token)
		)
			throw new Error("Saved pairing is invalid. Revoke this device entry and pair it again.");
		saved = value;
		service = createRemoteBuddy(value.pair, auth, () => value.token, registration.id);
	}
	async function restore() {
		const context = { owner, server, id: registration.id };
		try {
			const value = await records.get<SavedRegisteredPair>(key);
			if (
				!alive ||
				owner !== context.owner ||
				server !== context.server ||
				registration.id !== context.id
			)
				return;
			if (value !== null) connect(value);
		} catch {
			if (alive)
				error =
					"Saved pairing could not be unlocked. Revoke this device entry before pairing again.";
		} finally {
			if (alive) restoring = false;
		}
	}
	async function pair() {
		if (!alive || pairing || restoring || revoking || revoked || !code.trim()) return;
		const operation = ++generation;
		attempt = new globalThis.AbortController();
		pairing = true;
		error = "";
		const pending = enrollRegistered({
			server,
			auth,
			owner,
			registration: registration.id,
			code: code.trim(),
			signal: attempt.signal,
		});
		enrollment = pending;
		try {
			const result = await pending;
			if (alive && operation === generation) connect(result);
		} catch (cause) {
			if (alive && operation === generation)
				error = cause instanceof Error ? cause.message : "FamBuddy pairing could not be completed.";
		} finally {
			if (enrollment === pending) enrollment = undefined;
			code = "";
			if (alive && operation === generation) {
				pairing = false;
				attempt = undefined;
			}
		}
	}
	async function revokeAccess() {
		if (!alive || restoring || revoking) return;
		++generation;
		attempt?.abort();
		const pending = enrollment;
		const store = records;
		const recordKey = key;
		const id = registration.id;
		revoking = true;
		error = "";
		try {
			await revoke({ server, auth, signal: lifetime.signal }, id);
			if (alive) {
				revoked = true;
				service = undefined;
				saved = undefined;
			}
			// Wait for an aborted enrollment's conditional cleanup before removing local state.
			await pending?.catch(() => {});
			const current = await store.get<SavedRegisteredPair>(recordKey);
			if (current !== null) {
				if (typeof current.pair?.binding?.channel !== "string")
					throw new Error("Device access was revoked, but the saved pairing could not be removed.");
				await store.deleteIf(recordKey, "channel", current.pair.binding.channel);
			}
			if (alive) onrevoked();
		} catch (cause) {
			if (alive && !lifetime.signal.aborted)
				error = cause instanceof Error ? cause.message : "Unable to confirm device revocation.";
		} finally {
			code = "";
			if (alive) {
				revoking = false;
				pairing = false;
				attempt = undefined;
			}
		}
	}
	onMount(() => {
		alive = true;
		lifetime = new globalThis.AbortController();
		void restore();
		return () => {
			alive = false;
			generation++;
			lifetime.abort();
			attempt?.abort();
			code = "";
			saved = undefined;
			service = undefined;
		};
	});
</script>

<Card>
	<section class="registered-buddy" aria-label={`FamBuddy ${registration.name}`}>
		<header>
			<div>
				<h3>{registration.name}</h3>
				<p>
					{revoked
						? "Access revoked"
						: saved
							? "Paired on this app"
							: "Registered · not paired on this app"}
				</p>
			</div>
			<Button variant="danger" disabled={restoring || revoking} onclick={() => void revokeAccess()}
				>{revoking ? "Revoking…" : "Revoke FamBuddy access"}</Button
			>
		</header>
		<p class="help">Revoking removes this registration and its relay access for all paired apps.</p>
		{#if restoring}<p role="status">Checking saved pairing…</p>
		{:else if service && saved}
			<p>Encrypted relay selected. Device connection status appears in the controls below.</p>
			{#key service}<BuddyControls
					{service}
					familyId={saved.pair.binding.family}
					{server}
					{auth}
				/>{/key}
		{:else if !revoked}
			<form
				onsubmit={(event) => {
					event.preventDefault();
					void pair();
				}}
			>
				<p>
					Generate a one-use setup code on the muted FamBuddy device, then paste it here. You can
					also paste the text from its setup QR code.
				</p>
				<details>
					<summary>Generate a code on the Pi</summary><code
						>sudo /opt/fambuddy/bin/fambuddy-admin pair-relay</code
					>
				</details>
				<fieldset disabled={pairing || revoking}>
					<Input
						label="One-use setup code"
						type="password"
						bind:value={code}
						placeholder="Paste device setup code"
					/>
					<Button type="submit" disabled={!code.trim()}
						>{pairing ? "Pairing through encrypted relay…" : "Pair FamBuddy"}</Button
					>
				</fieldset>
				{#if pairing}<Button variant="ghost" onclick={() => attempt?.abort()}>Cancel pairing</Button
					>{/if}
			</form>
		{/if}
		<ErrorToast message={error} />
	</section>
</Card>

<style>
	.registered-buddy,
	form,
	fieldset {
		display: grid;
		gap: calc(var(--v-space) * 2);
		min-width: 0;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--v-space);
		flex-wrap: wrap;
	}
	h3,
	p {
		margin: 0;
	}
	h3 {
		font-size: 1rem;
	}
	p,
	details {
		color: var(--v-muted);
		font-size: 0.875rem;
		line-height: 1.6;
		overflow-wrap: anywhere;
	}
	header p {
		margin-top: calc(var(--v-space) / 2);
	}
	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
	}
	fieldset :global(button) {
		justify-self: start;
	}
	summary {
		cursor: pointer;
	}
	code {
		display: block;
		margin-top: var(--v-space);
		overflow-wrap: anywhere;
		color: var(--v-fg);
	}
	.help {
		font-size: 0.8125rem;
	}
</style>
