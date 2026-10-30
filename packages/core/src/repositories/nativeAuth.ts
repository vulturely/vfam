import { isTauri } from "@tauri-apps/api/core";
import { createTauriIpcClient } from "../api/ipc";

export interface NativeAuthCallback {
	code?: string;
	state?: string;
	error?: string;
}

export function isNativeApp(): boolean {
	return isTauri();
}

export async function onNativeAuthCallback(
	listener: (callback: NativeAuthCallback) => void,
): Promise<() => void> {
	const { listen } = await import("@tauri-apps/api/event");
	return listen<NativeAuthCallback>("vulture-auth-callback", (event) => listener(event.payload));
}

export async function startNativeAuthCallback(token: string): Promise<string> {
	return createTauriIpcClient().invoke<string>("start_auth_callback", { token });
}

export async function openNativeUrl(url: string): Promise<void> {
	await createTauriIpcClient().invoke("plugin:opener|open_url", { url });
}
