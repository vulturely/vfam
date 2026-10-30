import { beforeEach, expect, it, vi } from "vitest";
import { parentHeaders, relayClient, relayOrigin } from "./client";

const mocks = vi.hoisted(() => ({ transport: vi.fn(), client: vi.fn() }));
vi.mock("../../repositories/nativeClient", () => ({ createNativeClient: mocks.client }));

beforeEach(() => {
	vi.clearAllMocks();
	mocks.transport.mockReturnValue("transport");
	mocks.client.mockReturnValue("client");
});

it("accepts only default-port HTTPS relay origins", () => {
	expect(relayOrigin("https://relay.example/path")).toBe("https://relay.example");
	for (const server of [
		"http://relay.example",
		"https://user@relay.example",
		"https://relay.example:444",
	]) {
		expect(() => relayOrigin(server)).toThrow("Remote approvals require");
	}
});

it("creates a relay client through the native transport", () => {
	expect(relayClient("https://relay.example")).toBe("client");
	expect(mocks.client).toHaveBeenCalledWith("fambuddy_relay", "https://relay.example");
});

it("creates authorization headers only for parent access tokens", async () => {
	await expect(parentHeaders({ getAccessToken: async () => "vps_parent" })).resolves.toEqual({
		authorization: "Bearer vps_parent",
	});
	await expect(parentHeaders({ getAccessToken: async () => "other" })).rejects.toThrow(
		"Sign in to Vulture as a parent.",
	);
	await expect(parentHeaders({ getAccessToken: async () => null })).rejects.toThrow(
		"Sign in to Vulture as a parent.",
	);
});
