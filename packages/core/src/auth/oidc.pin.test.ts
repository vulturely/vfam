import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryLocalStateService } from "../services/storage/localState";
import { createOidcAuth } from "./oidc";
import { createSessionStorage, readRememberedChildren } from "./sessionStorage";
const api = vi.hoisted(() => ({
	signInChild: vi.fn(),
	setChildPin: vi.fn(),
	getChildPinAccess: vi.fn(),
	getParentPinAccess: vi.fn(),
	verifyParentPin: vi.fn(),
	setParentPin: vi.fn(),
}));
vi.mock("../api/auth/sessionApi", () => ({ createSessionApi: () => api }));
const config = {
	authority: "test",
	clientId: "test",
	redirectUri: "https://app.invalid",
	postLogoutRedirectUri: "https://app.invalid",
};
const parent = {
	accountId: "parent",
	displayName: "Parent",
	accessToken: `vps_${"a".repeat(64)}`,
	idToken: "",
	expiresAt: Date.now() + 3600000,
};
const child = `vcs_${"c".repeat(64)}`;
const replace = vi.fn();
let memory: ReturnType<typeof createMemoryLocalStateService>;
let storage: ReturnType<typeof createSessionStorage>;
const auth = () => createOidcAuth(config, "test", memory.service);

beforeEach(() => {
	vi.clearAllMocks();
	memory = createMemoryLocalStateService();
	storage = createSessionStorage("test", "test", memory.service);
	vi.stubGlobal("window", { location: { replace } });
	api.signInChild.mockResolvedValue({
		sessionToken: child,
		context: { displayName: "Jamie" },
	});
});
afterEach(() => vi.unstubAllGlobals());
it("passes the current parent for server revocation and replaces native credentials", async () => {
	await storage.saveParent(parent);
	await auth().signInChild("code", "123456", true);
	expect(api.signInChild).toHaveBeenCalledWith("code", "123456", parent.accessToken);
	await expect(storage.readParent()).resolves.toBeNull();
	await expect(storage.childToken()).resolves.toBe(child);
	await expect(readRememberedChildren(storage.rememberedKey, memory.service)).resolves.toEqual([
		{ loginId: "code", displayName: "Jamie" },
	]);
	expect(replace).toHaveBeenCalledWith("/");
});
it("does not persist a profile on a private device unless requested", async () => {
	await auth().signInChild("code", "123456");
	expect(api.signInChild).toHaveBeenCalledWith("code", "123456", undefined);
	await expect(readRememberedChildren(storage.rememberedKey, memory.service)).resolves.toEqual([]);
});
it("requires guardian authentication for PIN configuration", async () => {
	await expect(auth().setChildPin("profile", "123456")).rejects.toThrow("guardian");
	await expect(auth().getChildPinAccess("profile")).rejects.toThrow("guardian");
	expect(api.setChildPin).not.toHaveBeenCalled();
});
it("preserves the parent on a denied PIN, and discards it after a malformed successful grant", async () => {
	await storage.saveParent(parent);
	api.signInChild.mockRejectedValueOnce(new Error("Denied"));
	await expect(auth().signInChild("code", "000000")).rejects.toThrow("Denied");
	expect((await storage.readParent())?.accessToken).toBe(parent.accessToken);
	api.signInChild.mockResolvedValueOnce({ sessionToken: "bad" });
	await auth().signInChild("code", "123456");
	await expect(storage.readParent()).resolves.toBeNull();
	expect(replace).toHaveBeenCalledWith("/");
});
it("recovers corrupt child storage with a PIN without falling back to parent access", async () => {
	await storage.saveParent(parent);
	memory.values.set(storage.childKey, "corrupt");
	await auth().signInChild("code", "123456");
	expect(api.signInChild).toHaveBeenCalledWith("code", "123456", undefined);
	await expect(storage.readParent()).resolves.toBeNull();
	await expect(storage.childToken()).resolves.toBe(child);
});

it("locks a parent session with a PIN until this session verifies it", async () => {
	await expect(auth().parentPinLocked()).resolves.toBe(false);
	await storage.saveParent(parent);
	api.getParentPinAccess.mockResolvedValue({ enabled: false });
	await expect(auth().parentPinLocked()).resolves.toBe(false);
	api.getParentPinAccess.mockResolvedValue({ enabled: true });
	await expect(auth().parentPinLocked()).resolves.toBe(true);
	api.getParentPinAccess.mockRejectedValue(new Error("offline"));
	await expect(auth().parentPinLocked()).resolves.toBe(true);
	api.verifyParentPin.mockRejectedValueOnce(new Error("incorrect PIN"));
	await expect(auth().verifyParentPin("000000")).rejects.toThrow("incorrect PIN");
	await expect(auth().parentPinLocked()).resolves.toBe(true);
	api.verifyParentPin.mockResolvedValue({});
	await auth().verifyParentPin("482691");
	expect(api.verifyParentPin).toHaveBeenLastCalledWith("482691", parent.accessToken);
	await expect(auth().parentPinLocked()).resolves.toBe(false);
	// A new sign-in replaces the session and asks again.
	api.getParentPinAccess.mockResolvedValue({ enabled: true });
	await storage.saveParent(parent);
	await expect(auth().parentPinLocked()).resolves.toBe(true);
});

it("requires a parent session to verify the parent PIN", async () => {
	await expect(auth().verifyParentPin("482691")).rejects.toThrow("Sign in");
	expect(api.verifyParentPin).not.toHaveBeenCalled();
});

it("sends the current PIN when changing it and unlocks only after the server accepts", async () => {
	await storage.saveParent({ ...parent, pinReset: true });
	await expect(auth().parentPinResetPending()).resolves.toBe(true);
	api.setParentPin.mockRejectedValueOnce(new Error("incorrect PIN"));
	await expect(auth().setParentPin("111111", "000000")).rejects.toThrow("incorrect PIN");
	await expect(storage.readParent()).resolves.toMatchObject({ pinReset: true });
	api.setParentPin.mockResolvedValue({ enabled: true });
	await auth().setParentPin("111111");
	expect(api.setParentPin).toHaveBeenLastCalledWith("111111", parent.accessToken, "");
	await expect(storage.readParent()).resolves.toMatchObject({
		pinUnlocked: true,
		pinReset: false,
	});
	await expect(auth().parentPinResetPending()).resolves.toBe(false);
	await auth().setParentPin("222222", "111111");
	expect(api.setParentPin).toHaveBeenLastCalledWith("222222", parent.accessToken, "111111");
});
