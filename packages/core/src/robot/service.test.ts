import { beforeEach, expect, it, vi } from "vitest";
import type { OidcAuth } from "../auth/oidc";
import { FamBudCommand } from "../api/protocol";
import { createRobotService } from "./service";
const client = vi.hoisted(() => ({
	createRobotPairing: vi.fn(),
	listRobots: vi.fn(),
	revokeRobot: vi.fn(),
	issueRobotCommand: vi.fn(),
	cancelRobotCommand: vi.fn(),
}));
vi.mock("../repositories/nativeClient", () => ({ createNativeClient: () => client }));
const getAccessToken = vi.fn();
const auth = { getAccessToken } as unknown as OidcAuth;
beforeEach(() => {
	vi.resetAllMocks();
	getAccessToken.mockResolvedValue("parent");
});
it("uses fresh parent credentials for every typed robot operation", async () => {
	const service = createRobotService("https://server.invalid", auth);
	client.createRobotPairing.mockResolvedValue({
		token: "one-use",
		expiresAt: "soon",
	});
	client.listRobots.mockResolvedValue({ devices: [], commands: [] });
	const command = new FamBudCommand({ commandId: "command" });
	client.issueRobotCommand.mockResolvedValue({ command });
	expect(await service.pairing("profile")).toEqual({
		token: "one-use",
		expiresAt: "soon",
	});
	expect(await service.list("profile")).toEqual([]);
	expect(await service.dashboard("profile")).toEqual({
		devices: [],
		commands: [],
	});
	await service.revoke("device");
	const input = {
		commandId: "command",
		target: "device",
		nonce: "nonce",
		expiresAt: "soon",
		practiceId: "practice",
		practiceVersion: 1,
	};
	expect(await service.issue(input)).toBe(command);
	getAccessToken.mockResolvedValue("rotated");
	await service.cancel("command");
	const options = { headers: { authorization: "Bearer parent" } };
	expect(client.createRobotPairing).toHaveBeenCalledWith({ profileId: "profile" }, options);
	expect(client.listRobots).toHaveBeenCalledWith({ profileId: "profile" }, options);
	expect(client.revokeRobot).toHaveBeenCalledWith({ deviceId: "device" }, options);
	expect(client.issueRobotCommand).toHaveBeenCalledWith(input, options);
	expect(client.cancelRobotCommand).toHaveBeenCalledWith(
		{ commandId: "command" },
		{ headers: { authorization: "Bearer rotated" } },
	);
});
it("fails closed without parent authentication and surfaces transport or missing-response errors", async () => {
	const service = createRobotService("https://server.invalid", auth);
	getAccessToken.mockResolvedValue(null);
	for (const action of [
		() => service.pairing("p"),
		() => service.list("p"),
		() => service.dashboard("p"),
		() => service.revoke("d"),
		() => service.cancel("c"),
		() =>
			service.issue({
				commandId: "c",
				target: "d",
				nonce: "n",
				expiresAt: "e",
				practiceId: "p",
				practiceVersion: 1,
			}),
	])
		await expect(action()).rejects.toThrow("Guardian");
	for (const method of Object.values(client)) expect(method).not.toHaveBeenCalled();
	getAccessToken.mockResolvedValue("parent");
	client.listRobots.mockRejectedValue(new Error("offline"));
	await expect(service.list("p")).rejects.toThrow("offline");
	client.issueRobotCommand.mockResolvedValue({});
	await expect(
		service.issue({
			commandId: "c",
			target: "d",
			nonce: "n",
			expiresAt: "e",
			practiceId: "p",
			practiceVersion: 1,
		}),
	).rejects.toThrow("unavailable");
});
