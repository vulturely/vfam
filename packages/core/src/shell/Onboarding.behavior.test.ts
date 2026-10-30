import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import Onboarding from "./Onboarding.svelte";
import InfoPage from "./InfoPage.svelte";
import ChildMode from "./ChildMode.svelte";
import type { Runtime } from "../runtime/registry.svelte";

afterEach(cleanup);

function onboardingRuntime(screen = "", native = true) {
	const auth = {
		signIn: vi.fn(async () => {}),
		isNative: vi.fn(() => native),
	};
	const runtime = {
		config: { name: "Vulture" },
		router: { current: { screen }, navigate: vi.fn() },
		state: {},
		services: { auth },
		theme: { mode: "light", toggle: vi.fn() },
		restoreSession: vi.fn(async () => {}),
	} as unknown as Runtime;
	render(Onboarding, { runtime });
	return { runtime, auth };
}

it("starts native sign-in and restores the session", async () => {
	const { runtime, auth } = onboardingRuntime();
	await fireEvent.click(screen.getAllByRole("button", { name: "Login" })[0]);
	await waitFor(() => expect(auth.signIn).toHaveBeenCalledOnce());
	expect(runtime.restoreSession).toHaveBeenCalledOnce();
});

it("shows sign-in failures and supports information-page navigation and theme changes", async () => {
	const { runtime, auth } = onboardingRuntime("about");
	auth.signIn.mockRejectedValue(new Error("OIDC unavailable"));
	await fireEvent.click(screen.getAllByRole("button", { name: "Login" })[0]);
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"OIDC unavailable",
	);
	await fireEvent.click(screen.getAllByRole("button", { name: "Back", exact: true })[0]);
	expect(runtime.router.navigate).toHaveBeenCalledWith("");
	const brand = screen.getByRole("button", { name: "Vulture home" });
	await fireEvent.keyDown(brand, { key: "Enter" });
	await fireEvent.keyDown(brand, { key: " " });
	await fireEvent.keyDown(brand, { key: "x" });
	await fireEvent.click(brand);
	expect(runtime.router.navigate).toHaveBeenCalledTimes(4);
	await fireEvent.click(screen.getAllByRole("button", { name: "Switch to dark theme" })[0]);
	expect(runtime.theme.toggle).toHaveBeenCalledOnce();
});

it("renders every information page and the about fallback", async () => {
	for (const name of ["about", "contact", "privacy", "terms", "unknown"]) {
		const view = render(InfoPage, { screen: name });
		if (name === "about") {
			expect(await screen.findByAltText("Vulture")).toBeVisible();
			expect(view.getByText(/Vulture icon adapted/)).toBeVisible();
		} else if (name === "unknown") {
			expect(screen.getByRole("heading", { name: "About Vulture" })).toBeVisible();
		} else if (name === "contact") {
			expect(screen.getByText(/Send us a message/)).toBeVisible();
		} else if (name === "privacy") {
			expect(screen.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();
		} else {
			expect(screen.getByRole("region", { name: "Terms and Conditions content" })).toBeVisible();
		}
		view.unmount();
	}
});

function childRuntime() {
	const auth = {
		signIn: vi.fn(async () => {}),
		signOut: vi.fn(async () => {}),
		unlockParent: vi.fn(async () => {}),
		getChildPinAccess: vi.fn(async () => ({ enabled: true, loginId: "jamie" })),
		getChildAccessToken: vi.fn(async () => "child-token"),
		signInChild: vi.fn(async () => {}),
	};
	const runtime = {
		config: { oidc: { authority: "https://auth.example", clientId: "vulture" } },
		state: { childSession: null, identity: null },
		services: {
			auth,
			timetable: { policy: vi.fn(async () => ({ allowed: false, currentActivity: "Break" })) },
			childLearning: { list: vi.fn(async () => []) },
			voice: {},
		},
		refreshChildSession: vi.fn(async () => {}),
		router: { current: { screen: "home:kid" }, navigate: vi.fn() },
	} as unknown as Runtime;
	render(ChildMode, { runtime });
	return { runtime, auth };
}

it("recovers from guardian sign-in and sign-out failures in paused child mode", async () => {
	const { auth } = childRuntime();
	await fireEvent.click(screen.getByRole("button", { name: "Help", exact: true }));
	expect(screen.getByText(/Ask your guardian to sign in/)).toBeVisible();
	expect(screen.queryByRole("button", { name: "Switch child profile" })).toBeNull();
	auth.signIn.mockRejectedValueOnce(new Error("offline"));
	await fireEvent.click(screen.getByRole("button", { name: "Guardian sign-in" }));
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Could not reach the server",
	);
	auth.signOut.mockRejectedValueOnce(new Error("offline"));
	await fireEvent.click(screen.getByRole("button", { name: "End child session" }));
	await waitFor(() => expect(auth.signOut).toHaveBeenCalledOnce());
	await fireEvent.click(screen.getByRole("button", { name: "Guardian sign-in" }));
	await waitFor(() => expect(auth.signIn).toHaveBeenCalledTimes(2));
});

it("ends a child session successfully", async () => {
	const { auth } = childRuntime();
	await fireEvent.click(screen.getByRole("button", { name: "End child session" }));
	await waitFor(() => expect(auth.signOut).toHaveBeenCalledOnce());
});
