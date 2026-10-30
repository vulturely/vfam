import { beforeEach, expect, it, vi } from "vitest";
import type { OidcAuth } from "../auth/oidc";
import type { FamilyAiRepository } from "../repositories/familyAi";
import { createFamilyAiService } from "./service";

const family = "00000000-0000-4000-8000-000000000010";
const auth = { getAccessToken: vi.fn(async () => "vps_token") } as unknown as OidcAuth;
let repository: { settings: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn> };
let client: { prepareFamilyAiJob: ReturnType<typeof vi.fn> };
let familyId: string | null;

function service() {
	return createFamilyAiService(
		"https://server.example",
		auth,
		async () => familyId,
		repository as unknown as FamilyAiRepository,
		client as never,
	);
}

beforeEach(() => {
	familyId = family;
	repository = {
		settings: vi.fn(async ({ action }) => ({ configured: action === "save" })),
		run: vi.fn(),
	};
	client = { prepareFamilyAiJob: vi.fn(async () => ({ id: "job-1" })) };
});

it("scopes settings to the server and family and caches whether AI runs on this device", async () => {
	const ai = service();
	expect(await ai.enabled()).toBe(false);
	expect(await ai.enabled()).toBe(false);
	expect(repository.settings).toHaveBeenCalledOnce();
	expect(repository.settings).toHaveBeenCalledWith({
		serverUrl: "https://server.example",
		familyId: family,
		action: "status",
		config: undefined,
	});
	const config = {
		provider: "openai_compatible",
		model: "llama3",
		endpoint: "http://localhost:11434/v1/chat/completions",
		apiKey: "",
	};
	expect(await ai.save(config)).toEqual({ configured: true });
	expect(repository.settings).toHaveBeenLastCalledWith(
		expect.objectContaining({ action: "save", config }),
	);
	expect(await ai.enabled()).toBe(true);
	familyId = "00000000-0000-4000-8000-000000000011";
	expect(await ai.enabled()).toBe(false);
	expect(repository.settings).toHaveBeenLastCalledWith(
		expect.objectContaining({ familyId: "00000000-0000-4000-8000-000000000011" }),
	);
	await ai.clear();
	expect(repository.settings).toHaveBeenLastCalledWith(
		expect.objectContaining({ action: "clear" }),
	);
	await ai.status();
	familyId = null;
	expect(await ai.enabled()).toBe(false);
	await expect(ai.status()).rejects.toThrow("Join or create a family");
	await expect(
		ai.run({ worksheetParser: { profileId: "p", segments: [], layout: "", aiOptIn: true } }),
	).rejects.toThrow("Join or create a family");
});

it("prepares on the server, runs on the device and decodes each validated result", async () => {
	const ai = service();
	repository.run.mockResolvedValueOnce({
		job: { id: "job-1", status: "FAMILY_AI_JOB_STATUS_COMPLETED" },
		practice: {
			practice: { id: "set", title: "Addition" },
			questions: [{ question: { kind: "PRACTICE_QUESTION_KIND_SHORT_ANSWER", prompt: "1+1" } }],
		},
	});
	const task = {
		practice: {
			source: { id: "source", version: 1 },
			subject: "Math",
			difficulty: "easy",
			maxQuestions: 2,
			aiOptIn: true,
		},
	};
	const result = await ai.run(task as never);
	expect(client.prepareFamilyAiJob).toHaveBeenCalledWith(task, {
		headers: { authorization: "Bearer vps_token" },
		timeoutMs: 60_000,
	});
	expect(repository.run).toHaveBeenCalledWith({
		serverUrl: "https://server.example",
		familyId: family,
		token: "vps_token",
		jobId: "job-1",
	});
	expect(result.practice?.practice?.title).toBe("Addition");
	expect(result.practice?.questions[0].question?.kind).toBe(2);
	expect(result.homeworkDraft).toBeUndefined();

	repository.run.mockResolvedValueOnce({
		homeworkDraft: {
			title: "Draft",
			questions: [{ question: "q", answer: "a", explanation: "e" }],
		},
	});
	const draft = await ai.run({
		homeworkDraft: {
			profileId: "p",
			topic: "t",
			context: "",
			subject: "Math",
			questionCount: 1,
			aiOptIn: true,
		},
	});
	expect(draft.homeworkDraft?.title).toBe("Draft");

	repository.run.mockResolvedValueOnce({ worksheetParser: { parserJson: "{}" } });
	const parser = await ai.run({
		worksheetParser: { profileId: "p", segments: [], layout: "", aiOptIn: true },
	});
	expect(parser.worksheetParser).toEqual({ parserJson: "{}" });

	vi.mocked(auth.getAccessToken).mockResolvedValueOnce(null);
	repository.run.mockResolvedValueOnce({});
	await ai.run({ worksheetParser: { profileId: "p", segments: [], layout: "", aiOptIn: true } });
	expect(client.prepareFamilyAiJob).toHaveBeenLastCalledWith(expect.anything(), {
		headers: {},
		timeoutMs: 60_000,
	});
	expect(repository.run).toHaveBeenLastCalledWith(expect.objectContaining({ token: undefined }));
});

it("lists, approves and declines children's help requests from the parent inbox", async () => {
	const inbox = {
		...client,
		listFamilyAiJobs: vi.fn(async () => ({
			jobs: [
				{
					id: "help",
					kind: "FAMILY_AI_JOB_KIND_HOMEWORK_HELP",
					status: "FAMILY_AI_JOB_STATUS_AWAITING_APPROVAL",
					profileId: "child",
					summary: "Homework help · Jamie",
					requestText: "I am stuck",
					createdAt: "now",
				},
				{
					id: "parent",
					kind: "FAMILY_AI_JOB_KIND_PRACTICE",
					status: "FAMILY_AI_JOB_STATUS_READY",
					profileId: "child",
					summary: "Practice",
					createdAt: "now",
				},
			],
		})),
		approveFamilyAiJob: vi.fn(async () => ({})),
		cancelFamilyAiJob: vi.fn(async () => ({})),
	};
	const ai = createFamilyAiService(
		"https://server.example",
		auth,
		async () => familyId,
		repository as unknown as FamilyAiRepository,
		inbox as never,
	);
	expect(await ai.helpRequests()).toEqual([
		{
			id: "help",
			profileId: "child",
			summary: "Homework help · Jamie",
			question: "I am stuck",
			createdAt: "now",
		},
	]);
	repository.run.mockResolvedValueOnce({ homeworkHelp: { reply: "Count both groups." } });
	expect(await ai.approveHelp("help")).toBe("Count both groups.");
	expect(inbox.approveFamilyAiJob).toHaveBeenCalledWith(
		{ id: "help" },
		{ headers: { authorization: "Bearer vps_token" }, timeoutMs: 60_000 },
	);
	expect(repository.run).toHaveBeenLastCalledWith(
		expect.objectContaining({ jobId: "help", token: "vps_token" }),
	);
	repository.run.mockResolvedValueOnce({});
	expect(await ai.approveHelp("help")).toBe("");
	await ai.declineHelp("help");
	expect(inbox.cancelFamilyAiJob).toHaveBeenCalledWith({ id: "help" }, expect.anything());
	vi.mocked(auth.getAccessToken).mockResolvedValueOnce(null);
	await expect(ai.helpRequests()).rejects.toThrow("Family manager sign-in required");
});

it("manages each child's mode and the verified key transfer steps", async () => {
	const settings = {
		...client,
		listFamilyAiChildSettings: vi.fn(async () => ({
			settings: [
				{ profileId: "a", mode: "FAMILY_AI_CHILD_MODE_CHILD_DEVICE" },
				{ profileId: "b", mode: "FAMILY_AI_CHILD_MODE_PARENT_DEVICES" },
				{ profileId: "c", mode: "unknown" },
			],
		})),
		setFamilyAiChildSetting: vi.fn<(input: unknown) => Promise<object>>(async () => ({})),
		listFamilyAiKeyTransfers: vi.fn(async () => ({
			transfers: [
				{ id: "open", profileId: "a", childName: "Jamie" },
				{ id: "sent", profileId: "a", childName: "Jamie", ciphertext: "AAAA" },
			],
		})),
	};
	const keyTransfer = vi.fn();
	const ai = createFamilyAiService(
		"https://server.example",
		auth,
		async () => familyId,
		{ ...repository, keyTransfer } as unknown as FamilyAiRepository,
		settings as never,
	);
	expect(await ai.childModes()).toEqual({
		a: "child_device",
		b: "parent_devices",
		c: "parent_devices",
	});
	await ai.setChildMode("a", "child_device");
	await ai.setChildMode("b", "parent_devices");
	expect(settings.setFamilyAiChildSetting.mock.calls.map((call) => call[0])).toEqual([
		{ profileId: "a", mode: "FAMILY_AI_CHILD_MODE_CHILD_DEVICE" },
		{ profileId: "b", mode: "FAMILY_AI_CHILD_MODE_PARENT_DEVICES" },
	]);
	expect(await ai.keyOffers()).toEqual([{ id: "open", profileId: "a", childName: "Jamie" }]);
	keyTransfer.mockResolvedValueOnce({ code: "123456", installed: false });
	expect(await ai.respondToKeyOffer("open")).toBe("123456");
	expect(keyTransfer).toHaveBeenLastCalledWith({
		serverUrl: "https://server.example",
		familyId,
		token: "vps_token",
		action: "respond",
		transferId: "open",
	});
	keyTransfer.mockResolvedValueOnce({ installed: false });
	await expect(ai.respondToKeyOffer("open")).rejects.toThrow("could not be verified");
	keyTransfer.mockResolvedValueOnce({ installed: true });
	await ai.sendKey("open");
	expect(keyTransfer).toHaveBeenLastCalledWith(
		expect.objectContaining({ action: "send", transferId: "open" }),
	);
});
