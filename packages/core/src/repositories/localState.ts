import { createTauriIpcClient, type IpcClient } from "../api/ipc";

const namespace = "local-state-v1";

export interface LocalStateRepository {
	get<T>(key: string): Promise<T | null>;
	put(key: string, value: unknown): Promise<void>;
	delete(key: string): Promise<void>;
	removeLegacy(key: string): void;
	readLegacy(key: string): string | null;
	watch(onChange: (key: string | null) => void): () => void;
}

export function createLocalStateRepository(
	ipc: IpcClient = createTauriIpcClient(),
): LocalStateRepository {
	const source = crypto.randomUUID();
	return {
		async get<T>(key: string): Promise<T | null> {
			return ipc.invoke<T | null>("local_cache", {
				request: { action: "get", namespace, key },
			});
		},
		async put(key: string, value: unknown): Promise<void> {
			await ipc.invoke("local_cache", {
				request: { action: "put", namespace, key, value },
				source,
			});
		},
		async delete(key: string): Promise<void> {
			await ipc.invoke("local_cache", {
				request: { action: "delete", namespace, key },
				source,
			});
		},
		removeLegacy(key: string): void {
			if (typeof localStorage !== "undefined") localStorage.removeItem(key);
			if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(key);
		},
		readLegacy(key: string): string | null {
			if (typeof localStorage !== "undefined") {
				const value = localStorage.getItem(key);
				if (value !== null) return value;
			}
			return typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(key);
		},
		watch(onChange: (key: string | null) => void): () => void {
			let active = true;
			let unlisten: (() => void) | undefined;
			void import("@tauri-apps/api/event")
				.then(({ listen }) =>
					listen<{ key: string | null; source?: string }>(
						"vulture:local-state-changed",
						(event) => {
							if (active && event.payload.source !== source) onChange(event.payload.key);
						},
					),
				)
				.then((stop) => {
					if (active) unlisten = stop;
					else stop();
				})
				.catch(() => {});
			return () => {
				active = false;
				unlisten?.();
			};
		},
	};
}
