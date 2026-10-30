<script lang="ts">
	import { onMount } from "svelte";
	import { famBuddyRecords } from "../api/fambuddy/fambuddyStorage";
	import { Button, ErrorToast } from "../components/index";
	import type { BuddyService, BuddySettings } from "./buddy";
	import { enrollRemote, revokeRemote } from "./remote/enroll";
	import { createRemoteBuddy } from "./remote/service";
	import type { RemotePair } from "./remote/crypto";
	import type { ParentAuth } from "./remote/client";
	import { gatewayClient } from "./buddy-gateway";
	import { createLocalStateService } from "../services/storage/localState";
	let {
		owner,
		gateway,
		token,
		family,
		server,
		auth,
		localService,
		onchange,
	}: {
		owner: string;
		gateway: string;
		token: string;
		family: string;
		server: string;
		auth: ParentAuth;
		localService: BuddyService;
		onchange: (service: BuddyService) => void;
	} = $props();
	let pair = $state<RemotePair>();
	let internet = $state(false);
	let devices = $state<BuddySettings[]>([]);
	let device = $state("");
	let busy = $state(true);
	let error = $state("");
	const key = $derived(`fambuddy.remote.${owner}.${family}.${gateway}`);
	let alive = true;
	const records = $derived(famBuddyRecords(server, owner));
	const recordKey = $derived(`remote:${family}:${gateway}`);
	async function restore() {
		const currentToken = token;
		try {
			const saved = await records.get<{
				pair: RemotePair;
				internet: boolean;
				token: string;
			}>(recordKey);
			if (
				!alive ||
				currentToken !== token ||
				saved?.token !== token ||
				saved.pair.binding.family !== family
			)
				return;
			pair = saved.pair;
			internet = saved.internet;
			connect();
		} catch {
			if (alive)
				error =
					"Encrypted remote pairing could not be unlocked. Set it up again on your home network.";
		} finally {
			if (alive) busy = false;
		}
	}
	async function toggle() {
		if (busy || !pair) return;
		busy = true;
		try {
			await records.updateIf(recordKey, pair.binding.channel, {
				pair: $state.snapshot(pair),
				internet: !internet,
				token,
			});
			if (!alive) return;
			internet = !internet;
			connect();
		} catch {
			if (alive) error = "Unable to save the encrypted connection setting.";
		} finally {
			if (alive) busy = false;
		}
	}
	function connect() {
		if (!alive) return;
		onchange(internet && pair ? createRemoteBuddy(pair, auth, () => token) : localService);
	}
	onMount(() => {
		createLocalStateService().discardLegacy(key);
		void restore();
		return () => {
			alive = false;
			pair = undefined;
			devices = [];
			device = "";
			internet = false;
		};
	});
	async function prepare() {
		if (busy || !alive) return;
		busy = true;
		error = "";
		try {
			const response = await localService.command({ action: "list", family });
			if (!alive) return;
			devices = response.settings;
			device = devices[0]?.device ?? "";
		} catch {
			if (alive) error = "Connect to FamBuddy on your home network to enable remote approvals.";
		} finally {
			if (alive) busy = false;
		}
	}
	async function enable() {
		if (busy || !alive) return;
		const setup = { gateway, token, family, device, owner, server, auth };
		busy = true;
		error = "";
		try {
			const enrolled = await enrollRemote(setup);
			if (!alive || setup.token !== token || setup.owner !== owner) {
				await Promise.allSettled([
					revokeRemote(enrolled, setup.auth),
					gatewayClient(setup.gateway).disableRemote(
						{ channel: enrolled.binding.channel },
						{
							headers: { authorization: `Bearer ${setup.token}` },
							timeoutMs: 2000,
						},
					),
				]);
				return;
			}
			try {
				await records.put(recordKey, {
					pair: enrolled,
					internet: false,
					token: setup.token,
				});
			} catch (cause) {
				await revokeRemote(enrolled, setup.auth).catch(() => {});
				throw cause;
			}
			if (alive && setup.token === token && setup.owner === owner) pair = enrolled;
		} catch (cause) {
			if (alive) error = cause instanceof Error ? cause.message : "Remote setup failed.";
		} finally {
			if (alive) busy = false;
		}
	}
	async function disable() {
		if (!pair || busy || !alive) return;
		const currentPair = pair;
		const currentGateway = gateway;
		const currentToken = token;
		const store = records;
		const savedKey = recordKey;
		busy = true;
		error = "";
		try {
			await revokeRemote(currentPair, auth);
			await (
				gatewayClient(currentGateway).disableRemote(
					{ channel: currentPair.binding.channel },
					{
						headers: { authorization: `Bearer ${currentToken}` },
						timeoutMs: 2000,
					},
				) as Promise<unknown>
			).catch(() => {}); // Relay revocation already prevents delivery while away.
			await store.deleteIf(savedKey, "channel", currentPair.binding.channel);
			if (!alive) return;
			pair = undefined;
			internet = false;
			connect();
		} catch {
			if (alive) error = "Unable to confirm relay revocation. Remote access remains configured.";
		} finally {
			if (alive) busy = false;
		}
	}
</script>

<details class="remote">
	<summary>Outside-home approvals</summary>
	<p>
		Recording stays on your device. Only your paired endpoints can read questions, answers and
		approval commands. Your existing pairing expiry still applies. Pairing keys are saved in
		encrypted storage on this app or browser.
	</p>
	{#if pair}
		<p>
			Encrypted remote access enabled for device {pair.binding.device.slice(0, 8)}.
		</p>
		<Button disabled={busy} onclick={() => void toggle()}>
			{internet ? "Use home-network connection" : "Use encrypted internet connection"}
		</Button>
		<Button disabled={busy} variant="ghost" onclick={() => void disable()}
			>Disable remote access</Button
		>
	{:else if devices.length}
		<label
			>Device
			<select bind:value={device} disabled={busy}>
				{#each devices as item (item.device)}<option value={item.device}
						>{item.device.slice(0, 8)} — {item.wake_word}</option
					>{/each}
			</select>
		</label>
		<Button disabled={busy || !device} onclick={() => void enable()}
			>Enable encrypted remote approvals</Button
		>
	{:else}
		<Button disabled={busy} onclick={() => void prepare()}>Set up remote approvals</Button>
	{/if}
	{#if internet}<p role="status">
			Using the encrypted internet connection. Live talk requires the home-network connection.
		</p>{/if}
	<ErrorToast message={error} />
</details>

<style>
	.remote {
		padding: 1rem;
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius);
	}
	summary {
		cursor: pointer;
		font-weight: 600;
	}
	p {
		color: var(--v-muted);
		line-height: 1.5;
	}
	label {
		display: grid;
		gap: 0.5rem;
		margin-block: 1rem;
	}
	select {
		font: inherit;
		padding: 0.5rem;
		color: var(--v-fg);
		background: var(--v-bg);
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius-sm);
	}
</style>
