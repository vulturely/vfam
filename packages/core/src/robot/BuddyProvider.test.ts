import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import BuddyProvider from "./BuddyProvider.svelte";
import type { BuddyService } from "./buddy";
import type { FamilyAiService } from "../family-ai/service";

afterEach(cleanup);
const device = "00000000-0000-4000-8000-0000000000bb";
function setup(local?: { gateway: string; token: string }) {
	const service = {
		command: vi.fn(async () => ({ settings: [], turns: [] })),
	} as unknown as BuddyService;
	const familyAi = { provisionRobot: vi.fn(async () => undefined) } as unknown as FamilyAiService;
	render(BuddyProvider, { service, device, familyAi, local });
	return { service, familyAi };
}

it("defaults to answers from the parent's devices and keeps the key off the device", async () => {
	const { service, familyAi } = setup();
	expect(screen.getByRole("radio", { name: /Answer from my devices/ })).toBeChecked();
	const storeKey = screen.getByRole("radio", { name: /Store the key on this FamBuddy/ });
	expect(storeKey).toBeDisabled();
	expect(screen.getByText(/Available when connected on your home network/)).toBeTruthy();
	await fireEvent.click(screen.getByRole("button", { name: "Save AI setting" }));
	await waitFor(() =>
		expect(screen.getByRole("status")).toHaveTextContent("now gets answers from your devices"),
	);
	expect(vi.mocked(service.command).mock.calls[0][0]).toMatchObject({
		action: "save_provider",
		config: { provider: "parent_device", api_key: "" },
	});
	expect(familyAi.provisionRobot).not.toHaveBeenCalled();
});

it("stores the key on a locally connected FamBuddy and reports failures", async () => {
	const local = { gateway: "https://buddy.local:5443", token: "pairing" };
	const { service, familyAi } = setup(local);
	const storeKey = screen.getByRole("radio", { name: /Store the key on this FamBuddy/ });
	expect(storeKey).toBeEnabled();
	await fireEvent.click(storeKey);
	vi.mocked(familyAi.provisionRobot).mockRejectedValueOnce(
		new Error("FamBuddy needs an HTTPS AI provider."),
	);
	await fireEvent.click(screen.getByRole("button", { name: "Save AI setting" }));
	expect(await screen.findByRole("alert")).toHaveTextContent("HTTPS AI provider");
	await fireEvent.click(screen.getByRole("button", { name: "Save AI setting" }));
	await waitFor(() =>
		expect(screen.getByRole("status")).toHaveTextContent("uses its own copy of the family AI key"),
	);
	expect(familyAi.provisionRobot).toHaveBeenLastCalledWith({ ...local, device });
	expect(service.command).not.toHaveBeenCalled();
});
