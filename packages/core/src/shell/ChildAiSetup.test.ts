import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import ChildAiSetup from "./ChildAiSetup.svelte";
import type { ChildFamilyAiService } from "../family-ai/child";

afterEach(cleanup);

it("offers setup only when a parent allowed this device and shows the code to compare", async () => {
	let deliver!: () => void;
	const service = {
		mode: vi.fn(async () => "child_device"),
		installed: vi.fn(async () => false),
		offerKey: vi.fn(async () => "transfer"),
		waitForKey: vi.fn(async function* () {
			yield { installed: false, code: "123456" };
			await new Promise<void>((resolve) => (deliver = resolve));
			yield { installed: true, code: "123456" };
		}),
	} as unknown as ChildFamilyAiService;
	render(ChildAiSetup, { service });
	await fireEvent.click(await screen.findByRole("button", { name: "Set up the AI tutor" }));
	expect(await screen.findByText("123 456")).toBeTruthy();
	expect(service.waitForKey).toHaveBeenCalledWith("transfer", expect.any(AbortSignal));
	deliver();
	expect(await screen.findByText("The AI tutor is ready on this device.")).toBeTruthy();
});

it("stays hidden for parent-device mode, an installed key or an unavailable check", async () => {
	for (const service of [
		{ mode: vi.fn(async () => "parent_devices"), installed: vi.fn() },
		{ mode: vi.fn(async () => "child_device"), installed: vi.fn(async () => true) },
		{
			mode: vi.fn(async () => {
				throw new Error("offline");
			}),
			installed: vi.fn(),
		},
	]) {
		render(ChildAiSetup, { service: service as unknown as ChildFamilyAiService });
		await vi.waitFor(() => expect(service.mode).toHaveBeenCalled());
		expect(screen.queryByRole("button", { name: "Set up the AI tutor" })).toBeNull();
		cleanup();
	}
});

it("explains a failed setup and allows retry", async () => {
	const service = {
		mode: vi.fn(async () => "child_device"),
		installed: vi.fn(async () => false),
		offerKey: vi.fn(async () => {
			throw new Error("A parent must allow family AI on this child's device first.");
		}),
		waitForKey: vi.fn(),
	} as unknown as ChildFamilyAiService;
	render(ChildAiSetup, { service });
	await fireEvent.click(await screen.findByRole("button", { name: "Set up the AI tutor" }));
	expect(await screen.findByRole("alert")).toHaveTextContent("A parent must allow");
	expect(screen.getByRole("button", { name: "Set up the AI tutor" })).toBeTruthy();
});
