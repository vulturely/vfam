import { afterEach, describe, expect, it, vi } from "vitest";
import {
	callService,
	type CallAdapter,
	type CallCommand,
	type CallEvent,
	type CallPlatform,
	type CallReply,
	type CallState,
} from "./service";

function fixture() {
	vi.useFakeTimers();
	const audio = { kind: "audio", enabled: true, stop: vi.fn() };
	const video = { kind: "video", enabled: true, stop: vi.fn() };
	const stream = {
		getTracks: () => [audio, video],
		getAudioTracks: () => [audio],
		getVideoTracks: () => [video],
	} as unknown as MediaStream;
	const peer = {
		addTrack: vi.fn(),
		close: vi.fn(),
		addIceCandidate: vi.fn(),
		createOffer: vi.fn(async () => ({ type: "offer", sdp: "offer" })),
		createAnswer: vi.fn(async () => ({ type: "answer", sdp: "answer" })),
		setLocalDescription: vi.fn(async () => {}),
		setRemoteDescription: vi.fn(async (sdp) => {
			peer.remoteDescription = sdp;
		}),
		remoteDescription: null as RTCSessionDescriptionInit | null,
		connectionState: "new",
		ontrack: null as ((e: { track: MediaStreamTrack }) => void) | null,
		onicecandidate: null as
			((e: { candidate: { toJSON(): RTCIceCandidateInit } | null }) => void) | null,
		onconnectionstatechange: null as (() => void) | null,
	};
	let events: CallEvent[] = [],
		failure = false;
	const iceServer = {
		urls: "turn:localhost:3478",
		username: "600:device",
		credential: "ephemeral",
	};
	const execute = vi.fn<(c: CallCommand) => Promise<CallReply>>(async (c) => {
		if (failure) throw new Error("Session revoked");
		switch (c.action) {
			case "register":
				return { device: "own", iceServer };
			case "invite":
				return { call: "call", iceServer };
			case "accept":
				return { iceServer };
			case "poll": {
				const batch = events;
				events = [];
				return {
					devices: [{ id: "peer", name: "Family", accountId: "parent", busy: false }],
					events: batch,
				};
			}
			default:
				return {};
		}
	});
	const adapter: CallAdapter = { execute };
	const platform = {
		media: vi.fn(async () => stream),
		peer: vi.fn(() => peer as unknown as RTCPeerConnection),
		stream: () => ({ addTrack: vi.fn(), getTracks: () => [] }) as unknown as MediaStream,
	} satisfies CallPlatform;
	const service = callService(adapter, platform);
	let state: CallState;
	service.subscribe((s) => {
		state = s;
	});
	return {
		service,
		platform,
		peer,
		stream,
		audio,
		video,
		execute,
		get state() {
			return state;
		},
		event(e: CallEvent) {
			events.push(e);
		},
		fail() {
			failure = true;
		},
	};
}
const target = { id: "peer", name: "Family", accountId: "parent", busy: false };
afterEach(() => {
	vi.useRealTimers();
});
async function flush() {
	await vi.advanceTimersByTimeAsync(500);
}

describe("family calls", () => {
	it("registers, polls, rings, negotiates relay-only audio and cleans all tracks", async () => {
		const f = fixture();
		await f.service.start("Desktop");
		await flush();
		expect(f.state.devices).toEqual([target]);
		await f.service.call(target, false);
		expect(f.platform.media).toHaveBeenCalledWith(false);
		expect(f.platform.peer).toHaveBeenCalledWith(
			expect.objectContaining({ iceTransportPolicy: "relay" }),
		);
		f.event({ type: "accepted", call: "call" });
		await flush();
		expect(f.peer.createOffer).toHaveBeenCalledOnce();
		expect(f.execute).toHaveBeenCalledWith(
			expect.objectContaining({ action: "signal", kind: "offer" }),
		);
		f.peer.onicecandidate?.({
			candidate: { toJSON: () => ({ candidate: "relay" }) },
		});
		await flush();
		expect(f.execute).toHaveBeenCalledWith(expect.objectContaining({ kind: "candidate" }));
		f.peer.connectionState = "connected";
		f.peer.onconnectionstatechange?.();
		expect(f.state.phase).toBe("connected");
		f.service.mute();
		expect(f.audio.enabled).toBe(false);
		f.service.mute();
		expect(f.audio.enabled).toBe(true);
		await f.service.hangup();
		expect(f.audio.stop).toHaveBeenCalledOnce();
		expect(f.video.stop).toHaveBeenCalledOnce();
		expect(f.peer.close).toHaveBeenCalledOnce();
		expect(f.state.phase).toBe("idle");
		f.service.close();
	});
	it("accepts video, buffers early ICE, answers and toggles camera", async () => {
		const f = fixture();
		await f.service.start("Desktop");
		f.event({ type: "ringing", call: "incoming", name: "Parent", video: true });
		await flush();
		expect(f.state.phase).toBe("ringing");
		expect(f.platform.media).not.toHaveBeenCalled();
		await f.service.accept();
		f.event({
			type: "signal",
			call: "incoming",
			kind: "candidate",
			payload: { candidate: "relay" } as RTCSessionDescriptionInit & RTCIceCandidateInit,
		});
		await flush();
		expect(f.peer.addIceCandidate).not.toHaveBeenCalled();
		f.event({
			type: "signal",
			call: "incoming",
			kind: "offer",
			payload: { type: "offer", sdp: "sdp" },
		});
		await flush();
		expect(f.peer.addIceCandidate).toHaveBeenCalledWith({ candidate: "relay" });
		expect(f.execute).toHaveBeenCalledWith(
			expect.objectContaining({ kind: "answer", call: "incoming" }),
		);
		f.service.camera();
		expect(f.video.enabled).toBe(false);
		expect(f.state.cameraOff).toBe(true);
		f.service.camera();
		expect(f.video.enabled).toBe(true);
		f.event({ type: "ended", call: "incoming", reason: "hangup" });
		await flush();
		expect(f.audio.stop).toHaveBeenCalledOnce();
		f.service.close();
	});
	it("rejects without acquiring media", async () => {
		const f = fixture();
		await f.service.start("Desktop");
		f.event({ type: "ringing", call: "incoming" });
		await flush();
		await f.service.hangup();
		expect(f.platform.media).not.toHaveBeenCalled();
		expect(f.execute).toHaveBeenCalledWith({
			action: "end",
			device: "own",
			call: "incoming",
		});
		f.service.close();
	});
	it("shows permission denial and does not invite or leak media", async () => {
		const f = fixture();
		await f.service.start("Desktop");
		f.platform.media.mockRejectedValueOnce(new Error("Permission denied"));
		await f.service.call(target, true);
		expect(f.state.error).toBe("Permission denied");
		expect(f.state.phase).toBe("idle");
		expect(f.execute.mock.calls.some(([c]) => c.action === "invite")).toBe(false);
		f.service.close();
	});
	it("cleans permission-granted tracks after cancellation during the prompt", async () => {
		const f = fixture();
		await f.service.start("Desktop");
		let resolve!: (s: MediaStream) => void;
		f.platform.media.mockReturnValueOnce(
			new Promise((r) => {
				resolve = r;
			}),
		);
		const pending = f.service.call(target, true);
		await f.service.hangup();
		resolve(f.stream);
		await pending;
		expect(f.audio.stop).toHaveBeenCalledOnce();
		expect(f.execute.mock.calls.some(([c]) => c.action === "invite")).toBe(false);
		f.service.close();
	});
	it("handles busy server response and cleans tracks", async () => {
		const f = fixture();
		await f.service.start("Desktop");
		f.execute.mockImplementationOnce(async () => {
			throw new Error("Busy");
		});
		await f.service.call(target, false);
		expect(f.state.error).toBe("Busy");
		expect(f.audio.stop).toHaveBeenCalledOnce();
		f.service.close();
	});
	it("times out unanswered calls", async () => {
		const f = fixture();
		await f.service.start("Desktop");
		await f.service.call(target, false);
		await vi.advanceTimersByTimeAsync(30000);
		expect(f.state.phase).toBe("idle");
		expect(f.state.notice).toBe("No answer.");
		expect(f.peer.close).toHaveBeenCalledOnce();
		f.service.close();
	});
	it("keeps an accepted call beyond ringing timeout and enforces ten minutes", async () => {
		const f = fixture();
		await f.service.start("Desktop");
		await f.service.call(target, false);
		f.event({ type: "accepted", call: "call" });
		await flush();
		await vi.advanceTimersByTimeAsync(31000);
		expect(f.state.phase).toBe("connecting");
		await vi.advanceTimersByTimeAsync(570000);
		expect(f.state.phase).toBe("idle");
		f.service.close();
	});
	it("disconnect and revoked session stop media and polling", async () => {
		const f = fixture();
		await f.service.start("Desktop");
		await f.service.call(target, true);
		f.fail();
		await flush();
		expect(f.state.available).toBe(false);
		expect(f.state.error).toBe("Session revoked");
		expect(f.audio.stop).toHaveBeenCalledOnce();
		const count = f.execute.mock.calls.length;
		await flush();
		expect(f.execute.mock.calls.length).toBe(count);
	});
	it("peer connection loss hangs up and releases camera", async () => {
		const f = fixture();
		await f.service.start("Desktop");
		await f.service.call(target, true);
		f.peer.connectionState = "disconnected";
		f.peer.onconnectionstatechange?.();
		await flush();
		expect(f.state.phase).toBe("idle");
		expect(f.video.stop).toHaveBeenCalledOnce();
		f.service.close();
	});
	it("ignores signals for another call and queues events during accept", async () => {
		const f = fixture();
		await f.service.start("Desktop");
		f.event({ type: "ringing", call: "incoming", video: false });
		await flush();
		let resolve!: (s: MediaStream) => void;
		f.platform.media.mockReturnValueOnce(
			new Promise((r) => {
				resolve = r;
			}),
		);
		const pending = f.service.accept();
		f.event({
			type: "signal",
			call: "incoming",
			kind: "offer",
			payload: { type: "offer", sdp: "sdp" },
		});
		await flush();
		resolve(f.stream);
		await pending;
		expect(f.peer.createAnswer).toHaveBeenCalledOnce();
		f.event({ type: "ended", call: "another" });
		await flush();
		expect(f.state.phase).toBe("connecting");
		f.service.close();
	});
	it("leaves late device registration when screen closes", async () => {
		const f = fixture();
		let resolve!: (r: CallReply) => void;
		f.execute.mockReturnValueOnce(
			new Promise((r) => {
				resolve = r as unknown as (value: CallReply) => void;
			}),
		);
		const pending = f.service.start("Desktop");
		f.service.close();
		resolve({ device: "late" });
		await pending;
		expect(f.execute).toHaveBeenCalledWith({ action: "leave", device: "late" });
		expect(f.state.available).toBe(false);
	});
});

it("ends a late invitation with its original lease after disabling calls", async () => {
	const f = fixture();
	await f.service.start("Desktop");
	await flush();
	let resolve!: (value: CallReply) => void;
	f.execute.mockImplementationOnce(async (c) => {
		expect(c.action).toBe("invite");
		return new Promise((r) => {
			resolve = r as unknown as (value: CallReply) => void;
		});
	});
	const pending = f.service.call(target, true);
	await Promise.resolve();
	await Promise.resolve();
	f.service.close();
	resolve({ call: "late-call" });
	await pending;
	expect(f.execute).toHaveBeenCalledWith({
		action: "end",
		device: "own",
		call: "late-call",
	});
	expect(f.audio.stop).toHaveBeenCalledOnce();
	expect(f.state.available).toBe(false);
});
it("ignores a canceled peer's late SDP failure and stays available", async () => {
	const f = fixture();
	await f.service.start("Desktop");
	await f.service.call(target, false);
	let reject!: (reason: Error) => void;
	f.peer.setLocalDescription.mockImplementationOnce(
		() =>
			new Promise((_r, j) => {
				reject = j;
			}),
	);
	f.event({ type: "accepted", call: "call" });
	const polling = vi.advanceTimersByTimeAsync(500);
	for (let i = 0; i < 10 && !reject; i++) await Promise.resolve();
	// Wait for the timer callback's asynchronous SDP operation to start.
	await vi.waitFor(() => expect(reject).toBeDefined(), { interval: 1 });
	await f.service.hangup();
	reject(new Error("Peer closed during SDP"));
	await polling;
	expect(f.state.available).toBe(true);
	expect(f.state.phase).toBe("idle");
	expect(f.state.error).toBe("");
	f.service.close();
});

it("explains unavailable media APIs without inviting or acquiring tracks", async () => {
	vi.useFakeTimers();
	const execute = vi.fn(async (c: CallCommand) =>
		c.action === "register" ? { device: "own" } : { devices: [], events: [] },
	);
	const service = callService({ execute });
	let error = "";
	service.subscribe((s) => {
		error = s.error;
	});
	await service.start("Desktop");
	await service.call(target, true);
	expect(error).toContain("secure HTTPS window");
	expect(execute.mock.calls.some(([c]) => c.action === "invite")).toBe(false);
	service.close();
});

it("reports missing registration, invitation, and relay responses without leaking media", async () => {
	const first = fixture();
	first.execute.mockResolvedValueOnce({});
	await expect(first.service.start("Desktop")).rejects.toThrow("Device registration failed.");
	first.service.close();

	const second = fixture();
	await second.service.start("Desktop");
	second.execute.mockImplementation(async (command): Promise<CallReply> => {
		if (command.action === "invite") return {};
		if (command.action === "register") return { device: "own" };
		return {};
	});
	await second.service.call(target, false);
	expect(second.state.error).toBe("Call invitation failed.");
	expect(second.audio.stop).toHaveBeenCalledOnce();
	second.service.close();

	const third = fixture();
	await third.service.start("Desktop");
	third.execute.mockImplementation(async (command): Promise<CallReply> => {
		if (command.action === "invite") return { call: "call", iceServer: undefined };
		if (command.action === "register") return { device: "own" };
		return {};
	});
	await third.service.call(target, false);
	expect(third.state.error).toBe("TURN credentials unavailable.");
	expect(third.audio.stop).toHaveBeenCalledOnce();
	third.service.close();
});

it("forwards remote tracks and cleans up peer and signaling failures", async () => {
	const f = fixture();
	await f.service.start("Desktop");
	await f.service.call(target, false);
	const track = {} as MediaStreamTrack;
	f.peer.ontrack?.({ track });
	expect(f.state.remote).toBeDefined();
	f.peer.connectionState = "failed";
	f.peer.onconnectionstatechange?.();
	await vi.waitFor(() => expect(f.state.notice).toBe("Call disconnected."));
	expect(f.audio.stop).toHaveBeenCalledOnce();
	f.service.close();
});
