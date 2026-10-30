import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import MobileNavigationTest from "./MobileNavigationTest.svelte";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function trigger() {
	return screen.getByRole("button", { name: "Open menu" }) as HTMLButtonElement;
}

it("opens and closes with Escape, overlay, outside pointer, and menu action", async () => {
	render(MobileNavigationTest);
	await fireEvent.click(trigger());
	const dialog = await screen.findByRole("dialog", { name: "Menu" });
	expect(dialog).toHaveFocus();
	await fireEvent.keyDown(document, { key: "Tab" });
	expect(screen.getByRole("button", { name: "Close menu" })).toHaveFocus();
	await fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
	expect(screen.getByRole("button", { name: "Done" })).toHaveFocus();
	await fireEvent.keyDown(document, { key: "Escape" });
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(trigger()).toHaveFocus();
	await fireEvent.click(trigger());
	await fireEvent.click(screen.getByRole("button", { name: "Close navigation overlay" }));
	expect(screen.queryByRole("dialog")).toBeNull();
	await fireEvent.click(trigger());
	await fireEvent.pointerDown(document.body);
	expect(screen.queryByRole("dialog")).toBeNull();
	await fireEvent.click(trigger());
	await fireEvent.click(screen.getByRole("button", { name: "Close menu" }));
	expect(screen.queryByRole("dialog")).toBeNull();
	await fireEvent.click(trigger());
	await fireEvent.click(screen.getByRole("button", { name: "Done" }));
	expect(screen.queryByRole("dialog")).toBeNull();
});

it("drags within viewport bounds, suppresses the next click, and clamps on resize", async () => {
	Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
	render(MobileNavigationTest);
	const button = trigger();
	Object.defineProperty(button, "offsetWidth", { value: 64 });
	Object.assign(button, {
		setPointerCapture: vi.fn(),
		hasPointerCapture: () => true,
		releasePointerCapture: vi.fn(),
	});
	vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
		x: 100,
		y: 20,
		width: 64,
		height: 44,
		left: 100,
		right: 164,
		top: 20,
		bottom: 64,
		toJSON: () => ({}),
	});
	await fireEvent.pointerDown(button, { isPrimary: false, button: 0, pointerId: 1 });
	await fireEvent.pointerDown(button, { isPrimary: true, button: 1, pointerId: 1 });
	await fireEvent.pointerDown(button, {
		isPrimary: true,
		button: 0,
		pointerId: 1,
		clientX: 100,
		clientY: 40,
	});
	await fireEvent.pointerMove(button, { pointerId: 2, clientX: 110, clientY: 40 });
	await fireEvent.pointerMove(button, { pointerId: 1, clientX: 5, clientY: 40 });
	await fireEvent.pointerUp(button, { pointerId: 1 });
	expect(button.style.left).not.toBe("");
	await fireEvent.click(button, { detail: 1 });
	expect(screen.queryByRole("dialog")).toBeNull();
	await fireEvent.click(button, { detail: 0 });
	expect(await screen.findByRole("dialog")).toBeVisible();
	Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });
	await fireEvent(window, new Event("resize"));
	expect(screen.queryByRole("dialog")).toBeNull();
});
