<script lang="ts">
	import { getContext, onMount } from "svelte";
	import { Dialog } from "bits-ui";
	import X from "lucide-svelte/icons/x";
	import type { Runtime } from "../runtime/registry.svelte";
	import type { FamBuddySession } from "./directory.svelte";
	import { Button, ErrorToast, Input } from "../components/index";
	import BuddyProvider from "./BuddyProvider.svelte";
	import BuddyScreenPin from "./BuddyScreenPin.svelte";
	import BuddyUpdates from "./BuddyUpdates.svelte";
	import BuddyVoices from "./BuddyVoices.svelte";
	import BuddyDeviceLicense from "./BuddyDeviceLicense.svelte";
	import BuddyAiModeSetting from "./BuddyAiMode.svelte";
	import type { BuddyAiMode, BuddyAsker } from "./buddy";
	import { LIVE_CAMERA, NEEDS_LICENSE, lacks } from "./license";

	let { session, open = $bindable(false) }: { session: FamBuddySession; open?: boolean } = $props();
	const runtime = getContext<Runtime>("vulture:runtime");
	const deviceId = $derived(session.pair?.pair?.binding.device ?? "");
	const device = $derived(session.output.settings.find((item) => item.device === deviceId));
	let wakeWord = $state("");

	$effect(() => {
		if (device && !wakeWord) wakeWord = device.wake_word;
	});

	onMount(() => {
		void runtime.services.fambuddy.acquire(session.registration.id).catch(() => {});
		return () => runtime.services.fambuddy.release(session.registration.id);
	});

	async function saveWakeWord() {
		if (!device || !wakeWord.trim()) return;
		await runtime.services.fambuddy.command(session.registration.id, {
			action: "configure",
			device: device.device,
			wake_word: wakeWord.trim(),
			muted: true,
		});
	}

	async function toggleListening() {
		if (!device) return;
		await runtime.services.fambuddy.command(session.registration.id, {
			action: "configure",
			device: device.device,
			wake_word: device.wake_word,
			muted: !device.muted,
		});
	}

	async function toggleCamera() {
		if (!device) return;
		await runtime.services.fambuddy.command(session.registration.id, {
			action: "configure_camera",
			device: device.device,
			enabled: !device.camera_enabled,
		});
	}

	async function toggleCaptions() {
		if (!device) return;
		await runtime.services.fambuddy.command(session.registration.id, {
			action: "configure_captions",
			device: device.device,
			enabled: !device.captions_enabled,
		});
	}

	async function saveScreenPin(pin: string) {
		if (!device) return;
		await runtime.services.fambuddy.command(session.registration.id, {
			action: "configure_screen_pin",
			device: device.device,
			pin,
		});
	}

	async function labelVoice(speaker: string, name: string, role: BuddyAsker) {
		if (!device) return;
		await runtime.services.fambuddy.command(session.registration.id, {
			action: "label_voice",
			device: device.device,
			speaker,
			name,
			role,
		});
	}

	async function installLicense(token: string) {
		if (!device) return;
		await runtime.services.fambuddyLicense.installOn(session.registration.id, device.device, token);
	}

	async function configureAiMode(mode: BuddyAiMode) {
		if (!device) return;
		await runtime.services.fambuddy.command(session.registration.id, {
			action: "configure_ai_mode",
			device: device.device,
			mode,
		});
	}

	async function configureUpdates(automatic: boolean) {
		if (!device) return;
		await runtime.services.fambuddy.command(session.registration.id, {
			action: "configure_updates",
			device: device.device,
			automatic,
		});
	}

	async function installUpdate() {
		if (!device) return;
		await runtime.services.fambuddy.command(session.registration.id, {
			action: "install_update",
			device: device.device,
		});
	}

	function run(action: () => Promise<unknown>) {
		void action().catch(() => {});
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="buddy-settings-overlay" />
		<Dialog.Content class="buddy-settings-dialog">
			<Dialog.Close class="settings-close" aria-label="Close FamBuddy settings">
				<X aria-hidden="true" size={18} />
			</Dialog.Close>
			<Dialog.Title>{session.registration.name} settings</Dialog.Title>
			<Dialog.Description>
				Manage listening, camera access, the screen PIN, its license, family AI, software updates,
				and the AI provider for this FamBuddy.
			</Dialog.Description>
			<ErrorToast message={session.error} />
			{#if session.service && device}
				<section>
					<h3>Wake phrase</h3>
					<p>Saving a new phrase mutes listening until you enable it again.</p>
					<Input bind:value={wakeWord} placeholder="Wake phrase" />
					<div class="settings-actions">
						<Button disabled={session.busy || !wakeWord.trim()} onclick={() => run(saveWakeWord)}
							>Save wake phrase</Button
						>
						<Button variant="ghost" disabled={session.busy} onclick={() => run(toggleListening)}
							>{device.muted ? "Enable listening" : "Mute listening"}</Button
						>
					</div>
				</section>
				<section>
					<h3>Camera access</h3>
					<p>Live video is receive-only and is never recorded or sent to AI.</p>
					{#if lacks(device.license, LIVE_CAMERA) && !device.camera_enabled}
						<p class="needs-license">{NEEDS_LICENSE}</p>
					{:else}
						<Button variant="ghost" disabled={session.busy} onclick={() => run(toggleCamera)}>
							{device.camera_enabled ? "Disable camera access" : "Enable camera access"}
						</Button>
					{/if}
				</section>
				<section>
					<h3>Captions</h3>
					<p>Show what this FamBuddy says on its screen and in this app.</p>
					<Button variant="ghost" disabled={session.busy} onclick={() => run(toggleCaptions)}>
						{device.captions_enabled ? "Turn captions off" : "Turn captions on"}
					</Button>
				</section>
				<section>
					<BuddyScreenPin
						pinSet={device.screen_pin_set ?? false}
						busy={session.busy}
						onsave={saveScreenPin}
					/>
				</section>
				<section>
					<BuddyVoices
						voices={session.output.voices ?? []}
						busy={session.busy}
						onsave={labelVoice}
					/>
				</section>
				<section>
					<BuddyDeviceLicense
						license={device.license}
						familyLicense={runtime.services.fambuddyLicense?.license}
						busy={session.busy}
						oninstall={installLicense}
					/>
				</section>
				<section>
					<BuddyAiModeSetting settings={device} busy={session.busy} onmode={configureAiMode} />
				</section>
				<section>
					<BuddyUpdates
						settings={device}
						busy={session.busy}
						onautomatic={configureUpdates}
						oninstall={installUpdate}
					/>
				</section>
				{#if session.pair}
					<BuddyProvider
						service={session.service}
						device={device.device}
						familyAi={runtime.services.familyAi}
					/>
				{/if}
			{:else}
				<p role="status">Connecting to this FamBuddy…</p>
			{/if}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	:global(.buddy-settings-overlay) {
		position: fixed;
		inset: 0;
		z-index: 100;
		background: rgba(8, 13, 24, 0.48);
		backdrop-filter: blur(8px);
	}
	:global(.buddy-settings-dialog) {
		position: fixed;
		top: 50%;
		left: 50%;
		z-index: 101;
		display: grid;
		gap: calc(var(--v-space) * 2);
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
	}
	:global(.buddy-settings-dialog h2),
	:global(.buddy-settings-dialog p) {
		margin: 0;
	}
	:global(.buddy-settings-dialog p) {
		color: var(--v-muted);
		font-size: 0.875rem;
		line-height: 1.55;
	}
	:global(.settings-close) {
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
	section {
		display: grid;
		gap: var(--v-space);
		padding-top: calc(var(--v-space) * 1.5);
		border-top: 1px solid var(--v-border);
	}
	section h3 {
		margin: 0;
		font-size: 0.95rem;
	}
	.needs-license {
		color: var(--v-fg);
		font-weight: 600;
	}
	.settings-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--v-space);
	}
</style>
