import { beforeEach, expect, it, vi } from "vitest";
import type { IpcClient } from "../api/ipc";
import { createServerRepository } from "./server";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	listen: vi.fn(),
	unlisten: vi.fn(),
	handler: undefined as ((event: { payload: unknown }) => void) | undefined,
}));
vi.mock("@tauri-apps/api/event", () => ({
	listen: mocks.listen,
}));

beforeEach(() => {
	vi.resetAllMocks();
	mocks.handler = undefined;
	mocks.invoke.mockResolvedValue(undefined);
	mocks.listen.mockImplementation(async (_event, handler) => {
		mocks.handler = handler;
		return mocks.unlisten;
	});
});

function fixture() {
	const ipc = { invoke: mocks.invoke } as unknown as IpcClient;
	return createServerRepository("https://server.example", ipc);
}

function streamId() {
	return mocks.invoke.mock.calls[0][1].input.streamId as string;
}

it("queues stream data and closes after the end event", async () => {
	const server = fixture();
	const events = server
		.stream<{ ready: boolean }>(
			"fambuddy_relay",
			"WatchEnvelopes",
			{ channel: "channel" },
			{ token: "token", timeoutMs: 0 },
		)
		[Symbol.asyncIterator]();
	const first = events.next();
	await vi.waitFor(() => expect(mocks.handler).toBeDefined());
	const id = streamId();
	mocks.handler!({ payload: { streamId: id, kind: "data", payload: { ready: true } } });
	await expect(first).resolves.toEqual({ value: { ready: true }, done: false });
	mocks.handler!({ payload: { streamId: id, kind: "end" } });
	await expect(events.next()).resolves.toEqual({ value: undefined, done: true });
	expect(mocks.invoke).toHaveBeenCalledWith("server_stream_close", { streamId: id });
	expect(mocks.unlisten).toHaveBeenCalledOnce();
});

it("propagates structured stream failures", async () => {
	const server = fixture();
	const events = server.stream("fambuddy_gateway", "WatchParent", {})[Symbol.asyncIterator]();
	const first = events.next();
	await vi.waitFor(() => expect(mocks.handler).toBeDefined());
	mocks.handler!({
		payload: {
			streamId: streamId(),
			kind: "error",
			error: { kind: "unavailable", message: "offline" },
		},
	});
	await expect(first).rejects.toEqual({ kind: "unavailable", message: "offline" });
});

it("aborts and closes an active stream", async () => {
	const server = fixture();
	const controller = new AbortController();
	const events = server
		.stream("fambuddy_registry", "WatchEnrollment", {}, { signal: controller.signal })
		[Symbol.asyncIterator]();
	const first = events.next();
	await vi.waitFor(() => expect(mocks.handler).toBeDefined());
	controller.abort();
	await expect(first).resolves.toEqual({ value: undefined, done: true });
	expect(mocks.invoke).toHaveBeenCalledWith("server_stream_close", { streamId: streamId() });
});

it("closes the listener when native open fails", async () => {
	const server = fixture();
	mocks.invoke.mockImplementation((command) =>
		command === "server_stream_open" ? Promise.reject(new Error("open failed")) : Promise.resolve(),
	);
	const events = server.stream("fambuddy_gateway", "OpenTalk", {})[Symbol.asyncIterator]();
	await expect(events.next()).rejects.toThrow("open failed");
	expect(mocks.unlisten).toHaveBeenCalledOnce();
	expect(mocks.invoke).toHaveBeenCalledWith("server_stream_close", {
		streamId: expect.any(String),
	});
});
