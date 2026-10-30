import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import BuddySetup from "./BuddySetup.svelte";

const mocks = vi.hoisted(() => ({
	get: vi.fn(),
	put: vi.fn(),
	deleteIf: vi.fn(),
	pair: vi.fn(),
	certificate: vi.fn(),
	confirm: vi.fn(),
	command: vi.fn(),
}));

vi.mock("../api/fambuddy/fambuddyStorage", () => ({
	usesNativeFamBuddyStorage: () => true,
	famBuddyRecords: () => ({
		get: mocks.get,
		put: mocks.put,
		deleteIf: mocks.deleteIf,
	}),
}));
vi.mock("./buddy-gateway", () => ({
	pairBuddyPhone: mocks.pair,
	buddyCertificate: mocks.certificate,
	confirmBuddyCertificate: mocks.confirm,
}));
vi.mock("./buddy", () => ({
	createBuddyService: () => ({ command: mocks.command }),
}));
vi.mock("./BuddyRemote.svelte", async () => ({
	default: (await import("../shell/ChatComposerEditorTestStub.svelte")).default,
}));
vi.mock("./BuddyControls.svelte", async () => ({
	default: (await import("../shell/ChatComposerEditorTestStub.svelte")).default,
}));

const saved = {
	gateway: "https://fambuddy.local:5443",
	token: `vrp_${"a".repeat(64)}`,
	family: "family",
	expires_at: new Date(Date.now() + 60_000).toISOString(),
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.get.mockResolvedValue(null);
	mocks.put.mockResolvedValue(undefined);
	mocks.deleteIf.mockResolvedValue(undefined);
	mocks.command.mockResolvedValue({});
	mocks.certificate.mockResolvedValue("AB:CD");
	mocks.confirm.mockResolvedValue(undefined);
	mocks.pair.mockResolvedValue({
		token: saved.token,
		family: saved.family,
		expires_at: saved.expires_at,
	});
});

afterEach(cleanup);

it("restores a valid pairing and disconnects it", async () => {
	mocks.get.mockResolvedValue(saved);
	const view = render(BuddySetup, { owner: "parent" });
	expect(
		await screen.findByText(/Paired on your home network · https:\/\/fambuddy.local:5443/),
	).toBeVisible();
	// The pairing form lives in the sheet, never on the page.
	expect(screen.queryByRole("button", { name: "Check device" })).toBeNull();
	await view.rerender({ owner: "parent", pairingOpen: true });
	const sheet = await screen.findByRole("dialog", { name: "Home-network pairing" });
	await fireEvent.click(within(sheet).getByRole("button", { name: "Disconnect this pairing" }));
	await waitFor(() => expect(mocks.command).toHaveBeenCalledWith({ action: "logout" }));
	expect(mocks.deleteIf).toHaveBeenCalledWith("pairing", "token", saved.token);
	expect(await screen.findByRole("dialog", { name: "Connect a FamBuddy" })).toBeVisible();
	expect(screen.getByRole("button", { name: "Check device" })).toBeVisible();
});

it("deletes expired pairings and reports unreadable saves", async () => {
	mocks.get.mockResolvedValue({ ...saved, expires_at: new Date(Date.now() - 1).toISOString() });
	const view = render(BuddySetup, { owner: "parent", pairingOpen: true });
	await waitFor(() => expect(mocks.deleteIf).toHaveBeenCalledWith("pairing", "token", saved.token));
	expect(await view.findByRole("button", { name: "Check device" })).toBeVisible();
	view.unmount();
	mocks.get.mockRejectedValue(new Error("locked"));
	render(BuddySetup, { owner: "parent" });
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		/Saved pairing could not be unlocked/,
	);
});

it("validates the gateway, shows its certificate, revokes credentials after save failures, and pairs", async () => {
	render(BuddySetup, { owner: "parent", pairingOpen: true });
	const address = await screen.findByLabelText("Device address");
	await fireEvent.input(address, { target: { value: "http://fambuddy.local" } });
	await fireEvent.input(screen.getByLabelText("One-use pairing code"), {
		target: { value: "code" },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Check device" }));
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		/HTTPS address/,
	);
	expect(mocks.certificate).not.toHaveBeenCalled();
	await fireEvent.input(address, { target: { value: "https://fambuddy.local:5443/path" } });
	// An unreachable device shows why.
	mocks.certificate.mockRejectedValueOnce(new Error("The FamBuddy is unavailable."));
	await fireEvent.click(screen.getByRole("button", { name: "Check device" }));
	await waitFor(() =>
		expect(screen.getAllByRole("alert").at(-1)).toHaveTextContent("The FamBuddy is unavailable."),
	);
	await fireEvent.click(screen.getByRole("button", { name: "Check device" }));
	expect(await screen.findByRole("group", { name: "Device certificate" })).toHaveTextContent(
		"AB:CD",
	);
	expect(mocks.certificate).toHaveBeenLastCalledWith("https://fambuddy.local:5443");
	// "They don't match" discards the fingerprint, and so does changing the address.
	await fireEvent.click(screen.getByRole("button", { name: "They don’t match" }));
	expect(screen.queryByRole("group", { name: "Device certificate" })).toBeNull();
	await fireEvent.click(screen.getByRole("button", { name: "Check device" }));
	await screen.findByRole("group", { name: "Device certificate" });
	await fireEvent.input(address, { target: { value: "https://fambuddy.local:5443/" } });
	expect(screen.queryByRole("group", { name: "Device certificate" })).toBeNull();
	await fireEvent.click(screen.getByRole("button", { name: "Check device" }));
	await screen.findByRole("group", { name: "Device certificate" });
	mocks.put.mockRejectedValueOnce(new Error("Storage unavailable"));
	const connect = screen.getByRole("button", { name: "They match, connect" });
	await fireEvent.input(screen.getByLabelText("One-use pairing code"), {
		target: { value: "code" },
	});
	await waitFor(() => expect(connect).toBeEnabled());
	await fireEvent.click(connect);
	await waitFor(() =>
		expect(screen.getAllByRole("alert").at(-1)).toHaveTextContent("Storage unavailable"),
	);
	expect(mocks.confirm).toHaveBeenCalledWith("https://fambuddy.local:5443", "AB:CD");
	expect(mocks.command).toHaveBeenCalledWith({ action: "logout" });
	await fireEvent.input(screen.getByLabelText("One-use pairing code"), {
		target: { value: "code" },
	});
	await waitFor(() => expect(connect).toBeEnabled());
	await fireEvent.click(connect);
	expect(
		await screen.findByText(/Paired on your home network · https:\/\/fambuddy.local:5443/),
	).toBeVisible();
	// A successful pairing closes the sheet.
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(mocks.pair).toHaveBeenCalledWith("https://fambuddy.local:5443", "code");
	expect(mocks.put).toHaveBeenCalledWith(
		"pairing",
		expect.objectContaining({ gateway: "https://fambuddy.local:5443" }),
	);
});

it("offers home-network pairing when nothing is paired, without remote setup over plain HTTP", async () => {
	const view = render(BuddySetup, { owner: "parent", server: "http://127.0.0.1:50051" });
	await fireEvent.click(await view.findByRole("button", { name: "Pair on home network" }));
	expect(await screen.findByRole("dialog", { name: "Connect a FamBuddy" })).toBeVisible();
});
