import { afterEach, expect, it, vi } from "vitest";
import { gatherMediaCandidates } from "./mediaCandidates";

function connection(relayOnly = true) {
	const peer = Object.assign(new EventTarget(), {
		iceGatheringState: "gathering",
		localDescription: { sdp: "" },
		getConfiguration: () => ({
			iceTransportPolicy: relayOnly ? "relay" : "all",
		}),
	});
	return {
		peer,
		gather: (signal = new AbortController().signal) =>
			gatherMediaCandidates(peer as unknown as RTCPeerConnection, signal),
		candidate: (type = "relay") => {
			peer.localDescription.sdp = `a=candidate:1 1 udp 1 192.0.2.1 10000 typ ${type}\r\n`;
		},
		complete: () => {
			peer.iceGatheringState = "complete";
			peer.dispatchEvent(new Event("icegatheringstatechange"));
		},
	};
}
afterEach(() => vi.useRealTimers());

it("waits beyond five seconds for a delayed relay candidate", async () => {
	vi.useFakeTimers();
	const call = connection();
	const resolved = vi.fn();
	const result = call.gather().then(resolved);
	await vi.advanceTimersByTimeAsync(6000);
	expect(resolved).not.toHaveBeenCalled();
	call.candidate();
	call.complete();
	await result;
	expect(resolved).toHaveBeenCalledOnce();
	expect(vi.getTimerCount()).toBe(0);
});

it("uses a gathered relay when another TURN endpoint never finishes", async () => {
	vi.useFakeTimers();
	const call = connection();
	call.candidate();
	const result = call.gather();
	await vi.advanceTimersByTimeAsync(15000);
	await expect(result).resolves.toBeUndefined();
	expect(vi.getTimerCount()).toBe(0);
});

it.each(["", "host"])("rejects without a relay candidate (%s)", async (type) => {
	vi.useFakeTimers();
	const call = connection();
	if (type) call.candidate(type);
	const result = expect(call.gather()).rejects.toThrow("Check your network and retry");
	await vi.advanceTimersByTimeAsync(15000);
	await result;
});

it("accepts local candidates only when relay-only policy is disabled", async () => {
	const call = connection(false);
	call.candidate("host");
	call.complete();
	await expect(call.gather()).resolves.toBeUndefined();
});

it("rejects completed gathering without any route", async () => {
	const call = connection();
	call.complete();
	await expect(call.gather()).rejects.toThrow("Check your network and retry");
});

it("cancels immediately and removes listeners and timers", async () => {
	vi.useFakeTimers();
	const call = connection();
	const remove = vi.spyOn(call.peer, "removeEventListener");
	const abort = new AbortController();
	const result = expect(call.gather(abort.signal)).rejects.toThrow("Live talk cancelled");
	abort.abort();
	await result;
	expect(remove).toHaveBeenCalledWith("icegatheringstatechange", expect.any(Function));
	expect(vi.getTimerCount()).toBe(0);
	await expect(call.gather(abort.signal)).rejects.toThrow("Live talk cancelled");
});
