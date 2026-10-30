import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import ErrorToast from "./ErrorToast.svelte";
import { toastService } from "../../services/toast.svelte";

afterEach(() => {
	cleanup();
	toastService.clear();
});

it("stacks errors and dismisses them independently", async () => {
	toastService.error("First error");
	toastService.error("Second error");
	const alerts = await screen.findAllByRole("alert");
	expect(alerts).toHaveLength(2);
	await fireEvent.click(alerts[0].querySelector("button")!);
	expect(await screen.findAllByRole("alert")).toHaveLength(1);
	expect(screen.getByText("Second error")).toBeVisible();
});

it("dispatches a native error without retriggering the effect", async () => {
	render(ErrorToast, { message: "Chat unavailable. Please retry." });
	expect(await screen.findByRole("alert")).toHaveTextContent("Chat unavailable. Please retry.");
	expect(toastService.items).toHaveLength(1);
});

it("shows success toasts as dismissible status notifications", async () => {
	toastService.success("Family picture updated.");
	const status = await screen.findByRole("status");
	expect(status).toHaveTextContent("Family picture updated.");
	expect(status).toHaveClass("success");
	expect(screen.queryByRole("alert")).toBeNull();
	await fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
	expect(screen.queryByRole("status")).toBeNull();
	expect(toastService.items).toHaveLength(0);
});

it("shows help alerts with an action that dismisses and runs it", async () => {
	const run = vi.fn();
	toastService.info("Jamie needs help. Jamie asked for help with Spelling.", {
		label: "Open",
		run,
	});
	const status = await screen.findByRole("status");
	expect(status).toHaveClass("info");
	await fireEvent.click(screen.getByRole("button", { name: "Open" }));
	expect(run).toHaveBeenCalled();
	expect(toastService.items).toHaveLength(0);
});
