import type { Page, Route } from "@playwright/test";
import { test as base, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { installNativeIpc } from "./nativeIpc";
import { startBrowserCoverage, stopBrowserCoverage } from "./coverage";
import { AccountRole } from "../../packages/core/src/api/protocol";
import { nativeResponse } from "./nativeRpc";

interface NativeInput {
	serverUrl: string;
	service: string;
	method: string;
	token?: string | null;
	payload: Record<string, unknown>;
}

interface NativeRoute {
	pattern: string;
	handler: Parameters<Page["route"]>[1];
}

const services = {
	control: "vulture.server.v1.VultureControl",
	robot: "vulture.server.v1.RobotGatewayService",
	fambuddy_registry: "vulture.server.v1.FamBuddyRegistryService",
	fambuddy_relay: "vulture.server.v1.FamBuddyRelayService",
	fambuddy_gateway: "vulture.fambuddy.v1.FamBuddyGatewayService",
} as const;

function isNativeRoute(pattern: string): boolean {
	return (
		pattern.includes("vulture.") ||
		pattern.includes("fambuddy") ||
		pattern.includes("/chat/attachments/") ||
		pattern.includes(".well-known")
	);
}

function matches(pattern: string, service: string, method: string): boolean {
	const normalized = pattern.replace(/^\*\*\//, "");
	if (normalized.includes("://")) {
		return (
			(normalized.endsWith("/**") && service === "vulture.fambuddy.v1.FamBuddyGatewayService") ||
			normalized.endsWith(`/${service}/${method}`)
		);
	}
	if (normalized.endsWith("/*")) return service === normalized.slice(0, -2);
	return normalized === `${service}/${method}`;
}

function responseError(status: number, headers: Record<string, string>): never {
	const code = Number(headers["x-native-error-code"] ?? status);
	const kind =
		code === 16
			? "unauthenticated"
			: code === 7
				? "permission_denied"
				: code === 14
					? "unavailable"
					: "internal";
	const message = decodeURIComponent(headers["x-native-error-message"] || "Server request failed.");
	throw { kind, message };
}

async function callRoute(page: Page, input: NativeInput): Promise<unknown> {
	const routes = nativeRoutes.get(page) ?? [];
	const typeName = services[input.service as keyof typeof services];
	if (!typeName) throw new Error(`Unknown native service ${input.service}`);
	const url = `https://native.test/${typeName}/${input.method}`;
	for (let index = routes.length - 1; index >= 0; index--) {
		const route = routes[index];
		if (!matches(route.pattern, typeName, input.method)) continue;
		let response:
			{ status?: number; headers?: Record<string, string>; body?: string | Buffer } | undefined;
		let next = false;
		const fake = {
			request: () => ({
				url: () => url,
				method: () => "POST",
				headers: () => ({ authorization: input.token ? `Bearer ${input.token}` : "" }),
				postDataJSON: () => input.payload,
				postData: () => JSON.stringify(input.payload),
				postDataBuffer: () => Buffer.from(JSON.stringify(input.payload)),
			}),
			fulfill: async (value: typeof response) => {
				response = value;
			},
			fallback: async () => {
				next = true;
			},
			abort: async (reason?: string) => {
				throw { kind: "unavailable", message: reason || "Failed to fetch" };
			},
		} as unknown as Route;
		await route.handler(fake, {} as never);
		if (next) continue;
		const headers = response?.headers ?? {};
		if (response?.status && response.status >= 400) responseError(response.status, headers);
		if (headers["x-native-error-code"] && headers["x-native-error-code"] !== "0") {
			responseError(0, headers);
		}
		const body = response?.body ?? "{}";
		return typeof body === "string" ? JSON.parse(body) : JSON.parse(body.toString("utf8"));
	}
	throw new Error(`No native mock for ${typeName}/${input.method}`);
}

async function callAttachment(
	page: Page,
	command: string,
	input: Record<string, unknown>,
): Promise<unknown> {
	const routes = nativeRoutes.get(page) ?? [];
	const upload = command === "chat_attachment_upload";
	const path = upload
		? `/chat/attachments/${encodeURIComponent(String(input.familyId))}`
		: "/chat/attachments/download";
	const url = `https://native.test${path}`;
	const normalizedPath = path.replace(/^\//, "");
	for (const route of routes) {
		const normalized = route.pattern.replace(/^\*\*\//, "").replace(/\/$/, "");
		if (
			!(normalized.endsWith("/**")
				? normalizedPath.startsWith(normalized.slice(0, -3))
				: normalizedPath === normalized)
		)
			continue;
		let response:
			{ status?: number; headers?: Record<string, string>; body?: string | Buffer } | undefined;
		const fake = {
			request: () => ({
				url: () => url,
				method: () => (upload ? "PUT" : "POST"),
				headers: () => ({ authorization: `Bearer ${input.token}` }),
				postDataJSON: () => ({ familyId: input.familyId, objectKey: input.objectKey }),
				postDataBuffer: () => Buffer.from(String(input.bytes), "base64"),
			}),
			fulfill: async (value: typeof response) => {
				response = value;
			},
			abort: async (reason?: string) => {
				throw { kind: "unavailable", message: reason || "Failed to fetch" };
			},
		} as unknown as Route;
		await route.handler(fake, {} as never);
		const body = response?.body ?? "{}";
		if (upload) {
			const value = typeof body === "string" ? JSON.parse(body) : JSON.parse(body.toString("utf8"));
			return value.objectKey;
		}
		return Buffer.isBuffer(body) ? body.toString("base64") : Buffer.from(body).toString("base64");
	}
	throw new Error(`No native attachment mock for ${path}`);
}

const nativeRoutes = new WeakMap<Page, NativeRoute[]>();

function interceptRoutes(page: Page): void {
	const firstPage = page.context().pages()[0];
	const routes = (firstPage ? nativeRoutes.get(firstPage) : undefined) ?? [];
	nativeRoutes.set(page, routes);
	const pageRoute = page.route.bind(page);
	page.route = (async (
		url: string | RegExp | URLPattern | ((url: URL) => boolean),
		handler: Parameters<Page["route"]>[1],
		options: Parameters<Page["route"]>[2],
	) => {
		if (isNativeRoute(String(url))) {
			routes.push({ pattern: String(url), handler });
			return { dispose: async () => {} };
		}
		return pageRoute(url, handler, options);
	}) as unknown as Page["route"];
	const contextRoute = page.context().route.bind(page.context());
	page.context().route = (async (
		url: string | RegExp | URLPattern | ((url: URL) => boolean),
		handler: Parameters<Page["route"]>[1],
		options: Parameters<Page["route"]>[2],
	) => {
		if (isNativeRoute(String(url))) {
			routes.push({ pattern: String(url), handler });
			return { dispose: async () => {} };
		}
		return contextRoute(url, handler, options);
	}) as unknown as Page["route"];
}

const familyAiProviders = new WeakMap<Page, (prompt: FamilyAiPrompt) => string | Promise<string>>();

export interface FamilyAiPrompt {
	system: string;
	user: string;
	schemaName: string;
	schemaJson: string;
	maxOutputTokens: number;
}

/** Fakes the family's AI provider that the native layer calls on this device. */
export function mockFamilyAiProvider(
	page: Page,
	provider: (prompt: FamilyAiPrompt) => string | Promise<string>,
): void {
	familyAiProviders.set(page, provider);
}

export async function prepareNativePage(page: Page): Promise<void> {
	interceptRoutes(page);
	await installNativeIpc(page);
	await page.exposeFunction("__nativeFamilyAiProvider", async (prompt: FamilyAiPrompt) => {
		const provider = familyAiProviders.get(page);
		if (!provider) throw new Error("No family AI provider mock registered.");
		return provider(prompt);
	});
	await page.exposeFunction("__nativeUnary", async (input: NativeInput) => {
		try {
			return await callRoute(page, input);
		} catch (error) {
			console.error("Native unary mock failed", input.service, input.method, error);
			throw error;
		}
	});
	await page.exposeFunction(
		"__nativeStreamOpen",
		async (input: NativeInput & { streamId: string }) => {
			try {
				const payload = await callRoute(page, input);
				return { streamId: input.streamId, kind: "data", payload };
			} catch (error) {
				console.error("Native stream mock failed", input.method, error);
				throw error;
			}
		},
	);
	await page.exposeFunction(
		"__nativeAttachment",
		(command: string, input: Record<string, unknown>) => callAttachment(page, command, input),
	);
	await page.exposeFunction("__nativeDiscovery", async (authority: string) => {
		const routes = nativeRoutes.get(page) ?? [];
		for (const route of routes) {
			if (!route.pattern.includes(".well-known")) continue;
			let body = "{}";
			const fake = {
				request: () => ({
					url: () => `${authority.replace(/\/$/, "")}/.well-known/openid-configuration`,
				}),
				fulfill: async (value: { body?: string }) => {
					body = value.body ?? "{}";
				},
			} as unknown as Route;
			await route.handler(fake, {} as never);
			return JSON.parse(body);
		}
		throw new Error("No OIDC discovery mock");
	});
}

export const test = base.extend({
	page: async ({ page, browserName }, use) => {
		interceptRoutes(page);
		page.on("pageerror", (error) => console.error("Page error", error));
		page.on("console", (message) => {
			if (message.type() === "error") console.error(message.text());
		});
		const collectingCoverage = await startBrowserCoverage(page, browserName);
		await installNativeIpc(page);
		await prepareNativePage(page);
		for (const pattern of [
			"**/vulture.server.v1.VultureControl/*",
			"**/vulture.server.v1.RobotGatewayService/*",
			"**/vulture.server.v1.FamBuddyRegistryService/*",
			"**/vulture.server.v1.FamBuddyRelayService/*",
			"**/vulture.server.v1.FamBuddyAiService/*",
			"**/vulture.fambuddy.v1.FamBuddyGatewayService/*",
		]) {
			await page.route(pattern, (route) => nativeResponse(route));
		}
		for (const method of ["GetParentSession", "GetChildSession"]) {
			await page.route(`**/vulture.server.v1.VultureControl/${method}`, (route) =>
				nativeResponse(route, undefined, 16),
			);
		}
		await page.route("**/vulture.server.v1.RobotGatewayService/ListRobots", (route) =>
			nativeResponse(route, {}),
		);
		await page.context().route("**/vulture.server.v1.VultureControl/GetMyFamily", (route) =>
			nativeResponse(route, {
				family: { id: "00000000-0000-0000-0000-000000000010", name: "Test family" },
			}),
		);
		await page
			.context()
			.route("**/vulture.server.v1.VultureControl/ListLearningProfiles", (route) =>
				nativeResponse(route, {}),
			);
		await use(page);
		if (collectingCoverage) {
			const coverage = await stopBrowserCoverage(page, collectingCoverage);
			const directory = process.env.VULTURE_COVERAGE_DIR ?? ".integration-coverage";
			await mkdir(directory, { recursive: true });
			await writeFile(path.join(directory, `${test.info().testId}.json`), JSON.stringify(coverage));
		}
	},
});

export async function seedOidcSession(
	page: Page,
	options: {
		name?: string;
		email?: string;
		sub?: string;
		mockSession?: boolean;
		mockAccountSetup?: boolean;
		accessToken?: string;
		/** False simulates a fresh sign-in that has not entered the parent PIN yet. */
		pinUnlocked?: boolean;
		/** Simulates a sign-in started from "Forgot PIN?". */
		pinReset?: boolean;
	} = {},
) {
	const name = options.name ?? "Alex";
	const email = options.email ?? "alex@example.com";
	const sub = options.sub ?? "00000000-0000-0000-0000-000000000001";
	const session = {
		version: 2,
		accountId: sub,
		displayName: name,
		email,
		accessToken: options.accessToken ?? `vps_${"a".repeat(64)}`,
		idToken: "",
		expiresAt: Date.now() + 3600_000,
		pinUnlocked: options.pinUnlocked ?? true,
		pinReset: options.pinReset ?? false,
	};
	if (options.mockSession !== false) {
		await page.route("**/vulture.server.v1.VultureControl/GetParentSession", (route) =>
			nativeResponse(route, {
				accountId: sub,
				displayName: name,
				email,
				expiresAt: new Date(session.expiresAt).toISOString(),
			}),
		);
		await page.route("**/vulture.server.v1.VultureControl/RevokeSession", (route) =>
			nativeResponse(route, { ok: true }),
		);
	}
	if (options.mockAccountSetup !== false) {
		await page.route("**/vulture.server.v1.VultureControl/GetAccountSetup", (route) =>
			nativeResponse(route, {
				role: AccountRole.PARENT,
				dobConfirmed: true,
				completed: true,
			}),
		);
	}
	await page.evaluate(async (value) => {
		await window.__nativeLocalCache({
			action: "put",
			namespace: "local-state-v1",
			key: "oidc.user:https://auth.swavan.io/auth/v1/:vulturefam",
			value,
		});
	}, session);
}

export { expect };

export async function readNativeState<T>(page: Page, key: string): Promise<T | null> {
	return page.evaluate(
		async (key) =>
			(await window.__nativeLocalCache({
				action: "get",
				namespace: "local-state-v1",
				key,
			})) as T | null,
		key,
	);
}

export async function openParentLearning(page: Page) {
	const parent = page.locator(".chooser .profiles button").first();
	const learning = page.getByRole("link", { name: "Learning", exact: true });
	await expect(parent.or(learning)).toBeVisible();
	if (await parent.isVisible()) await parent.click();
	await learning.click();
}

declare global {
	interface Window {
		__nativeUnary(input: NativeInput): Promise<unknown>;
		__nativeStreamOpen(
			input: NativeInput & { streamId: string },
		): Promise<{ streamId: string; kind: string; payload: unknown }>;
		__nativeChatCommand(command: Record<string, unknown>, token?: string): Promise<unknown>;
		__nativeAttachment(command: string, input: Record<string, unknown>): Promise<unknown>;
		__nativeDiscovery(authority: string): Promise<unknown>;
		__nativeLocalCache(request: {
			action: string;
			namespace: string;
			key?: string;
			value?: unknown;
		}): Promise<unknown>;
		__nativeFallback(command: string, args?: Record<string, unknown>): Promise<unknown>;
		__nativeFamilyAiProvider(prompt: FamilyAiPrompt): Promise<string>;
	}
}
