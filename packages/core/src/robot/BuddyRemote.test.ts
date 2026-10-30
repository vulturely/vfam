import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import BuddyRemote from "./BuddyRemote.svelte";

const mocks = vi.hoisted(() => ({
	get: vi.fn(),
	put: vi.fn(),
	updateIf: vi.fn(),
	deleteIf: vi.fn(),
	enroll: vi.fn(),
	revoke: vi.fn(),
	remote: vi.fn(),
	disable: vi.fn(),
}));
vi.mock("../api/fambuddy/fambuddyStorage", () => ({
	famBuddyRecords: () => ({
		get: mocks.get,
		put: mocks.put,
		updateIf: mocks.updateIf,
		deleteIf: mocks.deleteIf,
	}),
}));
vi.mock("./remote/enroll", () => ({ enrollRemote: mocks.enroll, revokeRemote: mocks.revoke }));
vi.mock("./remote/service", () => ({ createRemoteBuddy: mocks.remote }));
vi.mock("./buddy-gateway", () => ({ gatewayClient: () => ({ disableRemote: mocks.disable }) }));

const pair = {
	origin: "https://relay.example",
	account: "parent",
	own: {},
	peer: {},
	binding: { channel: "channel", family: "family", device: "device-123456" },
};
const localService = { command: vi.fn(), watch: vi.fn(), openTalk: vi.fn() };
const remoteService = { command: vi.fn(), watch: vi.fn(), openTalk: vi.fn() };
function props() {
	return {
		owner: "parent",
		gateway: "http://127.0.0.1:50051",
		token: "token",
		family: "family",
		server: "https://relay.example",
		auth: { getAccessToken: async () => "vps_parent" },
		localService,
		onchange: vi.fn(),
	};
}

beforeEach(() => {
	vi.resetAllMocks();
	mocks.get.mockResolvedValue(null);
	mocks.remote.mockReturnValue(remoteService);
	mocks.enroll.mockResolvedValue(pair);
	mocks.revoke.mockResolvedValue(undefined);
	mocks.disable.mockResolvedValue(undefined);
	localService.command.mockResolvedValue({
		settings: [{ device: "device-123456", wake_word: "hey buddy", muted: false }],
		turns: [],
	});
});
afterEach(cleanup);

it("prepares, enables, switches and disables encrypted remote access", async () => {
	const input = props();
	render(BuddyRemote, input);
	const setup = await screen.findByRole("button", { name: "Set up remote approvals" });
	await vi.waitFor(() => expect(setup).toBeEnabled());
	await fireEvent.click(setup);
	await screen.findByRole("button", { name: "Enable encrypted remote approvals" });
	expect(localService.command).toHaveBeenCalledWith({ action: "list", family: "family" });
	await fireEvent.click(screen.getByRole("button", { name: "Enable encrypted remote approvals" }));
	await screen.findByText(/Encrypted remote access enabled for device device-1/);
	expect(mocks.put).toHaveBeenCalledWith("remote:family:http://127.0.0.1:50051", {
		pair,
		internet: false,
		token: "token",
	});

	await fireEvent.click(screen.getByRole("button", { name: "Use encrypted internet connection" }));
	await screen.findByRole("status");
	expect(mocks.updateIf).toHaveBeenCalledWith(
		"remote:family:http://127.0.0.1:50051",
		"channel",
		expect.objectContaining({ internet: true }),
	);
	expect(mocks.remote).toHaveBeenCalledWith(pair, input.auth, expect.any(Function));
	expect(input.onchange).toHaveBeenLastCalledWith(remoteService);

	await fireEvent.click(screen.getByRole("button", { name: "Disable remote access" }));
	await screen.findByRole("button", { name: "Enable encrypted remote approvals" });
	expect(mocks.revoke).toHaveBeenCalledWith(pair, input.auth);
	expect(mocks.disable).toHaveBeenCalledWith(
		{ channel: "channel" },
		{ headers: { authorization: "Bearer token" }, timeoutMs: 2000 },
	);
	expect(mocks.deleteIf).toHaveBeenCalledWith(
		"remote:family:http://127.0.0.1:50051",
		"channel",
		"channel",
	);
	expect(input.onchange).toHaveBeenLastCalledWith(localService);
});

it("restores a matching encrypted internet pairing", async () => {
	mocks.get.mockResolvedValue({ pair, internet: true, token: "token" });
	const input = props();
	render(BuddyRemote, input);
	await screen.findByRole("status");
	expect(mocks.remote).toHaveBeenCalledWith(pair, input.auth, expect.any(Function));
	expect(input.onchange).toHaveBeenCalledWith(remoteService);
	await fireEvent.click(screen.getByRole("button", { name: "Use home-network connection" }));
	await vi.waitFor(() => expect(input.onchange).toHaveBeenLastCalledWith(localService));
});

it("does not restore pairing saved under another device token", async () => {
	mocks.get.mockResolvedValue({ pair, internet: true, token: "old-token" });
	const input = props();
	render(BuddyRemote, input);
	await screen.findByRole("button", { name: "Set up remote approvals" });
	expect(mocks.remote).not.toHaveBeenCalled();
	expect(input.onchange).not.toHaveBeenCalled();
});

it("reports storage, local discovery and enrollment failures", async () => {
	mocks.get.mockRejectedValueOnce(new Error("locked"));
	const input = props();
	render(BuddyRemote, input);
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"could not be unlocked",
	);
	localService.command.mockRejectedValueOnce(new Error("offline"));
	await fireEvent.click(screen.getByRole("button", { name: "Set up remote approvals" }));
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Connect to FamBuddy",
	);
	localService.command.mockResolvedValueOnce({ settings: [], turns: [] });
	await fireEvent.click(screen.getByRole("button", { name: "Set up remote approvals" }));
	await vi.waitFor(() =>
		expect(screen.getByRole("button", { name: "Set up remote approvals" })).toBeEnabled(),
	);
});

it("revokes a new pairing when encrypted persistence fails", async () => {
	mocks.put.mockRejectedValue(new Error("locked"));
	const input = props();
	render(BuddyRemote, input);
	const setup = await screen.findByRole("button", { name: "Set up remote approvals" });
	await vi.waitFor(() => expect(setup).toBeEnabled());
	await fireEvent.click(setup);
	await fireEvent.click(
		await screen.findByRole("button", { name: "Enable encrypted remote approvals" }),
	);
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"locked",
	);
	expect(mocks.revoke).toHaveBeenCalledWith(pair, input.auth);
});

it("keeps remote configuration when revocation cannot be confirmed", async () => {
	mocks.get.mockResolvedValue({ pair, internet: false, token: "token" });
	mocks.revoke.mockRejectedValue(new Error("offline"));
	render(BuddyRemote, props());
	await fireEvent.click(await screen.findByRole("button", { name: "Disable remote access" }));
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Unable to confirm relay revocation",
	);
	expect(screen.getByText(/Encrypted remote access enabled/)).toBeInTheDocument();
	expect(mocks.deleteIf).not.toHaveBeenCalled();
});
