import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import Copy from "lucide-svelte/icons/copy";
import { afterEach, expect, it, vi } from "vitest";
import DropdownMenu from "./DropdownMenu.svelte";

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

function item(id: string, overrides: Record<string, unknown> = {}) {
	return { id, label: id, icon: Copy, onSelect: vi.fn(), ...overrides };
}

it("groups menu items, selects an item and closes on outside click", async () => {
	const first = item("First", { section: "Account" });
	const second = item("Second", { section: "Account" });
	const third = item("Third");
	const view = render(DropdownMenu, {
		triggerIcon: Copy,
		triggerLabel: "Open actions",
		items: [first, second, third],
		menuPlacement: "side-start",
	});
	const trigger = screen.getByRole("button", { name: "Open actions" });
	await fireEvent.click(trigger);
	expect(trigger).toHaveAttribute("aria-expanded", "true");
	expect(screen.getByText("Account")).toBeVisible();
	expect(screen.getByRole("separator")).toBeVisible();
	expect(view.container.querySelector(".side-start")).not.toBeNull();
	await fireEvent.click(screen.getByRole("menuitem", { name: "First" }));
	expect(first.onSelect).toHaveBeenCalledOnce();
	expect(screen.queryByRole("menu")).toBeNull();

	await fireEvent.click(trigger);
	await fireEvent.click(document.body);
	expect(screen.queryByRole("menu")).toBeNull();
});

it("supports image triggers without arrows and borderless styling", async () => {
	render(DropdownMenu, {
		triggerIcon: Copy,
		triggerLabel: "Profile",
		triggerImageUrl: "https://example.invalid/avatar.png",
		triggerBorderless: true,
		showTriggerArrow: false,
		items: [],
	});
	const trigger = screen.getByRole("button", { name: "Profile" });
	expect(trigger).toHaveClass("borderless");
	expect(trigger.querySelector("img")).toHaveAttribute("src", "https://example.invalid/avatar.png");
	expect(trigger.querySelector(".v-dropdown-arrow")).toBeNull();
	await fireEvent.click(trigger);
	expect(screen.getByRole("menu").children).toHaveLength(0);
});

it("copies labels and temporarily shows confirmation", async () => {
	vi.useFakeTimers();
	const writeText = vi.fn().mockResolvedValue(undefined);
	Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
	render(DropdownMenu, {
		triggerIcon: Copy,
		triggerLabel: "Actions",
		items: [item("Account id", { copyable: true })],
	});
	await fireEvent.click(screen.getByRole("button", { name: "Actions" }));
	await fireEvent.click(screen.getByRole("button", { name: "Copy Account id" }));
	await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("Account id"));
	expect(screen.getByRole("menu")).toBeVisible();
	await vi.advanceTimersByTimeAsync(1500);
	expect(writeText).toHaveBeenCalledOnce();
});

it("keeps the menu usable when clipboard access fails", async () => {
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
	});
	render(DropdownMenu, {
		triggerIcon: Copy,
		triggerLabel: "Actions",
		items: [item("Account id", { copyable: true })],
	});
	await fireEvent.click(screen.getByRole("button", { name: "Actions" }));
	await fireEvent.click(screen.getByRole("button", { name: "Copy Account id" }));
	expect(screen.getByRole("menu")).toBeVisible();
});
