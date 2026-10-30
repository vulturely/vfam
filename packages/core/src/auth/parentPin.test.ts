import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryLocalStateService } from "../services/storage/localState";
import { createOidcAuth } from "./oidc";
import { createSessionStorage } from "./sessionStorage";
const api = vi.hoisted(() => ({
	getParentPinAccess: vi.fn(),
	setParentPin: vi.fn(),
	unlockParent: vi.fn(),
}));
vi.mock("../api/auth/sessionApi", () => ({ createSessionApi: () => api }));
const config = {
	authority: "issuer",
	clientId: "parent-pin",
	redirectUri: "https://app/callback",
	postLogoutRedirectUri: "https://app/",
};
const reload = vi.fn();
const replace = vi.fn();
let memory: ReturnType<typeof createMemoryLocalStateService>;
let storage: ReturnType<typeof createSessionStorage>;
const auth = () => createOidcAuth(config, "https://server", memory.service);
beforeEach(() => {
	vi.resetAllMocks();
	memory = createMemoryLocalStateService();
	storage = createSessionStorage(config.authority, config.clientId, memory.service);
	vi.stubGlobal("window", { location: { reload, replace, hash: "" } });
});
afterEach(() => vi.unstubAllGlobals());
it("exchanges the child credential for a new parent session on successful PIN unlock", async () => {
	await storage.saveChild("vcs_child");
	api.unlockParent.mockResolvedValue({
		accountId: "parent",
		displayName: "Parent",
		email: "",
		accessToken: "vps_new",
		idToken: "",
		expiresAt: new Date(Date.now() + 3600000).toISOString(),
	});
	await auth().unlockParent("482691");
	expect(api.unlockParent).toHaveBeenCalledExactlyOnceWith("482691", "vcs_child");
	await expect(storage.childToken()).resolves.toBeNull();
	expect((await storage.readParent())?.accessToken).toBe("vps_new");
	expect(window.location.hash).toBe("#/home:parent");
	expect(reload).toHaveBeenCalledOnce();
});
it("retains child mode after an incorrect PIN or missing parent grant", async () => {
	await storage.saveChild("vcs_child");
	api.unlockParent.mockRejectedValueOnce(new Error("wrong PIN"));
	await expect(auth().unlockParent("000000")).rejects.toThrow("wrong PIN");
	api.unlockParent.mockResolvedValueOnce({ accessToken: "vcs_wrong" });
	await expect(auth().unlockParent("482691")).rejects.toThrow("Invalid parent session");
	await expect(storage.childToken()).resolves.toBe("vcs_child");
	await expect(storage.readParent()).resolves.toBeNull();
	expect(replace).not.toHaveBeenCalled();
	await expect(auth().setParentPin("123456")).rejects.toThrow("Sign in");
	expect(api.setParentPin).not.toHaveBeenCalled();
});

it.each([
	["reading parent PIN", (auth: ReturnType<typeof createOidcAuth>) => auth.getParentPinAccess()],
	["saving parent PIN", (auth: ReturnType<typeof createOidcAuth>) => auth.setParentPin("482691")],
	[
		"reading child PIN",
		(auth: ReturnType<typeof createOidcAuth>) => auth.getChildPinAccess("child"),
	],
	[
		"saving child PIN",
		(auth: ReturnType<typeof createOidcAuth>) => auth.setChildPin("child", "482691"),
	],
] as const)(
	"returns to login after local expiry when %s, without redirecting a child session",
	async (_label, action) => {
		await storage.saveParent({
			accountId: "parent",
			displayName: "Parent",
			accessToken: "vps_expired",
			idToken: "",
			expiresAt: Date.now() - 1,
		});
		await expect(action(auth())).rejects.toThrow(/sign in/i);
		expect(replace).toHaveBeenCalledExactlyOnceWith("/");
		expect(api.getParentPinAccess).not.toHaveBeenCalled();
		expect(api.setParentPin).not.toHaveBeenCalled();
		replace.mockClear();
		await storage.saveChild("vcs_child");
		await expect(action(auth())).rejects.toThrow(/sign in/i);
		expect(replace).not.toHaveBeenCalled();
		await expect(storage.childToken()).resolves.toBe("vcs_child");
	},
);
