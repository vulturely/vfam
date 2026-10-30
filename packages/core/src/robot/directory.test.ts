import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { createFamBuddyDirectory } from "./directory.svelte";
import type { BuddyCommand, BuddyOutput } from "./buddy";

const mocks = vi.hoisted(() => ({
	list: vi.fn(),
	get: vi.fn(),
	enroll: vi.fn(),
	revoke: vi.fn(),
	remote: vi.fn(),
	deleteIf: vi.fn(),
	acknowledge: vi.fn(),
}));
vi.mock("./onboarding/registry", () => ({
	list: mocks.list,
	revoke: mocks.revoke,
	acknowledgeApproval: mocks.acknowledge,
	register: vi.fn(),
}));
vi.mock("./onboarding/enroll", () => ({ enrollRegistered: mocks.enroll }));
vi.mock("../api/fambuddy/fambuddyStorage", () => ({
	famBuddyRecords: () => ({ get: mocks.get, deleteIf: mocks.deleteIf }),
}));
vi.mock("./remote/service", () => ({ createRemoteBuddy: mocks.remote }));
const home = vi.hoisted(() => ({ service: vi.fn() }));
vi.mock("./buddy", () => ({ createBuddyService: home.service }));

const registration = { id: "registration", name: "Kitchen" };
const saved = {
	registration: registration.id,
	token: `vrp_${"a".repeat(64)}`,
	pair: {
		origin: "https://relay.example",
		account: "fambuddy-parent:parent:channel",
		own: { accountId: "fambuddy-parent:parent:channel" },
		binding: { channel: "channel", family: "family", device: "device" },
	},
};
const output: BuddyOutput = {
	settings: [{ device: "device", wake_word: "hey buddy", muted: false, camera_enabled: true }],
	turns: [],
};
const auth = {
	getAccessToken: vi.fn(async () => "vps_parent"),
	watchSessionBoundary: vi.fn(),
};

beforeEach(() => {
	vi.resetAllMocks();
	mocks.list.mockResolvedValue([registration]);
	mocks.get.mockResolvedValue(saved);
	mocks.revoke.mockResolvedValue(undefined);
	mocks.deleteIf.mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());

describe("FamBuddy directory", () => {
	it("restores a saved pair and shares one watch lease across consumers", async () => {
		let signal: AbortSignal | undefined;
		const service = {
			command: vi.fn(async () => output),
			openTalk: vi.fn(),
			watch: vi.fn(async function* (_family: string, nextSignal: AbortSignal) {
				signal = nextSignal;
				yield output;
				await new Promise<void>((resolve) =>
					nextSignal.addEventListener("abort", () => resolve(), { once: true }),
				);
			}),
		};
		mocks.remote.mockReturnValue(service);
		const directory = createFamBuddyDirectory("https://relay.example", auth, () => "parent");
		await directory.refresh();
		await directory.acquire(registration.id);
		await directory.acquire(registration.id);
		expect(service.watch).toHaveBeenCalledOnce();
		directory.release(registration.id);
		expect(signal?.aborted).toBe(false);
		directory.release(registration.id);
		expect(signal?.aborted).toBe(true);
		expect(directory.session(registration.id)?.output).toEqual(output);
		directory.close();
	});

	it("reconnects a dropped live stream on its own and clears the notice", async () => {
		vi.useFakeTimers();
		let calls = 0;
		const service = {
			command: vi.fn(async () => output),
			openTalk: vi.fn(),
			watch: vi.fn(async function* (_family: string, nextSignal: AbortSignal) {
				calls++;
				if (calls === 1) throw new Error("Stream reset.");
				if (calls === 2) return;
				yield output;
				await new Promise<void>((resolve) =>
					nextSignal.addEventListener("abort", () => resolve(), { once: true }),
				);
			}),
		};
		mocks.remote.mockReturnValue(service);
		const directory = createFamBuddyDirectory("https://relay.example", auth, () => "parent");
		await directory.refresh();
		await directory.acquire(registration.id);
		await vi.advanceTimersByTimeAsync(0);
		expect(directory.session(registration.id)?.error).toBe("Stream reset. Reconnecting…");
		await vi.advanceTimersByTimeAsync(1_000);
		expect(directory.session(registration.id)?.error).toBe(
			"Device connection ended. Reconnecting…",
		);
		await vi.advanceTimersByTimeAsync(2_000);
		expect(service.watch).toHaveBeenCalledTimes(3);
		expect(directory.session(registration.id)?.error).toBe("");
		expect(directory.session(registration.id)?.output).toEqual(output);
		directory.release(registration.id);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(service.watch).toHaveBeenCalledTimes(3);
		directory.close();
		vi.useRealTimers();
	});

	it("stops reconnecting once the last consumer leaves", async () => {
		vi.useFakeTimers();
		const service = {
			command: vi.fn(async () => output),
			openTalk: vi.fn(),
			watch: vi.fn(async function* () {
				yield* [];
				throw new Error("Unavailable.");
			}),
		};
		mocks.remote.mockReturnValue(service);
		const directory = createFamBuddyDirectory("https://relay.example", auth, () => "parent");
		await directory.refresh();
		await directory.acquire(registration.id);
		await vi.advanceTimersByTimeAsync(0);
		directory.release(registration.id);
		await vi.advanceTimersByTimeAsync(120_000);
		expect(service.watch).toHaveBeenCalledOnce();
		directory.close();
		vi.useRealTimers();
	});

	it("lets go of each wait's abort listener while it keeps retrying", async () => {
		vi.useFakeTimers();
		const added = vi.spyOn(AbortSignal.prototype, "addEventListener");
		const removed = vi.spyOn(AbortSignal.prototype, "removeEventListener");
		onTestFinished(() => {
			added.mockRestore();
			removed.mockRestore();
			vi.useRealTimers();
		});
		const service = {
			command: vi.fn(async () => output),
			openTalk: vi.fn(),
			watch: vi.fn(async function* () {
				yield* [];
				throw new Error("Unavailable.");
			}),
		};
		mocks.remote.mockReturnValue(service);
		const directory = createFamBuddyDirectory("https://relay.example", auth, () => "parent");
		await directory.refresh();
		await directory.acquire(registration.id);
		await vi.advanceTimersByTimeAsync(10 * 30_000);
		expect(service.watch.mock.calls.length).toBeGreaterThan(5);
		const waiting = (spy: typeof added) =>
			spy.mock.calls.filter(([type]) => type === "abort").length;
		// Only the current wait still listens.
		expect(waiting(added) - waiting(removed)).toBe(1);
		directory.close();
	});

	it("tells the family server a review was seen when a parent acts on it", async () => {
		mocks.acknowledge.mockResolvedValue(undefined);
		const service = { command: vi.fn(async () => output), watch: vi.fn(), openTalk: vi.fn() };
		mocks.remote.mockReturnValue(service);
		const directory = createFamBuddyDirectory("https://relay.example", auth, () => "parent");
		await directory.refresh();
		await directory.command(registration.id, {
			action: "approve",
			device: "device",
			turn: "turn",
			review: [1],
		});
		await directory
			.command(registration.id, { action: "mute_placeholder" } as never)
			.catch(() => {});
		expect(mocks.acknowledge).toHaveBeenCalledWith(
			{ server: "https://relay.example", auth },
			registration.id,
			"turn",
		);
		expect(mocks.acknowledge).toHaveBeenCalledOnce();
		await directory.acknowledge("home", "turn");
		expect(mocks.acknowledge).toHaveBeenCalledOnce();
		mocks.acknowledge.mockRejectedValueOnce(new Error("offline"));
		await directory.command(registration.id, {
			action: "cancel",
			device: "device",
			turn: "turn",
		});
		expect(mocks.acknowledge).toHaveBeenCalledTimes(2);
		directory.close();
	});

	it("refreshes output after commands and broadcasts only to paired devices", async () => {
		const commands: BuddyCommand[] = [];
		const service = {
			command: vi.fn(async (command: BuddyCommand) => {
				commands.push(command);
				return output;
			}),
			watch: vi.fn(),
			openTalk: vi.fn(),
		};
		mocks.remote.mockReturnValue(service);
		const directory = createFamBuddyDirectory("https://relay.example", auth, () => "parent");
		await directory.refresh();
		await directory.command(registration.id, {
			action: "configure_camera",
			device: "device",
			enabled: true,
		});
		expect(commands).toEqual([
			{ action: "configure_camera", device: "device", enabled: true },
			{ action: "list", family: "family" },
		]);
		await directory.broadcast("Dinner is ready");
		expect(commands.at(-2)).toEqual({
			action: "announce",
			device: "device",
			text: "Dinner is ready",
		});
		expect(commands.at(-1)).toEqual({ action: "list", family: "family" });
		directory.close();
	});

	it("removes a revoked registration and closes its watch", async () => {
		let signal: AbortSignal | undefined;
		const service = {
			command: vi.fn(async () => output),
			openTalk: vi.fn(),
			watch: vi.fn(async function* (_family: string, nextSignal: AbortSignal) {
				signal = nextSignal;
				yield output;
				await new Promise<void>((resolve) =>
					nextSignal.addEventListener("abort", () => resolve(), { once: true }),
				);
			}),
		};
		mocks.remote.mockReturnValue(service);
		const directory = createFamBuddyDirectory("https://relay.example", auth, () => "parent");
		await directory.refresh();
		await directory.acquire(registration.id);
		await directory.revoke(registration.id);
		expect(mocks.revoke).toHaveBeenCalledWith(
			{ server: "https://relay.example", auth },
			registration.id,
		);
		expect(mocks.deleteIf).toHaveBeenCalledWith(
			`registered:${registration.id}`,
			"channel",
			"channel",
		);
		expect(signal?.aborted).toBe(true);
		expect(directory.session(registration.id)).toBeUndefined();
	});
});

describe("home-network FamBuddy", () => {
	const pairing = {
		gateway: "https://fambuddy.local:5443",
		token: `vps_${"c".repeat(64)}`,
		family: "home-family",
		expires_at: new Date(Date.now() + 60_000).toISOString(),
	};
	const homeOutput: BuddyOutput = {
		settings: [{ device: "home-device", wake_word: "hey buddy", muted: false }],
		turns: [],
	};

	it("joins the list, even without a family server on HTTPS, and takes commands", async () => {
		const command = vi.fn(async () => homeOutput);
		home.service.mockReturnValue({ command, watch: vi.fn(), openTalk: vi.fn() });
		mocks.get.mockImplementation(async (key: string) => (key === "pairing" ? pairing : null));
		const directory = createFamBuddyDirectory("http://127.0.0.1:50051", auth, () => "parent");
		await directory.refresh();
		expect(mocks.list).not.toHaveBeenCalled();
		const session = directory.session("home");
		expect(session?.registration.name).toBe("FamBuddy at home");
		expect(home.service).toHaveBeenCalledWith(pairing.gateway, expect.anything());
		await directory.command("home", { action: "announce", device: "home-device", text: "Hi" });
		expect(command).toHaveBeenCalledWith({ action: "list", family: "home-family" });
		const { deviceOf } = await import("./directory.svelte");
		expect(deviceOf(directory.session("home")!)).toBe("home-device");
		await directory.broadcast("Dinner");
		expect(command).toHaveBeenCalledWith({
			action: "announce",
			device: "home-device",
			text: "Dinner",
		});
		// A refresh keeps the same session while the pairing is unchanged.
		await directory.refresh();
		expect(home.service).toHaveBeenCalledOnce();
	});

	it("leaves out an expired or missing home pairing", async () => {
		mocks.get.mockImplementation(async (key: string) =>
			key === "pairing" ? { ...pairing, expires_at: "2000-01-01T00:00:00Z" } : null,
		);
		const directory = createFamBuddyDirectory("http://127.0.0.1:50051", auth, () => "parent");
		await directory.refresh();
		expect(directory.session("home")).toBeUndefined();
		mocks.get.mockRejectedValue(new Error("locked"));
		await directory.refresh();
		expect(directory.sessions).toEqual([]);
	});

	it("lists the devices a license goes to: every home device, or the paired one", async () => {
		const twoDevices: BuddyOutput = {
			settings: [
				{ device: "home-device", wake_word: "hey buddy", muted: false },
				{ device: "second", wake_word: "hey buddy", muted: false },
			],
			turns: [],
		};
		const command = vi.fn(async () => twoDevices);
		home.service.mockReturnValue({ command, watch: vi.fn(), openTalk: vi.fn() });
		mocks.remote.mockReturnValue({ command: vi.fn(), watch: vi.fn(), openTalk: vi.fn() });
		mocks.get.mockImplementation(async (key: string) => (key === "pairing" ? pairing : saved));
		const directory = createFamBuddyDirectory("https://relay.example", auth, () => "parent");
		await directory.refresh();
		// Not watched yet: the hub is asked.
		await expect(directory.devices("home")).resolves.toEqual(["home-device", "second"]);
		expect(command).toHaveBeenCalledWith({ action: "list", family: "home-family" });
		await directory.command("home", { action: "list", family: "home-family" });
		command.mockClear();
		await expect(directory.devices("home")).resolves.toEqual(["home-device", "second"]);
		expect(command).not.toHaveBeenCalled();
		await expect(directory.devices(registration.id)).resolves.toEqual(["device"]);
		await expect(directory.devices("missing")).rejects.toThrow("Pair this FamBuddy");
		directory.close();
	});
});
