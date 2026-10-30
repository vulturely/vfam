import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import Sidebar from "./Sidebar.svelte";
import type { Runtime } from "../runtime/registry.svelte";
import House from "lucide-svelte/icons/house";

/** Minimal Runtime mock for the Sidebar component. Read-only; the component's
 * `$derived` reactions handle observing these values. */
function mockRuntime(): Runtime {
	return {
		config: {} as Runtime["config"],
		bus: {} as Runtime["bus"],
		router: {
			current: { screen: "home:parent", params: {} },
			navigate: vi.fn(),
		},
		state: {
			identity: {
				id: "acct-1",
				name: "Parent",
				role: "manager",
				familyId: "fam-1",
				deviceId: "dev-1",
				createdAt: "2026-01-01T00:00:00Z",
			},
			familyId: "fam-1",
		},
		hasIdentity: true,
		screens: new Map(),
		navItems: [
			{
				id: "home:parent",
				label: "Parent home",
				icon: House,
				roles: ["manager"],
				order: 0,
			},
			{ id: "family:manage", label: "Family", roles: ["manager"], order: 1 },
			{ id: "profile", label: "Profile", order: 2 },
		],
		services: {
			family: { getAvatar: vi.fn(async () => null) },
			lifecycle: { canExit: vi.fn(() => true), exit: vi.fn(async () => {}) },
		} as unknown as Runtime["services"],
		theme: { mode: "light", toggle: vi.fn() },
		canAccessScreen: vi.fn(() => true),
		homeScreenForCurrentRole: vi.fn(() => "home:parent"),
		logout: vi.fn(),
		restoreSession: vi.fn(async () => {}),
		completeOnboarding: vi.fn(),
	} as unknown as Runtime;
}

describe("Sidebar mobile navigation sheet", () => {
	afterEach(cleanup);

	it("renders desktop nav items (visible ones) with an accessible label", () => {
		render(Sidebar, { props: { runtime: mockRuntime() } });
		expect(screen.getByLabelText("Parent home")).toBeTruthy();
		expect(screen.getByLabelText("Family")).toBeTruthy();
	});

	it("opens the mobile sheet from the floating Menu button", async () => {
		const runtime = mockRuntime();
		render(Sidebar, { props: { runtime } });
		fireEvent.click(screen.getByLabelText("Open menu"));
		expect(await screen.findByRole("dialog", { name: "Menu" })).toBeTruthy();
	});

	it("navigates when a mobile nav item is chosen and closes the sheet", async () => {
		const runtime = mockRuntime();
		render(Sidebar, { props: { runtime } });
		fireEvent.click(screen.getByLabelText("Open menu"));
		const sheet = await screen.findByRole("dialog", { name: "Menu" });
		fireEvent.click(within(sheet).getByText("Family"));
		expect(runtime.router.navigate).toHaveBeenCalledWith("family:manage");
		// Sheet closes after navigation (allow the out transition to finish).
		await waitFor(() => expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull());
	});

	it("runs the theme toggle from the mobile sheet", async () => {
		const runtime = mockRuntime();
		render(Sidebar, { props: { runtime } });
		fireEvent.click(screen.getByLabelText("Open menu"));
		fireEvent.click(await screen.findByText("Dark mode"));
		expect(runtime.theme.toggle).toHaveBeenCalledTimes(1);
	});

	it("runs logout from the mobile sheet", async () => {
		const runtime = mockRuntime();
		render(Sidebar, { props: { runtime } });
		fireEvent.click(screen.getByLabelText("Open menu"));
		fireEvent.click(await screen.findByText("Log out"));
		expect(runtime.logout).toHaveBeenCalledTimes(1);
	});

	it("closes the sheet when clicking outside it", async () => {
		render(Sidebar, { props: { runtime: mockRuntime() } });
		fireEvent.click(screen.getByLabelText("Open menu"));
		expect(await screen.findByRole("dialog", { name: "Menu" })).toBeTruthy();
		// Click a point outside the sheet (the document body).
		fireEvent.pointerDown(document.body);
		await waitFor(() => expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull());
	});

	it("closes on Escape and restores focus to the menu trigger", async () => {
		render(Sidebar, { props: { runtime: mockRuntime() } });
		const trigger = screen.getByLabelText("Open menu");
		fireEvent.click(trigger);
		const panel = await screen.findByRole("dialog", { name: "Menu" });
		await waitFor(() => expect(document.activeElement).toBe(panel));
		fireEvent.keyDown(document, { key: "Escape" });
		await waitFor(() => expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull());
		expect(document.activeElement).toBe(trigger);
	});

	it("renders a profile nav link to the profile page", () => {
		render(Sidebar, { props: { runtime: mockRuntime() } });
		const link = screen.getByLabelText("Profile");
		expect(link.getAttribute("href")).toBe("#/profile");
	});
});

describe("Sidebar account menu", () => {
	afterEach(cleanup);

	it("opens Switch profile, Log out and Exit from the account button", async () => {
		const runtime = mockRuntime();
		render(Sidebar, { props: { runtime } });
		await fireEvent.pointerDown(screen.getByLabelText("Account menu"), {
			button: 0,
			pointerType: "mouse",
		});
		const menu = await screen.findByRole("menu");
		expect(within(menu).getByRole("menuitem", { name: "Switch profile" })).toBeVisible();
		expect(within(menu).getByRole("menuitem", { name: "Log out" })).toBeVisible();
		await fireEvent.click(within(menu).getByRole("menuitem", { name: "Switch profile" }));
		expect(runtime.router.navigate).toHaveBeenCalledWith("profile:choose");
		await fireEvent.pointerDown(screen.getByLabelText("Account menu"), {
			button: 0,
			pointerType: "mouse",
		});
		await fireEvent.click(await screen.findByRole("menuitem", { name: "Exit" }));
		expect(runtime.services.lifecycle.exit).toHaveBeenCalledOnce();
		await fireEvent.pointerDown(screen.getByLabelText("Account menu"), {
			button: 0,
			pointerType: "mouse",
		});
		await fireEvent.click(await screen.findByRole("menuitem", { name: "Log out" }));
		expect(runtime.logout).toHaveBeenCalledOnce();
	});

	it("hides Switch profile and Exit where they do not apply", async () => {
		const runtime = mockRuntime();
		vi.mocked(runtime.canAccessScreen).mockReturnValue(false);
		vi.mocked(runtime.services.lifecycle.canExit).mockReturnValue(false);
		render(Sidebar, { props: { runtime } });
		await fireEvent.pointerDown(screen.getByLabelText("Account menu"), {
			button: 0,
			pointerType: "mouse",
		});
		const menu = await screen.findByRole("menu");
		expect(within(menu).queryByRole("menuitem", { name: "Switch profile" })).toBeNull();
		expect(within(menu).queryByRole("menuitem", { name: "Exit" })).toBeNull();
	});

	it("offers the same actions in the mobile sheet", async () => {
		const runtime = mockRuntime();
		render(Sidebar, { props: { runtime } });
		fireEvent.click(screen.getByLabelText("Open menu"));
		fireEvent.click(await screen.findByText("Switch profile"));
		expect(runtime.router.navigate).toHaveBeenCalledWith("profile:choose");
		fireEvent.click(screen.getByLabelText("Open menu"));
		fireEvent.click(await screen.findByText("Exit"));
		expect(runtime.services.lifecycle.exit).toHaveBeenCalledOnce();
	});
});

describe("Sidebar child navigation", () => {
	afterEach(cleanup);

	it("shows the child's items and only Switch profile in the account menu", async () => {
		const runtime = mockRuntime();
		const navigate = vi.fn();
		const switchProfile = vi.fn();
		render(Sidebar, {
			props: {
				runtime,
				nav: {
					items: [
						{ id: "child:home", label: "Home", icon: House },
						{ id: "profile", label: "Profile" },
					],
					current: "child:home",
					navigate,
					picture: "blob:kid",
					switchProfile,
				},
			},
		});
		expect(screen.queryByLabelText("Parent home")).toBeNull();
		const home = screen.getByLabelText("Home");
		expect(home).toHaveAttribute("aria-current", "page");
		await fireEvent.click(screen.getByLabelText("Profile"));
		expect(navigate).toHaveBeenCalledWith("profile");
		expect(runtime.router.navigate).not.toHaveBeenCalled();
		await fireEvent.pointerDown(screen.getByLabelText("Account menu"), {
			button: 0,
			pointerType: "mouse",
		});
		const menu = await screen.findByRole("menu");
		expect(within(menu).queryByRole("menuitem", { name: "Log out" })).toBeNull();
		expect(within(menu).queryByRole("menuitem", { name: "Exit" })).toBeNull();
		await fireEvent.click(within(menu).getByRole("menuitem", { name: "Switch profile" }));
		expect(switchProfile).toHaveBeenCalled();
	});
});
