import { createNativeClient } from "../repositories/nativeClient";
import type { OidcAuth } from "../auth/oidc";
import type { FamilyAiService } from "../family-ai/service";
import {
	type SourceVersion,
	PracticeVersion,
	ParentPracticeQuestion,
	GeneratePracticeResponse,
	ApprovePracticeResponse,
	TutorPracticeResponse,
	UncertainPracticeAnswer,
} from "../api/protocol";
export interface PracticeService {
	list(source: SourceVersion): Promise<GeneratePracticeResponse[]>;
	generate(
		source: SourceVersion,
		subject: string,
		difficulty: string,
		maxQuestions: number,
		aiOptIn: boolean,
	): Promise<GeneratePracticeResponse>;
	revise(
		practice: PracticeVersion,
		title: string,
		questions: ParentPracticeQuestion[],
		reject: boolean,
	): Promise<GeneratePracticeResponse>;
	approve(practice: PracticeVersion): Promise<ApprovePracticeResponse>;
	tutor(
		practice: PracticeVersion,
		sessionId: string | undefined,
		position: number,
		answer?: string,
		requestHint?: boolean,
	): Promise<TutorPracticeResponse>;
	uncertain(practice: PracticeVersion): Promise<UncertainPracticeAnswer[]>;
}
export function createPracticeService(
	serverUrl: string,
	auth: OidcAuth,
	familyAi?: FamilyAiService,
): PracticeService {
	const client = createNativeClient("control", serverUrl);
	async function options(): Promise<{ headers: Record<string, string> }> {
		const token = await auth.getAccessToken();
		return { headers: token ? { authorization: `Bearer ${token}` } : {} };
	}
	return {
		list: async (source) => {
			const response = (await client.listPractice({ source }, await options())) as {
				sets?: object[];
			};
			return (response.sets ?? []).map((set) => new GeneratePracticeResponse(set));
		},
		generate: async (source, subject, difficulty, maxQuestions, aiOptIn) => {
			// Family-owned AI runs on this device; otherwise the platform service runs it.
			if (familyAi && (await familyAi.enabled())) {
				const result = await familyAi.run({
					practice: { source, subject, difficulty, maxQuestions, aiOptIn },
				});
				if (!result.practice) throw new Error("AI did not return practice. Retry.");
				return result.practice;
			}
			return new GeneratePracticeResponse(
				await client.generatePractice(
					{ source, subject, difficulty, maxQuestions, aiOptIn },
					await options(),
				),
			);
		},
		revise: async (expectedPractice, title, questions, reject) =>
			new GeneratePracticeResponse(
				await client.revisePractice(
					{ expectedPractice, title, questions, reject },
					await options(),
				),
			),
		approve: async (expectedPractice) =>
			new ApprovePracticeResponse(
				await client.approvePractice({ expectedPractice }, await options()),
			),
		tutor: async (practice, sessionId, position, answer, requestHint = false) =>
			new TutorPracticeResponse(
				await client.tutorPractice(
					{ practice, sessionId, position, answer, requestHint },
					await options(),
				),
			),
		uncertain: async (practice) => {
			const response = (await client.getUncertainAnswers({ practice }, await options())) as {
				answers?: UncertainPracticeAnswer[];
			};
			return response.answers ?? [];
		},
	};
}
