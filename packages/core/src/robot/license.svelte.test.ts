import { beforeEach, describe, expect, it, vi } from "vitest";
import { NativeServerError } from "../repositories/server";
import { createFamBuddyLicenseService } from "./license.svelte";
import type { FamBuddyLicense } from "./license";
import type { BuddyCommand } from "./buddy";

vi.mock("./onboarding/registry", () => ({ getFamilyLicense: vi.fn(), setFamilyLicense: vi.fn() }));

const valid: FamBuddyLicense = {
	state: "valid",
	edition: "Family",
	features: ["fambuddy.remote_access"],
	expires_at: "2027-01-01T00:00:00Z",
};
const none: FamBuddyLicense = { state: "none", edition: "", features: [], expires_at: "" };

function session(id: string, name: string, paired = true) {
	return {
		registration: { id, name, createdAt: "" },
		service: paired ? {} : undefined,
		output: { settings: [], turns: [] },
		busy: false,
		error: "",
	};
}

let boundary: (() => void) | undefined;
const auth = {
	getAccessToken: vi.fn(async () => "vps_parent"),
	watchSessionBoundary: vi.fn((close: () => void) => {
		boundary = close;
		return () => {};
	}),
};

function setup({
	available = true,
	sessions = [session("home", "FamBuddy at home"), session("kitchen", "Kitchen")],
	devices = (id: string) => (id === "home" ? ["home-1", "home-2"] : [`${id}-device`]),
	command = vi.fn<(id: string, input: BuddyCommand) => Promise<unknown>>(async () => ({
		settings: [],
		turns: [],
	})),
} = {}) {
	const directory = {
		available,
		refresh: vi.fn(async () => {}),
		sessions,
		devices: vi.fn(async (id: string) => devices(id)),
		command,
	};
	const repository = { get: vi.fn(), set: vi.fn() };
	const service = createFamBuddyLicenseService(
		"https://family.example",
		auth,
		directory as never,
		repository,
	);
	return { service, directory, repository, command };
}

beforeEach(() => {
	vi.clearAllMocks();
	boundary = undefined;
});

describe("FamBuddy license service", () => {
	it("reads the family's license only from a family server on HTTPS", async () => {
		const offline = setup({ available: false });
		await offline.service.load();
		expect(offline.repository.get).not.toHaveBeenCalled();
		expect(offline.service.available).toBe(false);

		const { service, repository } = setup();
		repository.get.mockResolvedValue(valid);
		await service.load();
		expect(repository.get).toHaveBeenCalledWith({
			server: "https://family.example",
			auth,
		});
		expect(service.license).toEqual(valid);
		expect(service.loading).toBe(false);

		repository.get.mockRejectedValue(new NativeServerError("permission_denied", "no"));
		await service.load();
		expect(service.error).toMatch(/Only a guardian/);
		repository.get.mockRejectedValue("odd");
		await service.load();
		expect(service.error).toBe("The FamBuddy license could not be read.");
	});

	it("installs on the server, then on every device of every paired FamBuddy", async () => {
		const { service, repository, directory, command } = setup({
			sessions: [
				session("home", "FamBuddy at home"),
				session("kitchen", "Kitchen"),
				session("garage", "Garage", false),
			],
		});
		repository.set.mockResolvedValue(valid);
		await expect(service.install("  sap-token \n")).resolves.toBe(true);
		expect(repository.set).toHaveBeenCalledWith(
			{ server: "https://family.example", auth },
			"sap-token",
		);
		expect(directory.refresh).toHaveBeenCalled();
		expect(command.mock.calls).toEqual([
			["home", { action: "install_license", device: "home-1", token: "sap-token" }],
			["kitchen", { action: "install_license", device: "kitchen-device", token: "sap-token" }],
			["home", { action: "install_license", device: "home-2", token: "sap-token" }],
		]);
		expect(service.license).toEqual(valid);
		expect(service.failures).toEqual([]);
		expect(service.notice).toBe("License installed for your family and on 2 FamBuddies.");
		expect(service.busy).toBe(false);
	});

	it("reports each FamBuddy that failed without holding back the others", async () => {
		const command = vi.fn(async (id: string) => {
			if (id === "kitchen") throw new Error("Device did not confirm.");
			return { settings: [], turns: [] };
		});
		const { service, repository } = setup({
			command,
			sessions: [
				session("home", "FamBuddy at home"),
				session("kitchen", "Kitchen"),
				session("attic", "Attic"),
			],
			devices: (id) => {
				if (id === "attic") throw new NativeServerError("unavailable", "down");
				return id === "home" ? ["home-1"] : [`${id}-device`];
			},
		});
		repository.set.mockResolvedValue(valid);
		await expect(service.install("sap-token")).resolves.toBe(true);
		expect(command).toHaveBeenCalledWith("home", expect.anything());
		expect(service.failures).toEqual([
			{ id: "kitchen", name: "Kitchen", message: "Device did not confirm." },
			{ id: "attic", name: "Attic", message: expect.stringMatching(/could not be reached/) },
		]);
		expect(service.notice).toBe("License installed for your family and on 1 FamBuddy.");
	});

	it("still installs on the other devices of a hub when one of them fails", async () => {
		const command = vi.fn(async (_id: string, input: BuddyCommand) => {
			if ("device" in input && input.device === "home-1") throw new Error("Device is busy.");
			return { settings: [], turns: [] };
		});
		const { service, repository } = setup({
			command,
			sessions: [session("home", "FamBuddy at home")],
		});
		repository.set.mockResolvedValue(valid);
		await expect(service.install("sap-token")).resolves.toBe(true);
		expect(command).toHaveBeenCalledWith("home", {
			action: "install_license",
			device: "home-2",
			token: "sap-token",
		});
		expect(service.failures).toEqual([
			{ id: "home", name: "FamBuddy at home", message: "Device is busy." },
		]);
		expect(service.notice).toBe("License installed for your family and on 1 FamBuddy.");
	});

	it("says so when no FamBuddy took it, or none is paired", async () => {
		const failing = setup({
			sessions: [session("kitchen", "Kitchen")],
			command: vi.fn(async () => {
				throw "offline";
			}),
		});
		failing.repository.set.mockResolvedValue(valid);
		await failing.service.install("sap-token");
		expect(failing.service.notice).toBe("License installed for your family.");
		expect(failing.service.failures[0].message).toBe("This FamBuddy could not be reached.");

		const empty = setup({ sessions: [] });
		empty.repository.set.mockResolvedValue(valid);
		await empty.service.install("sap-token");
		expect(empty.service.notice).toBe(
			"License installed for your family. No paired FamBuddy needed it.",
		);
	});

	it.each([
		["invalid_argument", /not a valid FamBuddy license/],
		["failed_precondition", /expired, is not valid yet, or is older/],
		["already_exists", /already used by another family/],
		["permission_denied", /Only a guardian/],
	])("explains a %s refusal and sends nothing to the FamBuddies", async (kind, message) => {
		const { service, repository, command } = setup();
		repository.set.mockRejectedValue(new NativeServerError(kind, "raw"));
		await expect(service.install("sap-token")).resolves.toBe(false);
		expect(service.error).toMatch(message);
		expect(command).not.toHaveBeenCalled();
		expect(service.busy).toBe(false);
	});

	it("removes the license with an empty token everywhere", async () => {
		const { service, repository, command } = setup({ sessions: [session("kitchen", "Kitchen")] });
		repository.set.mockResolvedValue(none);
		await expect(service.remove()).resolves.toBe(true);
		expect(repository.set).toHaveBeenCalledWith(expect.anything(), "");
		expect(command).toHaveBeenCalledWith("kitchen", {
			action: "install_license",
			device: "kitchen-device",
			token: "",
		});
		expect(service.license).toEqual(none);
		expect(service.notice).toBe("License removed for your family and on 1 FamBuddy.");
	});

	it("asks for a key, needs the family server, and runs one save at a time", async () => {
		const { service, repository } = setup();
		await expect(service.install("   ")).resolves.toBe(false);
		expect(service.error).toBe("Paste your FamBuddy license key.");
		expect(repository.set).not.toHaveBeenCalled();

		let finish: (value: FamBuddyLicense) => void = () => {};
		repository.set.mockReturnValue(new Promise((resolve) => (finish = resolve)));
		const first = service.install("sap-token");
		expect(service.busy).toBe(true);
		await expect(service.install("sap-token")).resolves.toBe(false);
		finish(valid);
		await first;
		expect(repository.set).toHaveBeenCalledOnce();

		const offline = setup({ available: false });
		await expect(offline.service.remove()).resolves.toBe(false);
		expect(offline.service.error).toMatch(/HTTPS/);
	});

	it("installs the pasted key on one FamBuddy and explains a failure", async () => {
		const { service, command } = setup();
		await service.installOn("kitchen", "kitchen-device", " sap-token ");
		expect(command).toHaveBeenCalledWith("kitchen", {
			action: "install_license",
			device: "kitchen-device",
			token: "sap-token",
		});
		await expect(service.installOn("kitchen", "kitchen-device", "")).rejects.toThrow(
			"Paste your FamBuddy license key.",
		);
		command.mockRejectedValueOnce(new Error("That FamBuddy license has expired."));
		await expect(service.installOn("kitchen", "kitchen-device", "old")).rejects.toThrow(
			"That FamBuddy license has expired.",
		);
	});

	it("forgets everything at a session boundary, including late replies", async () => {
		const { service, repository } = setup();
		repository.get.mockResolvedValue(valid);
		await service.load();
		expect(service.license).toEqual(valid);
		boundary?.();
		expect(service.license).toBeUndefined();

		let read: (value: FamBuddyLicense) => void = () => {};
		repository.get.mockReturnValue(new Promise((resolve) => (read = resolve)));
		const loading = service.load();
		service.reset();
		read(valid);
		await loading;
		expect(service.license).toBeUndefined();

		let saved: (value: FamBuddyLicense) => void = () => {};
		repository.set.mockReturnValue(new Promise((resolve) => (saved = resolve)));
		const saving = service.install("sap-token");
		service.reset();
		saved(valid);
		await expect(saving).resolves.toBe(false);
		expect(service.license).toBeUndefined();

		const { service: late, repository: lateRepository, directory } = setup();
		lateRepository.set.mockResolvedValue(valid);
		directory.refresh.mockImplementation(async () => late.reset());
		await expect(late.install("sap-token")).resolves.toBe(false);
		expect(late.notice).toBe("");

		const { service: failed, repository: failedRepository } = setup();
		let reject: (cause: unknown) => void = () => {};
		failedRepository.set.mockReturnValue(new Promise((_, no) => (reject = no)));
		const failing = failed.install("sap-token");
		failed.reset();
		reject(new Error("late"));
		await failing;
		expect(failed.error).toBe("");
	});
});
