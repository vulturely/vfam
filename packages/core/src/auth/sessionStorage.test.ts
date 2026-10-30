import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryLocalStateService } from "../services/storage/localState";
import { createSessionStorage, readRememberedChildren } from "./sessionStorage";

const authority = "https://test.invalid";
const parent = {
	version: 2,
	accountId: "parent",
	displayName: "Alex",
	accessToken: `vps_${"a".repeat(64)}`,
	idToken: "",
	expiresAt: Date.now() + 3600000,
};
let memory: ReturnType<typeof createMemoryLocalStateService>;
let storage: ReturnType<typeof createSessionStorage>;

beforeEach(() => {
	memory = createMemoryLocalStateService();
	storage = createSessionStorage(authority, "test", memory.service);
});

describe("shared-device credential boundaries", () => {
	it("handoff removes parent credentials and local demo data while preserving preferences", async () => {
		await storage.saveParent(parent);
		memory.values.set("vulture.accounts", "private");
		memory.values.set("vulture:family-tasks:v1", "private");
		memory.values.set("vulture.theme", "dark");
		memory.values.set(storage.pendingKey, "old-login");
		memory.values.set("vulture:mailbox-consent", "private-consent");
		await storage.saveChild(`vcs_${"c".repeat(64)}`);
		await expect(storage.readParent()).resolves.toBeNull();
		expect(memory.values.has(storage.parentKey)).toBe(false);
		expect(memory.values.has("vulture.accounts")).toBe(false);
		expect(memory.values.has("vulture:family-tasks:v1")).toBe(false);
		expect(memory.values.has(storage.pendingKey)).toBe(false);
		expect(memory.values.has("vulture:mailbox-consent")).toBe(false);
		expect(memory.values.get("vulture.theme")).toBe("dark");
	});
	it("never falls back to a parent credential while corrupt or valid child state exists", async () => {
		await storage.saveParent(parent);
		memory.values.set(storage.childKey, "corrupt");
		await expect(storage.childToken()).resolves.toBe("invalid");
		await expect(storage.readParent()).resolves.toBeNull();
	});
	it("rejects legacy provider sessions rather than treating them as Vulture credentials", async () => {
		memory.values.set(storage.parentKey, {
			...parent,
			version: undefined,
			accessToken: "old-oidc-jwt",
			idToken: "old-id-token",
		});
		await expect(storage.readParent()).resolves.toBeNull();
		expect(memory.values.has(storage.parentKey)).toBe(false);
	});
	it("stores the new parent credential before clearing the child boundary", async () => {
		await storage.saveChild(`vcs_${"c".repeat(64)}`);
		await storage.saveParent(parent);
		await expect(storage.hasChild()).resolves.toBe(false);
		expect((await storage.readParent())?.accessToken).toBe(parent.accessToken);
	});
	it("clears only the rejected session and opens sign-in", async () => {
		const replace = vi.fn();
		vi.stubGlobal("location", { ...window.location, replace });
		const stop = storage.watch(vi.fn());
		const expire = (token: string) =>
			window.dispatchEvent(new CustomEvent("vulture:session-expired", { detail: token }));
		try {
			await storage.saveParent(parent);
			expire(`vps_${"z".repeat(64)}`);
			await vi.waitFor(() => expect(memory.values.has(storage.parentKey)).toBe(true));
			expire(parent.accessToken);
			await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
			expect(memory.values.has(storage.parentKey)).toBe(false);

			replace.mockClear();
			const child = `vcs_${"c".repeat(64)}`;
			await storage.saveChild(child);
			expire(`vcs_${"d".repeat(64)}`);
			expire(parent.accessToken);
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(replace).not.toHaveBeenCalled();
			await expect(storage.childToken()).resolves.toBe(child);
			expire(child);
			await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
			await expect(storage.childToken()).resolves.toBeNull();
		} finally {
			stop();
			vi.unstubAllGlobals();
		}
	});
	it("restores browser snapshots without listening for browser storage events", () => {
		const boundary = vi.fn();
		const stop = storage.watch(boundary);
		window.dispatchEvent(new window.StorageEvent("storage", { key: storage.childKey }));
		expect(boundary).not.toHaveBeenCalled();
		const show = new window.Event("pageshow");
		Object.defineProperty(show, "persisted", { value: true });
		window.dispatchEvent(show);
		expect(boundary).toHaveBeenCalledOnce();
		stop();
	});
});

it("remembers child names and codes without retaining sessions or PINs", async () => {
	await storage.saveParent(parent);
	await storage.rememberChild("child-code", "Jamie");
	await storage.rememberChild("child-code", "Jamie updated");
	await storage.saveChild(`vcs_${"c".repeat(64)}`);
	await storage.clearAll();
	await expect(readRememberedChildren(storage.rememberedKey, memory.service)).resolves.toEqual([
		{ loginId: "child-code", displayName: "Jamie updated" },
	]);
	expect(memory.values.has(storage.childKey)).toBe(false);
	expect(memory.values.has(storage.parentKey)).toBe(false);
	memory.values.set(storage.rememberedKey, "corrupt");
	await expect(readRememberedChildren(storage.rememberedKey, memory.service)).resolves.toEqual([]);
});

it("ignores malformed remembered profiles and deduplicates profile codes", async () => {
	memory.values.set(storage.rememberedKey, [
		null,
		{},
		{ loginId: 4, displayName: "Invalid" },
		{ loginId: "code", displayName: "Old" },
		{ loginId: "code", displayName: "Jamie" },
	]);
	await expect(readRememberedChildren(storage.rememberedKey, memory.service)).resolves.toEqual([
		{ loginId: "code", displayName: "Jamie" },
	]);
});
