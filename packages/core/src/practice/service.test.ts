import { expect, it, vi } from "vitest";
import type { ParentPracticeQuestion, PracticeVersion, SourceVersion } from "../api/protocol";
import type { OidcAuth } from "../auth/oidc";
import { createPracticeService } from "./service";

const client = vi.hoisted(() => ({
	listPractice: vi.fn(),
	generatePractice: vi.fn(),
	revisePractice: vi.fn(),
	approvePractice: vi.fn(),
	tutorPractice: vi.fn(),
	getUncertainAnswers: vi.fn(),
}));
vi.mock("../repositories/nativeClient", () => ({ createNativeClient: () => client }));
const source = { id: "source" } as SourceVersion;
const practice = { id: "practice" } as PracticeVersion;
const auth = { getAccessToken: vi.fn(async () => null) } as unknown as OidcAuth;

it("validates question counts and forwards all practice workflows", async () => {
	const service = createPracticeService("https://server.example", auth);
	client.generatePractice.mockRejectedValue(new Error("Choose 1–12 questions."));
	for (const count of [0, 1.5, 13])
		await expect(service.generate(source, "Math", "easy", count, false)).rejects.toThrow(
			"Choose 1–12",
		);
	client.listPractice.mockResolvedValue({ sets: [{ id: "set" }] });
	client.generatePractice.mockResolvedValue({ id: "generated" });
	client.revisePractice.mockResolvedValue({ id: "revised" });
	client.approvePractice.mockResolvedValue({ id: "approved" });
	client.tutorPractice.mockResolvedValue({ id: "tutor" });
	client.getUncertainAnswers.mockResolvedValue({ answers: [{ id: "uncertain" }] });
	expect(await service.list(source)).toMatchObject([{ id: "set" }]);
	await service.generate(source, "Math", "easy", 12, true);
	await service.revise(
		practice,
		"title",
		[{ id: "question" } as unknown as ParentPracticeQuestion],
		true,
	);
	await service.approve(practice);
	await service.tutor(practice, undefined, 2);
	await service.tutor(practice, "session", 1, "answer", true);
	expect(await service.uncertain(practice)).toEqual([{ id: "uncertain" }]);
	expect(client.generatePractice.mock.calls[3][0]).toEqual({
		source,
		subject: "Math",
		difficulty: "easy",
		maxQuestions: 12,
		aiOptIn: true,
	});
	expect(client.revisePractice.mock.calls[0][0].reject).toBe(true);
	expect(client.tutorPractice.mock.calls[1][0]).toMatchObject({
		sessionId: "session",
		answer: "answer",
		requestHint: true,
	});
	for (const call of [...client.listPractice.mock.calls, ...client.tutorPractice.mock.calls])
		expect(call[1].headers).toEqual({});
});

it("runs practice generation with family AI on this device when it is set up", async () => {
	const familyAi = {
		enabled: vi.fn(async () => true),
		run: vi.fn(async () => ({ practice: { practice: { id: "local" } } })),
	};
	const service = createPracticeService("https://server.example", auth, familyAi as never);
	client.generatePractice.mockClear();
	expect(await service.generate(source, "Math", "easy", 3, true)).toEqual({
		practice: { id: "local" },
	});
	expect(familyAi.run).toHaveBeenCalledWith({
		practice: { source, subject: "Math", difficulty: "easy", maxQuestions: 3, aiOptIn: true },
	});
	expect(client.generatePractice).not.toHaveBeenCalled();
	familyAi.run.mockResolvedValueOnce({} as never);
	await expect(service.generate(source, "Math", "easy", 3, true)).rejects.toThrow(
		"AI did not return practice",
	);
	familyAi.enabled.mockResolvedValue(false);
	client.generatePractice.mockResolvedValue({ id: "platform" });
	await service.generate(source, "Math", "easy", 3, true);
	expect(client.generatePractice).toHaveBeenCalledOnce();
});
