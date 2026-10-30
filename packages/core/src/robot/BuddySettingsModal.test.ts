import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import type { Runtime } from "../runtime/registry.svelte";
import type { FamBuddySession } from "./directory.svelte";
import BuddySettingsModal from "./BuddySettingsModal.svelte";

vi.mock("./BuddyProvider.svelte", async () => ({
	default: (await import("./BuddyProviderTestStub.svelte")).default,
}));

const session: FamBuddySession = {
	registration: { id: "registration", name: "Kitchen", createdAt: "2026-01-01T00:00:00Z" },
	pair: {
		registration: "registration",
		token: `vrp_${"a".repeat(64)}`,
		pair: {
			origin: "https://relay.example",
			account: "fambuddy-parent:parent:channel",
			own: {
				accountId: "fambuddy-parent:parent:channel",
				deviceId: "device",
				fingerprint: "a".repeat(64),
				keyPackage: "key",
			},
			peer: {
				accountId: "fambuddy:device",
				deviceId: "device",
				fingerprint: "b".repeat(64),
				keyPackage: "peer-key",
			},
			binding: { channel: "channel", family: "family", device: "device" },
		},
	},
	service: { command: vi.fn(), watch: vi.fn(), openTalk: vi.fn() },
	output: {
		settings: [{ device: "device", wake_word: "hey buddy", muted: false, camera_enabled: false }],
		turns: [],
	},
	busy: false,
	error: "",
};

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	session.output.settings[0].wake_word = "hey buddy";
	session.output.settings[0].camera_enabled = false;
	session.output.settings[0].screen_pin_set = false;
	delete session.output.settings[0].update_state;
	delete session.output.settings[0].installed_version;
	session.error = "";
});

it("saves wake phrase, listening, and camera settings and releases the watch", async () => {
	const directory = {
		acquire: vi.fn(async () => {}),
		release: vi.fn(),
		command: vi.fn(async () => session.output),
	};
	const runtime = {
		config: { serverUrl: "https://relay.example" },
		services: { fambuddy: directory, auth: {} },
	} as unknown as Runtime;
	const view = render(BuddySettingsModal, {
		props: { session, open: true },
		context: new Map([["vulture:runtime", runtime]]),
	});
	const input = await screen.findByLabelText("Wake phrase");
	await fireEvent.input(input, { target: { value: "hey kitchen" } });
	await fireEvent.click(screen.getByRole("button", { name: "Save wake phrase" }));
	expect(directory.command).toHaveBeenCalledWith("registration", {
		action: "configure",
		device: "device",
		wake_word: "hey kitchen",
		muted: true,
	});
	await fireEvent.click(screen.getByRole("button", { name: "Mute listening" }));
	expect(directory.command).toHaveBeenCalledWith("registration", {
		action: "configure",
		device: "device",
		wake_word: "hey buddy",
		muted: true,
	});
	await fireEvent.click(screen.getByRole("button", { name: "Enable camera access" }));
	expect(directory.command).toHaveBeenCalledWith("registration", {
		action: "configure_camera",
		device: "device",
		enabled: true,
	});
	expect(screen.getByText("AI provider settings")).toBeVisible();
	view.unmount();
	expect(directory.release).toHaveBeenCalledWith("registration");
});

it("handles rejected settings commands while preserving their error notification", async () => {
	session.error = "Storage unavailable";
	const directory = {
		acquire: vi.fn(async () => {}),
		release: vi.fn(),
		command: vi.fn(async () => {
			throw new Error("Storage unavailable");
		}),
	};
	const runtime = {
		config: { serverUrl: "https://relay.example" },
		services: { fambuddy: directory, auth: {} },
	} as unknown as Runtime;
	render(BuddySettingsModal, {
		props: { session, open: true },
		context: new Map([["vulture:runtime", runtime]]),
	});
	await fireEvent.input(await screen.findByLabelText("Wake phrase"), {
		target: { value: "hey kitchen" },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Save wake phrase" }));
	expect(directory.command).toHaveBeenCalledOnce();
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Storage unavailable",
	);
});

it("sets and removes the screen PIN through the FamBuddy directory", async () => {
	session.output.settings[0].screen_pin_set = true;
	const directory = {
		acquire: vi.fn(async () => {}),
		release: vi.fn(),
		command: vi.fn(async () => session.output),
	};
	const runtime = {
		config: { serverUrl: "https://relay.example" },
		services: { fambuddy: directory, auth: {} },
	} as unknown as Runtime;
	render(BuddySettingsModal, {
		props: { session, open: true },
		context: new Map([["vulture:runtime", runtime]]),
	});
	expect(await screen.findByText("PIN set")).toBeVisible();
	await fireEvent.click(screen.getByRole("button", { name: "Change PIN" }));
	await fireEvent.input(screen.getByLabelText("New PIN"), { target: { value: "13579" } });
	await fireEvent.input(screen.getByLabelText("Enter the PIN again"), {
		target: { value: "13579" },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Save PIN" }));
	expect(directory.command).toHaveBeenCalledWith("registration", {
		action: "configure_screen_pin",
		device: "device",
		pin: "13579",
	});
	await fireEvent.click(await screen.findByRole("button", { name: "Remove PIN" }));
	expect(directory.command).toHaveBeenCalledWith("registration", {
		action: "configure_screen_pin",
		device: "device",
		pin: "",
	});
});

it("sends Update now and the automatic-updates switch through the FamBuddy directory", async () => {
	session.output.settings[0].update_state = "failed";
	session.output.settings[0].installed_version = "v0.1.56";
	const directory = {
		acquire: vi.fn(async () => {}),
		release: vi.fn(),
		command: vi.fn(async () => session.output),
	};
	const runtime = {
		config: { serverUrl: "https://relay.example" },
		services: { fambuddy: directory, auth: {} },
	} as unknown as Runtime;
	render(BuddySettingsModal, {
		props: { session, open: true },
		context: new Map([["vulture:runtime", runtime]]),
	});
	expect(
		await screen.findByText("Last update failed — the FamBuddy kept its previous version."),
	).toBeVisible();
	expect(screen.getByText("Installed version: v0.1.56")).toBeVisible();
	await fireEvent.click(screen.getByRole("button", { name: "Update now" }));
	expect(directory.command).toHaveBeenCalledWith("registration", {
		action: "install_update",
		device: "device",
	});
	await fireEvent.click(screen.getByRole("switch", { name: "Install updates automatically" }));
	expect(directory.command).toHaveBeenCalledWith("registration", {
		action: "configure_updates",
		device: "device",
		automatic: true,
	});
});

it("names a voice through the FamBuddy directory", async () => {
	session.output.voices = [{ speaker: "speaker", name: "", role: "child" }];
	const directory = {
		acquire: vi.fn(async () => {}),
		release: vi.fn(),
		command: vi.fn(async () => session.output),
	};
	const runtime = {
		config: { serverUrl: "https://relay.example" },
		services: { fambuddy: directory, auth: {} },
	} as unknown as Runtime;
	render(BuddySettingsModal, {
		props: { session, open: true },
		context: new Map([["vulture:runtime", runtime]]),
	});
	await fireEvent.input(await screen.findByLabelText("Name for voice 1"), {
		target: { value: "Jamie" },
	});
	await fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);
	expect(directory.command).toHaveBeenCalledWith("registration", {
		action: "label_voice",
		device: "device",
		speaker: "speaker",
		name: "Jamie",
		role: "child",
	});
	delete session.output.voices;
});

it("says live camera needs a license and installs the pasted key on this FamBuddy", async () => {
	const none = { state: "none" as const, edition: "", features: [], expires_at: "" };
	session.output.settings[0].license = none;
	const directory = {
		acquire: vi.fn(async () => {}),
		release: vi.fn(),
		command: vi.fn(async () => session.output),
	};
	const fambuddyLicense = {
		license: { ...none, state: "valid" },
		installOn: vi.fn(async () => {}),
	};
	const runtime = {
		config: { serverUrl: "https://relay.example" },
		services: { fambuddy: directory, fambuddyLicense, auth: {} },
	} as unknown as Runtime;
	render(BuddySettingsModal, {
		props: { session, open: true },
		context: new Map([["vulture:runtime", runtime]]),
	});
	expect(await screen.findByText("Needs a FamBuddy license")).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Enable camera access" })).toBeNull();
	await fireEvent.click(screen.getByRole("button", { name: "Install on this FamBuddy" }));
	await fireEvent.input(screen.getByLabelText("License key"), { target: { value: "sap-token" } });
	await fireEvent.click(screen.getByRole("button", { name: "Install" }));
	expect(fambuddyLicense.installOn).toHaveBeenCalledWith("registration", "device", "sap-token");
	delete session.output.settings[0].license;
});

it("shows on-device AI and sends the family AI mode through the FamBuddy directory", async () => {
	session.output.settings[0].ai_mode = "local_only";
	session.output.settings[0].local_ai = true;
	const directory = {
		acquire: vi.fn(async () => {}),
		release: vi.fn(),
		command: vi.fn(async () => session.output),
	};
	const runtime = {
		config: { serverUrl: "https://relay.example" },
		services: { fambuddy: directory, auth: {} },
	} as unknown as Runtime;
	render(BuddySettingsModal, {
		props: { session, open: true },
		context: new Map([["vulture:runtime", runtime]]),
	});
	expect(await screen.findByText("On-device AI: available")).toBeVisible();
	await fireEvent.click(screen.getByRole("radio", { name: /Local first, cloud when needed/ }));
	expect(directory.command).toHaveBeenCalledWith("registration", {
		action: "configure_ai_mode",
		device: "device",
		mode: "local_first",
	});
	delete session.output.settings[0].ai_mode;
	delete session.output.settings[0].local_ai;
});
