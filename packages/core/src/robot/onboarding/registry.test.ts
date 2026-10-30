import { beforeEach, expect, it, vi } from "vitest";
import {
	acknowledgeApproval,
	getFamilyLicense,
	getMediaRelay,
	list,
	register,
	registryClient,
	revoke,
	setFamilyLicense,
} from "./registry";

const mocks = vi.hoisted(() => ({
	client: {
		listFamBuddies: vi.fn(),
		registerFamBuddy: vi.fn(),
		revokeFamBuddy: vi.fn(),
		getMediaRelay: vi.fn(),
		acknowledgeApproval: vi.fn(),
		setFamilyLicense: vi.fn(),
		getFamilyLicense: vi.fn(),
	},
	transport: vi.fn(),
}));

vi.mock("../../repositories/nativeClient", () => ({
	createNativeClient: mocks.transport,
}));
vi.mock("../remote/client", () => ({
	relayOrigin: (server: string) => new URL(server).origin,
	parentHeaders: async () => ({ authorization: "Bearer parent" }),
}));

const connection = {
	server: "https://relay.example",
	auth: { getAccessToken: async () => "vps_parent" },
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.transport.mockReturnValue(mocks.client);
});

it("creates a registry client through the native transport", () => {
	expect(registryClient(connection.server)).toBe(mocks.client);
	expect(mocks.transport).toHaveBeenCalledWith("fambuddy_registry", "https://relay.example");
});

it("lists and registers FamBuddy devices with request options", async () => {
	const signal = new AbortController().signal;
	mocks.client.listFamBuddies.mockResolvedValue({ devices: [{ device: "one" }] });
	mocks.client.registerFamBuddy.mockResolvedValue({ device: { device: "two" } });

	await expect(list({ ...connection, signal })).resolves.toEqual([{ device: "one" }]);
	await expect(register(connection, "Kitchen")).resolves.toEqual({ device: "two" });
	expect(mocks.client.listFamBuddies).toHaveBeenCalledWith(
		{},
		{ headers: { authorization: "Bearer parent" }, signal, timeoutMs: 10_000 },
	);
	expect(mocks.client.registerFamBuddy).toHaveBeenCalledWith(
		{ name: "Kitchen" },
		expect.objectContaining({ timeoutMs: 10_000 }),
	);
});

it("rejects aborted calls and missing registration results", async () => {
	const controller = new AbortController();
	controller.abort();
	await expect(list({ ...connection, signal: controller.signal })).rejects.toThrow();
	mocks.client.registerFamBuddy.mockResolvedValue({});
	await expect(register(connection, "Kitchen")).rejects.toThrow(
		"FamBuddy registration was not returned.",
	);
});

it("revokes registrations and obtains media relay settings", async () => {
	mocks.client.getMediaRelay.mockResolvedValue({ urls: ["turn:relay.example"] });
	await revoke(connection, "registration");
	await expect(getMediaRelay(connection, "registration")).resolves.toEqual({
		urls: ["turn:relay.example"],
	});

	expect(mocks.client.revokeFamBuddy).toHaveBeenCalledWith(
		{ registration: "registration" },
		expect.anything(),
	);
	expect(mocks.client.getMediaRelay).toHaveBeenCalledWith(
		{ registration: "registration" },
		expect.anything(),
	);
});

it("acknowledges a waiting approval for its registration and turn", async () => {
	await acknowledgeApproval(connection, "registration", "turn");
	expect(mocks.client.acknowledgeApproval).toHaveBeenCalledWith(
		{ registration: "registration", turn: "turn" },
		expect.anything(),
	);
});

it("installs, removes and reads the family license without returning its token", async () => {
	mocks.client.setFamilyLicense.mockResolvedValue({
		license: {
			state: 2,
			edition: "Family",
			features: ["fambuddy.remote_access"],
			expiresAt: "2027-01-01T00:00:00Z",
		},
	});
	await expect(setFamilyLicense(connection, "sap-token")).resolves.toEqual({
		state: "valid",
		edition: "Family",
		features: ["fambuddy.remote_access"],
		expires_at: "2027-01-01T00:00:00Z",
	});
	expect(mocks.client.setFamilyLicense).toHaveBeenCalledWith(
		{ token: "sap-token" },
		expect.objectContaining({ timeoutMs: 10_000 }),
	);
	mocks.client.setFamilyLicense.mockResolvedValue({ license: { state: 1 } });
	await expect(setFamilyLicense(connection, "")).resolves.toMatchObject({ state: "none" });
	mocks.client.getFamilyLicense.mockResolvedValue({});
	await expect(getFamilyLicense(connection)).resolves.toEqual({
		state: "unknown",
		edition: "",
		features: [],
		expires_at: "",
	});
	expect(mocks.client.getFamilyLicense).toHaveBeenCalledWith({}, expect.anything());
});
