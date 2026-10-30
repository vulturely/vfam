import { beforeEach, expect, it, vi } from "vitest";
import { createChatAdapter } from "./chatApi";
import type { OidcAuth } from "../../auth/oidc";

interface NativeEventPayload {
	subscriptionId?: string;
	familyId?: string;
	uploadId?: string;
	progress?: number;
}

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	listen: vi.fn(),
	unlisten: vi.fn(),
	handlers: new Map<string, (event: { payload: NativeEventPayload }) => void>(),
}));
vi.mock("../ipc", () => ({ createTauriIpcClient: () => ({ invoke: mocks.invoke }) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

const getSessionAccessToken = vi.fn();
const auth = { getSessionAccessToken } as unknown as OidcAuth;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.handlers.clear();
	getSessionAccessToken.mockResolvedValue("token");
	mocks.invoke.mockResolvedValue(undefined);
	mocks.listen.mockImplementation(async (event, handler) => {
		mocks.handlers.set(event, handler);
		return mocks.unlisten;
	});
});

it("sends chat commands with fresh native credentials", async () => {
	mocks.invoke.mockResolvedValue({ answer: 42 });
	const adapter = createChatAdapter("https://server.example", auth);
	await expect(adapter.remote({ action: "status" })).resolves.toEqual({ answer: 42 });
	expect(mocks.invoke).toHaveBeenCalledWith("chat_command", {
		input: {
			serverUrl: "https://server.example",
			token: "token",
			command: { action: "status" },
		},
	});
});

it("uses native crypto and grants native notification permission", async () => {
	mocks.invoke.mockResolvedValue({ ok: true });
	const adapter = createChatAdapter("https://server.example", auth);
	await expect(adapter.native("account", { action: "identity" })).resolves.toEqual({ ok: true });
	await expect(adapter.native("account", { action: "notification_permission" })).resolves.toEqual({
		granted: true,
	});
	expect(mocks.invoke).toHaveBeenCalledWith("family_chat_crypto", {
		account: "account",
		input: { action: "identity" },
	});
	expect(mocks.invoke).toHaveBeenCalledOnce();
	expect(adapter.nativeBatch).toBeUndefined();
});

it("filters native change notifications and closes subscriptions", async () => {
	const adapter = createChatAdapter("https://server.example", auth);
	const listener = vi.fn();
	const close = adapter.subscribe?.("family", listener);
	await vi.waitFor(() => expect(mocks.handlers.has("vulture:chat-changed")).toBe(true));
	const subscriptionId = mocks.invoke.mock.calls[0][1].input.subscriptionId;
	// The subscription names its family so the server sends it that family's changes.
	expect(mocks.invoke).toHaveBeenCalledWith("chat_subscribe", {
		input: {
			subscriptionId,
			serverUrl: "https://server.example",
			token: "token",
			familyId: "family",
		},
	});
	const handler = mocks.handlers.get("vulture:chat-changed")!;
	handler({ payload: { subscriptionId, familyId: "other" } });
	expect(listener).not.toHaveBeenCalled();
	handler({ payload: { subscriptionId, familyId: "family" } });
	handler({ payload: { subscriptionId } });
	expect(listener).toHaveBeenCalledTimes(2);
	close?.();
	expect(mocks.invoke).toHaveBeenCalledWith("chat_unsubscribe", { subscriptionId });
	expect(mocks.unlisten).toHaveBeenCalled();
});

it("requires credentials for chat transport", async () => {
	getSessionAccessToken.mockResolvedValue(null);
	const adapter = createChatAdapter("https://server.example", auth);
	await expect(adapter.remote({})).rejects.toThrow("Sign in again");
	await expect(adapter.uploadAttachment?.("family", new Uint8Array())).rejects.toThrow(
		"Sign in again",
	);
});

it("uploads encrypted attachment bytes with native progress events", async () => {
	mocks.invoke.mockImplementation(async (command, args) => {
		if (command !== "chat_attachment_upload") return undefined;
		const uploadId = args.input.uploadId;
		mocks.handlers.get("vulture:chat-upload")?.({ payload: { uploadId, progress: 0.5 } });
		mocks.handlers.get("vulture:chat-upload")?.({ payload: { uploadId, progress: 1 } });
		return "object-key";
	});
	const adapter = createChatAdapter("https://server.example", auth);
	const progress = vi.fn();
	await expect(
		adapter.uploadAttachment?.("family", Uint8Array.from([1, 2, 3]), progress),
	).resolves.toBe("object-key");
	expect(progress).toHaveBeenNthCalledWith(1, 0.5);
	expect(progress).toHaveBeenNthCalledWith(2, 1);
	expect(mocks.invoke).toHaveBeenCalledWith(
		"chat_attachment_upload",
		expect.objectContaining({
			input: expect.objectContaining({ familyId: "family", bytes: "AQID", token: "token" }),
		}),
	);
	expect(mocks.unlisten).toHaveBeenCalled();
});

it("downloads attachment bytes through native HTTP", async () => {
	mocks.invoke.mockResolvedValue("AQI=");
	const adapter = createChatAdapter("https://server.example", auth);
	await expect(adapter.downloadAttachment?.("family", "object")).resolves.toEqual(
		Uint8Array.from([1, 2]),
	);
	expect(mocks.invoke).toHaveBeenCalledWith("chat_attachment_download", {
		input: {
			serverUrl: "https://server.example",
			token: "token",
			familyId: "family",
			objectKey: "object",
		},
	});
});

it("returns to sign-in when chat, uploads or downloads find the session rejected", async () => {
	const token = `vcs_${"c".repeat(64)}`;
	getSessionAccessToken.mockResolvedValue(token);
	mocks.invoke.mockRejectedValue({ kind: "unauthenticated", message: "expired" });
	const dispatch = vi.spyOn(window, "dispatchEvent");
	const adapter = createChatAdapter("https://server.example", auth);
	await expect(adapter.remote({ action: "rooms" })).rejects.toThrow("expired");
	await expect(adapter.uploadAttachment!("family", new Uint8Array([1]))).rejects.toMatchObject({
		kind: "unauthenticated",
	});
	await expect(adapter.downloadAttachment!("family", "key")).rejects.toMatchObject({
		kind: "unauthenticated",
	});
	const expired = dispatch.mock.calls
		.map(([event]) => event as CustomEvent<string>)
		.filter((event) => event.type === "vulture:session-expired");
	expect(expired.map((event) => event.detail)).toEqual([token, token, token]);
	dispatch.mockRestore();
});

it("opens the shared chat connection early and closes it for the session", async () => {
	const adapter = createChatAdapter("https://server.example", auth);
	await adapter.connect!();
	expect(mocks.invoke).toHaveBeenCalledWith("chat_connect", {
		input: { serverUrl: "https://server.example", token: "token" },
	});
	await adapter.disconnect!();
	expect(mocks.invoke).toHaveBeenCalledWith("chat_disconnect");
	const token = `vps_${"a".repeat(64)}`;
	getSessionAccessToken.mockResolvedValue(token);
	mocks.invoke.mockRejectedValueOnce({ kind: "unauthenticated", message: "Sign in again" });
	const dispatch = vi.spyOn(window, "dispatchEvent");
	await expect(adapter.connect!()).rejects.toThrow("Sign in again");
	expect(dispatch).toHaveBeenCalledWith(
		expect.objectContaining({ type: "vulture:session-expired", detail: token }),
	);
	dispatch.mockRestore();
	mocks.invoke.mockRejectedValueOnce(new Error("IPC down"));
	await expect(adapter.connect!()).rejects.toThrow("IPC down");
});
