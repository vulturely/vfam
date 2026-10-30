<script lang="ts">
	import { Button, ErrorToast } from "../components/index";
	import { onMount } from "svelte";
	import type { BuddyService } from "./buddy";
	import { startBuddyTalk } from "./talk";
	let {
		service,
		device,
		disabled = false,
		startDisabled = false,
		video = false,
		acquireMedia,
	}: {
		service: BuddyService;
		device: string;
		disabled?: boolean;
		startDisabled?: boolean;
		video?: boolean;
		acquireMedia?: () => (() => void) | undefined;
	} = $props();
	let active = $state(false);
	let busy = $state(false);
	let error = $state("");
	let stop: (() => Promise<void>) | undefined;
	let disposed = false;
	let attempt: globalThis.AbortController | undefined;
	let audio = $state<globalThis.HTMLMediaElement>();
	let playbackBlocked = $state(false);
	let playing = $state(false);
	let releaseMedia: (() => void) | undefined;
	let ending: Promise<void> | undefined;
	function release() {
		releaseMedia?.();
		releaseMedia = undefined;
	}
	function playbackStarted() {
		if (!attempt || attempt.signal.aborted) return;
		playing = !video || (audio as globalThis.HTMLVideoElement).videoWidth > 0;
	}
	async function play() {
		const current = attempt;
		try {
			await audio?.play();
			if (current === attempt && !current?.signal.aborted) playbackBlocked = false;
		} catch {
			if (current === attempt && !current?.signal.aborted) {
				playbackBlocked = true;
				playing = false;
			}
		}
	}
	export function end(): Promise<void> {
		if (ending) return ending;
		active = false;
		playing = false;
		playbackBlocked = false;
		attempt?.abort();
		attempt = undefined;
		const finish = stop;
		stop = undefined;
		ending = (async () => {
			try {
				await finish?.();
			} finally {
				if (!busy) release();
				ending = undefined;
			}
		})();
		return ending;
	}
	/** Starts live media; resolves whether it is running, so callers never report a start that did not happen. */
	export async function start(): Promise<boolean> {
		if (active) return true;
		if (busy || ending || disabled || startDisabled) return false;
		releaseMedia = acquireMedia?.();
		if (acquireMedia && !releaseMedia) return false;
		busy = true;
		error = "";
		playing = false;
		playbackBlocked = false;
		attempt = new globalThis.AbortController();
		try {
			const finish = await startBuddyTalk(service, device, {
				signal: attempt.signal,
				video,
				onError: () => {
					void end();
					error = `${video ? "Live view" : "Live talk"} stopped. Check device connection.`;
				},
				onAudio: (stream) => {
					if (!audio) return;
					audio.srcObject = stream;
					if (stream) void play();
					else playing = false;
				},
			});
			if (disposed || document.hidden || disabled || attempt?.signal.aborted || !attempt) {
				await finish();
				return false;
			}
			stop = finish;
			active = true;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Microphone access unavailable.";
		} finally {
			busy = false;
			if (!active && !ending) release();
		}
		return active;
	}
	$effect(() => {
		if (disabled) void end();
	});
	onMount(() => {
		const hidden = () => {
			if (document.hidden) void end();
		};
		document.addEventListener("visibilitychange", hidden);
		return () => {
			disposed = true;
			document.removeEventListener("visibilitychange", hidden);
			void end();
		};
	});
</script>

<div>
	{#if video}<video
			bind:this={audio}
			autoplay
			playsinline
			onplaying={playbackStarted}
			onwaiting={() => (playing = false)}
			onpause={() => (playing = false)}
			aria-label="FamBuddy live camera"
		></video>{:else}<audio
			bind:this={audio}
			autoplay
			onplaying={playbackStarted}
			onwaiting={() => (playing = false)}
			onpause={() => (playing = false)}
		></audio>{/if}
	{#if playbackBlocked}<Button type="button" onclick={() => void play()}
			>{video ? "Play live video and audio" : "Play live audio"}</Button
		>{/if}
	{#if active}<p role="status">
			{playing
				? video
					? "Live camera playback started."
					: "Live audio playback started."
				: "Connected. Waiting for media from the device."}
		</p>
		<Button type="button" onclick={() => void end()}
			>{video ? "End live view" : "End live talk"}</Button
		>
	{:else}<Button
			type="button"
			disabled={disabled || startDisabled || busy}
			onclick={() => void start()}>{video ? "Start live view" : "Start live talk"}</Button
		>{/if}
	<ErrorToast message={error} />
</div>

<style>
	video {
		width: 100%;
		max-height: 24rem;
		background: #000;
		border-radius: var(--v-radius);
	}
</style>
