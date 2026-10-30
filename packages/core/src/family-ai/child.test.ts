import { beforeEach, expect, it, vi } from "vitest";
import type { FamilyAiRepository } from "../repositories/familyAi";
import { createChildFamilyAiService } from "./child";

const family = "00000000-0000-4000-8000-000000000010";
let repository: {
	settings: ReturnType<typeof vi.fn>;
	run: ReturnType<typeof vi.fn>;
	keyTransfer: ReturnType<typeof vi.fn>;
};
let client: {
	requestFamilyAiHelp: ReturnType<typeof vi.fn>;
	getFamilyAiHelp: ReturnType<typeof vi.fn>;
};
let token: string | null;
let child: { familyId: string } | null;

function service() {
	return createChildFamilyAiService(
		"https://server.example",
		{ getChildAccessToken: async () => token },
		() => child,
		repository as unknown as FamilyAiRepository,
		client as never,
	);
}
const input = { practiceId: "practice", version: 1, position: 2, question: "I am stuck" };

beforeEach(() => {
	token = "vcs_child";
	child = { familyId: family };
	repository = {
		settings: vi.fn(async () => ({ configured: true })),
		run: vi.fn(async () => ({ homeworkHelp: { reply: "Try counting." } })),
		keyTransfer: vi.fn(),
	};
	client = { requestFamilyAiHelp: vi.fn(), getFamilyAiHelp: vi.fn() };
});

it("answers on this device in child-device mode using the child session", async () => {
	client.requestFamilyAiHelp.mockResolvedValue({
		id: "job",
		status: "FAMILY_AI_JOB_STATUS_READY",
		prompt: { system: "rules" },
	});
	expect(await service().askForHelp(input)).toEqual({
		jobId: "job",
		status: "answered",
		reply: "Try counting.",
	});
	expect(client.requestFamilyAiHelp).toHaveBeenCalledWith(input, {
		headers: { authorization: "Bearer vcs_child" },
		timeoutMs: 30_000,
	});
	expect(repository.run).toHaveBeenCalledWith({
		serverUrl: "https://server.example",
		familyId: family,
		token: "vcs_child",
		jobId: "job",
	});
});

it("waits for a parent when AI runs on parent devices and follows until answered", async () => {
	client.requestFamilyAiHelp.mockResolvedValue({
		id: "job",
		status: "FAMILY_AI_JOB_STATUS_AWAITING_APPROVAL",
	});
	expect(await service().askForHelp(input)).toEqual({
		jobId: "job",
		status: "waiting_for_parent",
	});
	expect(repository.run).not.toHaveBeenCalled();
	client.getFamilyAiHelp
		.mockResolvedValueOnce({ job: { status: "FAMILY_AI_JOB_STATUS_AWAITING_APPROVAL" } })
		.mockResolvedValueOnce({ job: { status: "FAMILY_AI_JOB_STATUS_READY" } })
		.mockResolvedValueOnce({
			job: { status: "FAMILY_AI_JOB_STATUS_COMPLETED" },
			reply: "Count both groups.",
		});
	const updates = [];
	for await (const update of service().follow("job", new AbortController().signal, 0))
		updates.push(update);
	expect(updates.map((update) => update.status)).toEqual([
		"waiting_for_parent",
		"answering",
		"answered",
	]);
	expect(updates[2].reply).toBe("Count both groups.");
	for (const [status, expected] of [
		["FAMILY_AI_JOB_STATUS_CANCELLED", "declined"],
		["FAMILY_AI_JOB_STATUS_EXPIRED", "expired"],
		["", "expired"],
	]) {
		client.getFamilyAiHelp.mockResolvedValueOnce({ job: { status }, reply: "hidden" });
		expect(await service().help("job")).toEqual({ jobId: "job", status: expected });
	}
	const stopped = new AbortController();
	stopped.abort();
	const none = [];
	for await (const update of service().follow("job", stopped.signal)) none.push(update);
	expect(none).toEqual([]);
});

it("checks the mode, receives the key with a code and reports installation", async () => {
	repository.keyTransfer
		.mockResolvedValueOnce({ installed: false, mode: "FAMILY_AI_CHILD_MODE_CHILD_DEVICE" })
		.mockResolvedValueOnce({ installed: false, mode: "FAMILY_AI_CHILD_MODE_PARENT_DEVICES" });
	expect(await service().mode()).toBe("child_device");
	expect(await service().mode()).toBe("parent_devices");
	expect(repository.keyTransfer).toHaveBeenCalledWith(
		expect.objectContaining({ action: "status", token: "vcs_child", familyId: family }),
	);
	repository.keyTransfer.mockResolvedValueOnce({ transferId: "transfer", installed: false });
	expect(await service().offerKey()).toBe("transfer");
	repository.keyTransfer.mockResolvedValueOnce({ installed: false });
	await expect(service().offerKey()).rejects.toThrow("Could not start");
	repository.keyTransfer
		.mockResolvedValueOnce({ installed: false })
		.mockResolvedValueOnce({ installed: false, code: "123456" })
		.mockResolvedValueOnce({ installed: true, code: "123456" });
	const steps = [];
	for await (const step of service().waitForKey("transfer", new AbortController().signal, 0))
		steps.push(step);
	expect(steps).toEqual([
		{ installed: false, code: undefined },
		{ installed: false, code: "123456" },
		{ installed: true, code: "123456" },
	]);
	expect(repository.keyTransfer).toHaveBeenLastCalledWith(
		expect.objectContaining({ action: "receive", transferId: "transfer" }),
	);
	expect(await service().installed()).toBe(true);
	expect(repository.settings).toHaveBeenCalledWith({
		serverUrl: "https://server.example",
		familyId: family,
		action: "status",
	});
});

it("requires an active child session", async () => {
	token = null;
	await expect(service().askForHelp(input)).rejects.toThrow("Child session expired");
	token = "vcs_child";
	child = null;
	await expect(service().offerKey()).rejects.toThrow("Child session expired");
});
