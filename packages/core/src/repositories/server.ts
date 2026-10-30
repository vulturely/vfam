import { reportSessionExpiry } from "../api/auth/sessionEvents";
import { createTauriIpcClient, type IpcClient } from "../api/ipc";

export type ServerService =
	"control" | "robot" | "fambuddy_gateway" | "fambuddy_registry" | "fambuddy_relay";

export interface ServerRequestOptions {
	token?: string;
	timeoutMs?: number;
	signal?: AbortSignal;
}

export class NativeServerError extends Error {
	constructor(
		readonly kind: string,
		message: string,
	) {
		super(message);
		this.name = "NativeServerError";
	}
}

export function isNativeServerError(error: unknown, kind?: string): error is NativeServerError {
	const matches =
		error instanceof NativeServerError ||
		(!!error &&
			typeof error === "object" &&
			"kind" in error &&
			typeof error.kind === "string" &&
			"message" in error &&
			typeof error.message === "string");
	return matches && (kind === undefined || (error as NativeServerError).kind === kind);
}

export function isServerNetworkError(error: unknown): boolean {
	return (
		error instanceof TypeError ||
		(isNativeServerError(error) && ["unavailable", "deadline_exceeded"].includes(error.kind))
	);
}

export interface ServerRepository {
	unary<T>(
		service: ServerService,
		method: string,
		payload: Record<string, unknown>,
		options?: ServerRequestOptions,
	): Promise<T>;
	stream<T>(
		service: ServerService,
		method: string,
		payload: Record<string, unknown>,
		options?: ServerRequestOptions,
	): AsyncIterable<T>;
}

interface StreamEvent {
	streamId: string;
	kind: "data" | "error" | "end";
	payload?: unknown;
	error?: { kind: string; message: string };
}

export function createServerRepository(
	serverUrl: string,
	ipc: IpcClient = createTauriIpcClient(),
): ServerRepository {
	return {
		async unary<T>(
			service: ServerService,
			method: string,
			payload: Record<string, unknown>,
			options: ServerRequestOptions = {},
		): Promise<T> {
			try {
				return await ipc.invoke<T>("server_unary", {
					input: {
						serverUrl,
						service,
						method,
						token: options.token ?? null,
						payload,
						timeoutMs: options.timeoutMs ?? null,
					},
				});
			} catch (cause) {
				reportSessionExpiry(cause, options.token, method);
				if (isNativeServerError(cause)) throw new NativeServerError(cause.kind, cause.message);
				throw cause;
			}
		},
		stream<T>(
			service: ServerService,
			method: string,
			payload: Record<string, unknown>,
			options: ServerRequestOptions = {},
		): AsyncIterable<T> {
			return streamEvents<T>(serverUrl, ipc, service, method, payload, options);
		},
	};
}

async function* streamEvents<T>(
	serverUrl: string,
	ipc: IpcClient,
	service: ServerService,
	method: string,
	payload: Record<string, unknown>,
	options: ServerRequestOptions,
): AsyncGenerator<T> {
	const { listen } = await import("@tauri-apps/api/event");
	const streamId = crypto.randomUUID();
	const queue: T[] = [];
	let ended = false;
	let failure: unknown;
	let wake: (() => void) | undefined;
	const notify = () => {
		wake?.();
		wake = undefined;
	};
	const unlisten = await listen<StreamEvent>("vulture:server-stream", (event) => {
		const value = event.payload;
		if (value.streamId !== streamId) return;
		if (value.kind === "data") queue.push(value.payload as T);
		else if (value.kind === "error") failure = value.error;
		else ended = true;
		notify();
	});
	const close = () => ipc.invoke<void>("server_stream_close", { streamId }).catch(() => {});
	const aborted = () => {
		ended = true;
		void close();
		notify();
	};
	options.signal?.addEventListener("abort", aborted, { once: true });
	try {
		options.signal?.throwIfAborted();
		await ipc.invoke<void>("server_stream_open", {
			input: {
				streamId,
				serverUrl,
				service,
				method,
				token: options.token ?? null,
				payload,
				timeoutMs: options.timeoutMs ?? null,
			},
		});
		while (true) {
			const value = queue.shift();
			if (value !== undefined) {
				yield value;
				continue;
			}
			if (failure) throw failure;
			if (ended) return;
			await new Promise<void>((resolve) => {
				wake = resolve;
				if (queue.length || failure || ended) resolve();
			});
			wake = undefined;
		}
	} finally {
		options.signal?.removeEventListener("abort", aborted);
		unlisten();
		await close();
	}
}
