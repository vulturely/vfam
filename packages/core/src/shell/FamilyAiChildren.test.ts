import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import FamilyAiChildren from "./FamilyAiChildren.svelte";
import type { FamilyAiService } from "../family-ai/service";

afterEach(cleanup);
const children = [{ id: "jamie", displayName: "Jamie" }];
function setup() {
	const service = {
		childModes: vi.fn(async () => ({})),
		keyOffers: vi.fn(async () => [{ id: "offer", profileId: "jamie", childName: "Jamie" }]),
		setChildMode: vi.fn(async () => undefined),
		respondToKeyOffer: vi.fn(async () => "123456"),
		sendKey: vi.fn(async () => undefined),
	};
	render(FamilyAiChildren, { service: service as unknown as FamilyAiService, children });
	return service;
}

it("sets where each child's AI runs and explains what happens next", async () => {
	const service = setup();
	const select = await screen.findByLabelText("Jamie");
	await waitFor(() => expect(select).toBeEnabled());
	expect(select).toHaveValue("parent_devices");
	await fireEvent.change(select, { target: { value: "child_device" } });
	await waitFor(() => expect(service.setChildMode).toHaveBeenCalledWith("jamie", "child_device"));
	expect(await screen.findByRole("status")).toHaveTextContent("share the key here");
	await waitFor(() => expect(select).toBeEnabled());
	await fireEvent.change(select, { target: { value: "parent_devices" } });
	expect(await screen.findByText(/create a new key at your provider/)).toBeTruthy();
});

it("sends the key only after the parent confirms matching codes", async () => {
	const service = setup();
	const share = await screen.findByRole("button", { name: "Share key" });
	await waitFor(() => expect(share).toBeEnabled());
	await fireEvent.click(share);
	expect(await screen.findByText("123 456")).toBeTruthy();
	expect(service.sendKey).not.toHaveBeenCalled();
	await fireEvent.click(screen.getByRole("button", { name: "Codes match, send key" }));
	await waitFor(() => expect(service.sendKey).toHaveBeenCalledWith("offer"));
	expect(await screen.findByText("The family AI key was sent to Jamie's device.")).toBeTruthy();
});

it("sends nothing when the codes do not match", async () => {
	const service = setup();
	const share = await screen.findByRole("button", { name: "Share key" });
	await waitFor(() => expect(share).toBeEnabled());
	await fireEvent.click(share);
	await fireEvent.click(await screen.findByRole("button", { name: "Codes don't match" }));
	expect(await screen.findByRole("alert")).toHaveTextContent("nothing was sent");
	expect(service.sendKey).not.toHaveBeenCalled();
});
