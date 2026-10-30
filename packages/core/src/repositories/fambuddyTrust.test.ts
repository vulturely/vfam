import { expect, it, vi } from "vitest";
import type { IpcClient } from "../api/ipc";
import { createFamBuddyTrustRepository } from "./fambuddyTrust";
import { buddyCertificate, confirmBuddyCertificate } from "../robot/buddy-gateway";

it("reads and confirms a FamBuddy certificate through the native commands", async () => {
	const invoke = vi.fn(async (command: string) =>
		command === "fambuddy_certificate" ? "AB:CD" : undefined,
	);
	const trust = createFamBuddyTrustRepository({ invoke } as unknown as IpcClient);
	expect(await buddyCertificate("https://buddy.local:5443", trust)).toBe("AB:CD");
	expect(invoke).toHaveBeenCalledWith("fambuddy_certificate", {
		serverUrl: "https://buddy.local:5443",
	});
	await confirmBuddyCertificate("https://buddy.local:5443", "AB:CD", trust);
	expect(invoke).toHaveBeenCalledWith("fambuddy_trust", {
		input: { serverUrl: "https://buddy.local:5443", fingerprint: "AB:CD" },
	});
});

it("shows the native reason when a FamBuddy cannot be checked", async () => {
	const invoke = vi.fn(async () => {
		throw { kind: "unavailable", message: "The FamBuddy is unavailable." };
	});
	const trust = createFamBuddyTrustRepository({ invoke } as unknown as IpcClient);
	await expect(buddyCertificate("https://buddy.local:5443", trust)).rejects.toThrow(
		"The FamBuddy is unavailable.",
	);
	const failure = new TypeError("bridge gone");
	const broken = createFamBuddyTrustRepository({
		invoke: vi.fn(async () => {
			throw failure;
		}),
	} as unknown as IpcClient);
	await expect(confirmBuddyCertificate("https://buddy.local:5443", "AB", broken)).rejects.toBe(
		failure,
	);
});
