import type { SpeechOutput } from "./browser";
import { audioPlayer, type AudioPlayer } from "./player";

/**
 * Speaks a question's word with audio made on the family's server, the same clear voice
 * on every device. When the server, its speech engine or playback is unavailable, the
 * device voice reads the word instead.
 */
export function questionOutput(
	load: () => Promise<{ audio: Uint8Array; contentType: string }>,
	fallback: SpeechOutput,
	player: AudioPlayer = audioPlayer(),
): SpeechOutput {
	let generation = 0;
	// Fetched once per question; a failure is remembered so the fallback answers at once.
	let audio: Promise<{ audio: Uint8Array; contentType: string }> | undefined;
	return {
		speak(text, done, fail) {
			const id = ++generation;
			const current = () => id === generation;
			const useDevice = () => {
				if (current()) fallback.speak(text, done, fail);
			};
			audio ??= load();
			audio.then((sound) => {
				if (!current()) return;
				player.play(sound.audio, sound.contentType).then(() => {
					if (current()) done();
				}, useDevice);
			}, useDevice);
		},
		stop() {
			generation++;
			player.stop();
			fallback.stop();
		},
	};
}
