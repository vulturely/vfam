import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import type { Runtime } from "../runtime/registry.svelte";
import ProfileChooser from "./ProfileChooser.svelte";
afterEach(cleanup);
function setup(
	children = true,
	withFamily = true,
	parentPin = true,
	parentLocked = false,
	parentPinReset = false,
) {
	const navigate = vi.fn();
	const signInChild = vi.fn().mockRejectedValue(new Error("Wrong PIN"));
	const getChildPinAccess = vi.fn().mockResolvedValue({ enabled: true, loginId: "jamie-code" });
	const setParentPin = vi.fn().mockResolvedValue({ enabled: true });
	const unlockParentProfile = vi.fn(async (pin: string) => {
		if (pin !== "482691") throw new Error("Wrong PIN");
	});
	const logout = vi.fn();
	const forgotParentPin = vi.fn().mockRejectedValueOnce(new Error("offline"));
	const parentPinSaved = vi.fn();
	const runtime = {
		state: { identity: { id: "parent", name: "Alex" }, parentLocked, parentPinReset },
		router: { navigate },
		unlockParentProfile,
		logout,
		forgotParentPin,
		parentPinSaved,
		services: {
			family: {
				getMyFamily: vi.fn().mockResolvedValue(withFamily ? { id: "family" } : null),
			},
			learning: {
				listProfiles: vi.fn().mockResolvedValue(
					children
						? [
								{ id: "jamie", displayName: "Jamie" },
								{ id: "riley", displayName: "Riley" },
							]
						: [],
				),
			},
			auth: {
				getChildPinAccess,
				signInChild,
				getParentPinAccess: vi.fn().mockResolvedValue({ enabled: parentPin }),
				setParentPin,
			},
		},
	} as unknown as Runtime;
	render(ProfileChooser, { context: new Map([["vulture:runtime", runtime]]) });
	return {
		navigate,
		signInChild,
		getChildPinAccess,
		unlockParentProfile,
		logout,
		forgotParentPin,
		parentPinSaved,
		setParentPin,
	};
}
it("offers parent and child profiles when multiple profiles exist", async () => {
	const { navigate } = setup();
	await screen.findByRole("button", { name: /Jamie/ });
	expect(screen.getByRole("button", { name: /Riley/ })).toBeVisible();
	await fireEvent.click(screen.getByRole("button", { name: /Alex/ }));
	await waitFor(() => expect(navigate).toHaveBeenCalledWith("home:parent"));
});
it("opens the sole parent profile automatically", async () => {
	const { navigate } = setup(false);
	await waitFor(() => expect(navigate).toHaveBeenCalledWith("home:parent"));
	expect(screen.queryByRole("button", { name: /Alex/ })).toBeNull();
});
it("starts onboarding when the family has not been created", async () => {
	const { navigate } = setup(false, false);
	await waitFor(() => expect(navigate).toHaveBeenCalledWith("family:setup"));
});
it("requires the selected child's PIN without exposing their sign-in code", async () => {
	const { signInChild, getChildPinAccess } = setup();
	await fireEvent.click(await screen.findByRole("button", { name: /Jamie/ }));
	await screen.findByLabelText("Six-digit PIN");
	expect(getChildPinAccess).toHaveBeenCalledWith("jamie");
	expect(screen.queryByText("jamie-code")).toBeNull();
	expect(signInChild).not.toHaveBeenCalled();
	await fireEvent.input(screen.getByLabelText("Six-digit PIN"), {
		target: { value: "123456" },
	});
	await fireEvent.submit(screen.getByRole("button", { name: "Unlock" }).closest("form")!);
	expect(signInChild).toHaveBeenCalledWith("jamie-code", "123456");
	expect(await screen.findByRole("alert")).toHaveTextContent("Check your PIN");
	expect(screen.getByLabelText("Six-digit PIN")).toHaveValue("");
});

it("offers parent PIN setup from the parent profile when no PIN exists", async () => {
	const { navigate } = setup(true, true, false);
	await fireEvent.click(await screen.findByRole("button", { name: /Alex/ }));
	expect(await screen.findByRole("heading", { name: "Your parent PIN" })).toBeVisible();
	expect(await screen.findByLabelText("New parent PIN")).toBeVisible();
	expect(navigate).not.toHaveBeenCalled();
});

it("asks for the parent PIN before opening a locked parent profile", async () => {
	const { navigate, unlockParentProfile } = setup(true, true, true, true);
	await fireEvent.click(await screen.findByRole("button", { name: /Alex/ }));
	const input = await screen.findByLabelText("Parent PIN");
	expect(navigate).not.toHaveBeenCalled();
	await fireEvent.input(input, { target: { value: "000000" } });
	await fireEvent.submit(input.closest("form")!);
	expect(await screen.findByRole("alert")).toHaveTextContent("Check your parent PIN");
	expect(screen.getByLabelText("Parent PIN")).toHaveValue("");
	expect(navigate).not.toHaveBeenCalled();
	await fireEvent.input(screen.getByLabelText("Parent PIN"), { target: { value: "482691" } });
	await fireEvent.submit(screen.getByLabelText("Parent PIN").closest("form")!);
	await waitFor(() => expect(navigate).toHaveBeenCalledWith("home:parent"));
	expect(unlockParentProfile).toHaveBeenLastCalledWith("482691");
});

it("returns from the parent PIN prompt to the profile list", async () => {
	setup(true, true, true, true);
	await fireEvent.click(await screen.findByRole("button", { name: /Alex/ }));
	await fireEvent.click(await screen.findByRole("button", { name: "Profiles" }));
	expect(await screen.findByRole("button", { name: /Jamie/ })).toBeVisible();
	expect(screen.queryByLabelText("Parent PIN")).toBeNull();
});

it("asks a locked parent with no child profiles for the PIN instead of opening home", async () => {
	const { navigate, logout } = setup(false, true, true, true);
	expect(await screen.findByLabelText("Parent PIN")).toBeVisible();
	expect(screen.queryByRole("button", { name: "Profiles" })).toBeNull();
	expect(navigate).not.toHaveBeenCalled();
	await fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
	expect(logout).toHaveBeenCalled();
});

it("offers a forgotten parent PIN reset from the locked parent prompt", async () => {
	const { forgotParentPin } = setup(true, true, true, true);
	await fireEvent.click(await screen.findByRole("button", { name: /Alex/ }));
	const forgot = await screen.findByRole("button", { name: "Forgot PIN? Sign in to reset" });
	await fireEvent.click(forgot);
	expect(await screen.findByRole("alert")).toHaveTextContent("Could not start sign-in");
	await fireEvent.click(forgot);
	expect(forgotParentPin).toHaveBeenCalledTimes(2);
});

it("asks a parent who signed in to reset the PIN for a new PIN, then opens home", async () => {
	const { navigate, parentPinSaved, setParentPin } = setup(true, true, true, true, true);
	expect(await screen.findByRole("heading", { name: "Set a new parent PIN" })).toBeVisible();
	expect(screen.queryByLabelText("Current parent PIN")).toBeNull();
	await fireEvent.input(await screen.findByLabelText("New parent PIN"), {
		target: { value: "222222" },
	});
	await fireEvent.input(screen.getByLabelText("Confirm parent PIN"), {
		target: { value: "222222" },
	});
	await fireEvent.submit(screen.getByRole("button", { name: "Save PIN" }).closest("form")!);
	await waitFor(() => expect(navigate).toHaveBeenCalledWith("home:parent"));
	expect(setParentPin).toHaveBeenCalledWith("222222", "");
	expect(parentPinSaved).toHaveBeenCalledOnce();
});
