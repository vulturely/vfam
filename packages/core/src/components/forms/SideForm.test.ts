import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import TestSideForm from "../testing/TestSideForm.svelte";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});
describe("Shared side form lifecycle", () => {
	it("closes the previous editor without taking focus from the new editor", async () => {
		render(TestSideForm);
		await fireEvent.click(screen.getByRole("button", { name: "Open first" }));
		expect(screen.getByRole("dialog", { name: "First editor" })).toHaveFocus();
		await fireEvent.click(screen.getByRole("button", { name: "Open second" }));
		await waitFor(() =>
			expect(screen.queryByRole("dialog", { name: "First editor" })).not.toBeInTheDocument(),
		);
		expect(screen.getByRole("dialog", { name: "Second editor" })).toHaveFocus();
		await fireEvent.keyDown(document, { key: "Escape" });
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
		expect(screen.getByRole("button", { name: "Open second" })).toHaveFocus();
	});
	it("lets child controls consume Escape before closing the panel", async () => {
		render(TestSideForm);
		await fireEvent.click(screen.getByRole("button", { name: "Open first" }));
		const input = screen.getByLabelText("First value");
		input.addEventListener("keydown", (event) => event.preventDefault());
		await fireEvent.keyDown(input, { key: "Escape" });
		expect(screen.getByRole("dialog", { name: "First editor" })).toBeInTheDocument();
	});
	it("tracks the visible keyboard viewport and removes listeners on close", async () => {
		const viewport = Object.assign(new EventTarget(), {
			height: 500,
			offsetTop: 0,
		});
		const remove = vi.spyOn(viewport, "removeEventListener");
		vi.stubGlobal("visualViewport", viewport);
		render(TestSideForm);
		await fireEvent.click(screen.getByRole("button", { name: "Open first" }));
		const panel = screen.getByRole("dialog");
		expect(panel.style.getPropertyValue("--v-form-height")).toBe("500px");
		viewport.height = 320;
		viewport.offsetTop = 60;
		viewport.dispatchEvent(new Event("resize"));
		expect(panel.style.getPropertyValue("--v-form-height")).toBe("320px");
		expect(panel.style.getPropertyValue("--v-form-top")).toBe("60px");
		viewport.offsetTop = 80;
		viewport.dispatchEvent(new Event("scroll"));
		expect(panel.style.getPropertyValue("--v-form-top")).toBe("80px");
		await fireEvent.click(screen.getByRole("button", { name: "Close", exact: true }));
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
		expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
		expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
	});
	it("restores focus to a replacement trigger when closing recreates it", async () => {
		render(TestSideForm);
		await fireEvent.click(screen.getByRole("button", { name: "Open replacement" }));
		expect(screen.getByRole("dialog", { name: "Replacement editor" })).toHaveFocus();
		await fireEvent.keyDown(document, { key: "Escape" });
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
		expect(screen.getByRole("button", { name: "Open replacement" })).toHaveFocus();
	});
});
