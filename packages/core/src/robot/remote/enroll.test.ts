import { beforeEach, expect, it, vi } from "vitest";
import { enrollRemote, revokeRemote } from "./enroll";
import type { RemotePair } from "./crypto";

const mocks = vi.hoisted(() => ({
	createChannel: vi.fn(),
	revokeChannel: vi.fn(),
	enableRemote: vi.fn(),
	disableRemote: vi.fn(),
	identity: vi.fn(),
	join: vi.fn(),
	close: vi.fn(),
}));

vi.mock("./client", () => ({
	relayOrigin: (server: string) => new URL(server).origin,
	relayClient: () => ({
		createChannel: mocks.createChannel,
		revokeChannel: mocks.revokeChannel,
	}),
	parentHeaders: async () => ({ authorization: "Bearer parent" }),
}));
vi.mock("../buddy-gateway", () => ({
	gatewayClient: () => ({
		enableRemote: mocks.enableRemote,
		disableRemote: mocks.disableRemote,
	}),
}));
vi.mock("./crypto", () => ({
	remoteCrypto: () => ({
		identity: mocks.identity,
		join: mocks.join,
		close: mocks.close,
	}),
}));

const setup = {
	gateway: "http://127.0.0.1:50051",
	token: "device-token",
	family: "family",
	device: "device",
	owner: "parent",
	server: "https://relay.example",
	auth: { getAccessToken: async () => "vps_parent" },
};
const own = {
	accountId: "fambuddy-parent:parent:channel",
	deviceId: "parent-key",
	fingerprint: "parent-fingerprint",
	keyPackage: "parent-package",
};
const peer = {
	accountId: "device-account",
	deviceId: "device-key",
	fingerprint: "device-fingerprint",
	keyPackage: "device-package",
};

beforeEach(() => {
	vi.resetAllMocks();
	mocks.createChannel.mockResolvedValue({ channel: "channel", deviceCredential: "credential" });
	mocks.identity.mockResolvedValue(own);
	mocks.enableRemote.mockResolvedValue({ devicePeer: peer, welcome: "welcome" });
});

it("creates, joins and returns a device-bound remote pair", async () => {
	const pair = await enrollRemote(setup);

	expect(pair).toEqual({
		origin: "https://relay.example",
		account: "fambuddy-parent:parent:channel",
		own,
		peer,
		binding: { channel: "channel", family: "family", device: "device" },
	});
	expect(mocks.enableRemote).toHaveBeenCalledWith(
		{
			device: "device",
			channel: "channel",
			origin: "https://relay.example",
			deviceCredential: "credential",
			peer: own,
		},
		{ headers: { authorization: "Bearer device-token" }, timeoutMs: 10_000 },
	);
	expect(mocks.join).toHaveBeenCalledWith(pair, "welcome");
	expect(mocks.close).toHaveBeenCalledOnce();
	expect(mocks.disableRemote).not.toHaveBeenCalled();
});

it("rolls back local and relay enrollment when the device key is missing", async () => {
	mocks.enableRemote.mockResolvedValue({ welcome: "welcome" });

	await expect(enrollRemote(setup)).rejects.toThrow(
		"Device did not provide a remote approval key.",
	);
	expect(mocks.disableRemote).toHaveBeenCalledWith(
		{ channel: "channel" },
		{ headers: { authorization: "Bearer device-token" }, timeoutMs: 10_000 },
	);
	expect(mocks.revokeChannel).toHaveBeenCalledWith(
		{ channel: "channel" },
		{ headers: { authorization: "Bearer parent" }, timeoutMs: 5000 },
	);
	expect(mocks.close).toHaveBeenCalledOnce();
});

it("revokes a remote pair with parent authentication", async () => {
	const pair = {
		origin: "https://relay.example",
		account: "parent",
		own,
		peer,
		binding: { channel: "channel", family: "family", device: "device" },
	} satisfies RemotePair;

	await revokeRemote(pair, setup.auth);
	expect(mocks.revokeChannel).toHaveBeenCalledWith(
		{ channel: "channel" },
		{ headers: { authorization: "Bearer parent" }, timeoutMs: 5000 },
	);
});
