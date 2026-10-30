import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import BuddyDeviceLicense from "./BuddyDeviceLicense.svelte";
import type { FamBuddyLicense } from "./license";

const valid: FamBuddyLicense = {
	state: "valid",
	edition: "Family",
	features: [],
	expires_at: "",
};
const none: FamBuddyLicense = { state: "none", edition: "", features: [], expires_at: "" };

afterEach(() => cleanup());

it("shows this FamBuddy's license without offering to install it again", () => {
	render(BuddyDeviceLicense, {
		props: { license: valid, familyLicense: valid, busy: false, oninstall: vi.fn() },
	});
	expect(screen.getByRole("status").textContent).toContain("Active · Family edition");
	expect(screen.queryByRole("button", { name: "Install on this FamBuddy" })).toBeNull();
});

it("does not offer an install while the family has no valid license", () => {
	render(BuddyDeviceLicense, {
		props: { license: none, familyLicense: none, busy: false, oninstall: vi.fn() },
	});
	expect(screen.getByRole("status").textContent).toContain("No license");
	expect(screen.queryByRole("button", { name: "Install on this FamBuddy" })).toBeNull();
});

it("installs the family's license on a FamBuddy that has none, after a fresh paste", async () => {
	const oninstall = vi
		.fn()
		.mockRejectedValueOnce(new Error("That FamBuddy license has expired."))
		.mockRejectedValueOnce("odd")
		.mockResolvedValueOnce(undefined);
	render(BuddyDeviceLicense, {
		props: { license: none, familyLicense: valid, busy: false, oninstall },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Install on this FamBuddy" }));
	const field = screen.getByLabelText("License key") as HTMLInputElement;
	expect(field.type).toBe("password");
	await fireEvent.input(field, { target: { value: " sap-token " } });
	await fireEvent.click(screen.getByRole("button", { name: "Install" }));
	expect(await screen.findByRole("alert")).toHaveProperty(
		"textContent",
		"That FamBuddy license has expired.",
	);
	expect(oninstall).toHaveBeenCalledWith("sap-token");
	await fireEvent.click(screen.getByRole("button", { name: "Install" }));
	await vi.waitFor(() =>
		expect(screen.getByRole("alert").textContent).toBe("The license was not installed."),
	);
	await fireEvent.click(screen.getByRole("button", { name: "Install" }));
	await vi.waitFor(() => expect(screen.queryByLabelText("License key")).toBeNull());

	await fireEvent.click(screen.getByRole("button", { name: "Install on this FamBuddy" }));
	await fireEvent.input(screen.getByLabelText("License key"), { target: { value: "draft" } });
	await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
	await fireEvent.click(screen.getByRole("button", { name: "Install on this FamBuddy" }));
	expect((screen.getByLabelText("License key") as HTMLInputElement).value).toBe("");
});
