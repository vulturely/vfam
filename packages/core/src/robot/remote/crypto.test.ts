import { beforeEach, expect, it, vi } from "vitest";
import { remoteCrypto, type RemotePair } from "./crypto";
const mocks = vi.hoisted(() => ({ execute: vi.fn(), close: vi.fn() }));
const { execute } = mocks;
vi.mock("../../api/fambuddy/fambuddyStorage", () => ({
	famBuddyCrypto: () => mocks,
}));
const pair = {
	origin: "https://relay.example",
	account: "parent",
	binding: { channel: "channel", device: "device", family: "family" },
	peer: {
		accountId: "device-account",
		deviceId: "device-key",
		fingerprint: "pin",
		keyPackage: "public",
	},
	own: {
		accountId: "parent",
		deviceId: "parent-key",
		fingerprint: "parent-pin",
		keyPackage: "parent-public",
	},
} satisfies RemotePair;
function envelope() {
	return {
		version: 1,
		binding: pair.binding,
		id: "12345678-1234-1234-1234-123456789abc",
		expires_at: Date.now() + 30_000,
		payload: { output: { settings: [], turns: [] } },
	};
}
function response(value: unknown, senderId = pair.peer.accountId, deviceId = pair.peer.deviceId) {
	execute.mockResolvedValueOnce({
		senderId,
		deviceId,
		plaintext: JSON.stringify(value),
	});
}
beforeEach(() => vi.resetAllMocks());
it("accepts only the pinned sender and exact channel, family and device", async () => {
	const engine = remoteCrypto(pair.origin);
	response(envelope());
	await expect(engine.open(pair, new Uint8Array([1]))).resolves.toEqual(envelope().payload);
	response(envelope(), "other-parent");
	await expect(engine.open(pair, new Uint8Array([1]))).rejects.toThrow("Unrecognized");
	response(envelope(), pair.peer.accountId, "other-key");
	await expect(engine.open(pair, new Uint8Array([1]))).rejects.toThrow("Unrecognized");
	for (const field of ["channel", "family", "device"] as const) {
		response({ ...envelope(), binding: { ...pair.binding, [field]: "wrong" } });
		await expect(engine.open(pair, new Uint8Array([1]))).rejects.toThrow("binding");
	}
});
it("rejects absent, malformed and expired lifetimes", async () => {
	const engine = remoteCrypto(pair.origin);
	for (const expires_at of [
		undefined,
		null,
		"tomorrow",
		Date.now(),
		Date.now() - 1,
		Date.now() + 60_000,
	]) {
		response({ ...envelope(), expires_at });
		await expect(engine.open(pair, new Uint8Array([1]))).rejects.toThrow("expired");
	}
	response({ ...envelope(), id: "" });
	await expect(engine.open(pair, new Uint8Array([1]))).rejects.toThrow("invalid");
});
it("bounds encrypted responses before invoking MLS", async () => {
	const engine = remoteCrypto(pair.origin);
	await expect(engine.open(pair, new Uint8Array())).rejects.toThrow("Invalid");
	await expect(engine.open(pair, new Uint8Array(131_073))).rejects.toThrow("Invalid");
	expect(execute).not.toHaveBeenCalled();
});

it("creates identities and joins encrypted rooms", async () => {
	execute
		.mockResolvedValueOnce({ deviceId: "key", fingerprint: "pin", keyPackages: ["package"] })
		.mockResolvedValueOnce({});
	const engine = remoteCrypto(pair.origin);

	await expect(engine.identity("parent")).resolves.toEqual({
		accountId: "parent",
		deviceId: "key",
		fingerprint: "pin",
		keyPackage: "package",
	});
	await engine.join(pair, "welcome");
	expect(execute).toHaveBeenNthCalledWith(2, "parent", {
		action: "join",
		roomId: "channel",
		generation: 1,
		roster: [pair.own, pair.peer],
		welcome: "welcome",
	});
	engine.close();
	expect(mocks.close).toHaveBeenCalledOnce();
});

it("seals bounded payloads and returns encrypted bytes", async () => {
	execute.mockResolvedValue({ ciphertext: btoa("encrypted") });
	const engine = remoteCrypto(pair.origin);
	const result = await engine.seal(pair, { action: "status" });

	expect(new TextDecoder().decode(result.ciphertext)).toBe("encrypted");
	expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
	expect(execute).toHaveBeenCalledWith(
		"parent",
		expect.objectContaining({ action: "encrypt", roomId: "channel", generation: 1 }),
	);
	const request = execute.mock.calls[0][1];
	expect(JSON.parse(request.plaintext).payload).toEqual({ action: "status" });
});

it("rejects oversized remote requests before encryption", async () => {
	const engine = remoteCrypto(pair.origin);
	await expect(engine.seal(pair, "x".repeat(100_001))).rejects.toThrow(
		"Remote request is too large.",
	);
	expect(execute).not.toHaveBeenCalled();
});
