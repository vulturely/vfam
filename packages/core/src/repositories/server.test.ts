import { afterEach, expect, it, vi } from "vitest";
import type { IpcClient } from "../api/ipc";
import {
	createServerRepository,
	isNativeServerError,
	isServerNetworkError,
	NativeServerError,
} from "./server";

it("sends native unary requests with endpoint, credentials and timeout", async () => {
	const ipc = { invoke: vi.fn().mockResolvedValue({ ok: true }) } as unknown as IpcClient;
	const server = createServerRepository("https://server.example", ipc);
	await expect(
		server.unary("control", "Health", { probe: true }, { token: "token", timeoutMs: 5000 }),
	).resolves.toEqual({ ok: true });
	expect(ipc.invoke).toHaveBeenCalledWith("server_unary", {
		input: {
			serverUrl: "https://server.example",
			service: "control",
			method: "Health",
			token: "token",
			payload: { probe: true },
			timeoutMs: 5000,
		},
	});
});

it("normalizes structured native errors and classifies offline failures", async () => {
	const ipc = {
		invoke: vi.fn().mockRejectedValue({ kind: "unavailable", message: "offline" }),
	} as unknown as IpcClient;
	const server = createServerRepository("https://server.example", ipc);
	const error = await server.unary("control", "Health", {}).catch((cause: unknown) => cause);
	expect(error).toBeInstanceOf(NativeServerError);
	expect(isNativeServerError(error, "unavailable")).toBe(true);
	expect(isNativeServerError(error, "unauthenticated")).toBe(false);
	expect(isServerNetworkError(error)).toBe(true);
	expect(isServerNetworkError(new TypeError("fetch failed"))).toBe(true);
	expect(isServerNetworkError(new NativeServerError("permission_denied", "denied"))).toBe(false);
});

it("passes through non-native errors", async () => {
	const failure = new Error("IPC unavailable");
	const ipc = { invoke: vi.fn().mockRejectedValue(failure) } as unknown as IpcClient;
	const server = createServerRepository("https://server.example", ipc);
	await expect(server.unary("control", "Health", {})).rejects.toBe(failure);
});

afterEach(() => vi.restoreAllMocks());

it("reports a rejected session token so the app returns to sign-in", async () => {
	const token = `vcs_${"c".repeat(64)}`;
	const ipc = {
		invoke: vi.fn().mockRejectedValue({ kind: "unauthenticated", message: "expired" }),
	} as unknown as IpcClient;
	const dispatch = vi.spyOn(window, "dispatchEvent");
	const server = createServerRepository("https://server.example", ipc);
	await expect(server.unary("control", "ListChildTasks", {}, { token })).rejects.toThrow("expired");
	expect(dispatch).toHaveBeenCalledWith(
		expect.objectContaining({ type: "vulture:session-expired", detail: token }),
	);
	dispatch.mockClear();
	// A wrong PIN is UNAUTHENTICATED too, but must not sign anyone out.
	await expect(server.unary("control", "UnlockParent", {}, { token })).rejects.toThrow();
	expect(dispatch).not.toHaveBeenCalled();
});
