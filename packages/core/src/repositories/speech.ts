import { createTauriIpcClient, type IpcClient } from "../api/ipc";
import { isNativeApp } from "./nativeAuth";

/** The operating system's own voice, behind the native `speech_speak` command. */
export function createSpeechRepository(
	ipc: IpcClient = createTauriIpcClient(),
	native: () => boolean = isNativeApp,
) {
	return {
		available: native,
		speak: (text: string) => ipc.invoke<void>("speech_speak", { input: { text } }),
		stop: () => ipc.invoke<void>("speech_stop"),
	};
}
export type SpeechRepository = ReturnType<typeof createSpeechRepository>;
