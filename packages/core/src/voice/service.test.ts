import { beforeEach, expect, it, vi } from "vitest";
import { spellingDraft, createVoiceService } from "./service";
import type { OidcAuth } from "../auth/oidc";
const client = vi.hoisted(() => ({ voiceAssistant: vi.fn() }));
vi.mock("../repositories/nativeClient", () => ({ createNativeClient: () => client }));
const getAccessToken = vi.fn(),
	getChildAccessToken = vi.fn();
const auth = { getAccessToken, getChildAccessToken } as unknown as OidcAuth;
beforeEach(() => {
	vi.resetAllMocks();
	getAccessToken.mockResolvedValue("parent");
	getChildAccessToken.mockResolvedValue("child");
	client.voiceAssistant.mockResolvedValue({
		resultJson: JSON.stringify({
			enabled: true,
			intent: "read",
			text: "question",
		}),
	});
});
it("uses guardian tokens for consent and child tokens for bounded turns", async () => {
	const service = createVoiceService("https://server.invalid", auth);
	await service.policy("profile");
	await service.policy("profile", false);
	await service.status();
	await service.turn("session", "read");
	expect(client.voiceAssistant.mock.calls.map(([r]) => JSON.parse(r.commandJson))).toEqual([
		{ type: "get_policy", profile_id: "profile" },
		{ type: "save_policy", profile_id: "profile", enabled: false },
		{ type: "status" },
		{
			type: "turn",
			session_id: "session",
			text: "read",
			request_id: expect.any(String),
		},
	]);
	expect(
		client.voiceAssistant.mock.calls.map(([, options]) => options.headers.authorization),
	).toEqual(["Bearer parent", "Bearer parent", "Bearer child", "Bearer child"]);
	expect(client.voiceAssistant.mock.calls.every(([, options]) => options.timeoutMs === 10000)).toBe(
		true,
	);
});
it("fails closed for expired sessions, invalid responses and provider failures", async () => {
	const service = createVoiceService("https://server.invalid", auth);
	getChildAccessToken.mockResolvedValue(null);
	await expect(service.status()).rejects.toThrow("expired");
	expect(client.voiceAssistant).not.toHaveBeenCalled();
	getAccessToken.mockResolvedValue(null);
	await expect(service.policy("profile", true)).rejects.toThrow("Guardian");
	getChildAccessToken.mockResolvedValue("child");
	client.voiceAssistant.mockResolvedValue({
		resultJson: '{"enabled":true,"text":"x","intent":"camera"}',
	});
	await expect(service.turn("s", "read")).rejects.toThrow("Invalid");
	client.voiceAssistant.mockRejectedValue(new Error("offline"));
	await expect(service.status()).rejects.toThrow("offline");
});

it("normalizes spoken spelling letters while preserving ordinary answers", () => {
	expect(spellingDraft("a p p l e")).toBe("apple");
	expect(spellingDraft("A, P, P, L, E.")).toBe("apple");
	expect(spellingDraft("apple pie")).toBe("apple pie");
});
