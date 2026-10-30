<script lang="ts">
	import X from "lucide-svelte/icons/x";
	import UiPhone from "lucide-svelte/icons/phone";
	import UiVideo from "lucide-svelte/icons/video";
	import UiPhoneOff from "lucide-svelte/icons/phone-off";
	import UiVolume2 from "lucide-svelte/icons/volume-2";
	import UiMic from "lucide-svelte/icons/mic";
	import UiMicOff from "lucide-svelte/icons/mic-off";
	import UiVideoOff from "lucide-svelte/icons/video-off";
	import { getContext, onMount } from "svelte";
	import type { Runtime } from "../runtime/registry.svelte";
	import type { CallState } from "../calls/service";
	import { Button, Card, ErrorToast, IconButton } from "../components/index";
	let {
		embedded = false,
		onActiveChange,
	}: { embedded?: boolean; onActiveChange?: (active: boolean) => void } = $props();
	let expanded = $state(false),
		minimized = $state(false);
	let target = $state<string | undefined>();
	export function show() {
		expanded = true;
		minimized = false;
		target = undefined;
	}
	export async function begin(video: boolean, accountId?: string) {
		expanded = true;
		minimized = false;
		target = accountId;
		if (!view?.available) await start();
		const matches =
			view?.devices.filter((device) => device.accountId === accountId && !device.busy) ?? [];
		if (accountId && matches.length === 1 && view?.phase === "idle")
			await service.call(matches[0], video);
	}
	const runtime = getContext<Runtime>("vulture:runtime");
	const service = runtime.services.calls;
	let view = $state<CallState>();
	const visibleDevices = $derived(
		view?.devices.filter((device) => !target || device.accountId === target) ?? [],
	);
	const childName =
		runtime.state.childSession?.status === "active" ? runtime.state.childSession.displayName : "";
	let name = $state(`${runtime.state.identity?.name ?? (childName || "Family")} device`);
	let starting = $state(false);
	let localVideo: globalThis.HTMLVideoElement | undefined = $state();
	let remoteVideo: globalThis.HTMLVideoElement | undefined = $state();
	let playbackBlocked = $state(false);
	async function play() {
		if (remoteVideo?.srcObject) {
			try {
				await remoteVideo.play();
				playbackBlocked = false;
			} catch {
				playbackBlocked = true;
			}
		}
	}
	$effect(() => {
		if (localVideo) {
			localVideo.srcObject = view?.local ?? null;
			void localVideo.play().catch(() => {});
		}
	});
	$effect(() => {
		if (remoteVideo) {
			remoteVideo.srcObject = view?.remote ?? null;
			void play();
		}
	});
	async function start() {
		starting = true;
		try {
			await service.start(name);
		} catch {
			/* Service publishes the error. */
		} finally {
			starting = false;
		}
	}
	async function toggleCalls(event: globalThis.Event) {
		const checkbox = event.currentTarget as globalThis.HTMLInputElement;
		if (checkbox.checked) await start();
		else service.close();
		checkbox.checked = Boolean(view?.available);
	}
	onMount(() => {
		const unsubscribe = service.subscribe((value) => {
			if (value.phase === "ringing" && view?.phase !== "ringing") {
				expanded = true;
				minimized = false;
			}
			view = value;
			onActiveChange?.(value.available && value.phase !== "idle");
		});
		return () => {
			unsubscribe();
			service.close();
		};
	});
</script>

<section
	class="call-screen"
	class:embedded
	class:expanded={expanded || (!minimized && view?.available && view.phase !== "idle")}
	aria-label="Family calls"
>
	<header class="call-heading">
		<h1>Family calls</h1>
		{#if embedded}<IconButton
				icon={X}
				label={view?.available && view.phase !== "idle" ? "Minimize call" : "Close calls"}
				onclick={() => {
					expanded = false;
					minimized = true;
				}}
			/>{/if}
	</header>
	<p>
		Audio and video for family guardian devices. Enable calls here to receive them while chat stays
		open. Calls last up to 10 minutes and are never recorded.
	</p>
	<ErrorToast message={view?.error} />
	{#if view?.notice}<p role="status">{view.notice}</p>{/if}
	<div class="device-settings">
		<label for="call-device-name">Device name</label>
		<div class="call-device-control" role="group" aria-label="Call settings">
			<input
				id="call-device-name"
				type="text"
				bind:value={name}
				disabled={starting || Boolean(view?.available)}
			/>
			<label class="call-enabled">
				<input
					type="checkbox"
					aria-label="Enable calls"
					checked={Boolean(view?.available)}
					disabled={starting || (!view?.available && !name.trim())}
					onchange={(event) => void toggleCalls(event)}
				/>
				<span>{starting ? "Connecting…" : "Calls"}</span>
			</label>
		</div>
	</div>
	{#if view?.available}
		<Card>
			{#if view.phase === "idle"}
				<h2>Available family devices</h2>
				{#if !visibleDevices.length}<p>
						No other devices online. Open Chat & calls on another family guardian device and enable
						calls there.
					</p>{/if}
				{#each visibleDevices as device (device.id)}
					<div class="device">
						<span>{device.name}{device.busy ? " · Busy" : ""}</span>
						<div class="controls">
							<div class="v-button-row">
								<Button
									icon={UiPhone}
									disabled={device.busy}
									onclick={() => {
										void service.call(device, false);
									}}>Audio call</Button
								>
								<Button
									icon={UiVideo}
									disabled={device.busy}
									onclick={() => {
										void service.call(device, true);
									}}>Video call</Button
								>
							</div>
						</div>
					</div>
				{/each}
			{:else}
				<h2>{view.peer}</h2>
				<p role="status">
					{view.phase === "ringing"
						? `Incoming ${view.video ? "video" : "audio"} call`
						: view.phase === "calling"
							? "Ringing…"
							: view.phase === "connecting"
								? "Connecting…"
								: "Connected"}
				</p>
				{#if view.phase === "ringing"}
					<div class="controls">
						<div class="v-button-row">
							<Button
								icon={UiPhone}
								onclick={() => {
									void service.accept();
								}}>Accept</Button
							>
							<Button
								icon={UiPhoneOff}
								variant="danger"
								onclick={() => {
									void service.hangup();
								}}>Reject</Button
							>
						</div>
					</div>
				{:else}
					<div class="media">
						<!-- Live, private media has no prerecorded caption track. -->
						<video bind:this={remoteVideo} autoplay playsinline aria-label="Family device media"
						></video>
						<video
							class:camera-off={view.cameraOff}
							bind:this={localVideo}
							autoplay
							muted
							playsinline
							aria-label="Your camera preview"
						></video>
					</div>
					{#if view.cameraOff}<p>Camera off</p>{/if}
					{#if playbackBlocked}<Button
							icon={UiVolume2}
							onclick={() => {
								void play();
							}}>Play call audio</Button
						>{/if}
					<div class="controls">
						<Button
							icon={view.muted ? UiMic : UiMicOff}
							variant="ghost"
							onclick={() => service.mute()}>{view.muted ? "Unmute" : "Mute"}</Button
						>
						{#if view.video}<Button
								icon={view.cameraOff ? UiVideo : UiVideoOff}
								variant="ghost"
								onclick={() => service.camera()}
								>{view.cameraOff ? "Turn camera on" : "Turn camera off"}</Button
							>{/if}
						<Button
							icon={UiPhoneOff}
							variant="danger"
							onclick={() => {
								void service.hangup();
							}}>Hang up</Button
						>
					</div>
				{/if}
			{/if}
		</Card>
	{/if}
</section>

<style>
	.call-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.call-heading h1 {
		margin: 0;
		font-size: 1rem;
	}
	.call-screen.embedded {
		position: absolute;
		right: 0;
		top: 0;
		bottom: 0;
		width: min(380px, 100%);
		max-width: 100%;
		box-sizing: border-box;
		padding: 1rem;
		border-left: 1px solid var(--v-border);
		background: var(--v-surface);
		backdrop-filter: blur(24px);
		z-index: 10;
		overflow-y: auto;
		align-content: start;
		display: none;
		gap: 0.85rem;
	}
	.call-screen.embedded.expanded {
		display: grid;
	}
	.embedded h2 {
		font-size: 0.85rem;
	}
	.embedded p {
		font-size: 0.73rem;
		line-height: 1.5;
		color: var(--v-muted);
	}
	.embedded :global(.v-card) {
		border: 0;
		border-radius: 0;
		padding: 0;
		background: transparent;
		box-shadow: none;
	}
	.embedded .device {
		font-size: 0.8rem;
	}
	.embedded .device-settings > label,
	.embedded .call-enabled {
		font-size: 0.75rem;
	}
	.embedded :global(.v-btn) {
		min-height: 34px;
		height: auto;
		padding: 0.4rem 0.65rem;
		font-size: 0.75rem;
	}
	.embedded video {
		max-height: 200px;
		border-radius: 8px;
	}
	.embedded .media {
		grid-template-columns: minmax(0, 1fr);
	}
	.call-screen {
		display: grid;
		gap: calc(var(--v-space) * 2);
		width: min(100%, 60rem);
		margin: 0 auto;
	}
	h1,
	h2,
	p {
		margin: 0 0 var(--v-space);
	}
	.device-settings {
		display: grid;
		gap: calc(var(--v-space) / 2);
		min-width: 0;
	}
	.device-settings > label {
		font-weight: 600;
		font-size: 0.875rem;
	}
	.call-device-control {
		display: flex;
		align-items: center;
		gap: var(--v-space);
		padding-right: calc(var(--v-space) * 1.5);
		background: var(--v-bg);
		box-shadow: inset 0 0 0 1px var(--v-border);
		border-radius: var(--v-radius-sm);
		min-width: 0;
	}
	.call-device-control > input {
		padding-inline: calc(var(--v-space) * 1.5);
		flex: 1;
		min-width: 0;
		width: 100%;
		border: 0;
		background: transparent;
		color: var(--v-fg);
		outline: none;
	}
	.call-device-control:focus-within {
		outline: 2px solid var(--v-ring);
		outline-offset: 2px;
	}
	.call-enabled {
		display: inline-flex;
		align-items: center;
		gap: calc(var(--v-space) * 0.75);
		min-height: 44px;
		cursor: pointer;
		flex-shrink: 0;
		font-size: 0.875rem;
	}
	.call-enabled input {
		width: 18px;
		height: 18px;
		margin: 0;
		accent-color: var(--v-primary);
		cursor: pointer;
	}
	.device,
	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--v-space);
	}
	.device {
		justify-content: space-between;
		padding: var(--v-space) 0;
		border-bottom: 1px solid var(--v-border);
	}
	.media {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
		gap: var(--v-space);
		margin: var(--v-space) 0;
	}
	video {
		width: 100%;
		max-height: 24rem;
		background: var(--v-bg);
		border-radius: var(--v-radius);
	}
	.camera-off {
		visibility: hidden;
		height: 0;
	}
</style>
