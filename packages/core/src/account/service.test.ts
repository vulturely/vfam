import { describe, expect, it, vi } from "vitest";
import { createAccountService } from "./service";
import type { AccountApi } from "../api/account/accountApi";
import type { OidcAuth } from "../auth/oidc";

const repository = {
	validateInput: async (input: { displayName: string; email?: string }) => {
		if (!input.displayName.trim()) throw new Error("Name is required.");
		if (input.email && !input.email.includes("@")) throw new Error("Enter a valid email address.");
	},
};

const api: AccountApi = {
	async createAccount(input) {
		return {
			id: "account-1",
			displayName: input.displayName.trim(),
			role: input.role,
			email: input.email?.trim().toLowerCase(),
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		};
	},
};

describe("createAccountService", () => {
	it("registers kids and routes them to the kid screen", async () => {
		const service = createAccountService(api, undefined, repository);
		const session = await service.register({
			displayName: "  Jo  ",
			email: "JO@example.COM",
			familyName: "Bird Family",
			role: "kid",
		});
		expect(session.person).toMatchObject({ id: "account-1", name: "Jo", role: "kid" });
		expect(session.account.email).toBe("jo@example.com");
		expect(session.familyId).toMatch(/^bird-family-/);
		expect(session.landingScreen).toBe("home:kid");
	});

	it("registers grandparents and routes them to the grandparent screen", async () => {
		const service = createAccountService(api, undefined, repository);
		const session = await service.register({
			displayName: "Nana",
			familyName: "Care Circle",
			role: "grandparent",
		});
		expect(session.person.role).toBe("elder");
		expect(session.landingScreen).toBe("home:grandparent");
	});

	it("rejects missing names before calling the API", async () => {
		const service = createAccountService(api, undefined, repository);
		await expect(service.register({ displayName: " ", role: "parent" })).rejects.toThrow(
			"Name is required.",
		);
	});

	it("uses the real OIDC flow for sign-in and validates input", async () => {
		const service = createAccountService(api, undefined, repository);
		const session = await service.register({
			displayName: "Parent",
			familyName: " !!! ",
			role: "parent",
		});
		const auth = {
			signIn: vi.fn().mockResolvedValue(undefined),
			getUser: vi.fn().mockResolvedValue(session),
		} as unknown as OidcAuth;
		const signedIn = await createAccountService(api, auth, repository).signIn({
			displayName: "Parent",
			role: "parent",
		});
		expect(signedIn).toBe(session);
		expect(auth.signIn).toHaveBeenCalledOnce();
		await expect(
			createAccountService(api, auth, repository).signIn({
				displayName: "Parent",
				email: "invalid",
				role: "parent",
			}),
		).rejects.toThrow("Enter a valid email address.");
		expect(auth.signIn).toHaveBeenCalledOnce();
	});
});
