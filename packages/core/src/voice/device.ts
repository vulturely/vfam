import { isNativeServerError } from "../repositories/server";
import { createSpeechRepository, type SpeechRepository } from "../repositories/speech";
import { browserOutput, type SpeechOutput } from "./browser";

/**
 * Reads text aloud on this device with one voice at a time. In the desktop app the
 * operating system's own voice is used (it is the clearest); the web view's local voice
 * is used only when that is unavailable. Neither sends the text to an online service.
 */
export function deviceOutput(
	browser: SpeechOutput = browserOutput(),
	native: SpeechRepository = createSpeechRepository(),
): SpeechOutput {
	let generation = 0;
	return {
		speak(text, done, fail) {
			const id = ++generation;
			const current = () => id === generation;
			if (!native.available()) {
				browser.speak(text, done, fail);
				return;
			}
			native.speak(text).then(
				() => {
					if (current()) done();
				},
				(error: unknown) => {
					if (!current()) return;
					// Once the system voice has started, part of the text may have been heard,
					// so it is not read again by a second voice.
					if (isNativeServerError(error, "aborted")) fail();
					else browser.speak(text, done, fail);
				},
			);
		},
		stop() {
			generation++;
			browser.stop();
			if (native.available()) void native.stop().catch(() => {});
		},
	};
}
