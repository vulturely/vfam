import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import type { OidcAuth } from "../auth/oidc";
import ChildPinSettings from "./ChildPinSettings.svelte";
afterEach(cleanup);
async function setup(enabled = false) {
	const getChildPinAccess = vi
		.fn()
		.mockResolvedValue({ enabled, loginId: enabled ? "old-code" : "" });
	const setChildPin = vi.fn().mockImplementation(async (_id, pin) => ({
		enabled: !!pin,
		loginId: pin ? "new-code" : "",
	}));
	render(ChildPinSettings, {
		auth: { getChildPinAccess, setChildPin } as unknown as OidcAuth,
		profileId: "jamie",
		displayName: "Jamie",
	});
	await fireEvent.click(screen.getByText("Profile PIN", { exact: true }));
	return { getChildPinAccess, setChildPin };
}
it("validates matching PINs and clears the secret after saving", async () => {
	const { setChildPin } = await setup();
	await screen.findByRole("button", { name: "Set PIN" });
	await fireEvent.input(screen.getByLabelText("Six-digit PIN"), {
		target: { value: "123456" },
	});
	await fireEvent.input(screen.getByLabelText("Confirm PIN"), {
		target: { value: "654321" },
	});
	await fireEvent.submit(screen.getByRole("button", { name: "Set PIN" }).closest("form")!);
	expect(await screen.findByRole("alert")).toHaveTextContent("both PINs match");
	expect(setChildPin).not.toHaveBeenCalled();
	await fireEvent.input(screen.getByLabelText("Confirm PIN"), {
		target: { value: "123456" },
	});
	await fireEvent.submit(screen.getByRole("button", { name: "Set PIN" }).closest("form")!);
	await screen.findByText("new-code");
	expect(setChildPin).toHaveBeenCalledWith("jamie", "123456");
	expect(screen.queryByLabelText("New six-digit PIN")).toBeNull();
	await fireEvent.click(screen.getByRole("button", { name: "Reset PIN" }));
	expect(screen.getByLabelText("New six-digit PIN")).toHaveValue("");
	expect(screen.getByLabelText("Confirm PIN")).toHaveValue("");
});
it("disables existing access and removes the sign-in code", async () => {
	const { setChildPin } = await setup(true);
	await screen.findByText("old-code");
	await fireEvent.click(screen.getByRole("button", { name: "Disable PIN access" }));
	await waitFor(() => expect(screen.queryByText("old-code")).toBeNull());
	expect(setChildPin).toHaveBeenCalledWith("jamie", "");
	expect(await screen.findByRole("button", { name: "Set PIN" })).toBeEnabled();
});
it("preserves saved access and lets guardians retry failed updates", async () => {
	const { setChildPin } = await setup(true);
	setChildPin.mockRejectedValue(new Error("Service unavailable"));
	await screen.findByText("old-code");
	await fireEvent.click(screen.getByRole("button", { name: "Disable PIN access" }));
	expect(await screen.findByRole("alert")).toHaveTextContent("Service unavailable");
	expect(screen.getByText("old-code")).toBeTruthy();
	expect(screen.getByRole("button", { name: "Disable PIN access" })).toBeEnabled();
});
it("toggles PIN visibility independently without changing the digits", async () => {
	await setup();
	const pin = await screen.findByLabelText("Six-digit PIN");
	const confirmation = screen.getByLabelText("Confirm PIN");
	await fireEvent.input(pin, { target: { value: "123456" } });
	expect(pin).toHaveAttribute("type", "password");
	await fireEvent.click(screen.getByRole("button", { name: "Show PIN", exact: true }));
	expect(pin).toHaveAttribute("type", "text");
	expect(pin).toHaveValue("123456");
	expect(confirmation).toHaveAttribute("type", "password");
	await fireEvent.click(screen.getByRole("button", { name: "Show confirmation PIN" }));
	expect(confirmation).toHaveAttribute("type", "text");
	await fireEvent.click(screen.getByRole("button", { name: "Hide PIN", exact: true }));
	expect(pin).toHaveAttribute("type", "password");
	expect(pin).toHaveValue("123456");
});
