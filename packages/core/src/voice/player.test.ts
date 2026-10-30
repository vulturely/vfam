import { afterEach, expect, it, vi } from "vitest";
import { audioPlayer } from "./player";

class FakeAudio {
	static last: FakeAudio;
	onended: (() => void) | null = null;
	onerror: (() => void) | null = null;
	pause = vi.fn();
	play = vi.fn(async () => {});
	constructor(public src: string) {
		FakeAudio.last = this;
	}
}
afterEach(() => vi.unstubAllGlobals());

it("plays audio, frees it when finished and stops the previous sound", async () => {
	vi.stubGlobal("Audio", FakeAudio);
	const revoke = vi.spyOn(URL, "revokeObjectURL");
	const player = audioPlayer();
	const first = player.play(new Uint8Array([1]), "audio/wav");
	const firstAudio = FakeAudio.last;
	expect(firstAudio.src).toMatch(/^blob:/);
	// A new sound stops the first one, which then counts as finished.
	const second = player.play(new Uint8Array([2]), "audio/wav");
	await expect(first).resolves.toBeUndefined();
	expect(firstAudio.pause).toHaveBeenCalled();
	FakeAudio.last.onended!();
	await expect(second).resolves.toBeUndefined();
	expect(revoke).toHaveBeenCalledTimes(2);
	player.stop();
});

it("reports audio that cannot be played", async () => {
	vi.stubGlobal("Audio", FakeAudio);
	const player = audioPlayer();
	const broken = player.play(new Uint8Array([1]), "audio/wav");
	FakeAudio.last.onerror!();
	await expect(broken).rejects.toThrow("could not be played");
	class BlockedAudio extends FakeAudio {
		play = vi.fn(async () => Promise.reject(new Error("NotAllowedError")));
	}
	vi.stubGlobal("Audio", BlockedAudio);
	await expect(player.play(new Uint8Array([1]), "audio/wav")).rejects.toThrow(
		"could not be played",
	);
});
