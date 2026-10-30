<script lang="ts">
	import { getContext, onMount } from "svelte";
	import type { Runtime } from "../runtime/registry.svelte";
	import { famBuddyRecords, usesNativeFamBuddyStorage } from "../api/fambuddy/fambuddyStorage";
	import { Dialog } from "bits-ui";
	import { Button, ErrorToast, Input } from "../components/index";
	import X from "lucide-svelte/icons/x";
	import ShieldCheck from "lucide-svelte/icons/shield-check";
	import Wifi from "lucide-svelte/icons/wifi";
	import { buddyCertificate, confirmBuddyCertificate, pairBuddyPhone } from "./buddy-gateway";
	import BuddyRemote from "./BuddyRemote.svelte";
	import { relayOrigin, type ParentAuth } from "./remote/client";
	import BuddyControls from "./BuddyControls.svelte";
	import { createBuddyService, type BuddyService } from "./buddy";
	import type { FamilyAiService } from "../family-ai/service";
	import { createLocalStateService } from "../services/storage/localState";
	let {
		owner = "local",
		server,
		auth,
		familyAi,
		pairingOpen = $bindable(false),
	}: {
		owner?: string;
		server?: string;
		auth?: ParentAuth;
		familyAi?: FamilyAiService;
		/** The pairing sheet, opened from the FamBuddy header. */
		pairingOpen?: boolean;
	} = $props();
	/** Outside-home approvals relay through the family server, which needs HTTPS port 443. */
	const remoteAvailable = $derived.by(() => {
		try {
			return Boolean(server && relayOrigin(server));
		} catch {
			return false;
		}
	});
	// Chat lists the home FamBuddy too; it reloads when this pairing changes.
	const runtime = getContext<Runtime | undefined>("vulture:runtime");
	let gateway = $state("https://fambuddy.local:5443");
	let code = $state("");
	/** The fingerprint read for an address; it applies only while that address is entered. */
	let checked = $state({ address: "", fingerprint: "" });
	const certificate = $derived(checked.address === gateway ? checked.fingerprint : "");
	let family = $state("");
	let token = $state("");
	let service = $state<BuddyService>();
	let localService = $state<BuddyService>();
	let error = $state("");
	let busy = $state(true);
	const storageKey = $derived(`fambuddy.phone.${owner}`);
	let alive = true;
	const nativeStorage = usesNativeFamBuddyStorage();
	const records = $derived(famBuddyRecords(server ?? "local", owner));
	async function restore() {
		const currentOwner = owner;
		try {
			const saved = await records.get<{
				gateway: string;
				token: string;
				family: string;
				expires_at: string;
			}>("pairing");
			if (!alive || owner !== currentOwner || !saved) return;
			if (
				Date.parse(saved.expires_at) <= Date.now() ||
				!Number.isFinite(Date.parse(saved.expires_at))
			) {
				await records.deleteIf("pairing", "token", saved.token);
				return;
			}
			gateway = saved.gateway;
			token = saved.token;
			family = saved.family;
			connect();
		} catch {
			if (alive)
				error = "Saved pairing could not be unlocked. Use your device pairing code to reconnect.";
		} finally {
			if (alive) busy = false;
		}
	}
	function connect() {
		localService = createBuddyService(gateway, {
			getAccessToken: async () => token,
		});
		service = localService;
	}
	onMount(() => {
		createLocalStateService().discardLegacy(storageKey);
		void restore();
		return () => {
			alive = false;
			token = "";
			code = "";
			family = "";
			service = undefined;
			localService = undefined;
		};
	});
	function origin() {
		const address = new URL(gateway);
		if (
			address.protocol !== "https:" ||
			address.username ||
			address.password ||
			address.search ||
			address.hash
		)
			throw new Error("Enter the device’s HTTPS address.");
		return address.origin;
	}
	/** Shows the device's certificate so the parent can compare it before pairing. */
	async function check() {
		if (busy || !alive) return;
		busy = true;
		error = "";
		try {
			const address = gateway;
			const fingerprint = await buddyCertificate(origin());
			if (alive) checked = { address, fingerprint };
		} catch (cause) {
			if (alive) error = cause instanceof Error ? cause.message : "Unable to reach the device.";
		} finally {
			if (alive) busy = false;
		}
	}
	async function pair() {
		if (busy || !alive) return;
		const pairingOwner = owner;
		busy = true;
		error = "";
		try {
			const pairingGateway = origin();
			await confirmBuddyCertificate(pairingGateway, certificate);
			const paired = await pairBuddyPhone(pairingGateway, code);
			code = "";
			if (!alive || pairingOwner !== owner) {
				// A completed request must not leave an unused parent credential active.
				await createBuddyService(pairingGateway, {
					getAccessToken: async () => paired.token,
				})
					.command({ action: "logout" })
					.catch(() => {});
				return;
			}
			const store = records;
			try {
				await store.put("pairing", { ...paired, gateway: pairingGateway });
			} catch (cause) {
				await createBuddyService(pairingGateway, {
					getAccessToken: async () => paired.token,
				})
					.command({ action: "logout" })
					.catch(() => {});
				throw cause;
			}
			// A completed encrypted save remains available on return; do not erase
			// another view's pairing or reactivate this unmounted component.
			if (!alive || owner !== pairingOwner) return;
			gateway = pairingGateway;
			token = paired.token;
			family = paired.family;
			connect();
			checked = { address: "", fingerprint: "" };
			pairingOpen = false;
			void runtime?.services.fambuddy?.refresh();
		} catch (cause) {
			if (alive)
				error = cause instanceof Error ? cause.message : "Unable to connect to the device.";
		} finally {
			code = "";
			if (alive) busy = false;
		}
	}
	async function logout() {
		const store = records;
		const currentToken = token;
		try {
			await service?.command({ action: "logout" });
			await store.deleteIf("pairing", "token", currentToken);
			if (!alive) return;
			token = "";
			family = "";
			service = undefined;
			localService = undefined;
			void runtime?.services.fambuddy?.refresh();
		} catch {
			if (alive)
				error =
					"Device unavailable. Reconnect to revoke this pairing, or revoke it locally on the device.";
		}
	}
</script>

<section class="setup" aria-label="FamBuddy connection">
	{#if service}
		<div class="connection">
			<span
				><ShieldCheck size={18} aria-hidden="true" /> Paired on your home network · {gateway}</span
			>
			<Button variant="ghost" onclick={() => void logout()}>Disconnect</Button>
		</div>
		{#key service}<BuddyControls
				{service}
				familyId={family}
				{server}
				{auth}
				{familyAi}
				local={service === localService ? { gateway, token } : undefined}
			/>{/key}
		{#if server && auth && localService && remoteAvailable}
			{#key token}<BuddyRemote
					{owner}
					{gateway}
					{token}
					{family}
					{server}
					{auth}
					{localService}
					onchange={(next) => {
						if (alive) service = next;
					}}
				/>{/key}
		{/if}
	{:else if !busy}
		<div class="start">
			<Wifi size={28} strokeWidth={1.5} aria-hidden="true" />
			<div>
				<h2>Connect your FamBuddy</h2>
				<p>Pair it on your home network to see its settings and approve its questions.</p>
			</div>
			<Button onclick={() => (pairingOpen = true)}>Pair on home network</Button>
		</div>
	{/if}
	{#if !pairingOpen}<ErrorToast message={error} />{/if}
</section>

<Dialog.Root bind:open={pairingOpen}>
	<Dialog.Portal>
		<Dialog.Overlay class="pairing-overlay" />
		<Dialog.Content class="pairing-dialog">
			<Dialog.Close class="pairing-close" aria-label="Close home-network pairing">
				<X aria-hidden="true" size={18} />
			</Dialog.Close>
			{#if service}
				<Dialog.Title class="pairing-title">Home-network pairing</Dialog.Title>
				<Dialog.Description class="pairing-description">
					<ShieldCheck size={16} aria-hidden="true" /> Paired with {gateway}
				</Dialog.Description>
				<div>
					<Button variant="ghost" onclick={() => void logout()}>Disconnect this pairing</Button>
				</div>
			{:else}
				<Dialog.Title class="pairing-title">Connect a FamBuddy</Dialog.Title>
				<Dialog.Description class="pairing-description">
					Pair a device on your home network with the code it shows.
				</Dialog.Description>
				<form
					onsubmit={(event) => {
						event.preventDefault();
						void (certificate ? pair() : check());
					}}
				>
					<Input
						label="Device address"
						bind:value={gateway}
						placeholder="https://fambuddy.local:5443"
					/>
					<Input label="One-use pairing code" type="password" bind:value={code} />
					{#if certificate}
						<div class="certificate" role="group" aria-label="Device certificate">
							<p>Certificate fingerprint shown by this device:</p>
							<code>{certificate}</code>
							<p class="help">
								On the FamBuddy, run
								<code
									>sudo openssl x509 -in /etc/fambuddy/hub/server.crt -noout -fingerprint -sha256</code
								>. Connect only if both match; otherwise another device may be pretending to be it.
							</p>
						</div>
					{/if}
					<p class="help">
						Your device keeps recordings local and asks for your approval before sending a question
						to AI. Pairing credentials are saved encrypted for this account.
					</p>
					{#if !nativeStorage}<p class="help">
							For app-private encrypted files, use the Vulture desktop or mobile app. This browser
							stores pairing and relay keys in encrypted IndexedDB.
						</p>{/if}
					<ErrorToast message={error} />
					<div class="pairing-actions">
						{#if certificate}
							<Button
								variant="ghost"
								type="button"
								onclick={() => (checked = { address: "", fingerprint: "" })}
								>They don’t match</Button
							>
						{/if}
						<Button type="submit" disabled={busy || !code.trim()}
							>{busy ? "Checking…" : certificate ? "They match, connect" : "Check device"}</Button
						>
					</div>
				</form>
			{/if}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	.setup,
	form {
		display: grid;
		gap: calc(var(--v-space) * 2);
	}
	p {
		color: var(--v-muted);
		line-height: 1.6;
	}
	.help {
		margin: 0;
		max-width: 65ch;
		font-size: 0.85rem;
	}
	.pairing-actions {
		display: flex;
		justify-content: flex-end;
	}
	/* Matches the FamBuddy settings sheet. */
	:global(.pairing-overlay) {
		position: fixed;
		inset: 0;
		z-index: 100;
		background: rgba(8, 13, 24, 0.48);
		backdrop-filter: blur(8px);
	}
	:global(.pairing-dialog) {
		position: fixed;
		top: 50%;
		left: 50%;
		z-index: 101;
		display: grid;
		gap: calc(var(--v-space) * 2);
		box-sizing: border-box;
		width: min(460px, calc(100vw - 32px));
		max-height: calc(100dvh - 32px);
		overflow-y: auto;
		transform: translate(-50%, -50%);
		padding: 28px;
		border: 1px solid color-mix(in srgb, var(--v-fg) 10%, transparent);
		border-radius: 22px;
		background: color-mix(in srgb, var(--v-surface) 92%, transparent);
		backdrop-filter: blur(28px) saturate(150%);
		box-shadow: 0 24px 80px rgba(0, 0, 0, 0.28);
		color: var(--v-fg);
		outline: none;
	}
	:global(.pairing-title) {
		margin: 0;
		padding-right: 32px;
		font-size: 1.1rem;
		font-weight: 650;
	}
	:global(.pairing-description) {
		display: flex;
		align-items: center;
		gap: var(--v-space);
		margin: 0;
		color: var(--v-muted);
		font-size: 0.875rem;
		line-height: 1.55;
		overflow-wrap: anywhere;
	}
	:global(.pairing-close) {
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
	.certificate {
		display: grid;
		gap: calc(var(--v-space) * 0.75);
		padding: calc(var(--v-space) * 1.5);
		border-radius: 12px;
		background: color-mix(in srgb, var(--v-fg) 5%, transparent);
	}
	.certificate p {
		margin: 0;
	}
	.certificate > code {
		font-size: 0.8rem;
		line-height: 1.5;
		overflow-wrap: anywhere;
		color: var(--v-fg);
	}
	.certificate .help code {
		overflow-wrap: anywhere;
	}
	.start {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: calc(var(--v-space) * 2);
		padding: calc(var(--v-space) * 2.5);
		border: 1px solid var(--v-border);
		border-radius: 18px;
		background: color-mix(in srgb, var(--v-fg) 3%, transparent);
	}
	.start > :global(svg) {
		flex-shrink: 0;
		color: var(--v-primary-text, var(--v-primary));
	}
	.start > div {
		flex: 1 1 16rem;
		min-width: 0;
	}
	.start h2 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
	}
	.start p {
		margin: calc(var(--v-space) / 2) 0 0;
		font-size: 0.875rem;
	}
	.connection {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: var(--v-space);
	}
	.connection span {
		display: inline-flex;
		align-items: center;
		gap: var(--v-space);
		overflow-wrap: anywhere;
		color: var(--v-muted);
	}
</style>
