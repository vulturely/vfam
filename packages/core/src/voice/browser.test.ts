import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { browserInput, browserOutput } from "./browser";
let provider: FakeRecognition;
class FakeRecognition {
	onresult: ((event: unknown) => void) | null = null;
	onerror: (() => void) | null = null;
	onend: (() => void) | null = null;
	start = vi.fn();
	stop = vi.fn();
	abort = vi.fn();
	constructor() {
		// Capture the provider instance to deliver browser callbacks in tests.
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		provider = this;
	}
}
let track: {
	stop: ReturnType<typeof vi.fn>;
	onmute: (() => void) | null;
	onended: (() => void) | null;
	muted: boolean;
	readyState: string;
};
const text = vi.fn(),
	error = vi.fn(),
	mute = vi.fn();
beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	track = {
		stop: vi.fn(),
		onmute: null,
		onended: null,
		muted: false,
		readyState: "live",
	};
	vi.stubGlobal("SpeechRecognition", FakeRecognition);
	Object.defineProperty(navigator, "mediaDevices", {
		configurable: true,
		value: {
			getUserMedia: vi.fn().mockResolvedValue({
				getTracks: () => [track],
				getAudioTracks: () => [track],
			}),
		},
	});
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});
it("transcribes once, releases audio and ignores late results", async () => {
	const input = browserInput();
	await input.listen(text, error, mute);
	const callback = provider.onresult!;
	callback({ results: [[{ transcript: "read", confidence: 0.9 }]] });
	callback({ results: [[{ transcript: "late", confidence: 0.9 }]] });
	expect(text).toHaveBeenCalledExactlyOnceWith("read");
	expect(track.stop).toHaveBeenCalled();
	expect(provider.abort).toHaveBeenCalled();
});
it.each(["", "noise"])("rejects silence/noise %s", async (transcript) => {
	await browserInput().listen(text, error, mute);
	provider.onresult!({ results: [[{ transcript, confidence: 0.2 }]] });
	expect(text).not.toHaveBeenCalled();
	expect(error).toHaveBeenCalled();
	expect(track.stop).toHaveBeenCalled();
});
it("times out silence and handles provider failure", async () => {
	const input = browserInput();
	await input.listen(text, error, mute);
	vi.advanceTimersByTime(15000);
	expect(error).toHaveBeenCalled();
	expect(track.stop).toHaveBeenCalled();
	await input.listen(text, error, mute);
	provider.onerror!();
	expect(error).toHaveBeenCalledTimes(2);
});
it("releases microphone on physical mute and interrupt", async () => {
	const input = browserInput();
	await input.listen(text, error, mute);
	track.onmute!();
	expect(mute).toHaveBeenCalledOnce();
	await input.listen(text, error, mute);
	input.finish();
	expect(provider.stop).toHaveBeenCalled();
	input.stop();
	expect(provider.onresult).toBeNull();
});
it("handles denied permission and unsupported browser", async () => {
	vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(new Error("denied"));
	await browserInput().listen(text, error, mute);
	expect(error).toHaveBeenCalledWith(expect.stringContaining("permission denied"));
	vi.stubGlobal("SpeechRecognition", undefined);
	await browserInput().listen(text, error, mute);
	expect(error).toHaveBeenCalledWith(expect.stringContaining("unavailable"));
});
it("stops late permission grants after interruption or release", async () => {
	let resolve!: (value: MediaStream) => void;
	vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementation(
		() =>
			new Promise((r) => {
				resolve = r;
			}),
	);
	const input = browserInput();
	const listening = input.listen(text, error, mute);
	input.stop();
	resolve({ getTracks: () => [track] } as unknown as MediaStream);
	await listening;
	expect(track.stop).toHaveBeenCalled();
	expect(text).not.toHaveBeenCalled();
});
it("never sends TTS to a remote voice, even after waiting for voices", async () => {
	vi.useFakeTimers();
	try {
		const speak = vi.fn(),
			fail = vi.fn();
		vi.stubGlobal("speechSynthesis", {
			getVoices: () => [{ localService: false, lang: "en-US" }],
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			speak,
		});
		browserOutput().speak("hello", vi.fn(), fail);
		await vi.advanceTimersByTimeAsync(1500);
		expect(fail).toHaveBeenCalledOnce();
		expect(speak).not.toHaveBeenCalled();
	} finally {
		vi.useRealTimers();
	}
});
it("fails at once without a speech engine", () => {
	vi.stubGlobal("speechSynthesis", undefined);
	const fail = vi.fn();
	browserOutput().speak("hello", vi.fn(), fail);
	expect(fail).toHaveBeenCalledOnce();
});
it("waits for voices that load after the first request", async () => {
	let voices: { localService: boolean; lang: string }[] = [];
	const listeners: (() => void)[] = [];
	const speak = vi.fn();
	vi.stubGlobal("speechSynthesis", {
		getVoices: () => voices,
		addEventListener: (_: string, listener: () => void) => listeners.push(listener),
		removeEventListener: vi.fn(),
		speak,
		cancel: vi.fn(),
	});
	vi.stubGlobal(
		"SpeechSynthesisUtterance",
		class {
			voice: unknown;
			constructor(public text: string) {}
		},
	);
	browserOutput().speak("banana", vi.fn(), vi.fn());
	expect(speak).not.toHaveBeenCalled();
	// A non-local voice arriving first is ignored; the local one is used.
	voices = [{ localService: false, lang: "en-US" }];
	listeners.forEach((listener) => listener());
	expect(speak).not.toHaveBeenCalled();
	voices = [{ localService: true, lang: "en-GB" }];
	listeners.forEach((listener) => listener());
	await vi.waitFor(() => expect(speak).toHaveBeenCalledOnce());
	expect(speak.mock.calls[0][0].text).toBe("banana");
});
it("speaks using a local English voice and exposes completion/failure", async () => {
	const voice = { localService: true, lang: "en-US" };
	const speak = vi.fn(),
		done = vi.fn(),
		fail = vi.fn(),
		cancel = vi.fn();
	vi.stubGlobal("speechSynthesis", { getVoices: () => [voice], speak, cancel });
	vi.stubGlobal(
		"SpeechSynthesisUtterance",
		class {
			voice: unknown;
			onend?: () => void;
			onerror?: () => void;
			constructor(public text: string) {}
		},
	);
	const output = browserOutput();
	output.speak("approved question", done, fail);
	await vi.waitFor(() => expect(speak).toHaveBeenCalledOnce());
	const utterance = speak.mock.calls[0][0];
	expect(utterance.voice).toBe(voice);
	expect(utterance.text).toBe("approved question");
	utterance.onend();
	expect(done).toHaveBeenCalledOnce();
	utterance.onerror();
	expect(fail).toHaveBeenCalledOnce();
	// A request stopped before its voice is ready never speaks.
	output.speak("stale", done, fail);
	output.stop();
	await Promise.resolve();
	expect(speak).toHaveBeenCalledOnce();
	expect(cancel).toHaveBeenCalledTimes(2);
});
it("chooses the clearest local English voice and skips joke voices", async () => {
	const speak = vi.fn();
	const voice = (name: string, lang = "en-US", extra: Partial<SpeechSynthesisVoice> = {}) => ({
		name,
		lang,
		localService: true,
		default: false,
		...extra,
	});
	const samantha = voice("Samantha (Enhanced)");
	vi.stubGlobal("speechSynthesis", {
		getVoices: () => [
			voice("Albert"),
			voice("Bad News"),
			voice("Bubbles"),
			voice("Fred"),
			voice("Daniel", "en-GB"),
			voice("Google US English", "en-US", { localService: false }),
			voice("Alex", "en-US", { default: true }),
			samantha,
		],
		speak,
		cancel: vi.fn(),
	});
	vi.stubGlobal(
		"SpeechSynthesisUtterance",
		class {
			voice: unknown;
			rate = 1;
			constructor(public text: string) {}
		},
	);
	browserOutput().speak("necessary", vi.fn(), vi.fn());
	await vi.waitFor(() => expect(speak).toHaveBeenCalledOnce());
	expect(speak.mock.calls[0][0].voice).toBe(samantha);
	expect(speak.mock.calls[0][0].rate).toBeLessThan(1);
});
it("falls back when only joke voices are installed", async () => {
	vi.useFakeTimers();
	try {
		const fail = vi.fn();
		vi.stubGlobal("speechSynthesis", {
			getVoices: () => [{ name: "Bubbles", lang: "en-US", localService: true }],
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			speak: vi.fn(),
		});
		browserOutput().speak("necessary", vi.fn(), fail);
		await vi.advanceTimersByTimeAsync(1500);
		expect(fail).toHaveBeenCalledOnce();
	} finally {
		vi.useRealTimers();
	}
});
it("does not treat being cut off by a newer word as a failure", async () => {
	const speak = vi.fn(),
		fail = vi.fn();
	vi.stubGlobal("speechSynthesis", {
		getVoices: () => [{ name: "Samantha", lang: "en-US", localService: true }],
		speak,
		cancel: vi.fn(),
	});
	vi.stubGlobal(
		"SpeechSynthesisUtterance",
		class {
			voice: unknown;
			rate = 1;
			onerror?: (event: { error: string }) => void;
			constructor(public text: string) {}
		},
	);
	browserOutput().speak("pear", vi.fn(), fail);
	await vi.waitFor(() => expect(speak).toHaveBeenCalledOnce());
	const utterance = speak.mock.calls[0][0];
	utterance.onerror({ error: "interrupted" });
	utterance.onerror({ error: "canceled" });
	expect(fail).not.toHaveBeenCalled();
	utterance.onerror({ error: "synthesis-failed" });
	expect(fail).toHaveBeenCalledOnce();
});
