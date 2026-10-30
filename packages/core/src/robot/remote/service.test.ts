import { beforeEach, expect, it, vi } from "vitest";
import { createRemoteBuddy } from "./service";
import type { RemotePair } from "./crypto";

vi.mock("../../api/fambuddy/fambuddyStorage", () => ({
	acquireFamBuddyRelay: async () => () => {},
}));
const mocks = vi.hoisted(() => ({
	publish: vi.fn(),
	watch: vi.fn(),
	seal: vi.fn(),
	open: vi.fn(),
}));
vi.mock("./client", () => ({
	relayClient: () => ({
		publishEnvelope: mocks.publish,
		watchEnvelopes: mocks.watch,
	}),
	parentHeaders: async () => ({ authorization: "Bearer vps_cloud" }),
}));
vi.mock("./crypto", () => ({
	remoteCrypto: () => ({ seal: mocks.seal, open: mocks.open }),
}));
const pair = {
	origin: "https://relay.example",
	binding: { channel: "c", device: "d", family: "f" },
} as RemotePair;
const output = { settings: [], turns: [] };
type Event = { ready: boolean; ciphertext: Uint8Array };
function stream() {
	const queued: IteratorResult<Event>[] = [];
	let waiting: ((event: IteratorResult<Event>) => void) | undefined;
	const put = (event: IteratorResult<Event>) => {
		if (waiting) {
			const resolve = waiting;
			waiting = undefined;
			resolve(event);
		} else queued.push(event);
	};
	return {
		push: (ready = false) =>
			put({ done: false, value: { ready, ciphertext: new Uint8Array([9]) } }),
		end: () => put({ done: true, value: undefined }),
		[Symbol.asyncIterator]() {
			return this;
		},
		next: () =>
			queued.length
				? Promise.resolve(queued.shift()!)
				: new Promise<IteratorResult<Event>>((resolve) => {
						waiting = resolve;
					}),
	};
}
beforeEach(() => {
	vi.resetAllMocks();
	let sequence = 0;
	mocks.seal.mockImplementation(async () => ({
		id: String(++sequence),
		ciphertext: new Uint8Array([7, 8]),
	}));
	mocks.publish.mockResolvedValue({});
	mocks.open.mockResolvedValue({ output });
});
async function connected() {
	const incoming = stream();
	mocks.watch.mockReturnValue(incoming);
	const abort = new AbortController();
	const service = createRemoteBuddy(
		pair,
		{ getAccessToken: async () => "vps_cloud" },
		() => "vps_local_secret",
	);
	const watch = service.watch("f", abort.signal)[Symbol.asyncIterator]();
	incoming.push(true);
	incoming.push();
	await watch.next();
	return { incoming, abort, service, watch };
}
it("forwards only ciphertext and resolves the matching device acknowledgement", async () => {
	const { service, watch, incoming } = await connected();
	const command = {
		action: "announce" as const,
		device: "d",
		text: "private announcement",
	};
	const result = service.command(command);
	await vi.waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(2));
	expect(mocks.seal).toHaveBeenLastCalledWith(pair, {
		token: "vps_local_secret",
		command,
		watch: false,
	});
	expect(mocks.publish.mock.calls[1][0]).toEqual({
		channel: "c",
		ciphertext: new Uint8Array([7, 8]),
	});
	expect(JSON.stringify(mocks.publish.mock.calls)).not.toContain("private announcement");
	expect(JSON.stringify(mocks.publish.mock.calls)).not.toContain("vps_local_secret");
	mocks.open.mockResolvedValueOnce({ request: "2", output });
	incoming.push();
	const nextUpdate = watch.next();
	await expect(result).resolves.toEqual(output);
	incoming.end();
	await nextUpdate;
});
it("rejects pending commands on disconnect without retrying", async () => {
	const { service, watch, incoming } = await connected();
	const result = service.command({ action: "cancel", device: "d", turn: "t" });
	const rejected = expect(result).rejects.toThrow("no commands were retried");
	await vi.waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(2));
	incoming.end();
	await watch.next();
	await rejected;
	expect(mocks.publish).toHaveBeenCalledTimes(2);
	await expect(service.command({ action: "list", family: "f" })).rejects.toThrow("Reconnect");
});
it("does not send a command if encryption finishes after disconnect", async () => {
	const { service, watch, incoming } = await connected();
	let finish!: (message: { id: string; ciphertext: Uint8Array }) => void;
	mocks.seal.mockReturnValueOnce(
		new Promise((resolve) => {
			finish = resolve;
		}),
	);
	const result = service.command({ action: "cancel", device: "d", turn: "t" });
	const rejected = expect(result).rejects.toThrow("command was not sent");
	incoming.end();
	await watch.next();
	finish({ id: "late", ciphertext: new Uint8Array([1]) });
	await rejected;
	expect(mocks.publish).toHaveBeenCalledTimes(1);
});
it("rejects remote live talk before sending any request", () => {
	const service = createRemoteBuddy(
		pair,
		{ getAccessToken: async () => "vps_cloud" },
		() => "local",
	);
	expect(service.liveTalkAvailable).toBe(false);
	expect(() => service.openTalk("d", "offer", new AbortController().signal)).toThrow(
		"Register this device",
	);
	expect(mocks.publish).not.toHaveBeenCalled();
});
