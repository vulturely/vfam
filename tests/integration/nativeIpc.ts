import type { Page } from "@playwright/test";

interface LocalCacheRequest {
	action: string;
	namespace: string;
	key?: string;
	value?: unknown;
}

const localCache = new WeakMap<object, Map<string, unknown>>();
const installed = new WeakSet<Page>();

export async function installNativeIpc(page: Page): Promise<void> {
	if (installed.has(page)) return;
	installed.add(page);
	const context = page.context();
	let records = localCache.get(context);
	if (!records) {
		records = new Map<string, unknown>();
		localCache.set(context, records);
	}
	const nativeRecords = records;
	await page.exposeFunction("__nativeLocalCache", async (request: LocalCacheRequest) => {
		const key = JSON.stringify([request.namespace, request.key]);
		if (request.action === "get") return nativeRecords.get(key) ?? null;
		if (request.action === "put") nativeRecords.set(key, request.value);
		if (request.action === "delete") nativeRecords.delete(key);
		if (request.action === "clear_namespace") {
			const prefix = JSON.stringify([request.namespace]).slice(0, -1);
			for (const candidate of nativeRecords.keys()) {
				if (candidate.startsWith(prefix)) nativeRecords.delete(candidate);
			}
		}
		return null;
	});
	await page.addInitScript(() => {
		const fallback = async (command: string, args?: Record<string, unknown>) => {
			if (command === "server_unary") {
				const input = (args as { input: Parameters<Window["__nativeUnary"]>[0] }).input;
				return window.__nativeUnary(input);
			}
			if (command === "chat_command") {
				const input = (args as { input: { command: Record<string, unknown>; token?: string } })
					.input;
				return window.__nativeChatCommand(input.command, input.token);
			}
			if (command === "chat_attachment_upload" || command === "chat_attachment_download") {
				return window.__nativeAttachment(
					command,
					(args as { input: Record<string, unknown> }).input,
				);
			}
			if (command === "oidc_discovery") {
				const input = (args as { input: { authority: string } }).input;
				return window.__nativeDiscovery(input.authority);
			}
			if (command === "oidc_account_input") {
				const input = (args as { input: { displayName: string; email?: string } }).input;
				if (!input.displayName.trim()) throw new Error("Name is required.");
				if (input.email && !input.email.includes("@"))
					throw new Error("Enter a valid email address.");
				return null;
			}
			if (command === "family_ai_settings") {
				// Mirrors the native key store: settings persist per server and family; the key never comes back.
				const input = (
					args as {
						input: {
							serverUrl: string;
							familyId: string;
							action: string;
							config?: { provider: string; model: string; endpoint: string; apiKey: string };
						};
					}
				).input;
				const request = { namespace: "family-ai", key: `${input.serverUrl}|${input.familyId}` };
				if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.familyId))
					throw { kind: "invalid_argument", message: "Family required." };
				if (input.action === "save") {
					const config = input.config!;
					const local = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/)/.test(config.endpoint);
					if (
						config.provider === "openai_compatible" &&
						!config.endpoint.startsWith("https://") &&
						!local
					)
						throw {
							kind: "invalid_argument",
							message:
								"Use an HTTPS provider URL, or http://localhost for an AI model on this device.",
						};
					if (config.provider !== "openai_compatible" && !config.apiKey.trim())
						throw { kind: "invalid_argument", message: "Enter the AI provider API key." };
					await window.__nativeLocalCache({
						...request,
						action: "put",
						value: {
							provider: config.provider,
							model: config.model,
							endpoint: config.provider === "openai_compatible" ? config.endpoint : null,
						},
					});
				}
				if (input.action === "clear")
					await window.__nativeLocalCache({ ...request, action: "delete" });
				const saved = await window.__nativeLocalCache({ ...request, action: "get" });
				return saved ? { configured: true, ...(saved as object) } : { configured: false };
			}
			if (command === "family_ai_key_transfer") {
				// Mirrors the native contract; real key agreement is covered by Rust tests.
				const input = (
					args as {
						input: {
							action: string;
							serverUrl: string;
							familyId: string;
							token: string;
							transferId?: string;
						};
					}
				).input;
				const call = (method: string, payload: Record<string, unknown>) =>
					window.__nativeUnary({
						serverUrl: input.serverUrl,
						service: "control",
						method,
						token: input.token,
						payload,
						timeoutMs: 15000,
					} as Parameters<Window["__nativeUnary"]>[0]) as Promise<Record<string, string>>;
				const keyRecord = {
					namespace: "family-ai",
					key: `${input.serverUrl}|${input.familyId}`,
				};
				if (input.action === "status") {
					const status = await call("GetFamilyAiChildStatus", {});
					if (status.mode !== "FAMILY_AI_CHILD_MODE_CHILD_DEVICE")
						await window.__nativeLocalCache({ ...keyRecord, action: "delete" });
					return { installed: false, mode: status.mode };
				}
				if (input.action === "offer") {
					const offered = await call("OfferFamilyAiKey", { childPublicKey: btoa("c".repeat(32)) });
					return { transferId: offered.id, installed: false };
				}
				if (input.action === "respond") {
					await call("RespondFamilyAiKeyTransfer", {
						id: input.transferId,
						parentPublicKey: btoa("p".repeat(32)),
					});
					return { transferId: input.transferId, code: "123456", installed: false };
				}
				if (input.action === "send") {
					await call("SendFamilyAiKey", {
						id: input.transferId,
						nonce: btoa("n".repeat(12)),
						ciphertext: btoa("x".repeat(32)),
					});
					return { transferId: input.transferId, installed: true };
				}
				const state = await call("GetFamilyAiKeyTransfer", { id: input.transferId });
				if (state.ciphertext) {
					await window.__nativeLocalCache({
						...keyRecord,
						action: "put",
						value: { provider: "openai", model: "shared-model", endpoint: null },
					});
					return { transferId: input.transferId, code: "123456", installed: true };
				}
				return {
					transferId: input.transferId,
					code: state.parentPublicKey ? "123456" : null,
					installed: false,
				};
			}
			if (command === "family_ai_run") {
				const input = (
					args as { input: { serverUrl: string; familyId: string; token?: string; jobId: string } }
				).input;
				const call = (method: string, payload: Record<string, unknown>) =>
					window.__nativeUnary({
						serverUrl: input.serverUrl,
						service: "control",
						method,
						token: input.token,
						payload,
						timeoutMs: 30000,
					} as Parameters<Window["__nativeUnary"]>[0]);
				const job = (await call("GetFamilyAiJob", { id: input.jobId })) as {
					prompt?: Parameters<Window["__nativeFamilyAiProvider"]>[0];
				};
				if (!job.prompt)
					throw {
						kind: "failed_precondition",
						message:
							"This AI request is not ready to run. It may need approval or may have expired.",
					};
				const output = await window.__nativeFamilyAiProvider(job.prompt);
				return call("CompleteFamilyAiJob", { id: input.jobId, output });
			}
			if (command === "local_cache") {
				const request = (args as { request: LocalCacheRequest }).request;
				const result = await window.__nativeLocalCache(request);
				if (request.namespace === "local-state-v1" && request.action !== "get") {
					const change = { key: request.key ?? null, source: args?.source };
					for (const listener of listeners.values()) {
						if (listener.event === "vulture:local-state-changed")
							listener.handler({ payload: change });
					}
					localStateChanges.postMessage(change);
				}
				return result;
			}
			if (command === "fambuddy_storage") {
				const { scope, account, input } = args as {
					scope: string;
					account: string;
					input: { action: string; value?: unknown };
				};
				const key = JSON.stringify([scope, account]);
				const { action, value } = input;
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
					if (!current || current[update.field] !== update.value)
						throw new Error("Saved pairing changed.");
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
				throw new Error(`Unsupported FamBuddy storage action ${action}`);
			}
			if (command === "plugin:event|listen") {
				const id = crypto.randomUUID();
				listeners.set(id, {
					event: args!.event as string,
					handler: args!.handler as (payload: unknown) => void,
				});
				return id;
			}
			if (command === "plugin:event|unlisten") {
				listeners.delete(args!.eventId as string);
				return undefined;
			}
			if (command === "server_stream_open") {
				const input = (
					args as {
						input: Parameters<Window["__nativeStreamOpen"]>[0];
					}
				).input;
				void window.__nativeStreamOpen(input).then((event) => {
					for (const listener of listeners.values()) {
						if (listener.event === "vulture:server-stream") listener.handler({ payload: event });
					}
				});
				return undefined;
			}
			if (command === "server_stream_close") {
				for (const listener of listeners.values()) {
					if (listener.event === "vulture:server-stream")
						listener.handler({
							payload: {
								streamId: (args as { streamId: string }).streamId,
								kind: "end",
							},
						});
				}
				return undefined;
			}
			// A home-network FamBuddy shows a synthetic certificate; confirming it is recorded.
			if (command === "fambuddy_certificate") return "AB:CD:EF:01";
			if (command === "fambuddy_trust") {
				const log = ((window as unknown as { __fambuddyTrust?: unknown[] }).__fambuddyTrust ??= []);
				log.push((args as { input?: object })?.input);
				return undefined;
			}
			if (["chat_subscribe", "chat_unsubscribe"].includes(command)) return undefined;
			// The shared chat connection opens as the app loads; tests read the calls back.
			if (command === "chat_connect" || command === "chat_disconnect") {
				const log = ((window as unknown as { __chatConnections?: unknown[] }).__chatConnections ??=
					[]);
				log.push({ command, ...((args as { input?: object })?.input ?? {}) });
				return undefined;
			}
			throw new Error(`[tauri-mock] no mock registered for ${command}`);
		};
		const listeners = new Map<string, { event: string; handler: (payload: unknown) => void }>();
		const localStateChanges = new BroadcastChannel("vulture-native-local-state");
		localStateChanges.onmessage = (event) => {
			for (const listener of listeners.values()) {
				if (listener.event === "vulture:local-state-changed")
					listener.handler({ payload: event.data });
			}
		};
		const records = new Map<string, unknown>();
		const leases = new Set<string>();
		(window as unknown as Record<string, unknown>).__nativeFallback = fallback;
		(window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
			unregisterListener: (event: string) => {
				for (const [id, listener] of listeners) if (listener.event === event) listeners.delete(id);
			},
		};
		(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
			invoke: fallback,
			transformCallback: (value: unknown) => value,
		};
	});
}
