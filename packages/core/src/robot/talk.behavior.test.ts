import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startBuddyTalk } from "./talk";

vi.mock("./mediaCandidates", () => ({
	gatherMediaCandidates: vi.fn().mockResolvedValue(undefined),
}));

const peers: MockPeer[] = [];
class MockPeer {
	localDescription: { sdp: string } | null = null;
	remoteDescription: object | null = null;
	connectionState = "connected";
	ontrack: ((event: { track: MediaStreamTrack }) => void) | null = null;
	onconnectionstatechange: (() => void) | null = null;
	addTrack = vi.fn();
	addTransceiver = vi.fn();
	close = vi.fn();
	setRemoteDescription = vi.fn(async (description: object) => {
		this.remoteDescription = description;
	});
	createOffer = vi.fn(async () => ({ sdp: "offer" }));
	setLocalDescription = vi.fn(async (description: { sdp: string }) => {
		this.localDescription = description;
	});
	constructor(public configuration: object) {
		peers.push(this);
	}
}
class MockStream {
	tracks: MediaStreamTrack[] = [];
	addTrack(track: MediaStreamTrack) {
		this.tracks.push(track);
	}
}

beforeEach(() => {
	peers.length = 0;
	vi.stubGlobal("RTCPeerConnection", MockPeer);
	vi.stubGlobal("MediaStream", MockStream);
});
afterEach(() => vi.unstubAllGlobals());

function track() {
	return { stop: vi.fn(), onended: null } as unknown as MediaStreamTrack;
}

it("connects audio, forwards media, and releases every resource on failure and stop", async () => {
	const microphoneTrack = track();
	const incomingTrack = track();
	const getUserMedia = vi.fn(async () => ({
		getTracks: () => [microphoneTrack],
		getAudioTracks: () => [microphoneTrack],
	}));
	vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
	const command = vi.fn().mockRejectedValue(new Error("already stopped"));
	const onAudio = vi.fn();
	const onError = vi.fn();
	const service = {
		command,
		watch: vi.fn(),
		iceServers: async () => [{ urls: "turn:media" }],
		openTalk: vi.fn(async function* () {
			yield { session: "session", answer: "answer" };
			await new Promise<void>(() => {});
		}),
	};
	const stop = await startBuddyTalk(service, "device", { onAudio, onError });
	const peer = peers[0];
	expect(peer.configuration).toMatchObject({ iceTransportPolicy: "relay" });
	expect(peer.addTrack).toHaveBeenCalled();
	peer.ontrack?.({ track: incomingTrack });
	expect(onAudio).toHaveBeenCalledWith(expect.objectContaining({ tracks: [incomingTrack] }));
	peer.connectionState = "disconnected";
	peer.onconnectionstatechange?.();
	await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
	await stop();
	expect(microphoneTrack.stop).toHaveBeenCalledOnce();
	expect(peer.close).toHaveBeenCalledOnce();
	expect(command).toHaveBeenCalledWith({
		action: "stop_talk",
		device: "device",
		session: "session",
	});
	await vi.waitFor(() => expect(onAudio).toHaveBeenLastCalledWith(null));
});

it("uses receive-only video transceivers without opening the microphone", async () => {
	const getUserMedia = vi.fn();
	vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
	const service = {
		command: vi.fn(),
		watch: vi.fn(),
		openTalk: vi.fn(async function* () {
			yield { session: "session", answer: "answer" };
		}),
	};
	const stop = await startBuddyTalk(service, "device", { video: true, onError: vi.fn() });
	expect(getUserMedia).not.toHaveBeenCalled();
	expect(peers[0].addTransceiver).toHaveBeenCalledWith("audio", { direction: "recvonly" });
	expect(peers[0].addTransceiver).toHaveBeenCalledWith("video", { direction: "recvonly" });
	await stop();
});

it("cleans up failed offers and reports signaling failures", async () => {
	vi.stubGlobal("navigator", {
		mediaDevices: { getUserMedia: async () => ({ getTracks: () => [], getAudioTracks: () => [] }) },
	});
	peers.length = 0;
	const originalPeer = globalThis.RTCPeerConnection;
	vi.stubGlobal(
		"RTCPeerConnection",
		class extends MockPeer {
			createOffer = vi.fn(async () => ({ sdp: "offer" }));
			setLocalDescription = vi.fn(async () => {
				this.localDescription = null;
			});
		},
	);
	const onError = vi.fn();
	await expect(
		startBuddyTalk({ command: vi.fn(), watch: vi.fn(), openTalk: vi.fn() }, "device", { onError }),
	).rejects.toThrow("Unable to prepare live audio");
	vi.stubGlobal("RTCPeerConnection", originalPeer);
	const openTalk = vi.fn(async function* () {
		yield { session: "session" };
		throw new Error("Signaling denied");
	});
	await expect(
		startBuddyTalk({ command: vi.fn(), watch: vi.fn(), openTalk }, "device", { onError }),
	).rejects.toThrow("Signaling denied");
	expect(onError).toHaveBeenCalledOnce();
});
