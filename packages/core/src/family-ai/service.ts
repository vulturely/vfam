import type { OidcAuth } from "../auth/oidc";
import type {
	GenerateHomeworkDraftResponse,
	GeneratePracticeResponse,
	SourceSegment,
	SourceVersion,
} from "../api/protocol";
import { createNativeClient, decodeNativeValue } from "../repositories/nativeClient";
import {
	createFamilyAiRepository,
	type FamilyAiConfig,
	type FamilyAiRepository,
	type FamilyAiStatus,
} from "../repositories/familyAi";

export type { FamilyAiConfig, FamilyAiStatus } from "../repositories/familyAi";

/** One AI task, mirroring the platform requests the server already validates. */
export type FamilyAiTask =
	| {
			practice: {
				source: SourceVersion;
				subject: string;
				difficulty: string;
				maxQuestions: number;
				aiOptIn: boolean;
			};
	  }
	| {
			homeworkDraft: {
				profileId: string;
				topic: string;
				context: string;
				subject: string;
				questionCount: number;
				aiOptIn: boolean;
				referenceContent?: Uint8Array;
				referenceMediaType?: number;
			};
	  }
	| {
			worksheetParser: {
				profileId: string;
				segments: SourceSegment[];
				layout: string;
				aiOptIn: boolean;
			};
	  };

export interface FamilyAiResult {
	practice?: GeneratePracticeResponse;
	homeworkDraft?: GenerateHomeworkDraftResponse;
	worksheetParser?: { parserJson: string };
}

export type ChildAiMode = "parent_devices" | "child_device";

/** A child's help request waiting for a parent, as shown in the parent inbox. */
export interface HelpRequest {
	id: string;
	profileId: string;
	summary: string;
	question: string;
	createdAt: string;
}

/** A child's device asking for the family AI key. */
export interface KeyOffer {
	id: string;
	profileId: string;
	childName: string;
}

const modes: Record<string, ChildAiMode> = {
	FAMILY_AI_CHILD_MODE_PARENT_DEVICES: "parent_devices",
	FAMILY_AI_CHILD_MODE_CHILD_DEVICE: "child_device",
};

export interface FamilyAiService {
	status(): Promise<FamilyAiStatus>;
	save(config: FamilyAiConfig): Promise<FamilyAiStatus>;
	clear(): Promise<FamilyAiStatus>;
	/** True when this device holds family AI settings, so AI runs here. */
	enabled(): Promise<boolean>;
	/** Prepares the task on the server, runs it with the device's key and returns the validated result. */
	run(task: FamilyAiTask): Promise<FamilyAiResult>;
	/** Answers a parent-approved FamBuddy question with this device's family AI. */
	answer(question: string): Promise<string>;
	/** Stores the family AI key on a FamBuddy reachable on the local network. */
	provisionRobot(local: { gateway: string; token: string; device: string }): Promise<void>;
	/** Children's help requests waiting for a parent's approval. */
	helpRequests(): Promise<HelpRequest[]>;
	/** Approves a child's request and answers it with this device's family AI. */
	approveHelp(id: string): Promise<string>;
	declineHelp(id: string): Promise<void>;
	childModes(): Promise<Record<string, ChildAiMode>>;
	setChildMode(profileId: string, mode: ChildAiMode): Promise<void>;
	keyOffers(): Promise<KeyOffer[]>;
	/** Answers a child's offer; returns the code both screens must show. */
	respondToKeyOffer(id: string): Promise<string>;
	/** After the codes match, sends the encrypted settings to the child's device. */
	sendKey(id: string): Promise<void>;
}

export function createFamilyAiService(
	serverUrl: string,
	auth: OidcAuth,
	/** Resolves the server family ID; local placeholder IDs must never scope AI keys. */
	familyId: () => Promise<string | null>,
	repository: FamilyAiRepository = createFamilyAiRepository(),
	client = createNativeClient("control", serverUrl),
): FamilyAiService {
	let cached: { familyId: string; status: FamilyAiStatus } | undefined;
	async function scope() {
		const family = await familyId();
		if (!family) throw new Error("Join or create a family before setting up family AI.");
		return { serverUrl, familyId: family };
	}
	async function headers() {
		const token = await auth.getAccessToken();
		if (!token) throw new Error("Family manager sign-in required.");
		return { headers: { authorization: `Bearer ${token}` }, timeoutMs: 60_000 };
	}
	function tokenFrom(options: { headers: { authorization: string } }) {
		return options.headers.authorization.slice("Bearer ".length);
	}
	async function settings(
		action: "status" | "save" | "clear",
		config?: FamilyAiConfig,
	): Promise<FamilyAiStatus> {
		const current = await scope();
		const status = await repository.settings({ ...current, action, config });
		cached = { familyId: current.familyId, status };
		return status;
	}
	return {
		status: () => settings("status"),
		save: (config) => settings("save", config),
		clear: () => settings("clear"),
		async enabled() {
			const family = await familyId();
			if (!family) return false;
			if (cached?.familyId !== family) await settings("status");
			return cached?.status.configured === true;
		},
		async helpRequests() {
			const response = (await client.listFamilyAiJobs({}, await headers())) as {
				jobs?: {
					id: string;
					kind: string;
					status: string;
					profileId: string;
					summary: string;
					requestText?: string;
					createdAt: string;
				}[];
			};
			return (response.jobs ?? [])
				.filter(
					(job) =>
						job.kind === "FAMILY_AI_JOB_KIND_HOMEWORK_HELP" &&
						job.status === "FAMILY_AI_JOB_STATUS_AWAITING_APPROVAL",
				)
				.map((job) => ({
					id: job.id,
					profileId: job.profileId,
					summary: job.summary,
					question: job.requestText ?? "",
					createdAt: job.createdAt,
				}));
		},
		async approveHelp(id) {
			const current = await scope();
			const options = await headers();
			await client.approveFamilyAiJob({ id }, options);
			const result = (await repository.run({
				...current,
				token: tokenFrom(options),
				jobId: id,
			})) as { homeworkHelp?: { reply?: string } };
			return result.homeworkHelp?.reply ?? "";
		},
		async declineHelp(id) {
			await client.cancelFamilyAiJob({ id }, await headers());
		},
		async childModes() {
			const response = (await client.listFamilyAiChildSettings({}, await headers())) as {
				settings?: { profileId: string; mode: string }[];
			};
			return Object.fromEntries(
				(response.settings ?? []).map((setting) => [
					setting.profileId,
					modes[setting.mode] ?? "parent_devices",
				]),
			);
		},
		async setChildMode(profileId, mode) {
			await client.setFamilyAiChildSetting(
				{
					profileId,
					mode:
						mode === "child_device"
							? "FAMILY_AI_CHILD_MODE_CHILD_DEVICE"
							: "FAMILY_AI_CHILD_MODE_PARENT_DEVICES",
				},
				await headers(),
			);
		},
		async keyOffers() {
			const response = (await client.listFamilyAiKeyTransfers({}, await headers())) as {
				transfers?: { id: string; profileId: string; childName: string; ciphertext?: string }[];
			};
			return (response.transfers ?? [])
				.filter((transfer) => !transfer.ciphertext)
				.map(({ id, profileId, childName }) => ({ id, profileId, childName }));
		},
		async respondToKeyOffer(id) {
			const output = await repository.keyTransfer({
				...(await scope()),
				token: tokenFrom(await headers()),
				action: "respond",
				transferId: id,
			});
			if (!output.code) throw new Error("The key transfer could not be verified. Start again.");
			return output.code;
		},
		async sendKey(id) {
			await repository.keyTransfer({
				...(await scope()),
				token: tokenFrom(await headers()),
				action: "send",
				transferId: id,
			});
		},
		async answer(question) {
			return (await repository.answer({ ...(await scope()), question })).answer;
		},
		async provisionRobot(local) {
			await repository.provisionRobot({ ...(await scope()), ...local });
		},
		async run(task) {
			const current = await scope();
			const token = (await auth.getAccessToken()) ?? undefined;
			const job = (await client.prepareFamilyAiJob(task, {
				headers: token ? { authorization: `Bearer ${token}` } : {},
				timeoutMs: 60_000,
			})) as { id: string };
			const result = decodeNativeValue(
				"CompleteFamilyAiJob",
				await repository.run({ ...current, token, jobId: job.id }),
			) as Record<string, unknown>;
			return {
				practice: result.practice
					? (decodeNativeValue("GeneratePractice", result.practice) as GeneratePracticeResponse)
					: undefined,
				homeworkDraft: result.homeworkDraft
					? (decodeNativeValue(
							"GenerateHomeworkDraft",
							result.homeworkDraft,
						) as GenerateHomeworkDraftResponse)
					: undefined,
				worksheetParser: result.worksheetParser as { parserJson: string } | undefined,
			};
		},
	};
}
