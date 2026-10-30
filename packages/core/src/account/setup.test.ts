import { describe, expect, it, vi } from "vitest";
import { AccountRole } from "../api/protocol";
import type { OidcAuth } from "../auth/oidc";
import { createAccountSetupService } from "./setup";

const client = vi.hoisted(() => ({ getAccountSetup: vi.fn(), updateAccountSetup: vi.fn() }));
vi.mock("../repositories/nativeClient", () => ({ createNativeClient: () => client }));

function auth(token: string | null = "token") {
	return { getAccessToken: vi.fn(async () => token) } as unknown as OidcAuth;
}

describe("createAccountSetupService", () => {
	it("requires a session and maps every account role", async () => {
		const service = createAccountSetupService("https://server.example", auth(null));
		await expect(service.get()).rejects.toThrow("Sign in to continue setup");
		const authenticated = createAccountSetupService("https://server.example", auth());
		for (const [role, expected] of [
			[AccountRole.PARENT, "parent"],
			[AccountRole.KID, "kid"],
			[AccountRole.GRANDPARENT, "grandparent"],
			[AccountRole.UNSPECIFIED, null],
		] as const) {
			client.getAccountSetup.mockResolvedValueOnce({ role, dobConfirmed: true, completed: false });
			await expect(authenticated.get()).resolves.toEqual({
				role: expected,
				dobConfirmed: true,
				completed: false,
			});
		}
	});

	it("maps parent and child updates and bearer options", async () => {
		const service = createAccountSetupService("https://server.example", auth());
		client.updateAccountSetup.mockImplementation(async (input, options) => ({
			role: input.role,
			dobConfirmed: true,
			completed: input.complete ?? false,
			options,
		}));
		await service.update({ role: "parent", dateOfBirth: "1990-01-01", complete: true });
		await service.update({ role: "kid" });
		expect(client.updateAccountSetup.mock.calls[0][0].role).toBe(AccountRole.PARENT);
		expect(client.updateAccountSetup.mock.calls[1][0].role).toBe(AccountRole.KID);
		expect(client.updateAccountSetup.mock.calls[0][1].headers.authorization).toBe("Bearer token");
	});
});
