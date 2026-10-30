import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import RegisteredBuddy from "./RegisteredBuddy.svelte";
import type { RegisteredFamBuddy } from "./onboarding/registry";
import type { SavedRegisteredPair } from "./onboarding/enroll";

const mocks = vi.hoisted(() => ({
	get: vi.fn(),
	deleteIf: vi.fn(),
	enroll: vi.fn(),
	revoke: vi.fn(),
	command: vi.fn(),
	watch: vi.fn(),
	remote: vi.fn(),
}));

vi.mock("../api/fambuddy/fambuddyStorage", () => ({
	famBuddyRecords: () => ({ get: mocks.get, deleteIf: mocks.deleteIf }),
}));
vi.mock("./onboarding/enroll", () => ({ enrollRegistered: mocks.enroll }));
vi.mock("./onboarding/registry", () => ({ revoke: mocks.revoke }));
vi.mock("./remote/service", () => ({ createRemoteBuddy: mocks.remote }));

const registration = { id: "registration", name: "Kitchen" } as RegisteredFamBuddy;
const auth = { getAccessToken: async () => "vps_parent" };
const pair = {
	registration: registration.id,
	token: `vrp_${"a".repeat(64)}`,
	pair: {
		origin: "https://relay.example",
		account: "fambuddy-parent:parent:channel",
		own: { accountId: "fambuddy-parent:parent:channel" },
		binding: { channel: "channel", family: "family", device: "device" },
	},
} as SavedRegisteredPair;

function props(onrevoked = vi.fn()) {
	return { owner: "parent", server: "https://relay.example", auth, registration, onrevoked };
}

beforeEach(() => {
	vi.resetAllMocks();
	mocks.get.mockResolvedValue(null);
	mocks.command.mockResolvedValue({ settings: [], turns: [] });
	mocks.watch.mockImplementation(async function* () {});
	mocks.remote.mockReturnValue({ command: mocks.command, watch: mocks.watch, openTalk: vi.fn() });
});

afterEach(cleanup);

it("restores a valid encrypted pairing and revokes its saved channel", async () => {
	mocks.get.mockResolvedValue(pair);
	const onrevoked = vi.fn();
	render(RegisteredBuddy, props(onrevoked));
	await screen.findByText("Paired on this app");
	expect(mocks.remote).toHaveBeenCalledWith(pair.pair, auth, expect.any(Function), registration.id);

	await fireEvent.click(screen.getByRole("button", { name: "Revoke FamBuddy access" }));
	await screen.findByText("Access revoked");
	expect(mocks.revoke).toHaveBeenCalledWith(
		expect.objectContaining({ server: "https://relay.example", auth }),
		registration.id,
	);
	await vi.waitFor(() => expect(onrevoked).toHaveBeenCalledOnce());
	expect(mocks.deleteIf).toHaveBeenCalledWith("registered:registration", "channel", "channel");
});

it("rejects invalid saved pairings", async () => {
	mocks.get.mockResolvedValue({ ...pair, token: "invalid" });
	render(RegisteredBuddy, props());
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Saved pairing could not be unlocked",
	);
	expect(screen.getByRole("button", { name: "Pair FamBuddy" })).toBeVisible();
});

it("pairs with a trimmed one-use code and connects the returned session", async () => {
	mocks.enroll.mockResolvedValue(pair);
	render(RegisteredBuddy, props());
	await screen.findByRole("button", { name: "Pair FamBuddy" });
	await fireEvent.input(screen.getByLabelText("One-use setup code"), {
		target: { value: " setup-code " },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Pair FamBuddy" }));
	await screen.findByText("Paired on this app");
	expect(mocks.enroll).toHaveBeenCalledWith(
		expect.objectContaining({
			owner: "parent",
			registration: registration.id,
			code: "setup-code",
		}),
	);
	expect(screen.queryByLabelText("One-use setup code")).toBeNull();
});

it("shows pairing and revocation failures without removing access", async () => {
	mocks.enroll.mockRejectedValue(new Error("Pairing expired"));
	render(RegisteredBuddy, props());
	await screen.findByRole("button", { name: "Pair FamBuddy" });
	await fireEvent.input(screen.getByLabelText("One-use setup code"), {
		target: { value: "expired" },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Pair FamBuddy" }));
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Pairing expired",
	);

	mocks.revoke.mockRejectedValue(new Error("Relay unavailable"));
	await fireEvent.click(screen.getByRole("button", { name: "Revoke FamBuddy access" }));
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Relay unavailable",
	);
	expect(screen.getByRole("button", { name: "Pair FamBuddy" })).toBeVisible();
});

it("cancels an active pairing attempt", async () => {
	mocks.enroll.mockImplementation(
		({ signal }) =>
			new Promise((_, reject) =>
				signal.addEventListener("abort", () => reject(new Error("Cancelled"))),
			),
	);
	render(RegisteredBuddy, props());
	await screen.findByRole("button", { name: "Pair FamBuddy" });
	await fireEvent.input(screen.getByLabelText("One-use setup code"), {
		target: { value: "code" },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Pair FamBuddy" }));
	await fireEvent.click(screen.getByRole("button", { name: "Cancel pairing" }));
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Cancelled",
	);
});
