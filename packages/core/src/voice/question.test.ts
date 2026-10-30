import { expect, it, vi } from "vitest";
import type { SpeechOutput } from "./browser";
import type { AudioPlayer } from "./player";
import { questionOutput } from "./question";

const sound = { audio: new Uint8Array([82, 73, 70, 70]), contentType: "audio/wav" };
function device(): SpeechOutput {
	return { speak: vi.fn((_t, done) => done()), stop: vi.fn() };
}
function player(play: AudioPlayer["play"] = vi.fn(async () => {})): AudioPlayer {
	return { play: vi.fn(play), stop: vi.fn() };
}

it("plays the server's word and fetches it only once", async () => {
	const load = vi.fn(async () => sound);
	const speaker = player();
	const fallback = device();
	const voice = questionOutput(load, fallback, speaker);
	const done = vi.fn();
	voice.speak("banana", done, vi.fn());
	await vi.waitFor(() => expect(done).toHaveBeenCalledOnce());
	voice.speak("banana", done, vi.fn());
	await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(2));
	expect(load).toHaveBeenCalledOnce();
	expect(speaker.play).toHaveBeenCalledWith(sound.audio, "audio/wav");
	expect(fallback.speak).not.toHaveBeenCalled();
});

it("uses the device voice when the server or playback cannot help", async () => {
	const offline = device();
	const done = vi.fn();
	questionOutput(async () => Promise.reject(new Error("unavailable")), offline, player()).speak(
		"banana",
		done,
		vi.fn(),
	);
	await vi.waitFor(() => expect(offline.speak).toHaveBeenCalledOnce());
	expect(done).toHaveBeenCalledOnce();
	const blocked = device();
	questionOutput(
		async () => sound,
		blocked,
		player(async () => Promise.reject(new Error("blocked"))),
	).speak("banana", vi.fn(), vi.fn());
	await vi.waitFor(() => expect(blocked.speak).toHaveBeenCalledOnce());
});

it("stops both voices and ignores a word that was stopped or replaced", async () => {
	let resolve!: (value: typeof sound) => void;
	const load = vi.fn(() => new Promise<typeof sound>((r) => (resolve = r)));
	const speaker = player();
	const fallback = device();
	const voice = questionOutput(load, fallback, speaker);
	const done = vi.fn();
	voice.speak("banana", done, vi.fn());
	voice.stop();
	expect(speaker.stop).toHaveBeenCalled();
	expect(fallback.stop).toHaveBeenCalled();
	resolve(sound);
	await Promise.resolve();
	await Promise.resolve();
	expect(speaker.play).not.toHaveBeenCalled();
	expect(done).not.toHaveBeenCalled();
	// A failed load for a replaced word does not start the device voice either.
	let reject!: (error: Error) => void;
	const failing = questionOutput(
		() => new Promise((_r, rejectWith) => (reject = rejectWith)),
		fallback,
		speaker,
	);
	failing.speak("pear", vi.fn(), vi.fn());
	failing.stop();
	reject(new Error("offline"));
	await Promise.resolve();
	expect(fallback.speak).not.toHaveBeenCalled();
});
