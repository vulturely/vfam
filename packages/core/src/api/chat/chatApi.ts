import type { OidcAuth } from "../../auth/oidc";
import { isNativeServerError, NativeServerError } from "../../repositories/server";
import { createTauriIpcClient } from "../ipc";
import { reportSessionExpiry } from "../auth/sessionEvents";

export interface ChatAdapter {
	close?(): void;
	/** Opens the shared native chat connection ahead of the first command. */
	connect?(): Promise<void>;
	/** Closes the shared native chat connection when the session ends. */
	disconnect?(): Promise<void>;
	remote<T>(command: Record<string, unknown>): Promise<T>;
	subscribe?(familyId: string, listener: () => void): () => void;
	uploadAttachment?(
		familyId: string,
		bytes: Uint8Array,
		onProgress?: (progress: number) => void,
	): Promise<string>;
	downloadAttachment?(familyId: string, objectKey: string): Promise<Uint8Array>;
	native<T>(account: string, command: Record<string, unknown>): Promise<T>;
	nativeBatch?<T>(account: string, commands: Record<string, unknown>[]): Promise<T[]>;
}

export function createChatAdapter(serverUrl: string, auth: OidcAuth): ChatAdapter {
	const ipc = createTauriIpcClient();
	const subscriptions = new Set<() => void>();

	async function token(): Promise<string> {
		const value = await auth.getSessionAccessToken();
		if (!value) throw new Error("Sign in again to use family chat.");
		return value;
	}

	return {
		async connect() {
			const used = await token();
			try {
				await ipc.invoke("chat_connect", { input: { serverUrl, token: used } });
			} catch (cause) {
				reportSessionExpiry(cause, used);
				if (isNativeServerError(cause)) throw new NativeServerError(cause.kind, cause.message);
				throw cause;
			}
		},
		async disconnect() {
			await ipc.invoke("chat_disconnect");
		},
		async remote<T>(command: Record<string, unknown>): Promise<T> {
			const used = await token();
			try {
				return await ipc.invoke<T>("chat_command", {
					input: { serverUrl, token: used, command },
				});
			} catch (cause) {
				reportSessionExpiry(cause, used);
				if (isNativeServerError(cause)) throw new NativeServerError(cause.kind, cause.message);
				throw cause;
			}
		},
		subscribe(familyId, listener) {
			const subscriptionId = crypto.randomUUID();
			let closed = false;
			let unlisten: (() => void) | undefined;
			const close = () => {
				if (closed) return;
				closed = true;
				subscriptions.delete(close);
				unlisten?.();
				void ipc.invoke("chat_unsubscribe", { subscriptionId }).catch(() => {});
			};
			subscriptions.add(close);
			void (async () => {
				const { listen } = await import("@tauri-apps/api/event");
				if (closed) return;
				unlisten = await listen<{ subscriptionId: string; familyId?: string }>(
					"vulture:chat-changed",
					(event) => {
						if (
							event.payload.subscriptionId === subscriptionId &&
							(!event.payload.familyId || event.payload.familyId === familyId)
						)
							listener();
					},
				);
				if (closed) {
					unlisten();
					return;
				}
				// The server sends this family's change notifications to the subscription.
				await ipc.invoke("chat_subscribe", {
					input: { subscriptionId, serverUrl, token: await token(), familyId },
				});
			})().catch(close);
			return close;
		},
		async uploadAttachment(familyId, bytes, onProgress) {
			const uploadId = crypto.randomUUID();
			const { listen } = await import("@tauri-apps/api/event");
			const unlisten = await listen<{ uploadId: string; progress: number }>(
				"vulture:chat-upload",
				(event) => {
					if (event.payload.uploadId === uploadId) onProgress?.(event.payload.progress);
				},
			);
			const used = await token();
			try {
				return await ipc.invoke<string>("chat_attachment_upload", {
					input: {
						uploadId,
						serverUrl,
						token: used,
						familyId,
						bytes: encodeBase64(bytes),
					},
				});
			} catch (cause) {
				reportSessionExpiry(cause, used);
				throw cause;
			} finally {
				unlisten();
			}
		},
		async downloadAttachment(familyId, objectKey) {
			const used = await token();
			try {
				const value = await ipc.invoke<string>("chat_attachment_download", {
					input: { serverUrl, token: used, familyId, objectKey },
				});
				return decodeBase64(value);
			} catch (cause) {
				reportSessionExpiry(cause, used);
				throw cause;
			}
		},
		async native<T>(account: string, input: Record<string, unknown>): Promise<T> {
			if (input.action === "notification_permission") return { granted: true } as T;
			return ipc.invoke("family_chat_crypto", { account, input });
		},
		close: () => {
			for (const close of [...subscriptions]) close();
		},
	};
}

function encodeBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
	return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
