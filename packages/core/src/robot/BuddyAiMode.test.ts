import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import BuddyAiMode from "./BuddyAiMode.svelte";
import type { BuddySettings } from "./buddy";
import { ON_DEVICE_AI } from "./license";

afterEach(cleanup);

const base: BuddySettings = { device: "device", wake_word: "hey buddy", muted: false };

function show(settings: Partial<BuddySettings>, busy = false, onmode = vi.fn(async () => {})) {
	render(BuddyAiMode, { settings: { ...base, ...settings }, busy, onmode });
	return onmode;
}

it("shows the mode in effect and that on-device AI is available", () => {
	show({ ai_mode: "local_first", local_ai: true });
	expect(screen.getByRole("status")).toHaveTextContent("On-device AI: available");
	expect(screen.getByRole("radio", { name: /Local first, cloud when needed/ })).toBeChecked();
	expect(screen.getByRole("radio", { name: /Local only/ })).not.toBeChecked();
	expect(screen.getByText(/never go to a cloud AI unless a parent chooses/)).toBeVisible();
});

it("says what on-device AI needs when it is not available", () => {
	show({ ai_mode: "unknown" });
	expect(screen.getByRole("status")).toHaveTextContent(
		"On-device AI: not available (needs a 4 GB+ FamBuddy and a license with On-device AI)",
	);
	expect(screen.queryByText(/isn't running/)).toBeNull();
	for (const radio of screen.getAllByRole("radio")) expect(radio).not.toBeChecked();
});

it("says when a licensed FamBuddy's on-device AI is not running", () => {
	show({
		local_ai: false,
		license: { state: "valid", edition: "Family", features: [ON_DEVICE_AI], expires_at: "" },
	});
	expect(
		screen.getByText(/Licensed for On-device AI, but this FamBuddy's AI isn't running/),
	).toBeVisible();
});

it("sends the chosen mode, and nothing for the mode already in effect", async () => {
	const onmode = show({ ai_mode: "local_only", local_ai: true });
	await fireEvent.click(screen.getByRole("radio", { name: /Cloud only/ }));
	expect(onmode).toHaveBeenCalledWith("cloud_only");
	await fireEvent.change(screen.getByRole("radio", { name: /Local only/ }));
	expect(onmode).toHaveBeenCalledOnce();
});

it("keeps the choice available after a failed save, and disables it while busy", async () => {
	const onmode = vi.fn(async () => {
		throw new Error("offline");
	});
	show({ ai_mode: "local_only" }, false, onmode);
	await fireEvent.click(screen.getByRole("radio", { name: /Local first/ }));
	expect(onmode).toHaveBeenCalledWith("local_first");
	expect(screen.getByRole("radio", { name: /Cloud only/ })).toBeEnabled();
	cleanup();
	show({}, true);
	expect(screen.getByRole("radio", { name: /Cloud only/ })).toBeDisabled();
});
