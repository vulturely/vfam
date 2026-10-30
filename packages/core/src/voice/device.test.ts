import { expect, it, vi } from "vitest";
import type { SpeechOutput } from "./browser";
import { deviceOutput } from "./device";

function browser(works = true): SpeechOutput {
	return {
		speak: vi.fn((_text, done, fail) => (works ? done() : fail())),
		stop: vi.fn(),
	};
}
function native(speak: () => Promise<void> = async () => {}, available = true) {
	return { available: () => available, speak: vi.fn(speak), stop: vi.fn(async () => {}) };
}

it("speaks with the system voice only, never also with the web voice", async () => {
	const web = browser();
	const system = native();
	const done = vi.fn();
	deviceOutput(web, system).speak("apple", done, vi.fn());
	expect(system.speak).toHaveBeenCalledWith("apple");
	await vi.waitFor(() => expect(done).toHaveBeenCalledOnce());
	expect(web.speak).not.toHaveBeenCalled();
});

it("uses the web voice when the system voice cannot start", async () => {
	const web = browser();
	const done = vi.fn();
	deviceOutput(
		web,
		native(async () => Promise.reject(new Error("no voice"))),
	).speak("apple", done, vi.fn());
	await vi.waitFor(() => expect(web.speak).toHaveBeenCalledOnce());
	expect(done).toHaveBeenCalledOnce();
});

it("does not repeat a word with the web voice once the system voice has started", async () => {
	const web = browser();
	const fail = vi.fn();
	deviceOutput(
		web,
		native(async () =>
			Promise.reject({ kind: "aborted", message: "The device voice could not speak." }),
		),
	).speak("apple", vi.fn(), fail);
	await vi.waitFor(() => expect(fail).toHaveBeenCalledOnce());
	expect(web.speak).not.toHaveBeenCalled();
});

it("uses the web voice outside the desktop app and reports when nothing can speak", () => {
	const web = browser(false);
	const system = native(async () => {}, false);
	const fail = vi.fn();
	deviceOutput(web, system).speak("apple", vi.fn(), fail);
	expect(system.speak).not.toHaveBeenCalled();
	expect(fail).toHaveBeenCalledOnce();
});

it("stops both voices, and a stopped word neither finishes nor falls back", async () => {
	const pending: { finish: () => void; reject: (error: Error) => void }[] = [];
	const web = browser();
	const system = native(
		() =>
			new Promise<void>((finish, reject) => {
				pending.push({ finish, reject });
			}),
	);
	const done = vi.fn();
	const output = deviceOutput(web, system);
	output.speak("apple", done, vi.fn());
	output.stop();
	expect(web.stop).toHaveBeenCalled();
	expect(system.stop).toHaveBeenCalled();
	pending[0].finish();
	await Promise.resolve();
	expect(done).not.toHaveBeenCalled();
	output.speak("pear", done, vi.fn());
	output.speak("plum", done, vi.fn());
	// "pear" was replaced by "plum": its failure must not start the web voice.
	pending[1].reject(new Error("replaced"));
	await Promise.resolve();
	expect(web.speak).not.toHaveBeenCalled();
	pending[2].finish();
	await vi.waitFor(() => expect(done).toHaveBeenCalledOnce());
	// Outside the desktop app there is no system voice to stop.
	const plain = native(async () => {}, false);
	deviceOutput(browser(), plain).stop();
	expect(plain.stop).not.toHaveBeenCalled();
});
