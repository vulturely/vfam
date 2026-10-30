<script lang="ts">
	import { getContext } from "svelte";
	import { Button, Card } from "../components/index";
	import Mic from "lucide-svelte/icons/mic";
	import MicOff from "lucide-svelte/icons/mic-off";
	import Megaphone from "lucide-svelte/icons/megaphone";
	import Captions from "lucide-svelte/icons/captions";
	import ShieldCheck from "lucide-svelte/icons/shield-check";
	import BuddyTalk from "./BuddyTalk.svelte";
	import BuddyProvider from "./BuddyProvider.svelte";
	import BuddyScreenPin from "./BuddyScreenPin.svelte";
	import BuddyUpdates from "./BuddyUpdates.svelte";
	import BuddyDeviceLicense from "./BuddyDeviceLicense.svelte";
	import BuddyAiMode from "./BuddyAiMode.svelte";
	import { LIVE_CAMERA, NEEDS_LICENSE, lacks } from "./license";
	import type { Runtime } from "../runtime/registry.svelte";
	import type { ParentAuth } from "./remote/client";
	import type { FamilyAiService } from "../family-ai/service";
	import type { BuddyCaption, BuddyCommand, BuddyService, BuddySettings } from "./buddy";

	let {
		device,
		caption,
		connection,
		busy,
		oncommand,
	}: {
		device: BuddySettings;
		/** What the device is saying now, while captions are on. */
		caption?: BuddyCaption;
		connection: {
			service: BuddyService;
			server?: string;
			auth?: ParentAuth;
			familyAi?: FamilyAiService;
			local?: { gateway: string; token: string };
		};
		busy: boolean;
		/** Resolves false when the command was not carried out; the caller shows why. */
		oncommand: (command: BuddyCommand) => Promise<boolean | void>;
	} = $props();
	/** For forms that keep what was typed until the device has really taken it. */
	async function confirmed(command: BuddyCommand) {
		if ((await oncommand(command)) === false) throw new Error("FamBuddy did not take the change.");
	}
	let wakeWord = $state<string>();
	let announcement = $state("");
	let mediaBusy = $state(false);
	function acquireMedia() {
		if (mediaBusy) return undefined;
		mediaBusy = true;
		return () => {
			mediaBusy = false;
		};
	}
	const service = $derived(connection.service);
	const server = $derived(connection.server);
	const auth = $derived(connection.auth);
	const familyAi = $derived(connection.familyAi);
	const local = $derived(connection.local);
	/** The family's license, when this screen runs inside the signed-in app. */
	const licenses = getContext<Runtime | undefined>("vulture:runtime")?.services.fambuddyLicense;
	const cameraLocked = $derived(lacks(device.license, LIVE_CAMERA) && !device.camera_enabled);
</script>

<Card>
	<fieldset>
		<legend>Device {device.device.slice(0, 8)}</legend>
		<div class="listening-row">
			<span class="status-badge" class:muted={device.muted}>
				{#if device.muted}<MicOff size={14} aria-hidden="true" />{:else}<Mic
						size={14}
						aria-hidden="true"
					/>{/if}
				{device.muted ? "Muted" : "Listening enabled"}
			</span>
			<Button
				disabled={busy && device.muted}
				variant={device.muted ? "primary" : "danger"}
				onclick={() =>
					void oncommand({
						action: "configure",
						device: device.device,
						wake_word: device.wake_word,
						muted: !device.muted,
					})}>{device.muted ? "Enable local listening" : "Mute and cancel all requests"}</Button
			>
		</div>
		<p>
			{device.muted
				? "Muted. Pending requests are cancelled."
				: "Local listening enabled. Unknown voices are ignored."}
		</p>
		<div class="caption" aria-live="polite">
			{#if caption}
				<span class="caption-label"><Captions size={14} aria-hidden="true" /> Saying now</span>
				<q>{caption.text}</q>
			{/if}
		</div>
		<div class="device-section">
			<h4>Wake phrase</h4>
			<p>Saving mutes listening and cancels pending requests. Enable listening again when ready.</p>
			<div class="wake-editor">
				<label class="wake-label"
					><span class="sr-only">Wake phrase</span><input
						disabled={busy}
						value={wakeWord ?? device.wake_word}
						oninput={(e) => (wakeWord = e.currentTarget.value)}
						maxlength="60"
					/></label
				>
				<Button
					variant="ghost"
					disabled={busy}
					onclick={() =>
						void oncommand({
							action: "configure",
							device: device.device,
							wake_word: wakeWord ?? device.wake_word,
							muted: true,
						})}>Save wake phrase</Button
				>
			</div>
		</div>
		<div class="device-section">
			<h4>
				<Megaphone size={17} aria-hidden="true" /> Messages & live talk
			</h4>
			<label
				>Announcement or message<textarea
					disabled={busy}
					bind:value={announcement}
					maxlength="8000"
					placeholder="Write a message for this device…"></textarea></label
			>
			<div class="actions">
				<Button
					disabled={busy || device.muted || !announcement?.trim()}
					onclick={() =>
						void oncommand({
							action: "announce",
							device: device.device,
							text: announcement,
						})}>Send for local speech</Button
				>
				<BuddyTalk
					{service}
					startDisabled={busy || mediaBusy}
					{acquireMedia}
					device={device.device}
					disabled={device.muted || service.liveTalkAvailable === false}
				/>
			</div>
		</div>
		{#if mediaBusy}<p role="status">
				One live session per device. End the current session before starting another.
			</p>{/if}
		<div class="device-section">
			<h4>Captions</h4>
			<p>
				{device.captions_enabled
					? "On: what this FamBuddy says is shown on its screen and here."
					: "Off: nothing it says is shown on its screen or here."}
			</p>
			<Button
				variant="ghost"
				disabled={busy}
				onclick={() =>
					void oncommand({
						action: "configure_captions",
						device: device.device,
						enabled: !device.captions_enabled,
					})}>{device.captions_enabled ? "Turn captions off" : "Turn captions on"}</Button
			>
		</div>
		<div class="device-section">
			<BuddyScreenPin
				pinSet={device.screen_pin_set ?? false}
				{busy}
				onsave={(pin) => confirmed({ action: "configure_screen_pin", device: device.device, pin })}
			/>
		</div>
		<div class="device-section">
			<BuddyUpdates
				settings={device}
				{busy}
				onautomatic={(automatic) =>
					confirmed({ action: "configure_updates", device: device.device, automatic })}
				oninstall={() => confirmed({ action: "install_update", device: device.device })}
			/>
		</div>
		<div class="device-section">
			<BuddyAiMode
				settings={device}
				{busy}
				onmode={(mode) => confirmed({ action: "configure_ai_mode", device: device.device, mode })}
			/>
		</div>
		<div class="device-section">
			<BuddyDeviceLicense
				license={device.license}
				familyLicense={licenses?.license}
				{busy}
				oninstall={(token) =>
					confirmed({ action: "install_license", device: device.device, token })}
			/>
		</div>
		<div class="device-section">
			<h4>Live camera</h4>
			<p>
				Off by default. Enabling access does not start capture. Video is live only and is not
				recorded or sent to AI.
			</p>
			{#if cameraLocked}
				<p class="needs-license">{NEEDS_LICENSE}</p>
			{:else}
				<Button
					variant="ghost"
					disabled={busy && !device.camera_enabled}
					onclick={() =>
						void oncommand({
							action: "configure_camera",
							device: device.device,
							enabled: !device.camera_enabled,
						})}>{device.camera_enabled ? "Disable camera access" : "Enable camera access"}</Button
				>
			{/if}
			{#if device.camera_enabled}<BuddyTalk
					{service}
					device={device.device}
					video={true}
					startDisabled={busy || mediaBusy}
					{acquireMedia}
					disabled={device.muted || service.liveTalkAvailable === false}
				/>{/if}
		</div>
		<div class="device-section">
			{#if service.providerSettingsAvailable !== false && server && auth && familyAi}
				<BuddyProvider {service} device={device.device} {familyAi} {local} />
			{:else}<p>Sign in to Vulture to choose how this FamBuddy gets AI answers.</p>{/if}
		</div>
		<div class="device-footer">
			<span><ShieldCheck size={15} aria-hidden="true" /> Parent controlled</span>
			<Button
				variant="ghost"
				onclick={() => void oncommand({ action: "revoke", device: device.device })}
				>Revoke this device</Button
			>
		</div>
	</fieldset>
</Card>

<style>
	.caption:empty {
		display: none;
	}
	.caption {
		display: grid;
		gap: calc(var(--v-space) / 2);
		padding: calc(var(--v-space) * 1.25) calc(var(--v-space) * 1.5);
		border-radius: 12px;
		background: color-mix(in srgb, var(--v-primary) 10%, transparent);
	}
	.caption-label {
		display: inline-flex;
		align-items: center;
		gap: calc(var(--v-space) / 2);
		color: var(--v-primary-text, var(--v-primary));
		font-size: 0.75rem;
		font-weight: 600;
	}
	.caption q {
		font-size: 0.95rem;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	fieldset,
	.needs-license {
		color: var(--v-fg);
		font-weight: 600;
	}
	.device-section {
		display: grid;
		min-width: 0;
		gap: calc(var(--v-space) * 2);
	}
	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
	}
	legend {
		padding: 0 0 calc(var(--v-space) * 2);
		font-size: 0.95rem;
		font-weight: 600;
	}
	.listening-row,
	.actions,
	.device-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: calc(var(--v-space) * 1.5);
	}
	.actions {
		justify-content: flex-start;
	}
	h4,
	p {
		margin: 0;
	}
	h4 {
		display: flex;
		align-items: center;
		gap: var(--v-space);
		font-size: 0.875rem;
		font-weight: 600;
	}
	p {
		color: var(--v-muted);
		font-size: 0.8125rem;
		line-height: 1.6;
		overflow-wrap: anywhere;
	}
	.status-badge {
		display: inline-flex;
		align-items: center;
		gap: calc(var(--v-space) * 0.75);
		padding: calc(var(--v-space) / 2) var(--v-space);
		border-radius: 999px;
		background: color-mix(in srgb, var(--v-primary) 10%, transparent);
		color: var(--v-primary-text, var(--v-primary));
		font-size: 0.75rem;
		font-weight: 600;
	}
	.status-badge.muted {
		background: var(--v-bg);
		color: var(--v-muted);
	}
	.device-section {
		gap: calc(var(--v-space) * 1.5);
		padding-top: calc(var(--v-space) * 2);
		border-top: 1px solid var(--v-border);
	}
	.wake-editor {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--v-space);
	}
	.wake-label {
		flex: 1 1 12rem;
		min-width: 0;
	}
	label {
		display: grid;
		gap: calc(var(--v-space) / 2);
		font-size: 0.8125rem;
		font-weight: 600;
	}
	input,
	textarea {
		width: 100%;
		min-width: 0;
		min-height: max(var(--v-control-h), 44px);
		box-sizing: border-box;
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius-sm);
		padding: var(--v-space) calc(var(--v-space) * 1.5);
		background: var(--v-bg);
		color: var(--v-fg);
		font: inherit;
		font-weight: 400;
	}
	input:focus-visible,
	textarea:focus-visible {
		outline: 2px solid var(--v-ring);
		outline-offset: 1px;
	}
	textarea {
		min-height: 6rem;
		resize: vertical;
	}
	textarea::placeholder {
		color: var(--v-muted);
	}
	.device-footer {
		border-top: 1px solid var(--v-border);
		padding-top: var(--v-space);
	}
	.device-footer > span {
		display: inline-flex;
		gap: calc(var(--v-space) / 2);
		align-items: center;
		color: var(--v-muted);
		font-size: 0.75rem;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
		border: 0;
	}
</style>
