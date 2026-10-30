import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import RegisteredBuddies from "./RegisteredBuddies.svelte";
import { toastService } from "../services/toast.svelte";

const mocks = vi.hoisted(() => ({
	list: vi.fn(),
	register: vi.fn(),
	enroll: vi.fn(),
	get: vi.fn(),
	remote: vi.fn(),
}));
vi.mock("./onboarding/registry", () => ({ list: mocks.list, register: mocks.register }));
vi.mock("./onboarding/enroll", () => ({ enrollRegistered: mocks.enroll }));
vi.mock("../api/fambuddy/fambuddyStorage", () => ({
	famBuddyRecords: () => ({ get: mocks.get, deleteIf: vi.fn() }),
}));
vi.mock("./remote/service", () => ({ createRemoteBuddy: mocks.remote }));

const props = {
	owner: "parent",
	server: "https://relay.example",
	auth: { getAccessToken: async () => "vps_parent" },
};
const device = { id: "registration", name: "Kitchen" };

beforeEach(() => {
	vi.resetAllMocks();
	mocks.list.mockResolvedValue([]);
	mocks.get.mockResolvedValue(null);
	mocks.remote.mockReturnValue({ command: vi.fn(), watch: vi.fn(), openTalk: vi.fn() });
});
afterEach(() => {
	cleanup();
	toastService.clear();
});

it("loads cards and refreshes them through the shared directory", async () => {
	mocks.list.mockResolvedValue([device]);
	const { component } = render(RegisteredBuddies, props);
	await screen.findByText("Kitchen");
	mocks.list.mockResolvedValue([]);
	await component.refreshDevices();
	await screen.findByText(/None yet. Use Add/);
	expect(mocks.list).toHaveBeenCalledTimes(2);
	expect(mocks.list).toHaveBeenCalledWith({ server: props.server, auth: props.auth });
});

it("registers a trimmed name and closes the modal", async () => {
	mocks.list.mockResolvedValue([device]);
	mocks.register.mockResolvedValue({ id: device.id, name: "Kitchen updated" });
	render(RegisteredBuddies, { ...props, registrationOpen: true });
	await screen.findByText("Kitchen");
	const input = await screen.findByLabelText("FamBuddy name");
	await fireEvent.input(input, { target: { value: " Kitchen updated " } });
	mocks.list.mockResolvedValue([{ id: device.id, name: "Kitchen updated" }]);
	await fireEvent.click(screen.getByRole("button", { name: "Register FamBuddy" }));
	await screen.findByText("Kitchen updated");
	expect(mocks.register).toHaveBeenCalledWith(expect.anything(), "Kitchen updated");
	await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("validates empty and oversized names", async () => {
	render(RegisteredBuddies, { ...props, registrationOpen: true });
	await screen.findByText(/None yet. Use Add/);
	const input = await screen.findByLabelText("FamBuddy name");
	await fireEvent.input(input, { target: { value: " " } });
	await fireEvent.submit(input.closest("form")!);
	expect(toastService.items.at(-1)?.message).toBe("Enter a name for your FamBuddy.");
	await fireEvent.input(input, { target: { value: "x".repeat(81) } });
	await fireEvent.click(screen.getByRole("button", { name: "Register FamBuddy" }));
	expect(toastService.items.at(-1)?.message).toBe("Choose a shorter FamBuddy name.");
	expect(mocks.register).not.toHaveBeenCalled();
});

it("shows list and registration failures", async () => {
	mocks.list.mockRejectedValueOnce(new Error("Registry offline"));
	render(RegisteredBuddies, { ...props, registrationOpen: true });
	await vi.waitFor(() => expect(toastService.items.at(-1)?.message).toBe("Registry offline"));
	mocks.list.mockResolvedValue([]);
	mocks.register.mockRejectedValue(new Error("Registration failed"));
	await fireEvent.input(screen.getByLabelText("FamBuddy name"), { target: { value: "Kitchen" } });
	await fireEvent.click(screen.getByRole("button", { name: "Register FamBuddy" }));
	await vi.waitFor(() => expect(toastService.items.at(-1)?.message).toBe("Registration failed"));
});

it("pairs an unpaired registration with its one-use code", async () => {
	mocks.list.mockResolvedValue([device]);
	mocks.enroll.mockResolvedValue({
		registration: device.id,
		token: `vrp_${"a".repeat(64)}`,
		pair: {
			origin: props.server,
			account: "fambuddy-parent:parent:channel",
			own: { accountId: "fambuddy-parent:parent:channel" },
			binding: { channel: "channel", family: "family", device: "device" },
		},
	});
	render(RegisteredBuddies, props);
	await fireEvent.click(await screen.findByRole("button", { name: "Pair Kitchen" }));
	await fireEvent.input(screen.getByLabelText("One-use setup code"), {
		target: { value: "setup-code" },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Pair FamBuddy" }));
	expect(mocks.enroll).toHaveBeenCalledWith({
		server: props.server,
		auth: props.auth,
		owner: props.owner,
		registration: device.id,
		code: "setup-code",
	});
	expect(await screen.findByRole("button", { name: "Chat with Kitchen" })).toBeVisible();
});

it("ignores registration results received after unmount", async () => {
	let finish!: (value: typeof device) => void;
	mocks.register.mockReturnValue(new Promise((resolve) => (finish = resolve)));
	const view = render(RegisteredBuddies, { ...props, registrationOpen: true });
	await fireEvent.input(screen.getByLabelText("FamBuddy name"), { target: { value: "Kitchen" } });
	await fireEvent.click(screen.getByRole("button", { name: "Register FamBuddy" }));
	view.unmount();
	finish(device);
	await Promise.resolve();
	expect(screen.queryByText("Kitchen")).toBeNull();
});

it("is quietly off when the family server is not on HTTPS port 443", async () => {
	const { component } = render(RegisteredBuddies, { ...props, server: "http://127.0.0.1:50051" });
	expect(
		await screen.findByText(/Away-from-home access needs your family server on HTTPS/),
	).toBeVisible();
	await component.refreshDevices();
	expect(mocks.list).not.toHaveBeenCalled();
	expect(screen.queryByRole("alert")).toBeNull();
});

it("shows each paired FamBuddy's license once it reports one", async () => {
	const paired = (id: string, state: "valid" | "unknown") => ({
		registration: { id, name: id, createdAt: "" },
		pair: { pair: { binding: { device: `${id}-device` } } },
		service: {},
		output: {
			settings: [
				{
					device: `${id}-device`,
					wake_word: "",
					muted: false,
					license: { state, edition: "", features: [], expires_at: "" },
				},
			],
			turns: [],
		},
		busy: false,
		error: "",
	});
	const directory = {
		available: true,
		loading: false,
		error: "",
		sessions: [paired("Kitchen", "valid"), paired("Garage", "unknown")],
		refresh: vi.fn(async () => {}),
		session: vi.fn(),
	};
	render(RegisteredBuddies, {
		context: new Map([["vulture:runtime", { services: { fambuddy: directory } }]]),
	});
	expect(await screen.findByText("Paired on this app · License: Active")).toBeTruthy();
	expect(screen.getByText("Paired on this app")).toBeTruthy();
});
