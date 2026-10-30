import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import BuddyRemote from "./BuddyRemote.svelte";

const mocks = vi.hoisted(() => ({
	get: vi.fn(),
	put: vi.fn(),
	updateIf: vi.fn(),
	deleteIf: vi.fn(),
	enroll: vi.fn(),
	revoke: vi.fn(),
	disable: vi.fn(),
	remote: vi.fn(),
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
vi.mock("./buddy-gateway", () => ({
	gatewayClient: () => ({ disableRemote: mocks.disable }),
}));

const pair = {
	origin: "https://relay.example",
	own: { accountId: "account" },
	account: "account",
	binding: { family: "family", device: "device-long", channel: "channel" },
};
const localService = { command: vi.fn(), openTalk: vi.fn(), watch: vi.fn() };
const remoteService = { command: vi.fn(), openTalk: vi.fn(), watch: vi.fn() };
const props = {
	owner: "owner",
	gateway: "https://gateway.example",
	token: "token",
	family: "family",
	server: "https://server.example",
	auth: { getAccessToken: vi.fn() },
	localService,
	onchange: vi.fn(),
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.get.mockResolvedValue(null);
	mocks.put.mockResolvedValue(undefined);
	mocks.updateIf.mockResolvedValue(undefined);
	mocks.deleteIf.mockResolvedValue(undefined);
	mocks.revoke.mockResolvedValue(undefined);
	mocks.disable.mockResolvedValue(undefined);
	mocks.remote.mockReturnValue(remoteService);
	localService.command.mockResolvedValue({
		settings: [{ device: "device-long", wake_word: "buddy" }],
	});
});
afterEach(cleanup);

it("restores an internet pairing, switches to local access, and revokes remote access", async () => {
	mocks.get.mockResolvedValue({ pair, internet: true, token: "token" });
	render(BuddyRemote, props);
	expect(await screen.findByText(/Encrypted remote access enabled/)).toBeInTheDocument();
	expect(props.onchange).toHaveBeenCalledWith(remoteService);
	await fireEvent.click(screen.getByRole("button", { name: "Use home-network connection" }));
	await waitFor(() => expect(mocks.updateIf).toHaveBeenCalled());
	expect(props.onchange).toHaveBeenLastCalledWith(localService);
	await fireEvent.click(screen.getByRole("button", { name: "Disable remote access" }));
	expect(
		await screen.findByRole("button", { name: "Set up remote approvals" }),
	).toBeInTheDocument();
	expect(mocks.deleteIf).toHaveBeenCalledWith(
		"remote:family:https://gateway.example",
		"channel",
		"channel",
	);
});

it("prepares a device and stores a newly enrolled encrypted pairing", async () => {
	mocks.enroll.mockResolvedValue(pair);
	render(BuddyRemote, props);
	const prepare = await screen.findByRole("button", { name: "Set up remote approvals" });
	await waitFor(() => expect(prepare).toBeEnabled());
	await fireEvent.click(prepare);
	const enable = await screen.findByRole("button", { name: "Enable encrypted remote approvals" });
	await waitFor(() => expect(enable).toBeEnabled());
	await fireEvent.click(enable);
	expect(await screen.findByText(/Encrypted remote access enabled/)).toBeInTheDocument();
	expect(mocks.put).toHaveBeenCalledWith(
		"remote:family:https://gateway.example",
		expect.objectContaining({ pair, internet: false, token: "token" }),
	);
	expect(props.onchange).not.toHaveBeenCalled();
});

it("revokes a pairing if encrypted persistence fails", async () => {
	mocks.enroll.mockResolvedValue(pair);
	mocks.put.mockRejectedValue(new Error("Storage locked"));
	render(BuddyRemote, props);
	const prepare = await screen.findByRole("button", { name: "Set up remote approvals" });
	await waitFor(() => expect(prepare).toBeEnabled());
	await fireEvent.click(prepare);
	const enable = await screen.findByRole("button", { name: "Enable encrypted remote approvals" });
	await waitFor(() => expect(enable).toBeEnabled());
	await fireEvent.click(enable);
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Storage locked",
	);
	expect(mocks.revoke).toHaveBeenCalledWith(pair, props.auth);
});

it("reports discovery, enrollment, persistence, and revocation failures", async () => {
	localService.command.mockRejectedValueOnce(new Error("offline"));
	mocks.get.mockRejectedValueOnce(new Error("locked"));
	render(BuddyRemote, props);
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		/could not be unlocked/,
	);
	await fireEvent.click(screen.getByRole("button", { name: "Set up remote approvals" }));
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		/Connect to FamBuddy/,
	);
	localService.command.mockResolvedValueOnce({ settings: [] });
	await fireEvent.click(screen.getByRole("button", { name: "Set up remote approvals" }));
	expect(await screen.findByRole("button", { name: "Set up remote approvals" })).toBeEnabled();
});

it("keeps a pairing when the connection setting or relay revocation cannot be confirmed", async () => {
	mocks.get.mockResolvedValue({ pair, internet: false, token: "token" });
	mocks.updateIf.mockRejectedValueOnce(new Error("locked"));
	render(BuddyRemote, props);
	await screen.findByText(/Encrypted remote access enabled/);
	await fireEvent.click(screen.getByRole("button", { name: "Use encrypted internet connection" }));
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Unable to save",
	);
	mocks.revoke.mockRejectedValueOnce(new Error("offline"));
	await fireEvent.click(screen.getByRole("button", { name: "Disable remote access" }));
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Remote access remains configured",
	);
	expect(screen.getByText(/Encrypted remote access enabled/)).toBeInTheDocument();
});

it("ignores saved pairings for another token or household", async () => {
	mocks.get.mockResolvedValue({ pair, internet: true, token: "old-token" });
	render(BuddyRemote, props);
	const prepare = await screen.findByRole("button", { name: "Set up remote approvals" });
	await waitFor(() => expect(prepare).toBeEnabled());
	expect(mocks.remote).not.toHaveBeenCalled();
});

it("removes local pairing state even when gateway disable is unavailable", async () => {
	mocks.get.mockResolvedValue({ pair, internet: false, token: "token" });
	mocks.disable.mockRejectedValue(new Error("offline"));
	render(BuddyRemote, props);
	await screen.findByText(/Encrypted remote access enabled/);
	await fireEvent.click(screen.getByRole("button", { name: "Disable remote access" }));
	expect(
		await screen.findByRole("button", { name: "Set up remote approvals" }),
	).toBeInTheDocument();
	expect(mocks.deleteIf).toHaveBeenCalledOnce();
});

it("continues secure restore when legacy browser storage is unavailable", async () => {
	vi.spyOn(window.sessionStorage, "removeItem").mockImplementation(() => {
		throw new Error("denied");
	});
	mocks.get.mockResolvedValue({ pair, internet: true, token: "token" });
	render(BuddyRemote, props);
	expect(await screen.findByText(/Encrypted remote access enabled/)).toBeInTheDocument();
	expect(mocks.remote).toHaveBeenCalledOnce();
});
