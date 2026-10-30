import { createTauriIpcClient, type IpcClient } from "../api/ipc";
import { isNativeApp } from "./nativeAuth";

/** Desktop process lifecycle behind the native `app_exit` command. */
export function createAppLifecycleRepository(
	ipc: IpcClient = createTauriIpcClient(),
	native: () => boolean = isNativeApp,
) {
	return {
		isDesktop: native,
		exit: () => ipc.invoke<void>("app_exit"),
	};
}
export type AppLifecycleRepository = ReturnType<typeof createAppLifecycleRepository>;
