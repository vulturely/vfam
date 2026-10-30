import { isTauri } from "@tauri-apps/api/core";
import { createTauriIpcClient } from "../api/ipc";

export interface CacheRequest {
	action: "get" | "put" | "delete" | "clear_namespace";
	namespace: string;
	key?: string;
	value?: unknown;
	ttlSeconds?: number;
	includeExpired?: boolean;
}

export interface CacheRepository {
	execute<T>(request: CacheRequest): Promise<T>;
}

export function createCacheRepository(): CacheRepository {
	const ipc = createTauriIpcClient();
	const native = isTauri();
	return {
		async execute<T>(request: CacheRequest): Promise<T> {
			if (!native) return null as T;
			return ipc.invoke<T>("local_cache", { request });
		},
	};
}
