import { cleanup, render } from "@testing-library/svelte";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Runtime } from "./registry.svelte";
import TestRuntimeProvider from "./TestRuntimeProvider.svelte";
import type { AppConfig } from "./defineApp";
import type { Plugin } from "@vulture/plugin-sdk";
import TestScreen from "../shell/ChatComposerEditorTestStub.svelte";

function mount(config: AppConfig): Runtime {
	let runtime!: Runtime;
	render(TestRuntimeProvider, {
		config,
		onruntime: (value) => {
			runtime = value;
		},
	});
	return runtime;
}

const authority = "https://auth.example";
const parentKey = `oidc.user:${authority}:vulture`;
const childKey = `vulture.child-session:${authority}:vulture`;
let pinState: "none" | "set" | "unknown" = "none";

function config(plugins: Plugin[] = []): AppConfig {
	return {
		id: "test",
		name: "Test",
		profile: "standard",
		plugins,
		serverUrl: "https://server.example",
		oidc: {
			authority,
			clientId: "vulture",
			redirectUri: "https://app.example/callback",
			postLogoutRedirectUri: "https://app.example",
		},
	};
}

beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();
	const records = new Map<string, unknown>();
	Object.assign(window, {
		__TAURI_INTERNALS__: {
			invoke: vi.fn(
				async (
					command: string,
					args: {
						input?: { method?: string; payload?: { pin?: string } };
						request?: { action: string; namespace: string; key?: string; value?: unknown };
					},
				) => {
					if (command === "local_cache") {
						const request = args.request!;
						const key = JSON.stringify([request.namespace, request.key]);
						if (request.action === "get") return records.get(key) ?? null;
						if (request.action === "put") records.set(key, request.value);
						if (request.action === "delete") records.delete(key);
						return null;
					}
					if (command !== "server_unary") throw new Error(`Unexpected command ${command}`);
					switch (args.input?.method) {
						case "GetParentSession":
							return {
								accountId: "parent",
								displayName: "Alex",
								expiresAt: new Date(Date.now() + 60_000).toISOString(),
							};
						case "GetAccountSetup":
							return { role: 1, dobConfirmed: true, completed: true };
						case "GetChildSession":
							return {
								context: {
									profileId: "child",
									familyId: "family",
									displayName: "Jamie",
									expiresAt: new Date(Date.now() + 60_000).toISOString(),
								},
							};
						case "RevokeSession":
							return { ok: true };
						case "GetParentPinAccess":
							if (pinState === "unknown") throw { kind: "unavailable", message: "offline" };
							return { enabled: pinState === "set" };
						case "VerifyParentPin":
							if (args.input?.payload?.pin !== "482691")
								throw { kind: "permission_denied", message: "incorrect PIN" };
							return {};
						default:
							throw new Error(`Unexpected method ${args.input?.method}`);
					}
				},
			),
			transformCallback: (value: unknown) => value,
		},
	});
});

afterEach(() => {
	pinState = "none";
	cleanup();
	vi.restoreAllMocks();
	delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

it("composes plugins, restores a parent, enforces roles, and logs out", async () => {
	const setup = vi.fn((context) => {
		context.services.avatar = { load: vi.fn() };
		context.navigate("home:parent");
	});
	const runtime = mount(
		config([
			{
				id: "identity",
				name: "Identity",
				version: "1",
				roles: ["manager"],
				screens: [
					{
						id: "identity:profile",
						component: TestScreen,
						nav: { id: "identity:profile", label: "Identity", order: 1 },
					},
				],
				setup,
			},
		]),
	);
	expect(setup).toHaveBeenCalledOnce();
	expect(runtime.screens.has("identity:profile")).toBe(true);
	expect(runtime.navItems.some((item) => item.id === "identity:profile")).toBe(true);
	expect(runtime.pluginServices.identity.avatar).toBeDefined();
	expect(runtime.homeScreenForCurrentRole()).toBe("home:parent");
	localStorage.setItem(
		parentKey,
		JSON.stringify({
			version: 2,
			accountId: "parent",
			displayName: "Alex",
			accessToken: `vps_${"a".repeat(64)}`,
			idToken: "",
			expiresAt: Date.now() + 60_000,
		}),
	);
	await runtime.restoreSession();
	expect(runtime.state.identity).toMatchObject({ id: "parent", role: "manager" });
	expect(runtime.state.restoring).toBe(false);
	expect(runtime.canAccessScreen("learning:profiles")).toBe(true);
	expect(runtime.canAccessScreen("account:setup")).toBe(true);
	expect(runtime.canAccessScreen("fambuddy")).toBe(true);
	expect(runtime.canAccessScreen("identity:profile")).toBe(true);
	runtime.theme.toggle();
	expect(runtime.theme.mode).toBe("dark");
	runtime.logout();
	await vi.waitFor(() => expect(localStorage.getItem(parentKey)).toBeNull());
	expect(runtime.state.identity).toBeNull();
});

it("restores a child session without restoring parent credentials", async () => {
	const runtime = mount(config());
	localStorage.setItem(childKey, JSON.stringify({ token: `vcs_${"b".repeat(64)}` }));
	await runtime.restoreSession();
	expect(runtime.state.childSession).toMatchObject({ status: "active", profileId: "child" });
	expect(runtime.state.identity).toBeNull();
	await runtime.refreshChildSession();
	expect(runtime.state.childSession?.status).toBe("active");
	runtime.completeOnboarding(
		{
			id: "parent",
			familyId: "family",
			name: "Alex",
			role: "manager",
			deviceId: "device",
			createdAt: "now",
		},
		"family:manage",
	);
	await vi.waitFor(() =>
		expect(runtime.router.current).toMatchObject({
			screen: "family:manage",
			params: {},
		}),
	);
});

it("handles missing sessions and preserves access rules before identity loads", async () => {
	const runtime = mount(config());
	await runtime.restoreSession();
	expect(runtime.state.identity).toBeNull();
	expect(runtime.state.sessionError).toBe("");
	expect(runtime.canAccessScreen("home:parent")).toBe(false);
	expect(runtime.homeScreenForCurrentRole()).toBe("home:parent");
	runtime.logout();
	await vi.waitFor(() => expect(runtime.state.identity).toBeNull());
});

it("keeps parent screens locked until the parent PIN is entered on a shared device", async () => {
	pinState = "set";
	const runtime = mount(config([]));
	const stored = {
		version: 2,
		accountId: "parent",
		displayName: "Alex",
		accessToken: `vps_${"a".repeat(64)}`,
		idToken: "",
		expiresAt: Date.now() + 60_000,
	};
	localStorage.setItem(parentKey, JSON.stringify(stored));
	await runtime.restoreSession();
	expect(runtime.state.parentLocked).toBe(true);
	await vi.waitFor(() => expect(runtime.router.current.screen).toBe("profile:choose"));
	expect(runtime.homeScreenForCurrentRole()).toBe("profile:choose");
	expect(runtime.canAccessScreen("profile:choose")).toBe(true);
	for (const screen of ["home:parent", "learning:profiles", "fambuddy", "family:setup"])
		expect(runtime.canAccessScreen(screen)).toBe(false);
	await expect(runtime.unlockParentProfile("000000")).rejects.toBeTruthy();
	expect(runtime.state.parentLocked).toBe(true);
	await runtime.unlockParentProfile("482691");
	expect(runtime.state.parentLocked).toBe(false);
	expect(runtime.canAccessScreen("learning:profiles")).toBe(true);
	expect(runtime.homeScreenForCurrentRole()).toBe("home:parent");
	expect(runtime.state.parentPinReset).toBe(false);
	runtime.parentPinSaved();
	expect(runtime.state.parentPinReset).toBe(false);
	// The unlock belongs to this parent session, so a reload stays unlocked.
	await runtime.restoreSession();
	expect(runtime.state.parentLocked).toBe(false);
});

it("keeps parent screens locked when the PIN state cannot be checked", async () => {
	pinState = "unknown";
	const runtime = mount(config([]));
	localStorage.setItem(
		parentKey,
		JSON.stringify({
			version: 2,
			accountId: "parent",
			displayName: "Alex",
			accessToken: `vps_${"a".repeat(64)}`,
			idToken: "",
			expiresAt: Date.now() + 60_000,
		}),
	);
	await runtime.restoreSession();
	expect(runtime.state.parentLocked).toBe(true);
	expect(runtime.canAccessScreen("home:parent")).toBe(false);
});

it("restores a Forgot PIN sign-in as locked with a pending PIN reset", async () => {
	pinState = "set";
	const runtime = mount(config([]));
	localStorage.setItem(
		parentKey,
		JSON.stringify({
			version: 2,
			accountId: "parent",
			displayName: "Alex",
			accessToken: `vps_${"a".repeat(64)}`,
			idToken: "",
			expiresAt: Date.now() + 60_000,
			pinReset: true,
		}),
	);
	await runtime.restoreSession();
	expect(runtime.state.parentLocked).toBe(true);
	expect(runtime.state.parentPinReset).toBe(true);
	expect(runtime.canAccessScreen("home:parent")).toBe(false);
	runtime.parentPinSaved();
	expect(runtime.state.parentLocked).toBe(false);
	expect(runtime.state.parentPinReset).toBe(false);
	expect(runtime.canAccessScreen("home:parent")).toBe(true);
});
