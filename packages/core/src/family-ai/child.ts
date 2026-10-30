import type { OidcAuth } from "../auth/oidc";
import { createNativeClient } from "../repositories/nativeClient";
import { createFamilyAiRepository, type FamilyAiRepository } from "../repositories/familyAi";

export interface ChildHelp {
	jobId: string;
	/** Present when the reply is ready. */
	reply?: string;
	status: "waiting_for_parent" | "answering" | "answered" | "declined" | "expired";
}

export interface ChildFamilyAiService {
	/** Checks this child's mode; a revoked key is removed from this device. */
	mode(): Promise<"parent_devices" | "child_device">;
	/** Asks for help with one question of delivered practice. */
	askForHelp(input: {
		practiceId: string;
		version: number;
		position: number;
		question: string;
	}): Promise<ChildHelp>;
	help(jobId: string): Promise<ChildHelp>;
	/** Starts receiving the family AI key on this device. */
	offerKey(): Promise<string>;
	/** Returns the code to compare with the parent's screen, and whether the key arrived. */
	receiveKey(transferId: string): Promise<{ code?: string; installed: boolean }>;
	/** Whether this device already holds the family AI key. */
	installed(): Promise<boolean>;
	/** Updates for a help request until it is answered, declined or expired. */
	follow(jobId: string, signal: AbortSignal, intervalMs?: number): AsyncIterable<ChildHelp>;
	/** Code and progress while the parent sends the key; ends once installed. */
	waitForKey(
		transferId: string,
		signal: AbortSignal,
		intervalMs?: number,
	): AsyncIterable<{ code?: string; installed: boolean }>;
}

function pause(ms: number, signal: AbortSignal) {
	return new Promise<void>((resolve) => {
		const timer = setTimeout(resolve, ms);
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true },
		);
	});
}

const statuses: Record<string, ChildHelp["status"]> = {
	FAMILY_AI_JOB_STATUS_AWAITING_APPROVAL: "waiting_for_parent",
	FAMILY_AI_JOB_STATUS_READY: "answering",
	FAMILY_AI_JOB_STATUS_COMPLETED: "answered",
	FAMILY_AI_JOB_STATUS_CANCELLED: "declined",
	FAMILY_AI_JOB_STATUS_EXPIRED: "expired",
};

export function createChildFamilyAiService(
	serverUrl: string,
	auth: Pick<OidcAuth, "getChildAccessToken">,
	child: () => { familyId: string } | null,
	repository: FamilyAiRepository = createFamilyAiRepository(),
	client = createNativeClient("control", serverUrl),
): ChildFamilyAiService {
	async function session() {
		const token = await auth.getChildAccessToken();
		const current = child();
		if (!token || !current) throw new Error("Child session expired. Ask a guardian to sign in.");
		return { serverUrl, familyId: current.familyId, token };
	}
	async function help(jobId: string): Promise<ChildHelp> {
		const { token } = await session();
		const response = (await client.getFamilyAiHelp(
			{ id: jobId },
			{ headers: { authorization: `Bearer ${token}` } },
		)) as { job?: { status: string }; reply?: string };
		const status = statuses[response.job?.status ?? ""] ?? "expired";
		return { jobId, status, reply: status === "answered" ? response.reply : undefined };
	}
	return {
		async mode() {
			const output = await repository.keyTransfer({ ...(await session()), action: "status" });
			return output.mode === "FAMILY_AI_CHILD_MODE_CHILD_DEVICE"
				? "child_device"
				: "parent_devices";
		},
		async askForHelp(input) {
			const current = await session();
			const job = (await client.requestFamilyAiHelp(input, {
				headers: { authorization: `Bearer ${current.token}` },
				timeoutMs: 30_000,
			})) as { id: string; status: string; prompt?: object };
			// In child-device mode this device answers right away with its own key.
			if (job.status === "FAMILY_AI_JOB_STATUS_READY" && job.prompt) {
				const result = (await repository.run({ ...current, jobId: job.id })) as {
					homeworkHelp?: { reply?: string };
				};
				return { jobId: job.id, status: "answered", reply: result.homeworkHelp?.reply };
			}
			return { jobId: job.id, status: statuses[job.status] ?? "waiting_for_parent" };
		},
		help,
		async offerKey() {
			const output = await repository.keyTransfer({ ...(await session()), action: "offer" });
			if (!output.transferId) throw new Error("Could not start family AI setup. Retry.");
			return output.transferId;
		},
		async installed() {
			const { serverUrl: url, familyId } = await session();
			return (await repository.settings({ serverUrl: url, familyId, action: "status" })).configured;
		},
		async *follow(jobId, signal, intervalMs = 5000) {
			while (!signal.aborted) {
				const current = await help(jobId);
				yield current;
				if (!["waiting_for_parent", "answering"].includes(current.status)) return;
				await pause(intervalMs, signal);
			}
		},
		async *waitForKey(transferId, signal, intervalMs = 3000) {
			while (!signal.aborted) {
				const output = await this.receiveKey(transferId);
				yield output;
				if (output.installed) return;
				await pause(intervalMs, signal);
			}
		},
		async receiveKey(transferId) {
			const output = await repository.keyTransfer({
				...(await session()),
				action: "receive",
				transferId,
			});
			return { code: output.code ?? undefined, installed: output.installed };
		},
	};
}
