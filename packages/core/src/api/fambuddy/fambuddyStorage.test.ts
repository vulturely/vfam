import { beforeEach, expect, it, vi } from "vitest";
import {
	acquireFamBuddyRelay,
	famBuddyRecords,
	famBuddyCrypto,
	usesNativeFamBuddyStorage,
} from "./fambuddyStorage";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("../ipc", () => ({ createTauriIpcClient: () => ({ invoke }) }));

beforeEach(() => vi.resetAllMocks());

it("routes records and MLS through encrypted native storage", async () => {
	await famBuddyRecords("https://vulture.example", "parent").put("pairing", { token: "fixture" });
	await famBuddyCrypto("https://vulture.example").execute("parent-relay", { action: "identity" });
	expect(invoke).toHaveBeenCalledWith(
		"fambuddy_storage",
		expect.objectContaining({
			account: JSON.stringify(["parent", "pairing"]),
			input: { action: "put", value: { token: "fixture" } },
		}),
	);
	expect(invoke).toHaveBeenCalledWith(
		"fambuddy_storage",
		expect.objectContaining({ input: { action: "crypto", command: { action: "identity" } } }),
	);
});

it("validates record keys and supports every record mutation", async () => {
	const records = famBuddyRecords("https://vulture.example", "parent");
	await expect(records.get("")).rejects.toThrow("FamBuddy account required.");
	await expect(famBuddyRecords("https://vulture.example", "").get("key")).rejects.toThrow(
		"FamBuddy account required.",
	);
	await records.get("pairing");
	await records.delete("pairing");
	await records.updateIf("pairing", "general", { channel: "general" });
	await records.deleteIf("pairing", "token", "secret");
	expect(invoke).toHaveBeenCalledWith(
		"fambuddy_storage",
		expect.objectContaining({
			input: {
				action: "update_if",
				value: { field: "channel", value: "general", replacement: { channel: "general" } },
			},
		}),
	);
	expect(invoke).toHaveBeenCalledWith(
		"fambuddy_storage",
		expect.objectContaining({
			input: { action: "delete_if", value: { field: "token", value: "secret" } },
		}),
	);
});

it("rejects native crypto results after the session closes", async () => {
	let resolve!: (value: unknown) => void;
	invoke.mockReturnValue(new Promise((resolvePromise) => (resolve = resolvePromise)));
	const crypto = famBuddyCrypto("https://vulture.example");
	const result = crypto.execute("parent", { action: "identity" });
	crypto.close();
	resolve({ ok: true });
	await expect(result).rejects.toThrow("FamBuddy session ended.");
});

it("acquires and releases a native relay lease", async () => {
	invoke.mockResolvedValue({ lease: "lease-1" });
	const release = await acquireFamBuddyRelay("https://vulture.example", "parent");
	await release();
	expect(invoke).toHaveBeenNthCalledWith(1, "fambuddy_storage", {
		scope: JSON.stringify(["relay-consumer-v1", "https://vulture.example"]),
		account: "parent",
		input: { action: "lease_acquire" },
	});
	expect(invoke).toHaveBeenNthCalledWith(2, "fambuddy_storage", {
		scope: JSON.stringify(["relay-consumer-v1", "https://vulture.example"]),
		account: "parent",
		input: { action: "lease_release", lease: "lease-1" },
	});
});

it("always reports native FamBuddy storage", () => {
	expect(usesNativeFamBuddyStorage()).toBe(true);
});
