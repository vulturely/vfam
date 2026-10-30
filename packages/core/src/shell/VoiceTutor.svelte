<script lang="ts">
	import UiMic from "lucide-svelte/icons/mic";
	import UiSquare from "lucide-svelte/icons/square";
	import UiMicOff from "lucide-svelte/icons/mic-off";
	import { onMount } from "svelte";
	import { Button, ErrorToast, IconButton } from "../components/index";
	import type { VoiceService } from "../voice/service";
	import { deviceOutput } from "../voice/device";
	import {
		browserInput,
		type SpeechInput,
		type SpeechOutput,
		type MicrophoneState,
	} from "../voice/browser";
	let {
		service,
		sessionId,
		onAnswer,
		input = browserInput(),
		output = deviceOutput(),
	}: {
		service: VoiceService;
		sessionId: string;
		onAnswer: (answer: string) => void;
		input?: SpeechInput;
		output?: SpeechOutput;
	} = $props();
	let enabled = $state(false),
		loaded = $state(false),
		micState = $state<MicrophoneState>("off"),
		text = $state(""),
		error = $state("");
	/** What the microphone is doing, in words a child understands. */
	const STATES: Record<MicrophoneState, string> = {
		off: "Hold the button and say your answer",
		listening: "Listening…",
		processing: "Thinking…",
		speaking: "Speaking…",
		muted: "Voice is muted",
		error: "Let's try that again",
	};
	let generation = 0;
	let released = false;
	function finish() {
		released = true;
		input.finish();
	}
	let timer: ReturnType<typeof setTimeout> | undefined;
	function stop(muted = false) {
		generation++;
		clearTimeout(timer);
		input.stop();
		output.stop();
		micState = muted ? "muted" : "off";
	}
	async function policy() {
		try {
			enabled = (await service.status()).enabled;
			loaded = true;
		} catch {
			enabled = false;
			loaded = true;
			error = "Voice unavailable. You can still type your answer.";
			stop();
		}
		if (!enabled) stop();
	}
	onMount(() => {
		void policy();
		const poll = setInterval(() => void policy(), 10000);
		const hide = () => {
			if (document.hidden) stop();
		};
		document.addEventListener("visibilitychange", hide);
		return () => {
			clearInterval(poll);
			document.removeEventListener("visibilitychange", hide);
			stop();
		};
	});
	// Session/question navigation invalidates every outstanding provider callback.
	$effect(() => {
		void sessionId;
		return () => stop();
	});
	async function respond(transcript: string, id: number) {
		if (id !== generation) return;
		micState = "processing";
		timer = setTimeout(() => {
			if (id === generation) {
				stop();
				error = "Voice took too long. Please try again.";
			}
		}, 10000);
		try {
			const reply = await service.turn(sessionId, transcript);
			if (id !== generation) return;
			clearTimeout(timer);
			text = reply.text;
			if (reply.intent === "stop") {
				stop();
				return;
			}
			if (reply.intent === "answer") onAnswer(transcript.trim().slice("my answer is ".length));
			micState = "speaking";
			timer = setTimeout(() => {
				if (id === generation) stop();
			}, 20000);
			output.speak(
				reply.text,
				() => {
					if (id === generation) stop();
				},
				() => {
					if (id === generation) {
						stop();
						error = "Local speech output unavailable. Read the response below.";
					}
				},
			);
		} catch {
			if (id === generation) {
				stop();
				error = "Voice provider unavailable. Please retry or type your answer.";
			}
		}
	}
	async function listen() {
		stop();
		released = false;
		error = "";
		const id = generation;
		try {
			if (!(await service.status()).enabled || id !== generation) {
				enabled = false;
				return;
			}
			if (released) return;
			micState = "listening";
			await input.listen(
				(transcript) => void respond(transcript, id),
				(message) => {
					if (id === generation) {
						stop();
						error = message;
					}
				},
				() => {
					if (id === generation) stop(true);
				},
			);
		} catch {
			if (id === generation) {
				stop();
				error = "Microphone unavailable. Type your answer instead.";
			}
		}
	}
</script>

<!-- Only shown once a guardian has turned voice on; typing always works. -->
{#if loaded && enabled}
	<section class="tutor" aria-label="FamBud voice tutor">
		<Button
			icon={UiMic}
			disabled={micState === "muted"}
			onpointerdown={() => void listen()}
			onpointerup={() => finish()}
			onpointercancel={() => stop()}
			onpointerleave={() => finish()}
			onkeydown={(event) => {
				if ((event.key === " " || event.key === "Enter") && !event.repeat) {
					event.preventDefault();
					void listen();
				}
			}}
			onkeyup={(event) => {
				if (event.key === " " || event.key === "Enter") {
					event.preventDefault();
					finish();
				}
			}}>Hold to talk</Button
		>
		<span class="state" role="status">{STATES[micState]}</span>
		<span class="tools">
			<IconButton icon={UiSquare} label="Stop voice" onclick={() => stop()} /><IconButton
				icon={micState === "muted" ? UiMic : UiMicOff}
				label={micState === "muted" ? "Unmute voice" : "Mute voice"}
				onclick={() => stop(micState !== "muted")}
			/>
		</span>
		{#if text}<p aria-live="polite">{text}</p>{/if}
		<ErrorToast message={error} />
	</section>
{:else if error}<ErrorToast message={error} />{/if}

<style>
	.tutor {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
	}
	.state {
		color: var(--v-muted);
		font-size: 0.9rem;
	}
	.tools {
		display: inline-flex;
		margin-left: auto;
		gap: 0.25rem;
	}
	.tools :global(.v-icon-btn::after) {
		left: auto;
		right: 0;
		transform: none;
	}
	p {
		flex-basis: 100%;
		margin: 0;
		overflow-wrap: anywhere;
	}
</style>
