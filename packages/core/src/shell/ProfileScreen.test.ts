import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Runtime } from "../runtime/registry.svelte";
import TestProfileProvider from "./TestProfileProvider.svelte";

function makeRuntime(): Runtime {
	return {
		config: {} as Runtime["config"],
		bus: {} as Runtime["bus"],
		router: { current: { screen: "profile", params: {} }, navigate: vi.fn() },
		state: {
			identity: {
				id: "acct-1",
				name: "Parent",
				role: "manager",
				familyId: "fam-1",
				deviceId: "dev-1",
				createdAt: "2025-06-15T12:00:00Z",
			},
			familyId: "fam-1",
		},
		hasIdentity: true,
		screens: new Map(),
		navItems: [],
		services: {
			family: {
				getAvatar: vi.fn(async () => null),
				setAvatar: vi.fn(async () => {}),
			},
		} as unknown as Runtime["services"],
		theme: { mode: "light", toggle: vi.fn() },
		canAccessScreen: vi.fn(() => true),
		homeScreenForCurrentRole: vi.fn(() => "home:parent"),
		logout: vi.fn(),
		restoreSession: vi.fn(async () => {}),
		completeOnboarding: vi.fn(),
	} as unknown as Runtime;
}

describe("ProfileScreen", () => {
	afterEach(cleanup);

	it("renders the user's name, role, and account id", async () => {
		render(TestProfileProvider, { props: { runtime: makeRuntime() } });
		expect(await screen.findByRole("heading", { name: "Parent" })).toBeTruthy();
		expect(screen.getByText("manager")).toBeTruthy();
		expect(screen.getByText("acct-1")).toBeTruthy();
	});

	it("shows family, device, and member-since info rows", async () => {
		render(TestProfileProvider, { props: { runtime: makeRuntime() } });
		expect(await screen.findByText("fam-1")).toBeTruthy();
		expect(screen.getByText("dev-1")).toBeTruthy();
		// Member-since date is locale-formatted; assert the year is present.
		expect(screen.getByText(/2025/)).toBeTruthy();
	});

	it("hides the QR code until the toggle is clicked", async () => {
		render(TestProfileProvider, { props: { runtime: makeRuntime() } });
		const toggle = await screen.findByRole("button", { name: "Show QR code" });
		expect(screen.queryByAltText(/QR code for/)).toBeNull();
		fireEvent.click(toggle);
		await waitFor(() => expect(screen.getByAltText(/QR code for/)).toBeTruthy());
	});

	it("uploads a profile picture and refreshes the avatar", async () => {
		const runtime = makeRuntime();
		const setAvatar = runtime.services.family.setAvatar as ReturnType<typeof vi.fn>;
		render(TestProfileProvider, { props: { runtime } });

		const edit = await screen.findByRole("button", {
			name: "Change profile picture",
		});
		const input = edit.parentElement?.querySelector('input[type="file"]') as HTMLInputElement;
		expect(input).toBeTruthy();

		const file = new File(["fake-image-bytes"], "avatar.png", {
			type: "image/png",
		});
		await fireEvent.change(input, { target: { files: [file] } });

		await waitFor(() => expect(setAvatar).toHaveBeenCalledTimes(1));
		expect(setAvatar).toHaveBeenCalledWith(expect.any(Uint8Array), "image/png");
	});
});
