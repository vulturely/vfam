import { ParentCommandRequest, PairPhoneResponse } from "../api/protocol";
import { pairBuddyPhone } from "./buddy-gateway";
import { beforeEach, it, expect, vi } from "vitest";
import { createBuddyService } from "./buddy";

const client = vi.hoisted(() => ({
	parentCommand: vi.fn(),
	pairPhone: vi.fn(),
}));
vi.mock("../repositories/nativeClient", () => ({ createNativeClient: () => client }));

beforeEach(() => vi.resetAllMocks());

it("rejects insecure remote gateways and never retries approval", async () => {
	const auth = { getAccessToken: async () => "vps_parent" };
	await expect(
		createBuddyService("http://fambuddy.local", auth).command({
			action: "list",
			family: "f",
		}),
	).rejects.toThrow("HTTPS");
	expect(client.parentCommand).not.toHaveBeenCalled();
	client.parentCommand.mockRejectedValue(new Error("Connection lost"));
	await expect(
		createBuddyService("https://fambuddy.local", auth).command({
			action: "approve",
			device: "d",
			turn: "t",
			review: [1],
		}),
	).rejects.toThrow("Connection lost");
	expect(client.parentCommand).toHaveBeenCalledTimes(1);
	const [request, options] = client.parentCommand.mock.calls[0];
	expect(request).toBeInstanceOf(ParentCommandRequest);
	expect(request.approve).toBeDefined();
	expect(options).toMatchObject({
		headers: { authorization: "Bearer vps_parent" },
		timeoutMs: 30000,
	});
});

it("pairs through the native gateway client", async () => {
	client.pairPhone.mockResolvedValue(
		new PairPhoneResponse({ token: "vps_test", family: "family", expiresAt: "expiry" }),
	);
	await expect(pairBuddyPhone("https://fambuddy.local", "one-use-code")).resolves.toEqual({
		token: "vps_test",
		family: "family",
		expires_at: "expiry",
	});
	expect(client.pairPhone).toHaveBeenCalledWith({ code: "one-use-code" }, { timeoutMs: 10000 });
});
