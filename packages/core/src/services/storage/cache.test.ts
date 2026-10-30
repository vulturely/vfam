import { NativeServerError } from "../../repositories/server";
import { describe, expect, it, vi } from "vitest";
import type { OidcAuth } from "../../auth/oidc";
import type { CacheRequest, CacheRepository } from "../../repositories/cache";
import { createCacheService, isCacheOfflineError } from "./cache";

function fixture(signedIn = true) {
	const requests: CacheRequest[] = [];
	const repository: CacheRepository = {
		async execute<T>(request: CacheRequest): Promise<T> {
			requests.push(request);
			return { cached: true } as T;
		},
	};
	const auth = {
		getUser: vi.fn(async () =>
			signedIn
				? {
						account: { id: "account-a" },
						person: { role: "manager" },
					}
				: null,
		),
	} as unknown as OidcAuth;
	const cache = createCacheService("https://server.example", auth, repository);
	return { requests, cache, auth };
}

describe("createCacheService", () => {
	it("scopes every operation to the server and signed-in account", async () => {
		const { cache, requests } = fixture();
		await expect(cache.get("family", true)).resolves.toEqual({ cached: true });
		await cache.put("family", { name: "Family" });
		await cache.delete("family");
		await cache.clear();
		const namespace = JSON.stringify(["display-cache-v1", "https://server.example", "account-a"]);
		expect(requests).toEqual([
			{ action: "get", namespace, key: "family", includeExpired: true },
			{
				action: "put",
				namespace,
				key: "family",
				value: { name: "Family" },
				ttlSeconds: 300,
			},
			{ action: "delete", namespace, key: "family" },
			{ action: "clear_namespace", namespace },
		]);
	});

	it("supports custom expiry and does not persist without an account", async () => {
		const { cache, requests } = fixture();
		await cache.put("tasks", [], 60);
		expect(requests[0].ttlSeconds).toBe(60);
		const signedOut = fixture(false);
		await signedOut.cache.put("tasks", []);
		await signedOut.cache.delete("tasks");
		await signedOut.cache.clear();
		await expect(signedOut.cache.get("tasks")).resolves.toBeNull();
		expect(signedOut.requests).toEqual([]);
	});
});

describe("isCacheOfflineError", () => {
	it("accepts only network availability failures", () => {
		expect(isCacheOfflineError(new TypeError("fetch failed"))).toBe(true);
		expect(isCacheOfflineError(new NativeServerError("unavailable", "offline"))).toBe(true);
		expect(isCacheOfflineError(new NativeServerError("deadline_exceeded", "timeout"))).toBe(true);
		expect(isCacheOfflineError(new NativeServerError("permission_denied", "denied"))).toBe(false);
		expect(isCacheOfflineError(new NativeServerError("unauthenticated", "denied"))).toBe(false);
		expect(isCacheOfflineError(new NativeServerError("internal", "denied"))).toBe(false);
		expect(isCacheOfflineError(new Error("other"))).toBe(false);
	});
});
