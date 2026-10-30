import { createTauriIpcClient, type IpcClient } from "../api/ipc";
import { isNativeApp } from "./nativeAuth";

/** The family server's alert that a FamBuddy approval is waiting. Ids and a name only. */
export interface ServerApprovalAlert {
	registrationId: string;
	name: string;
	kind: "question" | "answer";
	turnId: string;
	at: string;
}

type Listen = (
	event: string,
	handler: (event: { payload: ServerApprovalAlert }) => void,
) => Promise<() => void>;

async function tauriListen(...args: Parameters<Listen>) {
	const { listen } = await import("@tauri-apps/api/event");
	return listen<ServerApprovalAlert>(...args);
}

/** OS notifications for FamBuddy approvals, and the server's approval alerts; native app only. */
export function createApprovalNoticeRepository(
	ipc: IpcClient = createTauriIpcClient(),
	native: () => boolean = isNativeApp,
	listen: Listen = tauriListen,
) {
	return {
		async show(title: string, body: string): Promise<void> {
			if (!native()) return;
			await ipc.invoke<void>("fambuddy_approval_notice", { input: { title, body } });
		},
		/** Server alerts arrive through the native app, which listens in the background. */
		async listen(handler: (alert: ServerApprovalAlert) => void): Promise<() => void> {
			if (!native()) return () => {};
			return listen("vulture:fambuddy-approval", (event) => handler(event.payload));
		},
	};
}
export type ApprovalNoticeRepository = ReturnType<typeof createApprovalNoticeRepository>;
