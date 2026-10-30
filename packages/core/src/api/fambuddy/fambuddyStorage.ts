import { createTauriIpcClient } from "../ipc";

export const usesNativeFamBuddyStorage = () => true;

export function famBuddyRecords(server: string, owner: string) {
	const scope = JSON.stringify(["records-v1", server]);
	const ipc = createTauriIpcClient();
	async function run<T>(
		key: string,
		action: "get" | "put" | "delete" | "delete_if" | "update_if",
		value?: unknown,
	): Promise<T> {
		if (!owner || !key) throw new Error("FamBuddy account required.");
		const account = JSON.stringify([owner, key]);
		return ipc.invoke<T>("fambuddy_storage", {
			scope,
			account,
			input: { action, value },
		});
	}
	return {
		get: <T>(key: string) => run<T | null>(key, "get"),
		put: (key: string, value: unknown) => run<void>(key, "put", value),
		delete: (key: string) => run<void>(key, "delete"),
		updateIf: (key: string, channel: string, replacement: unknown) =>
			run<void>(key, "update_if", {
				field: "channel",
				value: channel,
				replacement,
			}),
		deleteIf: (key: string, field: "token" | "channel", value: string) =>
			run<void>(key, "delete_if", { field, value }),
	};
}

export function famBuddyCrypto(origin: string) {
	const ipc = createTauriIpcClient();
	let epoch = 0;
	return {
		close() {
			epoch++;
		},
		async execute<T>(account: string, command: Record<string, unknown>): Promise<T> {
			const ticket = epoch;
			const result = await ipc.invoke<T>("fambuddy_storage", {
				scope: JSON.stringify(["mls-v1", origin]),
				account,
				input: { action: "crypto", command },
			});
			if (ticket !== epoch) throw new Error("FamBuddy session ended.");
			return result;
		},
	};
}

export async function acquireFamBuddyRelay(
	origin: string,
	account: string,
): Promise<() => Promise<void>> {
	const scope = JSON.stringify(["relay-consumer-v1", origin]);
	const ipc = createTauriIpcClient();
	const result = await ipc.invoke<{ lease: string }>("fambuddy_storage", {
		scope,
		account,
		input: { action: "lease_acquire" },
	});
	return () =>
		ipc.invoke<void>("fambuddy_storage", {
			scope,
			account,
			input: { action: "lease_release", lease: result.lease },
		});
}
