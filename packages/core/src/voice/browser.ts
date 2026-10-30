/** Browser speech providers. Recognition may use the browser vendor's cloud service. */
export type MicrophoneState = "off" | "listening" | "processing" | "speaking" | "muted" | "error";
interface Recognition {
	lang: string;
	continuous: boolean;
	interimResults: boolean;
	onresult:
		| ((event: {
				results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }>>;
		  }) => void)
		| null;
	onerror: (() => void) | null;
	onend: (() => void) | null;
	start(): void;
	stop(): void;
	abort(): void;
}
export interface SpeechInput {
	listen(
		onText: (text: string) => void,
		onError: (message: string) => void,
		onMute: () => void,
	): Promise<void>;
	finish(): void;
	stop(): void;
}
export interface SpeechOutput {
	speak(text: string, done: () => void, fail: () => void): void;
	stop(): void;
}
export function browserInput(): SpeechInput {
	let recognition: Recognition | undefined;
	let stream: MediaStream | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let generation = 0;
	let released = false;
	function stop() {
		generation++;
		clearTimeout(timer);
		if (recognition) {
			recognition.onresult = null;
			recognition.onerror = null;
			recognition.onend = null;
			recognition.abort();
			recognition = undefined;
		}
		stream?.getTracks().forEach((track) => {
			track.onmute = null;
			track.onended = null;
			track.stop();
		});
		stream = undefined;
	}
	return {
		stop,
		finish() {
			released = true;
			recognition?.stop();
		},
		async listen(onText, onError, onMute) {
			stop();
			released = false;
			const id = generation;
			const globals = globalThis as typeof globalThis & {
				SpeechRecognition?: new () => Recognition;
				webkitSpeechRecognition?: new () => Recognition;
			};
			const Constructor = globals.SpeechRecognition ?? globals.webkitSpeechRecognition;
			if (!Constructor || !navigator.mediaDevices?.getUserMedia) {
				onError("Speech input is unavailable. Type your answer instead.");
				return;
			}
			const fail = (message: string) => {
				if (id !== generation) return;
				stop();
				onError(message);
			};
			// Also bound a stalled permission prompt; a late stream is immediately released.
			timer = setTimeout(
				() => fail("No speech received. Check your microphone and try again."),
				15000,
			);
			try {
				const media = await navigator.mediaDevices.getUserMedia({
					audio: true,
				});
				if (id !== generation) {
					media.getTracks().forEach((track) => track.stop());
					return;
				}
				if (released) {
					media.getTracks().forEach((track) => track.stop());
					stop();
					onError("Hold to talk after microphone permission is granted.");
					return;
				}
				stream = media;
				for (const track of media.getAudioTracks()) {
					const mute = () => {
						if (id !== generation) return;
						stop();
						onMute();
					};
					track.onmute = mute;
					track.onended = mute;
					if (track.muted || track.readyState === "ended") {
						mute();
						return;
					}
				}
				const provider = new Constructor();
				recognition = provider;
				provider.lang = "en-US";
				provider.continuous = false;
				provider.interimResults = false;
				provider.onresult = (event) => {
					if (id !== generation) return;
					const result = event.results[0]?.[0];
					if (
						!result ||
						!result.transcript.trim() ||
						result.confidence < 0.5 ||
						new TextEncoder().encode(result.transcript).length > 2000
					) {
						fail("I could not hear clearly. Try again in a quieter place or type your answer.");
						return;
					}
					const text = result.transcript.trim();
					stop();
					onText(text);
				};
				provider.onerror = () =>
					fail(
						"Microphone permission or speech provider unavailable. Type your answer or try again.",
					);
				provider.onend = () => fail("No speech received. Try again or type your answer.");
				provider.start();
			} catch {
				fail(
					"Microphone permission denied or microphone unavailable. You can still type your answer.",
				);
			}
		},
	};
}
/** Only installed local voices are used; text never goes to a network TTS provider. */
/** How long to wait for the web view to finish loading its voices. */
const VOICE_WAIT_MS = 1500;

/** Joke and robotic voices some systems list among their English voices. */
const UNCLEAR_VOICES =
	/\b(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|ralph|kathy|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/i;

/** Higher is clearer: natural voices, then the system default, then the reader's language. */
function clarity(voice: SpeechSynthesisVoice) {
	const language = globalThis.navigator?.language ?? "en-US";
	return (
		(/enhanced|premium|natural|neural/i.test(voice.name) ? 8 : 0) +
		(voice.default ? 4 : 0) +
		(voice.lang === language ? 2 : 0) +
		(/^en-(US|GB)$/.test(voice.lang) ? 1 : 0)
	);
}

/**
 * The clearest English voice on this device. Online voices are never used: they would
 * send the text to a cloud service.
 */
function localEnglish(synth: SpeechSynthesis) {
	return synth
		.getVoices()
		.filter(
			(voice) =>
				voice.localService && voice.lang.startsWith("en") && !UNCLEAR_VOICES.test(voice.name),
		)
		.sort((a, b) => clarity(b) - clarity(a))[0];
}

/** Voices often load after the first request; wait briefly for them to arrive. */
function voiceFor(synth: SpeechSynthesis): Promise<SpeechSynthesisVoice | undefined> {
	const ready = localEnglish(synth);
	if (ready || typeof synth.addEventListener !== "function") return Promise.resolve(ready);
	return new Promise((resolve) => {
		const finish = () => {
			clearTimeout(timer);
			synth.removeEventListener("voiceschanged", changed);
			resolve(localEnglish(synth));
		};
		const changed = () => {
			if (localEnglish(synth)) finish();
		};
		const timer = setTimeout(finish, VOICE_WAIT_MS);
		synth.addEventListener("voiceschanged", changed);
	});
}

export function browserOutput(): SpeechOutput {
	let generation = 0;
	return {
		stop() {
			generation++;
			globalThis.speechSynthesis?.cancel();
		},
		speak(text, done, fail) {
			const synth = globalThis.speechSynthesis;
			if (!synth) {
				fail();
				return;
			}
			const id = ++generation;
			void voiceFor(synth).then((voice) => {
				if (id !== generation) return;
				if (!voice) {
					fail();
					return;
				}
				const utterance = new SpeechSynthesisUtterance(text);
				utterance.voice = voice;
				// A little slower than conversation, so children hear each sound.
				utterance.rate = 0.9;
				utterance.onend = done;
				// Being cut off by a newer word is not a failure; nothing else should speak.
				utterance.onerror = (event) => {
					if (event?.error === "interrupted" || event?.error === "canceled") return;
					fail();
				};
				synth.cancel();
				synth.speak(utterance);
			});
		},
	};
}
