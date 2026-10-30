import { createNativeClient } from "../repositories/nativeClient";
import type { OidcAuth } from "../auth/oidc";
import {
	ChildPractice,
	PracticeVersion,
	GetLearningSessionResponse,
	LearningSessionAction,
	LearningAttempt,
	SubmitLearningAnswerResponse,
} from "../api/protocol";
export interface ChildLearningService {
	list(): Promise<ChildPractice[]>;
	start(practice: PracticeVersion, key: string): Promise<string>;
	get(sessionId: string): Promise<GetLearningSessionResponse>;
	answer(
		sessionId: string,
		position: number,
		answer: string,
		requestId: string,
	): Promise<SubmitLearningAnswerResponse>;
	control(
		sessionId: string,
		position: number,
		action: LearningSessionAction,
		requestId: string,
	): Promise<GetLearningSessionResponse>;
	review(profileId: string): Promise<LearningAttempt[]>;
	/** The current question's word as audio made on the server. */
	audio(sessionId: string, position: number): Promise<{ audio: Uint8Array; contentType: string }>;
}
export function createChildLearningService(
	serverUrl: string,
	auth: OidcAuth,
): ChildLearningService {
	const client = createNativeClient("control", serverUrl);
	async function options(parent = false) {
		const token = parent ? await auth.getAccessToken() : await auth.getChildAccessToken();
		if (!token)
			throw new Error(
				parent ? "Guardian sign-in required." : "Child session expired. Ask a guardian to sign in.",
			);
		return { headers: { authorization: `Bearer ${token}` } };
	}
	return {
		list: async () => {
			const response = (await client.listChildPractice({}, await options())) as {
				activities?: object[];
			};
			return (response.activities ?? []).map((activity) => new ChildPractice(activity));
		},
		start: async (practice, idempotencyKey) => {
			const result = (await client.startLearningSession(
				{ practice, idempotencyKey },
				await options(),
			)) as { session?: { id: string } };
			if (!result.session) throw new Error("The server did not return a learning session.");
			return result.session.id;
		},
		get: async (sessionId) =>
			new GetLearningSessionResponse(
				await client.getLearningSession({ sessionId }, await options()),
			),
		answer: async (sessionId, position, answer, requestId) =>
			new SubmitLearningAnswerResponse(
				await client.submitLearningAnswer(
					{ sessionId, position, answer, requestId },
					await options(),
				),
			),
		control: async (sessionId, position, action, requestId) =>
			new GetLearningSessionResponse(
				await client.controlLearningSession(
					{ sessionId, position, action, requestId },
					await options(),
				),
			),
		audio: async (sessionId, position) => {
			const response = (await client.getQuestionAudio(
				{ sessionId, position },
				await options(),
			)) as { audio?: Uint8Array; contentType?: string };
			if (!response.audio?.length) throw new Error("No spoken word was returned.");
			return { audio: response.audio, contentType: response.contentType || "audio/wav" };
		},
		review: async (profileId) => {
			const response = (await client.reviewLearningSessions(
				{ profileId },
				await options(true),
			)) as { attempts?: object[] };
			return (response.attempts ?? []).map((attempt) => new LearningAttempt(attempt));
		},
	};
}
