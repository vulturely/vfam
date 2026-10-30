import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import BuddyScreenPin from "./BuddyScreenPin.svelte";

afterEach(cleanup);

async function enter(pin: string, confirmation: string) {
	await fireEvent.input(screen.getByLabelText("New PIN"), { target: { value: pin } });
	await fireEvent.input(screen.getByLabelText("Enter the PIN again"), {
		target: { value: confirmation },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Save PIN" }));
}

it("sets a new PIN with masked numeric inputs and clears them afterwards", async () => {
	const onsave = vi.fn(async () => {});
	render(BuddyScreenPin, { pinSet: false, busy: false, onsave });
	expect(screen.getByText("No PIN")).toBeVisible();
	expect(
		screen.getByText("Needed on the FamBuddy's own screen before changing its Wi-Fi."),
	).toBeVisible();
	expect(screen.queryByRole("button", { name: "Remove PIN" })).toBeNull();
	await fireEvent.click(screen.getByRole("button", { name: "Set PIN" }));
	for (const label of ["New PIN", "Enter the PIN again"]) {
		const input = screen.getByLabelText(label);
		expect(input).toHaveAttribute("type", "password");
		expect(input).toHaveAttribute("inputmode", "numeric");
		expect(input).toHaveAttribute("autocomplete", "off");
	}
	await enter("482913", "482913");
	expect(onsave).toHaveBeenCalledWith("482913");
	await vi.waitFor(() => expect(screen.queryByLabelText("New PIN")).toBeNull());
	await fireEvent.click(screen.getByRole("button", { name: "Set PIN" }));
	expect(screen.getByLabelText("New PIN")).toHaveValue("");
	expect(screen.getByLabelText("Enter the PIN again")).toHaveValue("");
});

it("rejects mismatched, short, and non-digit PINs without sending them", async () => {
	const onsave = vi.fn(async () => {});
	render(BuddyScreenPin, { pinSet: true, busy: false, onsave });
	await fireEvent.click(screen.getByRole("button", { name: "Change PIN" }));
	await enter("1234", "1243");
	expect(screen.getByRole("alert")).toHaveTextContent("The two PINs do not match.");
	await enter("123", "123");
	expect(screen.getByRole("alert")).toHaveTextContent("Use 4 to 8 digits.");
	await enter("12ab", "12ab");
	expect(screen.getByRole("alert")).toHaveTextContent("Use digits only.");
	expect(onsave).not.toHaveBeenCalled();
});

it("cancels by clearing the entries", async () => {
	const onsave = vi.fn(async () => {});
	render(BuddyScreenPin, { pinSet: true, busy: false, onsave });
	await fireEvent.click(screen.getByRole("button", { name: "Change PIN" }));
	await enter("1234", "9999");
	await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
	expect(screen.queryByRole("alert")).toBeNull();
	await fireEvent.click(screen.getByRole("button", { name: "Change PIN" }));
	expect(screen.getByLabelText("New PIN")).toHaveValue("");
	expect(onsave).not.toHaveBeenCalled();
});

it("removes the PIN by sending an empty one", async () => {
	const onsave = vi.fn(async () => {});
	render(BuddyScreenPin, { pinSet: true, busy: false, onsave });
	expect(screen.getByText("PIN set")).toBeVisible();
	await fireEvent.click(screen.getByRole("button", { name: "Remove PIN" }));
	expect(onsave).toHaveBeenCalledWith("");
});

it("keeps the entries for a retry when saving fails and disables actions while busy", async () => {
	const onsave = vi.fn(async () => {
		throw new Error("Hub unavailable");
	});
	const view = render(BuddyScreenPin, { pinSet: false, busy: false, onsave });
	await fireEvent.click(screen.getByRole("button", { name: "Set PIN" }));
	await enter("5555", "5555");
	expect(onsave).toHaveBeenCalledWith("5555");
	await vi.waitFor(() => expect(screen.getByRole("button", { name: "Save PIN" })).toBeEnabled());
	expect(screen.getByLabelText("New PIN")).toHaveValue("5555");
	await view.rerender({ pinSet: false, busy: true, onsave });
	expect(screen.getByRole("button", { name: "Save PIN" })).toBeDisabled();
});
