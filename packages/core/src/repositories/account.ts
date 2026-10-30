import { createTauriIpcClient, type IpcClient } from "../api/ipc";
import type { AccountFormInput } from "../account/types";

export function createAccountRepository(ipc: IpcClient = createTauriIpcClient()) {
	return {
		async validateInput(input: AccountFormInput): Promise<void> {
			await ipc.invoke("oidc_account_input", { input });
		},
	};
}
