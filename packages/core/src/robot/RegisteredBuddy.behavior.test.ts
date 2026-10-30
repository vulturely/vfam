import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import RegisteredBuddy from "./RegisteredBuddy.svelte";
import { RegisteredFamBuddy } from "../api/protocol";

const mocks = vi.hoisted(() => ({
	get: vi.fn(),
	deleteIf: vi.fn(),
	revoke: vi.fn(),
	enroll: vi.fn(),
	remote: vi.fn(),
}));

vi.mock("../api/fambuddy/fambuddyStorage", () => ({
	famBuddyRecords: () => ({ get: mocks.get, deleteIf: mocks.deleteIf }),
}));
vi.mock("./onboarding/registry", () => ({ revoke: mocks.revoke }));
vi.mock("./onboarding/enroll", () => ({ enrollRegistered: mocks.enroll }));
vi.mock("./remote/service", () => ({ createRemoteBuddy: mocks.remote }));
vi.mock("./BuddyControls.svelte", async () => ({
	default: (await import("../shell/ChatComposerEditorTestStub.svelte")).default,
}));

const saved = {
	registration: "registration",
	token: `vrp_${"a".repeat(64)}`,
	pair: {
		origin: "https://relay.example",
		own: { accountId: "fambuddy-parent:parent:channel" },
		account: "fambuddy-parent:parent:channel",
		binding: { family: "family", device: "device", channel: "channel" },
	},
};
const props = {
	owner: "parent",
	server: "https://relay.example",
	auth: { getAccessToken: async () => `vps_${"b".repeat(64)}` },
	registration: new RegisteredFamBuddy({ id: "registration", name: "Kitchen" }),
	onrevoked: vi.fn(),
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.get.mockResolvedValue(null);
	mocks.deleteIf.mockResolvedValue(undefined);
	mocks.revoke.mockResolvedValue(undefined);
	mocks.remote.mockReturnValue({ command: vi.fn() });
});

afterEach(cleanup);

it("restores an encrypted pairing and revokes it with conditional cleanup", async () => {
	mocks.get.mockResolvedValue(saved);
	render(RegisteredBuddy, props);
	expect(await screen.findByText("Paired on this app")).toBeVisible();
	expect(mocks.remote).toHaveBeenCalledWith(
		saved.pair,
		props.auth,
		expect.any(Function),
		"registration",
	);
	await fireEvent.click(screen.getByRole("button", { name: "Revoke FamBuddy access" }));
	await waitFor(() => expect(mocks.revoke).toHaveBeenCalledWith(expect.anything(), "registration"));
	expect(mocks.deleteIf).toHaveBeenCalledWith("registered:registration", "channel", "channel");
	await waitFor(() => expect(props.onrevoked).toHaveBeenCalledOnce());
});

it("rejects invalid saved pairings and reports enrollment failures", async () => {
	mocks.get.mockResolvedValue({ ...saved, registration: "other" });
	render(RegisteredBuddy, props);
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		/Saved pairing could not be unlocked/,
	);
	mocks.enroll.mockRejectedValue(new Error("Enrollment expired"));
	await fireEvent.input(screen.getByLabelText("One-use setup code"), {
		target: { value: "code" },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Pair FamBuddy" }));
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Enrollment expired",
	);
});

it("pairs through the encrypted relay and revokes incomplete local state safely", async () => {
	mocks.enroll.mockResolvedValue(saved);
	const view = render(RegisteredBuddy, props);
	await screen.findByRole("button", { name: "Pair FamBuddy" });
	await fireEvent.input(screen.getByLabelText("One-use setup code"), {
		target: { value: "code" },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Pair FamBuddy" }));
	expect(await screen.findByText("Paired on this app")).toBeVisible();
	expect(mocks.enroll).toHaveBeenCalledWith(
		expect.objectContaining({
			server: props.server,
			owner: props.owner,
			registration: "registration",
			code: "code",
		}),
	);
	mocks.get.mockResolvedValue(null);
	await fireEvent.click(screen.getByRole("button", { name: "Revoke FamBuddy access" }));
	await waitFor(() => expect(props.onrevoked).toHaveBeenCalledOnce());
	expect(mocks.deleteIf).not.toHaveBeenCalled();
	view.unmount();
});
