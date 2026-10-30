import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Runtime } from "../runtime/registry.svelte";
import Topbar from "./Topbar.svelte";

function makeRuntime(identity: Runtime["state"]["identity"]): Runtime {
	return {
		config: { name: "Vulture" } as Runtime["config"],
		bus: {} as Runtime["bus"],
		router: {
			current: { screen: "home:parent", params: {} },
			navigate: vi.fn(),
		},
		state: { identity, familyId: identity?.familyId ?? null },
		hasIdentity: identity != null,
		screens: new Map(),
		navItems: [],
		services: {} as Runtime["services"],
		theme: { mode: "light", toggle: vi.fn() },
		canAccessScreen: vi.fn(() => true),
		homeScreenForCurrentRole: vi.fn(() => "home:parent"),
		logout: vi.fn(),
		restoreSession: vi.fn(async () => {}),
		completeOnboarding: vi.fn(),
	} as unknown as Runtime;
}

describe("Topbar", () => {
	afterEach(cleanup);

	it("renders the user's name and role when signed in", () => {
		render(Topbar, {
			props: {
				runtime: makeRuntime({
					id: "acct-1",
					name: "Parent",
					role: "manager",
					familyId: "fam-1",
					deviceId: "dev-1",
					createdAt: "2026-01-01T00:00:00Z",
				}),
			},
		});
		expect(screen.getByText("Parent")).toBeTruthy();
		expect(screen.getByText("manager")).toBeTruthy();
	});

	it("renders nothing when signed out", () => {
		render(Topbar, { props: { runtime: makeRuntime(null) } });
		expect(screen.queryByText("Parent")).toBeNull();
	});
});
