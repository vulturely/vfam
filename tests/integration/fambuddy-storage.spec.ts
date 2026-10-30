import { test, expect, seedOidcSession } from "./fixtures";
import { nativeResponse } from "./nativeRpc";
import type { Page } from "@playwright/test";

interface StorageArgs {
	scope: string;
	account: string;
	input: {
		action: string;
		value?: unknown;
		lease?: string;
	};
}

interface StorageState {
	records: Map<string, unknown>;
	leases: Set<string>;
}

async function mockStorage(
	page: Page,
	state: StorageState = { records: new Map(), leases: new Set() },
) {
	const { records, leases } = state;
	await page.exposeFunction("__famBuddyStorage", (args: StorageArgs) => {
		const key = JSON.stringify([args.scope, args.account]);
		const { action, value } = args.input;
		if (action === "get") return records.get(key) ?? null;
		if (action === "put") {
			records.set(key, value);
			return null;
		}
		if (action === "delete") {
			records.delete(key);
			return null;
		}
		if (action === "update_if") {
			const update = value as { field: string; value: string; replacement: unknown };
			const current = records.get(key) as Record<string, unknown> | undefined;
			if (!current || current[update.field] !== update.value) throw new Error("Stale pairing");
			records.set(key, update.replacement);
			return null;
		}
		if (action === "delete_if") {
			const deletion = value as { field: string; value: string };
			const current = records.get(key) as Record<string, unknown> | undefined;
			if (current?.[deletion.field] === deletion.value) records.delete(key);
			return null;
		}
		if (action === "lease_acquire") {
			if (leases.has(key)) throw new Error("Relay already open");
			leases.add(key);
			return { lease: key };
		}
		if (action === "lease_release") {
			leases.delete(key);
			return null;
		}
		throw new Error(`Unsupported storage action ${action}`);
	});
	await page.addInitScript(() => {
		(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
			invoke(command: string, args: StorageArgs) {
				if (command !== "fambuddy_storage")
					return window.__nativeFallback(command, args as unknown as Record<string, unknown>);
				return window.__famBuddyStorage(args);
			},
			transformCallback: (value: unknown) => value,
		};
	});
	await page.evaluate(() => {
		(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
			invoke(command: string, args: StorageArgs) {
				if (command !== "fambuddy_storage")
					return window.__nativeFallback(command, args as unknown as Record<string, unknown>);
				return window.__famBuddyStorage(args);
			},
			transformCallback: (value: unknown) => value,
		};
	});
}

test.beforeEach(async ({ page }) => {
	await page.route("**/vulture.server.v1.VultureControl/*", (route) => {
		const method = route.request().url().split("/").at(-1);
		if (
			["GetParentSession", "GetAccountSetup", "GetMyFamily", "RevokeSession"].includes(method ?? "")
		)
			return route.fallback();
		return nativeResponse(route);
	});
	await seedOidcSession(page);
	await page.goto("/");
});

test("native FamBuddy records are isolated, durable and conditionally mutated", async ({
	page,
}) => {
	await mockStorage(page);
	const original = { token: "private-pairing-fixture", family: "family-a" };
	const modulePath = `/@fs${process.cwd()}/packages/core/src/api/fambuddy/fambuddyStorage.ts`;
	await page.evaluate(
		async ({ modulePath, original }) => {
			const { famBuddyRecords } = await import(modulePath);
			await famBuddyRecords("server", "owner").put("pairing", original);
		},
		{ modulePath, original },
	);
	await page.reload();
	const restored = await page.evaluate(async (modulePath) => {
		const { famBuddyRecords } = await import(modulePath);
		const records = famBuddyRecords("server", "owner");
		const restored = await records.get("pairing");
		const other = await famBuddyRecords("server", "other").get("pairing");
		let refused = false;
		try {
			await records.updateIf("pairing", "old", { token: "old" });
		} catch {
			refused = true;
		}
		await records.deleteIf("pairing", "token", "wrong");
		return { restored, other, refused };
	}, modulePath);
	expect(restored).toEqual({ restored: original, other: null, refused: true });
});

test("native relay leases exclude other tabs until release", async ({ page, context }) => {
	const state = { records: new Map<string, unknown>(), leases: new Set<string>() };
	await mockStorage(page, state);
	const modulePath = `/@fs${process.cwd()}/packages/core/src/api/fambuddy/fambuddyStorage.ts`;
	await page.evaluate(async (modulePath) => {
		const { acquireFamBuddyRelay } = await import(modulePath);
		(window as unknown as { releaseFamBuddy: () => Promise<void> }).releaseFamBuddy =
			await acquireFamBuddyRelay("https://relay.test", "test-parent");
	}, modulePath);
	const other = await context.newPage();
	await other.goto("/");
	await mockStorage(other, state);
	const denied = await other.evaluate(async (modulePath) => {
		const { acquireFamBuddyRelay } = await import(modulePath);
		try {
			const release = await acquireFamBuddyRelay("https://relay.test", "test-parent");
			await release();
			return false;
		} catch {
			return true;
		}
	}, modulePath);
	expect(denied).toBe(true);
	await page.evaluate(() =>
		(window as unknown as { releaseFamBuddy: () => Promise<void> }).releaseFamBuddy(),
	);
	await other.evaluate(async (modulePath) => {
		const { acquireFamBuddyRelay } = await import(modulePath);
		const release = await acquireFamBuddyRelay("https://relay.test", "test-parent");
		await release();
	}, modulePath);
	await other.close();
});

declare global {
	interface Window {
		__famBuddyStorage(args: StorageArgs): Promise<unknown>;
	}
}
