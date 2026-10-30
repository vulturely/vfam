import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import BuddyDevice from "./BuddyDevice.svelte";
import { startBuddyTalk } from "./talk";
vi.mock("./talk", () => ({ startBuddyTalk: vi.fn() }));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});
it("keeps End live talk available while a dashboard request is pending", async () => {
	const stop = vi.fn(async () => {});
	vi.mocked(startBuddyTalk).mockResolvedValue(stop);
	const props = {
		device: { device: "device", wake_word: "hey buddy", muted: false },
		connection: {
			service: { command: vi.fn(), watch: vi.fn(), openTalk: vi.fn() },
		},
		busy: false,
		oncommand: vi.fn(),
	};
	const view = render(BuddyDevice, props);
	await fireEvent.click(screen.getByRole("button", { name: "Start live talk" }));
	await screen.findByRole("button", { name: "End live talk" });
	await view.rerender({ ...props, busy: true });
	const end = screen.getByRole("button", { name: "End live talk" });
	expect(end).toBeEnabled();
	expect(screen.getByRole("button", { name: "Mute and cancel all requests" })).toBeEnabled();
	expect(screen.getByRole("button", { name: "Save wake phrase" })).toBeDisabled();
	await fireEvent.click(end);
	expect(stop).toHaveBeenCalledOnce();
});

it("saves wake edits muted so delayed edits cannot undo an emergency mute", async () => {
	let finish!: () => void;
	const pending = new Promise<void>((resolve) => {
		finish = resolve;
	});
	const oncommand = vi.fn(() => pending);
	render(BuddyDevice, {
		device: { device: "device", wake_word: "hey buddy", muted: false },
		connection: {
			service: { command: vi.fn(), watch: vi.fn(), openTalk: vi.fn() },
		},
		busy: false,
		oncommand,
	});
	await fireEvent.input(screen.getByRole("textbox", { name: "Wake phrase" }), {
		target: { value: "hello bird" },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Save wake phrase" }));
	await fireEvent.click(screen.getByRole("button", { name: "Mute and cancel all requests" }));
	expect(oncommand.mock.calls).toEqual([
		[
			{
				action: "configure",
				device: "device",
				wake_word: "hello bird",
				muted: true,
			},
		],
		[
			{
				action: "configure",
				device: "device",
				wake_word: "hey buddy",
				muted: true,
			},
		],
	]);
	finish();
});

it("requires camera opt-in and stops live view when permission is removed", async () => {
	const stop = vi.fn(async () => {});
	vi.mocked(startBuddyTalk).mockResolvedValue(stop);
	const props = {
		device: {
			device: "device",
			wake_word: "hey buddy",
			muted: false,
			camera_enabled: false,
		},
		connection: {
			service: { command: vi.fn(), watch: vi.fn(), openTalk: vi.fn() },
		},
		busy: false,
		oncommand: vi.fn(),
	};
	const view = render(BuddyDevice, props);
	expect(screen.queryByRole("button", { name: "Start live view" })).toBeNull();
	await fireEvent.click(screen.getByRole("button", { name: "Enable camera access" }));
	expect(props.oncommand).toHaveBeenCalledWith({
		action: "configure_camera",
		device: "device",
		enabled: true,
	});
	expect(startBuddyTalk).not.toHaveBeenCalled();
	await view.rerender({
		...props,
		device: { ...props.device, camera_enabled: true },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Start live view" }));
	await screen.findByRole("button", { name: "End live view" });
	expect(startBuddyTalk).toHaveBeenCalledWith(
		props.connection.service,
		"device",
		expect.objectContaining({ video: true }),
	);
	await view.rerender({
		...props,
		device: { ...props.device, camera_enabled: true },
		busy: true,
	});
	expect(screen.getByRole("button", { name: "Disable camera access" })).toBeEnabled();
	expect(screen.getByRole("button", { name: "End live view" })).toBeEnabled();
	await view.rerender(props);
	expect(stop).toHaveBeenCalledOnce();
});

it("excludes another live session while starting, active, and stopping", async () => {
	let started!: (stop: () => Promise<void>) => void;
	let stopped!: () => void;
	const stop = vi.fn(
		() =>
			new Promise<void>((resolve) => {
				stopped = resolve;
			}),
	);
	vi.mocked(startBuddyTalk).mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				started = resolve;
			}),
	);
	render(BuddyDevice, {
		device: {
			device: "device",
			wake_word: "hey buddy",
			muted: false,
			camera_enabled: true,
		},
		connection: {
			service: { command: vi.fn(), watch: vi.fn(), openTalk: vi.fn() },
		},
		busy: false,
		oncommand: vi.fn(),
	});
	await fireEvent.click(screen.getByRole("button", { name: "Start live talk" }));
	const view = screen.getByRole("button", { name: "Start live view" });
	expect(view).toBeDisabled();
	started(stop);
	await screen.findByRole("button", { name: "End live talk" });
	expect(view).toBeDisabled();
	await fireEvent.click(screen.getByRole("button", { name: "End live talk" }));
	expect(view).toBeDisabled();
	stopped();
	await vi.waitFor(() => expect(view).toBeEnabled());
	expect(startBuddyTalk).toHaveBeenCalledOnce();
});

it("releases a failed start so live view can be attempted", async () => {
	vi.mocked(startBuddyTalk).mockRejectedValueOnce(new Error("No media route"));
	render(BuddyDevice, {
		device: {
			device: "device",
			wake_word: "hey buddy",
			muted: false,
			camera_enabled: true,
		},
		connection: {
			service: { command: vi.fn(), watch: vi.fn(), openTalk: vi.fn() },
		},
		busy: false,
		oncommand: vi.fn(),
	});
	await fireEvent.click(screen.getByRole("button", { name: "Start live talk" }));
	await screen.findByText("No media route");
	expect(screen.getByRole("button", { name: "Start live view" })).toBeEnabled();
});

it("retains exclusion until a cancelled pending start finishes cleanup", async () => {
	let started!: (stop: () => Promise<void>) => void;
	const stop = vi.fn(async () => {});
	vi.mocked(startBuddyTalk).mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				started = resolve;
			}),
	);
	const props = {
		device: {
			device: "device",
			wake_word: "hey buddy",
			muted: false,
			camera_enabled: true,
		},
		connection: {
			service: { command: vi.fn(), watch: vi.fn(), openTalk: vi.fn() },
		},
		busy: false,
		oncommand: vi.fn(),
	};
	const view = render(BuddyDevice, props);
	await fireEvent.click(screen.getByRole("button", { name: "Start live talk" }));
	await view.rerender({ ...props, device: { ...props.device, muted: true } });
	expect(vi.mocked(startBuddyTalk).mock.calls[0][2].signal?.aborted).toBe(true);
	await view.rerender(props);
	expect(screen.getByRole("button", { name: "Start live view" })).toBeDisabled();
	started(stop);
	await vi.waitFor(() =>
		expect(screen.getByRole("button", { name: "Start live view" })).toBeEnabled(),
	);
	expect(stop).toHaveBeenCalledOnce();
	expect(screen.queryByRole("button", { name: "End live talk" })).toBeNull();
});

it("shows what the device is saying and switches captions", async () => {
	const oncommand = vi.fn();
	render(BuddyDevice, {
		device: { device: "device", wake_word: "hey buddy", muted: false, captions_enabled: true },
		caption: { device: "device", turn: "turn", text: "Dinner is ready.", started_at: "now" },
		connection: { service: { command: vi.fn(), watch: vi.fn(), openTalk: vi.fn() } },
		busy: false,
		oncommand,
	});
	expect(screen.getByText("Dinner is ready.")).toBeVisible();
	await fireEvent.click(screen.getByRole("button", { name: "Turn captions off" }));
	expect(oncommand).toHaveBeenCalledWith({
		action: "configure_captions",
		device: "device",
		enabled: false,
	});
});

it("sends a confirmed screen PIN for this device", async () => {
	const oncommand = vi.fn(async () => {});
	render(BuddyDevice, {
		device: { device: "device", wake_word: "hey buddy", muted: false, screen_pin_set: false },
		connection: { service: { command: vi.fn(), watch: vi.fn(), openTalk: vi.fn() } },
		busy: false,
		oncommand,
	});
	expect(screen.getByText("No PIN")).toBeVisible();
	await fireEvent.click(screen.getByRole("button", { name: "Set PIN" }));
	await fireEvent.input(screen.getByLabelText("New PIN"), { target: { value: "2468" } });
	await fireEvent.input(screen.getByLabelText("Enter the PIN again"), {
		target: { value: "2468" },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Save PIN" }));
	expect(oncommand).toHaveBeenCalledWith({
		action: "configure_screen_pin",
		device: "device",
		pin: "2468",
	});
});

it("installs an available update and switches automatic updates for this device", async () => {
	const oncommand = vi.fn(async () => {});
	render(BuddyDevice, {
		device: {
			device: "device",
			wake_word: "hey buddy",
			muted: false,
			installed_version: "v0.1.56",
			available_version: "v0.1.57",
			update_state: "available",
		},
		connection: { service: { command: vi.fn(), watch: vi.fn(), openTalk: vi.fn() } },
		busy: false,
		oncommand,
	});
	expect(screen.getByText("Update available: v0.1.57")).toBeVisible();
	await fireEvent.click(screen.getByRole("button", { name: "Update now" }));
	expect(oncommand).toHaveBeenCalledWith({ action: "install_update", device: "device" });
	await fireEvent.click(screen.getByRole("switch", { name: "Install updates automatically" }));
	expect(oncommand).toHaveBeenCalledWith({
		action: "configure_updates",
		device: "device",
		automatic: true,
	});
});

it("says live camera needs a license and installs the family's license on this FamBuddy", async () => {
	const oncommand = vi.fn(async () => {});
	const none = { state: "none" as const, edition: "", features: [], expires_at: "" };
	const familyLicense = { ...none, state: "valid" as const };
	render(BuddyDevice, {
		props: {
			device: { device: "device", wake_word: "hey buddy", muted: false, license: none },
			connection: { service: { command: vi.fn(), watch: vi.fn(), openTalk: vi.fn() } },
			busy: false,
			oncommand,
		},
		context: new Map([
			["vulture:runtime", { services: { fambuddyLicense: { license: familyLicense } } }],
		]),
	});
	expect(screen.getByText("Needs a FamBuddy license")).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Enable camera access" })).toBeNull();
	await fireEvent.click(screen.getByRole("button", { name: "Install on this FamBuddy" }));
	await fireEvent.input(screen.getByLabelText("License key"), { target: { value: "sap-token" } });
	await fireEvent.click(screen.getByRole("button", { name: "Install" }));
	expect(oncommand).toHaveBeenCalledWith({
		action: "install_license",
		device: "device",
		token: "sap-token",
	});
});

it("shows on-device AI and sends the family AI mode for this device", async () => {
	const oncommand = vi.fn(async () => {});
	render(BuddyDevice, {
		device: { device: "device", wake_word: "hey buddy", muted: false, ai_mode: "cloud_only" },
		connection: { service: { command: vi.fn(), watch: vi.fn(), openTalk: vi.fn() } },
		busy: false,
		oncommand,
	});
	expect(screen.getByText(/On-device AI: not available/)).toBeVisible();
	expect(screen.getByRole("radio", { name: /Cloud only/ })).toBeChecked();
	await fireEvent.click(screen.getByRole("radio", { name: /Local only/ }));
	expect(oncommand).toHaveBeenCalledWith({
		action: "configure_ai_mode",
		device: "device",
		mode: "local_only",
	});
});
