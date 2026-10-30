import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enrollRegistered } from "./enroll";

const mocks = vi.hoisted(() => ({
	bootstrap: vi.fn(),
	get: vi.fn(),
	put: vi.fn(),
	deleteIf: vi.fn(),
	begin: vi.fn(),
	confirm: vi.fn(),
	watch: vi.fn(),
	revoke: vi.fn(),
	identity: vi.fn(),
	join: vi.fn(),
	close: vi.fn(),
	release: vi.fn(),
}));
vi.mock("../../api/fambuddy/fambuddyBootstrap", () => ({
	bootstrap: mocks.bootstrap,
	encodeSetup: (bytes: Uint8Array) => Buffer.from(bytes).toString("base64"),
	decodeSetup: (value: string) => new Uint8Array(Buffer.from(value, "base64")),
}));
vi.mock("../../api/fambuddy/fambuddyStorage", () => ({
	famBuddyRecords: () => ({
		get: mocks.get,
		put: mocks.put,
		deleteIf: mocks.deleteIf,
	}),
	acquireFamBuddyRelay: async () => mocks.release,
}));
vi.mock("../remote/client", () => ({
	relayOrigin: (value: string) => value,
	parentHeaders: async () => ({ authorization: "Bearer synthetic-parent" }),
	relayClient: () => ({ revokeChannel: mocks.revoke }),
}));
vi.mock("../remote/crypto", () => ({
	remoteCrypto: () => ({
		identity: mocks.identity,
		join: mocks.join,
		close: mocks.close,
	}),
}));
vi.mock("./registry", () => ({
	registryClient: () => ({
		beginEnrollment: mocks.begin,
		confirmEnrollment: mocks.confirm,
		watchEnrollment: mocks.watch,
	}),
}));
const id = (digit: string) =>
	`${digit.repeat(8)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(12)}`;
const setup = {
	owner: "parent",
	server: "https://relay.example",
	registration: id("1"),
	code: "synthetic-local-code",
	auth: { getAccessToken: async () => "synthetic-parent" },
};
let reply: Record<string, unknown>;
beforeEach(() => {
	vi.resetAllMocks();
	vi.stubGlobal("crypto", webcrypto);
	mocks.get.mockResolvedValue(null);
	mocks.identity.mockImplementation(async (accountId: string) => ({
		accountId,
		deviceId: id("2"),
		fingerprint: "a".repeat(64),
		keyPackage: "cHVibGlj",
	}));
	mocks.begin.mockImplementation(async ({ channel }: { channel: string }) => {
		reply = {
			version: 1,
			registration: setup.registration,
			origin: setup.server,
			binding: { channel, family: id("3"), device: id("4") },
			peer: {
				accountId: `fambuddy-device:${id("4")}:${channel}`,
				deviceId: id("5"),
				fingerprint: "b".repeat(64),
				keyPackage: "cHVibGlj",
			},
			welcome: "d2VsY29tZQ==",
			token: `vrp_${"c".repeat(64)}`,
		};
	});
	mocks.bootstrap.mockImplementation(async ({ action }: { action: string }) => {
		if (action === "parse")
			return {
				id: id("6"),
				device: id("4"),
				expiresAt: Date.now() + 60_000,
				bearer: "local-secret",
				bootstrapHash: "d".repeat(64),
			};
		if (action === "seal") return { ciphertext: "ZW5jcnlwdGVk" };
		return { plaintext: Buffer.from(JSON.stringify(reply)).toString("base64") };
	});
	mocks.watch.mockImplementation(async function* () {
		yield { response: new Uint8Array([1]) };
	});
});
afterEach(() => vi.unstubAllGlobals());

it("joins and persists the device-bound endpoint before confirming enrollment", async () => {
	const result = await enrollRegistered(setup);
	expect(result.registration).toBe(setup.registration);
	expect(mocks.join).toHaveBeenCalledOnce();
	expect(mocks.put).toHaveBeenCalledWith(`registered:${setup.registration}`, result);
	expect(mocks.put.mock.invocationCallOrder[0]).toBeLessThan(
		mocks.confirm.mock.invocationCallOrder[0],
	);
	expect(mocks.revoke).not.toHaveBeenCalled();
	expect(mocks.release).toHaveBeenCalledOnce();
	const request = mocks.begin.mock.calls[0][0];
	expect(JSON.stringify(request)).not.toContain(setup.code);
	expect(JSON.stringify(request)).not.toContain("local-secret");
});

it.each(["registration", "origin", "binding", "peer"])(
	"rejects substituted %s before saving or confirming",
	async (field) => {
		mocks.watch.mockImplementation(async function* () {
			reply[field] = "substituted";
			yield { response: new Uint8Array([1]) };
		});
		await expect(enrollRegistered(setup)).rejects.toThrow("invalid setup response");
		expect(mocks.put).not.toHaveBeenCalled();
		expect(mocks.confirm).not.toHaveBeenCalled();
		expect(mocks.revoke).toHaveBeenCalledOnce();
		expect(mocks.release).toHaveBeenCalledOnce();
	},
);

it("revokes an ambiguously accepted begin request and releases its lease", async () => {
	mocks.begin.mockRejectedValue(new Error("connection lost"));
	await expect(enrollRegistered(setup)).rejects.toThrow("connection lost");
	expect(mocks.revoke).toHaveBeenCalledOnce();
	expect(mocks.watch).not.toHaveBeenCalled();
	expect(mocks.release).toHaveBeenCalledOnce();
});

it("removes only this attempt's saved channel when confirmation fails", async () => {
	mocks.confirm.mockRejectedValue(new Error("confirmation lost"));
	await expect(enrollRegistered(setup)).rejects.toThrow("confirmation lost");
	const channel = mocks.begin.mock.calls[0][0].channel;
	expect(mocks.deleteIf).toHaveBeenCalledWith(
		`registered:${setup.registration}`,
		"channel",
		channel,
	);
	expect(mocks.revoke).toHaveBeenCalledWith({ channel }, expect.anything());
});

it("reports failed cleanup rather than presenting setup as successful", async () => {
	mocks.confirm.mockRejectedValue(new Error("confirmation lost"));
	mocks.revoke.mockRejectedValue(new Error("offline"));
	await expect(enrollRegistered(setup)).rejects.toThrow("cleanup could not be confirmed");
	expect(mocks.deleteIf).toHaveBeenCalledOnce();
	expect(mocks.release).toHaveBeenCalledOnce();
});
