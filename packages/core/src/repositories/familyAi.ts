import { createTauriIpcClient, type IpcClient } from "../api/ipc";

/** Family-owned AI settings. The API key goes only to the device's OS key store. */
export interface FamilyAiConfig {
	provider: string;
	model: string;
	endpoint: string;
	apiKey: string;
}

/** What the UI may read back: never the API key. */
export interface FamilyAiStatus {
	configured: boolean;
	provider?: string | null;
	model?: string | null;
	endpoint?: string | null;
}

export type KeyTransferInput = FamilyAiScope & { token: string } & (
		{ action: "offer" | "status" } | { action: "receive" | "respond" | "send"; transferId: string }
	);

export interface KeyTransferOutput {
	transferId?: string | null;
	/** Six digits both devices display; the parent sends only when they match. */
	code?: string | null;
	installed: boolean;
	mode?: string | null;
}

export interface FamilyAiScope {
	serverUrl: string;
	familyId: string;
}

export interface FamilyAiRepository {
	settings(
		input: FamilyAiScope & { action: "status" | "save" | "clear"; config?: FamilyAiConfig },
	): Promise<FamilyAiStatus>;
	/** Runs a prepared job on this device and returns the server's validated result. */
	run(input: FamilyAiScope & { token?: string; jobId: string }): Promise<unknown>;
	/** Answers a parent-approved FamBuddy question; only the answer text returns. */
	answer(input: FamilyAiScope & { question: string }): Promise<{ answer: string }>;
	/** One step of the verified key transfer to a child's device (keys stay native). */
	keyTransfer(input: KeyTransferInput): Promise<KeyTransferOutput>;
	/** Stores the family AI key on a FamBuddy through its local gateway only. */
	provisionRobot(
		input: FamilyAiScope & { gateway: string; token: string; device: string },
	): Promise<unknown>;
}

export function createFamilyAiRepository(
	ipc: IpcClient = createTauriIpcClient(),
): FamilyAiRepository {
	return {
		settings: (input) => ipc.invoke<FamilyAiStatus>("family_ai_settings", { input }),
		run: (input) => ipc.invoke<unknown>("family_ai_run", { input }),
		answer: (input) => ipc.invoke<{ answer: string }>("family_ai_answer", { input }),
		provisionRobot: (input) => ipc.invoke<unknown>("family_ai_provision_robot", { input }),
		keyTransfer: (input) => ipc.invoke<KeyTransferOutput>("family_ai_key_transfer", { input }),
	};
}
