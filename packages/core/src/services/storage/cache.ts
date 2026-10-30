import { isServerNetworkError } from "../../repositories/server";
import type { OidcAuth } from "../../auth/oidc";
import { createCacheRepository, type CacheRepository } from "../../repositories/cache";

export interface CacheService {
	get<T>(key: string, includeExpired?: boolean): Promise<T | null>;
	put(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
	delete(key: string): Promise<void>;
	clear(): Promise<void>;
}

export function createCacheService(
	serverUrl: string,
	auth: OidcAuth,
	repository: CacheRepository = createCacheRepository(),
): CacheService {
	async function namespace(): Promise<string | null> {
		const user = await auth.getUser();
		return user ? JSON.stringify(["display-cache-v1", serverUrl, user.account.id]) : null;
	}

	return {
		async get<T>(key: string, includeExpired = false): Promise<T | null> {
			const scope = await namespace();
			if (!scope) return null;
			return repository.execute<T | null>({
				action: "get",
				namespace: scope,
				key,
				includeExpired,
			});
		},
		async put(key: string, value: unknown, ttlSeconds = 300): Promise<void> {
			const scope = await namespace();
			if (!scope) return;
			await repository.execute({
				action: "put",
				namespace: scope,
				key,
				value,
				ttlSeconds,
			});
		},
		async delete(key: string): Promise<void> {
			const scope = await namespace();
			if (!scope) return;
			await repository.execute({ action: "delete", namespace: scope, key });
		},
		async clear(): Promise<void> {
			const scope = await namespace();
			if (!scope) return;
			await repository.execute({ action: "clear_namespace", namespace: scope });
		},
	};
}

export function isCacheOfflineError(error: unknown): boolean {
	return isServerNetworkError(error);
}
