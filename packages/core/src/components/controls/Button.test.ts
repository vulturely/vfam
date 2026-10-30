import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import Button from "./Button.svelte";

const children = createRawSnippet(() => ({
	render: () => "<span>Save</span>",
}));
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});
function setup(reducedMotion = false) {
	vi.stubGlobal("matchMedia", () => ({ matches: reducedMotion }));
	const onclick = vi.fn();
	render(Button, { children, onclick });
	const button = screen.getByRole("button", { name: "Save" });
	vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
		left: 10,
		top: 20,
		width: 100,
		height: 44,
	} as DOMRect);
	return { button, onclick };
}
describe("Button ripple", () => {
	it("starts at the click position, calls the action once and cleans up", async () => {
		const { button, onclick } = setup();
		await fireEvent.click(button, { detail: 1, clientX: 30, clientY: 40 });
		const ripple = button.querySelector<HTMLElement>(".v-btn-ripple")!;
		expect(parseFloat(ripple.style.left) + parseFloat(ripple.style.width) / 2).toBeCloseTo(20);
		expect(parseFloat(ripple.style.top) + parseFloat(ripple.style.height) / 2).toBeCloseTo(20);
		expect(onclick).toHaveBeenCalledTimes(1);
		await fireEvent.animationEnd(ripple);
		expect(button.querySelector(".v-btn-ripple")).toBeNull();
	});
	it("centers keyboard activation and replaces an active ripple on another click", async () => {
		const { button } = setup();
		await fireEvent.click(button, { detail: 0 });
		const ripple = button.querySelector<HTMLElement>(".v-btn-ripple")!;
		expect(parseFloat(ripple.style.left) + parseFloat(ripple.style.width) / 2).toBeCloseTo(50);
		expect(parseFloat(ripple.style.top) + parseFloat(ripple.style.height) / 2).toBeCloseTo(22);
		await fireEvent.click(button);
		expect(button.querySelectorAll(".v-btn-ripple")).toHaveLength(1);
		expect(button.querySelector(".v-btn-ripple")).not.toBe(ripple);
	});
	it("respects reduced motion while preserving the button action", async () => {
		const { button, onclick } = setup(true);
		await fireEvent.click(button);
		expect(onclick).toHaveBeenCalledTimes(1);
		expect(button.querySelector(".v-btn-ripple")).toBeNull();
	});
});
