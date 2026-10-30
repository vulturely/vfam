import { beforeEach, expect, it, vi } from "vitest";
import { createRemoteBuddy } from "./service";
import type { RemotePair } from "./crypto";

const mocks = vi.hoisted(() => ({
	publish: vi.fn(),
	watch: vi.fn(),
	seal: vi.fn(),
	open: vi.fn(),
	release: vi.fn(),
	relay: vi.fn(),
	signalingReceive: vi.fn(),
	signalingDisconnect: vi.fn(),
}));
vi.mock("./client", () => ({
	relayClient: () => ({ publishEnvelope: mocks.publish, watchEnvelopes: mocks.watch }),
	parentHeaders: vi.fn(async () => ({ authorization: "Bearer parent" })),
}));
vi.mock("./crypto", () => ({
	remoteCrypto: () => ({ seal: mocks.seal, open: mocks.open }),
}));
vi.mock("../../api/fambuddy/fambuddyStorage", () => ({
	acquireFamBuddyRelay: vi.fn(async () => mocks.release),
}));
vi.mock("../onboarding/registry", () => ({ getMediaRelay: mocks.relay }));
vi.mock("./media", () => ({
	mediaSignaling: () => ({
		receive: mocks.signalingReceive,
		disconnect: mocks.signalingDisconnect,
		open: vi.fn(),
	}),
}));

const pair = {
	origin: "https://relay.example",
	own: { accountId: "account" },
	account: "account",
	binding: { family: "family", device: "device", channel: "channel" },
} as RemotePair;
const auth = { getAccessToken: vi.fn(async () => "vps_parent") };
const output = { settings: [], turns: [] };

beforeEach(() => {
	vi.clearAllMocks();
	mocks.seal.mockResolvedValue({ id: "message", ciphertext: new Uint8Array([1]) });
	mocks.publish.mockResolvedValue({});
	mocks.release.mockResolvedValue(undefined);
});

it("waits for readiness, matches command replies, and releases the relay", async () => {
	const service = createRemoteBuddy(pair, auth, () => "local-token");
	await expect(service.command({ action: "list", family: "family" })).rejects.toThrow(
		"Reconnect remote approvals",
	);
	mocks.open.mockResolvedValueOnce({ output }).mockResolvedValueOnce({
		request: "message",
		output: { ...output, talk: "session" },
	});
	mocks.watch.mockReturnValue(
		(async function* () {
			yield { ready: true, ciphertext: new Uint8Array() };
			yield { ciphertext: new Uint8Array([2]) };
			await vi.waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(2));
			yield { ciphertext: new Uint8Array([3]) };
		})(),
	);
	const watching = service.watch("family", new AbortController().signal)[Symbol.asyncIterator]();
	expect((await watching.next()).value).toEqual(output);
	const command = service.command({ action: "list", family: "family" });
	const finished = watching.next();
	expect(await command).toEqual({ ...output, talk: "session" });
	expect((await finished).done).toBe(true);
	expect(mocks.release).toHaveBeenCalledOnce();
	expect(mocks.signalingDisconnect).toHaveBeenCalled();
});

it("maps registered media credentials and rejects mismatched households", async () => {
	mocks.relay.mockResolvedValue({
		urls: ["turn:media"],
		username: "user",
		credential: "secret",
	});
	const service = createRemoteBuddy(pair, auth, () => "token", "registration");
	expect(await service.iceServers?.()).toEqual([
		{ urls: ["turn:media"], username: "user", credential: "secret" },
	]);
	await expect(async () => {
		for await (const _output of service.watch("other", new AbortController().signal)) {
			void _output;
		}
	}).rejects.toThrow("Remote household mismatch");
	const unregistered = createRemoteBuddy(pair, auth, () => "token");
	await expect(unregistered.iceServers?.()).rejects.toThrow("Register this device");
	expect(() => unregistered.openTalk("device", "offer", new AbortController().signal)).toThrow(
		"Register this device",
	);
});
