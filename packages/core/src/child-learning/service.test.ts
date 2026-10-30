import { beforeEach, expect, it, vi } from "vitest";
import type { OidcAuth } from "../auth/oidc";
import { PracticeVersion, LearningSessionAction as Action } from "../api/protocol";
import { createChildLearningService } from "./service";
const client = vi.hoisted(() => ({
	listChildPractice: vi.fn(),
	startLearningSession: vi.fn(),
	getLearningSession: vi.fn(),
	submitLearningAnswer: vi.fn(),
	controlLearningSession: vi.fn(),
	reviewLearningSessions: vi.fn(),
	getQuestionAudio: vi.fn(),
}));
vi.mock("../repositories/nativeClient", () => ({ createNativeClient: () => client }));
const getAccessToken = vi.fn(),
	getChildAccessToken = vi.fn();
const auth = { getAccessToken, getChildAccessToken } as unknown as OidcAuth;
const service = () => createChildLearningService("https://server.invalid", auth);
beforeEach(() => {
	vi.resetAllMocks();
	getAccessToken.mockResolvedValue("parent");
	getChildAccessToken.mockResolvedValue("child");
});
it("uses fresh child credentials on all child endpoints and preserves retry IDs", async () => {
	const api = service();
	const practice = new PracticeVersion({ id: "set", version: 1 });
	client.listChildPractice.mockResolvedValue({ activities: [] });
	client.startLearningSession.mockResolvedValue({ session: { id: "session" } });
	expect(await api.list()).toEqual([]);
	expect(await api.start(practice, "key")).toBe("session");
	await api.get("session");
	await api.answer("session", 1, "apple", "request");
	await api.control("session", 1, Action.HINT, "hint-request");
	const options = { headers: { authorization: "Bearer child" } };
	expect(client.listChildPractice).toHaveBeenCalledWith({}, options);
	expect(client.startLearningSession).toHaveBeenCalledWith(
		{ practice, idempotencyKey: "key" },
		options,
	);
	expect(client.getLearningSession).toHaveBeenCalledWith({ sessionId: "session" }, options);
	expect(client.submitLearningAnswer).toHaveBeenCalledWith(
		{
			sessionId: "session",
			position: 1,
			answer: "apple",
			requestId: "request",
		},
		options,
	);
	expect(client.controlLearningSession).toHaveBeenCalledWith(
		{
			sessionId: "session",
			position: 1,
			action: Action.HINT,
			requestId: "hint-request",
		},
		options,
	);
	expect(getAccessToken).not.toHaveBeenCalled();
	getChildAccessToken.mockResolvedValueOnce("rotated");
	await api.get("session");
	expect(client.getLearningSession).toHaveBeenLastCalledWith(
		{ sessionId: "session" },
		{ headers: { authorization: "Bearer rotated" } },
	);
});
it("review requires parent credentials and never falls back to child", async () => {
	client.reviewLearningSessions.mockResolvedValue({ attempts: [] });
	expect(await service().review("profile")).toEqual([]);
	expect(client.reviewLearningSessions).toHaveBeenCalledWith(
		{ profileId: "profile" },
		{ headers: { authorization: "Bearer parent" } },
	);
	expect(getChildAccessToken).not.toHaveBeenCalled();
	getAccessToken.mockResolvedValueOnce(null);
	await expect(service().review("profile")).rejects.toThrow("Guardian sign-in required");
});
it("never falls back to parent credentials when child session is absent", async () => {
	getChildAccessToken.mockResolvedValue(null);
	await expect(service().list()).rejects.toThrow("Child session expired");
	expect(getAccessToken).not.toHaveBeenCalled();
	expect(client.listChildPractice).not.toHaveBeenCalled();
});
it("rejects a missing start session", async () => {
	client.startLearningSession.mockResolvedValue({});
	await expect(
		service().start(new PracticeVersion({ id: "set", version: 1 }), "key"),
	).rejects.toThrow("did not return");
});

it("fetches the current question's spoken word with the child token", async () => {
	client.getQuestionAudio
		.mockResolvedValueOnce({ audio: new Uint8Array([1, 2]), contentType: "audio/wav" })
		.mockResolvedValueOnce({ audio: new Uint8Array([3]) })
		.mockResolvedValueOnce({});
	const api = service();
	expect(await api.audio("session", 2)).toEqual({
		audio: new Uint8Array([1, 2]),
		contentType: "audio/wav",
	});
	expect(client.getQuestionAudio).toHaveBeenCalledWith(
		{ sessionId: "session", position: 2 },
		{ headers: { authorization: "Bearer child" } },
	);
	expect((await api.audio("session", 2)).contentType).toBe("audio/wav");
	await expect(api.audio("session", 2)).rejects.toThrow("No spoken word");
});
