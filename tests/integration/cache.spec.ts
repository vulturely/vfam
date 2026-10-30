import { test, expect, seedOidcSession } from "./fixtures";
import { nativeResponse } from "./nativeRpc";

test("native cache restores labeled read-only family data while offline", async ({ page }) => {
	let offline = false;
	let familyRequests = 0;
	await page.addInitScript(() => {
		(window as unknown as Record<string, unknown>).isTauri = true;
		const values = new Map<string, { value: unknown; expiresAt: number | null }>(
			JSON.parse(localStorage.getItem("vfam-test-cache") ?? "[]"),
		);
		const persist = () => localStorage.setItem("vfam-test-cache", JSON.stringify([...values]));
		(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
			async invoke(command: string, args: Record<string, unknown>) {
				if (command !== "local_cache") return window.__nativeFallback(command, args);
				const request = args.request as {
					action: string;
					namespace: string;
					key?: string;
					value?: unknown;
					ttlSeconds?: number;
					includeExpired?: boolean;
				};
				if (request.namespace === "local-state-v1") return window.__nativeFallback(command, args);
				const id = `${request.namespace}:${request.key ?? ""}`;
				if (request.action === "put") {
					values.set(id, {
						value: request.value,
						expiresAt: Date.now() - 1,
					});
					persist();
					return null;
				}
				if (request.action === "get") {
					const cached = values.get(id);
					if (
						!cached ||
						(!request.includeExpired && cached.expiresAt !== null && cached.expiresAt <= Date.now())
					)
						return null;
					return cached.value;
				}
				if (request.action === "delete") values.delete(id);
				if (request.action === "clear_namespace") {
					for (const key of values.keys())
						if (key.startsWith(`${request.namespace}:`)) values.delete(key);
				}
				persist();
				return null;
			},
			transformCallback: (value: unknown) => value,
		};
	});
	await seedOidcSession(page);
	await page.route("**/vulture.server.v1.VultureControl/ListTasks", (route) =>
		nativeResponse(route, {}),
	);
	await page.route("**/vulture.server.v1.VultureControl/GetFamilyAvatar", (route) =>
		nativeResponse(route, {}),
	);
	await page.route("**/vulture.server.v1.VultureControl/GetMyFamily", (route) => {
		familyRequests += 1;
		if (offline) return route.abort("failed");
		return nativeResponse(route, {
			family: { id: "family-cache", name: "Offline family" },
		});
	});
	await page.route("**/vulture.server.v1.VultureControl/ListFamilyMembers", (route) =>
		offline ? route.abort("failed") : nativeResponse(route, {}),
	);
	await page.goto("/#/family:manage");
	await expect(page.getByText("Offline family", { exact: true })).toBeVisible({ timeout: 30_000 });
	expect(familyRequests).toBe(1);
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem("vfam-test-cache")))
		.toContain("Offline family");
	offline = true;
	await page.reload();
	await expect(page.getByText("Offline family", { exact: true })).toBeVisible({ timeout: 30_000 });
	await expect(
		page.getByText("Showing saved family data while offline. Changes still require a connection."),
	).toBeVisible();
	expect(familyRequests).toBe(2);
});
