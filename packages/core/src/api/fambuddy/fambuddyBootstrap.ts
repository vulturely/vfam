/** Ephemeral setup codes never enter browser/native persistence or the relay. */
import { createTauriIpcClient } from "../ipc";

export async function bootstrap<T>(command: unknown): Promise<T> {
	return createTauriIpcClient().invoke<T>("fambuddy_storage", {
		scope: "bootstrap-v1",
		account: "setup",
		input: { action: "bootstrap", command },
	});
}

export function encodeSetup(bytes: Uint8Array): string {
	let output = "";
	for (const byte of bytes) output += String.fromCharCode(byte);
	return btoa(output);
}

export function decodeSetup(value: string): Uint8Array {
	return Uint8Array.from(atob(value), (v) => v.charCodeAt(0));
}
