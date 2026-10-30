import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import BuddyUpdates from "./BuddyUpdates.svelte";
import type { BuddySettings } from "./buddy";

afterEach(cleanup);

const base: BuddySettings = { device: "device", wake_word: "hey buddy", muted: false };

function show(settings: Partial<BuddySettings>, busy = false) {
	const onautomatic = vi.fn(async () => {});
	const oninstall = vi.fn(async () => {});
	const view = render(BuddyUpdates, {
		settings: { ...base, ...settings },
		busy,
		onautomatic,
		oninstall,
	});
	return { onautomatic, oninstall, view };
}

const updateNow = () => screen.queryByRole("button", { name: "Update now" });

it("is off by default and has not reported a version or state yet", () => {
	show({});
	expect(screen.getByText("Installed version: not reported yet")).toBeVisible();
	expect(screen.getByRole("status")).toHaveTextContent("Update status: not reported yet");
	expect(screen.getByRole("switch", { name: "Install updates automatically" })).toHaveAttribute(
		"aria-checked",
		"false",
	);
	expect(screen.getByText("Off: updates wait until you choose Update now.")).toBeVisible();
	expect(updateNow()).toBeNull();
});

it("shows the installed version when up to date", () => {
	show({ installed_version: "v0.1.57", update_state: "current" });
	expect(screen.getByText("Installed version: v0.1.57")).toBeVisible();
	expect(screen.getByRole("status")).toHaveTextContent("Up to date");
	expect(updateNow()).toBeNull();
});

it("offers Update now for an available update while automatic updates are off", async () => {
	const { oninstall } = show({
		installed_version: "v0.1.56",
		available_version: "v0.1.57",
		update_state: "available",
	});
	expect(screen.getByRole("status")).toHaveTextContent("Update available: v0.1.57");
	expect(screen.getByText("The FamBuddy pauses for 1–3 minutes while it updates.")).toBeVisible();
	await fireEvent.click(screen.getByRole("button", { name: "Update now" }));
	expect(oninstall).toHaveBeenCalledOnce();
});

it("leaves an available update to the FamBuddy when automatic updates are on", () => {
	show({ auto_update: true, update_state: "available" });
	expect(screen.getByRole("status")).toHaveTextContent("Update available: new version");
	expect(
		screen.getByText("On: the FamBuddy installs signed updates on its own whenever it is idle."),
	).toBeVisible();
	expect(updateNow()).toBeNull();
});

it("shows Updating… while installing or once a parent asked for the update", async () => {
	const { view, onautomatic, oninstall } = show({ update_state: "installing" });
	expect(screen.getByRole("status")).toHaveTextContent("Updating…");
	expect(updateNow()).toBeNull();
	await view.rerender({
		settings: { ...base, update_state: "available", update_requested: true },
		busy: false,
		onautomatic,
		oninstall,
	});
	expect(screen.getByRole("status")).toHaveTextContent("Updating…");
	expect(updateNow()).toBeNull();
});

it("offers Update now again after a failed update, even with automatic updates on", async () => {
	const { oninstall } = show({
		auto_update: true,
		installed_version: "v0.1.56",
		update_state: "failed",
	});
	expect(screen.getByRole("status")).toHaveTextContent(
		"Last update failed — the FamBuddy kept its previous version.",
	);
	await fireEvent.click(screen.getByRole("button", { name: "Update now" }));
	expect(oninstall).toHaveBeenCalledOnce();
});

it("switches automatic updates on and off", async () => {
	const { onautomatic, view, oninstall } = show({});
	await fireEvent.click(screen.getByRole("switch", { name: "Install updates automatically" }));
	expect(onautomatic).toHaveBeenLastCalledWith(true);
	await view.rerender({
		settings: { ...base, auto_update: true },
		busy: false,
		onautomatic,
		oninstall,
	});
	expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
	await fireEvent.click(screen.getByRole("switch"));
	expect(onautomatic).toHaveBeenLastCalledWith(false);
});

it("keeps the controls for a retry when a command fails and disables them while busy", async () => {
	const oninstall = vi.fn(async () => {
		throw new Error("Hub unavailable");
	});
	const onautomatic = vi.fn(async () => {});
	const settings = { ...base, update_state: "failed" as const };
	const view = render(BuddyUpdates, { settings, busy: false, onautomatic, oninstall });
	await fireEvent.click(screen.getByRole("button", { name: "Update now" }));
	expect(oninstall).toHaveBeenCalledOnce();
	await vi.waitFor(() => expect(screen.getByRole("button", { name: "Update now" })).toBeEnabled());
	await view.rerender({ settings, busy: true, onautomatic, oninstall });
	expect(screen.getByRole("button", { name: "Update now" })).toBeDisabled();
	expect(screen.getByRole("switch")).toBeDisabled();
});
