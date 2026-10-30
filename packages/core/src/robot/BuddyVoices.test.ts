import { fireEvent, render, screen } from "@testing-library/svelte";
import { expect, it, vi } from "vitest";
import BuddyVoices from "./BuddyVoices.svelte";

it("names voices as children or parents", async () => {
	const onsave = vi
		.fn<(speaker: string, name: string, role: string) => Promise<unknown>>()
		.mockResolvedValueOnce(undefined)
		.mockRejectedValueOnce(new Error("offline"));
	render(BuddyVoices, {
		voices: [
			{ speaker: "a", name: "", role: "child" },
			{ speaker: "b", name: "Mum", role: "parent" },
		],
		busy: false,
		onsave,
	});
	const [first, second] = screen.getAllByRole("button", { name: "Save" });
	expect(first).toBeDisabled();
	await fireEvent.input(screen.getByLabelText("Name for voice 1"), {
		target: { value: "  Jamie " },
	});
	await fireEvent.click(first);
	expect(onsave).toHaveBeenCalledWith("a", "Jamie", "child");
	await fireEvent.change(screen.getByLabelText("Who is voice 2"), { target: { value: "child" } });
	await fireEvent.click(second);
	expect(onsave).toHaveBeenLastCalledWith("b", "Mum", "child");
	await fireEvent.change(screen.getByLabelText("Who is voice 2"), { target: { value: "parent" } });
	await fireEvent.click(second);
	expect(onsave).toHaveBeenLastCalledWith("b", "Mum", "parent");
});

it("says when no voices are enrolled", () => {
	render(BuddyVoices, { voices: [], busy: false, onsave: vi.fn() });
	expect(screen.getByText("No voices are enrolled on this FamBuddy yet.")).toBeVisible();
});
