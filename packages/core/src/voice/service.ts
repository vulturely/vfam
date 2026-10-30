import { createNativeClient } from "../repositories/nativeClient";
import type { OidcAuth } from "../auth/oidc";
export interface VoiceReply {
	enabled: boolean;
	text: string;
	intent: "read" | "hint" | "help" | "stop" | "clarify" | "answer";
}
export interface VoiceService {
	policy(profileId: string, enabled?: boolean): Promise<VoiceReply>;
	status(): Promise<VoiceReply>;
	turn(sessionId: string, text: string): Promise<VoiceReply>;
}
export function createVoiceService(serverUrl: string, auth: OidcAuth): VoiceService {
	const client = createNativeClient("control", serverUrl);
	async function call(command: object, parent = false): Promise<VoiceReply> {
		const token = parent ? await auth.getAccessToken() : await auth.getChildAccessToken();
		if (!token) throw new Error(parent ? "Guardian sign-in required." : "Child session expired.");
		const reply = await client.voiceAssistant(
			{ commandJson: JSON.stringify(command) },
			{ headers: { authorization: `Bearer ${token}` }, timeoutMs: 10000 },
		);
		const value = JSON.parse((reply as { resultJson: string }).resultJson) as VoiceReply;
		if (
			typeof value.enabled !== "boolean" ||
			typeof value.text !== "string" ||
			value.text.length > 5000 ||
			!["read", "hint", "help", "stop", "clarify", "answer"].includes(value.intent)
		)
			throw new Error("Invalid voice response.");
		return value;
	}
	return {
		policy: (profileId, enabled) =>
			call(
				{
					type: enabled === undefined ? "get_policy" : "save_policy",
					profile_id: profileId,
					...(enabled === undefined ? {} : { enabled }),
				},
				true,
			),
		status: () => call({ type: "status" }),
		turn: (sessionId, text) =>
			call({
				type: "turn",
				session_id: sessionId,
				text,
				request_id: crypto.randomUUID(),
			}),
	};
}

/** Spoken letter sequences are joined only for spelling questions; ordinary words are preserved. */
export function spellingDraft(value: string): string {
	const letters = value
		.trim()
		.split(/[\s,.]+/)
		.filter(Boolean);
	return letters.length > 1 && letters.every((part) => /^[a-z]$/i.test(part))
		? letters.join("").toLowerCase()
		: value;
}
