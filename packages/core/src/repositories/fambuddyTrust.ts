import { createTauriIpcClient, type IpcClient } from "../api/ipc";

/** A home-network FamBuddy's certificate, read and confirmed by the native app. */
export function createFamBuddyTrustRepository(ipc: IpcClient = createTauriIpcClient()) {
	return {
		certificate: (serverUrl: string) => ipc.invoke<string>("fambuddy_certificate", { serverUrl }),
		trust: (serverUrl: string, fingerprint: string) =>
			ipc.invoke<void>("fambuddy_trust", { input: { serverUrl, fingerprint } }),
	};
}
export type FamBuddyTrustRepository = ReturnType<typeof createFamBuddyTrustRepository>;
