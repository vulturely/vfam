import { describe, expect, it, vi } from "vitest";
import { createMemoryLocalStateService } from "../services/storage/localState";
import { createOidcAuth, signedInAccountFromSession } from "./oidc";
import { createSessionStorage } from "./sessionStorage";

describe("signedInAccountFromSession", () => {
	it("falls back to the email local part when the IdP has no profile name", () => {
		const signedIn = signedInAccountFromSession({
			accountId: "rauthy-sub-123",
			displayName: "",
			email: "octocat@example.com",
			accessToken: "opaque-access-token",
			idToken: "opaque-id-token",
			expiresAt: Date.now() + 60_000,
		});
		expect(signedIn.account.displayName).toBe("octocat");
		expect(signedIn.person.name).toBe("octocat");
		expect(signedIn.account.email).toBe("octocat@example.com");
	});
});

it("keeps child and parent credential access separate", async () => {
	const memory = createMemoryLocalStateService();
	const config = {
		authority: "https://test.invalid",
		clientId: "test",
		redirectUri: "https://app.invalid/callback",
		postLogoutRedirectUri: "https://app.invalid",
	};
	const auth = createOidcAuth(config, "https://server.invalid", memory.service);
	const storage = createSessionStorage(config.authority, config.clientId, memory.service);
	expect(await auth.getChildAccessToken()).toBeNull();
	expect(await auth.getSessionAccessToken()).toBeNull();
	await storage.saveParent({
		accountId: "parent",
		displayName: "Parent",
		accessToken: `vps_${"a".repeat(64)}`,
		idToken: "",
		expiresAt: Date.now() + 3600000,
	});
	expect(await auth.getAccessToken()).toMatch(/^vps_/);
	expect(await auth.getChildAccessToken()).toBeNull();
	expect(await auth.getSessionAccessToken()).toMatch(/^vps_/);
	const child = `vcs_${"c".repeat(64)}`;
	await storage.saveChild(child);
	expect(await auth.getChildAccessToken()).toBe(child);
	expect(await auth.getAccessToken()).toBeNull();
	// Chat and calls use whichever session is active.
	expect(await auth.getSessionAccessToken()).toBe(child);
});

it("returns to login when a parent token expires during use", async () => {
	const memory = createMemoryLocalStateService();
	const replace = vi.fn();
	vi.stubGlobal("window", { location: { replace } });
	try {
		const config = {
			authority: "issuer",
			clientId: "client",
			redirectUri: "https://app/callback",
			postLogoutRedirectUri: "https://app/",
		};
		const storage = createSessionStorage(config.authority, config.clientId, memory.service);
		const auth = createOidcAuth(config, "https://server.invalid", memory.service);
		await storage.saveParent({
			accountId: "parent",
			displayName: "Parent",
			accessToken: "vps_expired",
			idToken: "",
			expiresAt: Date.now() - 1,
		});
		expect(await auth.getAccessToken()).toBeNull();
		expect(replace).toHaveBeenCalledExactlyOnceWith("/");
		replace.mockClear();
		await storage.saveChild("vcs_child");
		expect(await auth.getAccessToken()).toBeNull();
		expect(replace).not.toHaveBeenCalled();
		expect(await auth.getChildAccessToken()).toBe("vcs_child");
	} finally {
		vi.unstubAllGlobals();
	}
});
