import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import { GetChildPolicyResponse } from "../api/protocol";
import type { Runtime } from "../runtime/registry.svelte";
import ChildMode from "./ChildMode.svelte";
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	// The child shell keeps its page in the hash.
	window.history.replaceState(null, "", "#/");
});

function setup(active = true) {
	const auth = {
		signIn: vi.fn(async () => {}),
		signOut: vi.fn(async () => {}),
		unlockParent: vi.fn(async () => {}),
		switchChildProfile: vi.fn(async () => {}),
	};
	const runtime = {
		state: {
			childSession: active
				? {
						status: "active",
						profileId: "kid",
						familyId: "family",
						displayName: "Ana",
						expiresAt: "",
					}
				: { status: "locked", message: "Paused" },
		},
		theme: { mode: "light", toggle: vi.fn() },
		refreshChildSession: vi.fn(async () => {}),
		services: {
			auth,
			childHome: {
				tasks: vi.fn(async () => []),
				avatar: vi.fn(async () => ({ image: new Uint8Array([1]), contentType: "image/png" })),
				family: vi.fn(async () => [
					{ participantId: "mum", displayName: "Mum", guardian: true, child: false },
					{ participantId: "profile:kid", displayName: "Ana", guardian: false, child: true },
					{ participantId: "profile:sam", displayName: "Sam", guardian: false, child: true },
				]),
			},
			timetable: {
				policy: vi.fn(
					async () =>
						new GetChildPolicyResponse({
							allowed: false,
							evaluatedAt: new Date().toISOString(),
							validUntil: new Date(Date.now() + 30000).toISOString(),
						}),
				),
			},
			childLearning: { list: vi.fn(async () => []) },
			childFamilyAi: { mode: vi.fn(async () => "parent_device") },
		},
	} as unknown as Runtime;
	render(ChildMode, {
		props: { runtime },
		context: new Map([["vulture:runtime", runtime]]),
	});
	return { runtime, auth };
}

it("opens home, learning, profile and switch profile in the child shell", async () => {
	const { runtime, auth } = setup();
	expect(await screen.findByRole("heading", { name: "Hi, Ana!" })).toBeVisible();
	expect(runtime.services.childHome.avatar).toHaveBeenCalledWith("kid");
	await fireEvent.click(screen.getByLabelText("Learning"));
	expect(await screen.findByText("Time for a pause")).toBeVisible();
	await fireEvent.click(screen.getByLabelText("Profile"));
	expect(await screen.findByRole("heading", { name: "Ana" })).toBeVisible();
	await waitFor(() =>
		expect(
			screen.getByRole("button", { name: "Change your picture" }).querySelector("img"),
		).toHaveAttribute("src", expect.stringMatching(/^blob:/)),
	);
	await fireEvent.pointerDown(screen.getByLabelText("Account menu"), {
		button: 0,
		pointerType: "mouse",
	});
	const menu = await screen.findByRole("menu");
	await fireEvent.click(within(menu).getByRole("menuitem", { name: "Switch profile" }));
	expect(await screen.findByRole("heading", { name: "Who’s here?" })).toBeVisible();
	expect(screen.queryByRole("button", { name: /Ana/ })).toBeNull();
	await fireEvent.click(screen.getByRole("button", { name: /Mum.*Parent/ }));
	await fireEvent.input(screen.getByLabelText("Parent PIN"), { target: { value: "123456" } });
	await fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
	await waitFor(() => expect(auth.unlockParent).toHaveBeenCalledWith("123456"));
});

async function openChooser() {
	await screen.findByRole("heading", { name: "Hi, Ana!" });
	await fireEvent.pointerDown(screen.getByLabelText("Account menu"), {
		button: 0,
		pointerType: "mouse",
	});
	const menu = await screen.findByRole("menu");
	await fireEvent.click(within(menu).getByRole("menuitem", { name: "Switch profile" }));
	await screen.findByRole("heading", { name: "Who’s here?" });
}

it("switches to a sibling with their PIN and reports wrong PINs", async () => {
	const { auth } = setup();
	await openChooser();
	expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
	auth.switchChildProfile.mockRejectedValueOnce(new Error("bad"));
	await fireEvent.click(screen.getByRole("button", { name: /Sam.*Child/ }));
	await fireEvent.input(screen.getByLabelText("Six-digit PIN"), { target: { value: "000000" } });
	await fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
	expect(await screen.findByText(/Check your PIN/)).toBeVisible();
	await fireEvent.input(screen.getByLabelText("Six-digit PIN"), { target: { value: "654321" } });
	await fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
	await waitFor(() => expect(auth.switchChildProfile).toHaveBeenLastCalledWith("sam", "654321"));
});

it("offers guardian sign-in when the parent PIN is forgotten or wrong", async () => {
	const { auth } = setup();
	await openChooser();
	await fireEvent.click(screen.getByRole("button", { name: /Mum.*Parent/ }));
	expect(screen.getByRole("heading", { name: "Mum" })).toBeVisible();
	expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
	auth.unlockParent.mockRejectedValueOnce(new Error("bad"));
	await fireEvent.input(screen.getByLabelText("Parent PIN"), { target: { value: "000000" } });
	await fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
	expect(await screen.findByText(/Check your parent PIN/)).toBeVisible();
	await fireEvent.click(screen.getByRole("button", { name: "Forgot PIN? Sign in to reset" }));
	await waitFor(() => expect(auth.signIn).toHaveBeenCalled());
	await fireEvent.click(screen.getByRole("button", { name: "Profiles" }));
	expect(screen.getByRole("button", { name: /Sam.*Child/ })).toBeVisible();
});

it("shows the paused session with help and ending the session", async () => {
	const { auth } = setup(false);
	expect(screen.getByRole("heading", { name: "Learning session paused" })).toBeVisible();
	await fireEvent.click(screen.getByRole("button", { name: "Help" }));
	expect(screen.getByText(/Ask your guardian to sign in/)).toBeVisible();
	auth.signOut.mockRejectedValueOnce(new Error("offline"));
	await fireEvent.click(screen.getByRole("button", { name: "End child session" }));
	expect(await screen.findByText(/Could not reach the server/)).toBeVisible();
	await fireEvent.click(screen.getByRole("button", { name: "End child session" }));
	await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(2));
});
