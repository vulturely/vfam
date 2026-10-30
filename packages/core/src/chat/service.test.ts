import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatAdapter } from "../api/chat/chatApi";
import { chatService, type ChatMessage } from "./service";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function fixture() {
	const calls: Record<string, unknown>[] = [];
	const nativeCalls: Record<string, unknown>[] = [];
	const identity = {
		deviceId: "device",
		fingerprint: "a".repeat(64),
		keyPackages: ["package"],
	};
	const device = {
		...identity,
		accountId: "parent",
		approved: true,
		revoked: false,
	};
	const pins: Record<string, string> = {};
	let messages: ChatMessage[] = [];
	let history: ChatMessage[] = [];
	let outbox: Record<string, unknown>[] = [];
	let generation = 1;
	let initialized = false;
	let group = false;
	let initializerWelcome: string | undefined;
	let roster = [device];
	let failSend = false;
	let loseInitializeResponse = false;
	let welcomes: unknown[] = [];
	const adapter: ChatAdapter = {
		async native<T>(_account: string, c: Record<string, unknown>): Promise<T> {
			nativeCalls.push(c);
			let result: unknown = {};
			switch (c.action) {
				case "identity":
					result = identity;
					break;
				case "pins":
					result = { pins };
					break;
				case "pin":
					pins[c.deviceId as string] = c.fingerprint as string;
					break;
				case "exists":
					result = { exists: group, initializerWelcome };
					break;
				case "create":
					group = true;
					initializerWelcome = "welcome";
					result = {
						welcomes: [{ deviceId: "device", ciphertext: "welcome" }],
					};
					break;
				case "join":
					group = true;
					break;
				case "dropGroup":
					group = false;
					initializerWelcome = undefined;
					break;
				case "encrypt": {
					const payload = JSON.parse(c.plaintext as string) as {
						text?: string;
						attachment?: unknown;
					};
					if (!payload.text?.trim() && !payload.attachment)
						throw new Error("Enter a message or choose a file.");
					if ((payload.text?.length ?? 0) > 16000)
						throw new Error("Messages are limited to 16,000 characters.");
					result = { ciphertext: "OPAQUE" };
					outbox.push({ ...c, ciphertext: "OPAQUE" });
					break;
				}
				case "decrypt":
					result = { plaintext: JSON.stringify({ text: "Received" }) };
					if (c.message) {
						const message = c.message as ChatMessage;
						history = [
							...history.filter((item) => item.messageId !== message.messageId),
							{
								...message,
								ciphertext: undefined,
								payload: { text: "Received" },
							},
						];
					}
					break;
				case "outbox":
					result = { messages: outbox };
					break;
				case "ack":
					outbox = outbox.filter((m) => m.clientId !== c.clientId);
					break;
				case "cache":
					history.push(c.message as ChatMessage);
					break;
				case "cacheAndAck":
					history.push(c.message as ChatMessage);
					outbox = outbox.filter((m) => m.clientId !== c.clientId);
					break;
				case "history":
					result = { messages: history };
					break;
				case "purge":
					history = history.filter((m) => !(c.ids as string[]).includes(m.messageId));
					break;
			}
			return result as T;
		},
		async remote<T>(c: Record<string, unknown>): Promise<T> {
			calls.push(c);
			let result: unknown = {};
			switch (c.action) {
				case "roster":
					result = { devices: roster };
					break;
				case "rooms":
					result = { rooms: [] };
					break;
				case "open":
					result = { roomId: "room" };
					break;
				case "initialize":
					initialized = true;
					welcomes = c.welcomes as unknown[];
					if (loseInitializeResponse) throw new Error("Lost initialize reply");
					break;
				case "sync":
					result = {
						generation,
						revision: 1,
						initialized,
						roster,
						welcomes,
						messages: messages.filter((m) => m.sequence > ((c.after as number) ?? 0)),
						generations: [],
					};
					break;
				case "send": {
					if (failSend) throw new Error("Offline");
					const message: ChatMessage = {
						messageId: "sent",
						clientId: c.clientId as string,
						sequence: 1,
						generation,
						deviceId: "device",
						accountId: "parent",
						createdAt: Date.now() / 1000,
						deleted: false,
						ciphertext: c.ciphertext as string,
					};
					messages = [message];
					result = message;
					break;
				}
				case "delete":
					messages = messages.map((m) => ({ ...m, deleted: true }));
					break;
			}
			return result as T;
		},
		async uploadAttachment() {
			return "attachment-object-key";
		},
	};
	return {
		adapter,
		calls,
		nativeCalls,
		identity,
		device,
		pins,
		service: chatService(adapter),
		setRoster: (v: typeof roster) => (roster = v),
		rotate: () => generation++,
		offline: () => (failSend = true),
		online: () => (failSend = false),
		loseInitialize: () => (loseInitializeResponse = true),
		message: (m: Partial<ChatMessage> = {}) => {
			messages = [
				{
					messageId: "remote",
					clientId: "remote-client",
					sequence: 1,
					generation,
					deviceId: "peer",
					accountId: "peer",
					createdAt: Date.now() / 1000,
					deleted: false,
					ciphertext: "OPAQUE",
					...m,
				},
			];
		},
		addMessage: (m: Partial<ChatMessage> = {}) => {
			const sequence = messages.length + 1;
			messages.push({
				messageId: `remote-${sequence}`,
				clientId: `remote-client-${sequence}`,
				sequence,
				generation,
				deviceId: "peer",
				accountId: "peer",
				createdAt: Date.now() / 1000,
				deleted: false,
				ciphertext: "OPAQUE",
				...m,
			});
		},
	};
}
describe("desktop chat orchestration", () => {
	it("rejoins the winning group after an offline initialization loses the CAS", async () => {
		const f = fixture();
		let attempted = false;
		let online = false;
		const adapter: ChatAdapter = {
			...f.adapter,
			remote: async <T>(c: Record<string, unknown>): Promise<T> => {
				if (c.action === "initialize") {
					attempted = true;
					throw new Error("Offline initialization");
				}
				if (c.action === "sync" && attempted) {
					if (!online) throw new Error("Offline resync");
					return {
						generation: 1,
						revision: 1,
						initialized: true,
						roster: [f.device],
						welcomes: [{ deviceId: "device", ciphertext: "winner-welcome" }],
						messages: [],
						generations: [],
					} as T;
				}
				return f.adapter.remote<T>(c);
			},
		};
		const service = chatService(adapter);
		await service.start("parent", "family");
		await service.open();
		await expect(service.send("room", "waiting")).rejects.toThrow("Offline resync");
		expect(f.nativeCalls.some((c) => c.action === "dropGroup")).toBe(false);
		online = true;
		await expect(service.sync("room")).resolves.toEqual([]);
		expect(f.nativeCalls.filter((c) => c.action === "dropGroup")).toHaveLength(1);
		expect(f.nativeCalls.find((c) => c.action === "join")?.welcome).toBe("winner-welcome");
	});
	it("continues byte-limited pages even when they contain fewer than100 records", async () => {
		const f = fixture();
		const adapter: ChatAdapter = {
			...f.adapter,
			remote: async <T>(c: Record<string, unknown>): Promise<T> => {
				const result = await f.adapter.remote<Record<string, unknown>>(c);
				if (c.action !== "sync") return result as T;
				const sequence = (c.after as number) === 1 ? 2 : 1;
				return {
					...result,
					hasMore: sequence === 1,
					messages: [
						{
							messageId: `m${sequence}`,
							clientId: `c${sequence}`,
							sequence,
							generation: 1,
							deviceId: "peer",
							accountId: "peer",
							createdAt: Date.now() / 1000,
							deleted: false,
							ciphertext: "OPAQUE",
						},
					],
				} as T;
			},
		};
		const service = chatService(adapter);
		await service.start("parent", "family");
		await service.open();
		expect((await service.sync("room")).map((m) => m.sequence)).toEqual([1, 2]);
	});
	it("rejects unrelated pinned family devices in a direct conversation", async () => {
		const f = fixture();
		await f.service.start("parent", "family");
		const unrelated = {
			...f.device,
			deviceId: "uncle",
			accountId: "uncle",
			fingerprint: "c".repeat(64),
		};
		f.pins[unrelated.deviceId] = unrelated.fingerprint;
		await f.service.open("peer");
		f.setRoster([f.device, unrelated]);
		await expect(f.service.sync("room")).rejects.toThrow("outside this private conversation");
		expect(f.nativeCalls.some((c) => c.action === "create")).toBe(false);
	});
	it("reuses a durable pending send when the user retries the same message", async () => {
		const f = fixture();
		await f.service.start("parent", "family");
		await f.service.open();
		f.offline();
		await expect(f.service.send("room", "retry this")).rejects.toThrow("Offline");
		f.online();
		await f.service.send("room", "retry this");
		expect(f.nativeCalls.filter((c) => c.action === "encrypt")).toHaveLength(1);
		expect(f.calls.filter((c) => c.action === "send").map((c) => c.clientId)[0]).toBe(
			f.calls.filter((c) => c.action === "send").map((c) => c.clientId)[1],
		);
	});
	it("preserves creator private state when initialization commits but its response is lost", async () => {
		const f = fixture();
		await f.service.start("parent", "family");
		await f.service.open();
		f.loseInitialize();
		await expect(f.service.send("room", "still decryptable")).resolves.toBeUndefined();
		expect(f.nativeCalls.some((c) => c.action === "dropGroup")).toBe(false);
		expect((await f.service.sync("room"))[0].payload?.text).toBe("still decryptable");
	});
	it("encrypts bodies and attachment names/bytes before transport, caches sender history and retries ciphertext", async () => {
		const f = fixture();
		await f.service.start("parent", "family");
		await f.service.open();
		f.offline();
		const file = {
			name: "private-plan.txt",
			type: "text/plain",
			size: 5,
			arrayBuffer: async () => new TextEncoder().encode("HELLO").buffer,
		} as File;
		await expect(f.service.send("room", "secret body", file)).rejects.toThrow("Offline");
		const sent = f.calls.find((c) => c.action === "send")!;
		expect(JSON.stringify(sent)).not.toMatch(/secret body|private-plan|HELLO|plaintext/);
		expect(f.nativeCalls.find((c) => c.action === "encrypt")?.plaintext).toContain(
			"private-plan.txt",
		);
		f.online();
		const messages = await f.service.sync("room");
		expect(messages[0].payload?.text).toBe("secret body");
		expect(f.calls.filter((c) => c.action === "send").map((c) => c.clientId)).toEqual([
			sent.clientId,
			sent.clientId,
		]);
	});
	it("automatically registers new approved devices but never replaces a changed key", async () => {
		const f = fixture();
		await f.service.start("parent", "family");
		await f.service.open();
		const peer = {
			...f.device,
			deviceId: "peer",
			accountId: "peer",
			fingerprint: "b".repeat(64),
		};
		f.setRoster([f.device, peer]);
		await expect(f.service.sync("room")).resolves.toEqual([]);
		expect(f.pins.peer).toBe(peer.fingerprint);
		f.rotate();
		f.setRoster([f.device, { ...peer, fingerprint: "c".repeat(64) }]);
		await expect(f.service.sync("room")).rejects.toThrow("security key changed");
		expect(f.pins.peer).toBe(peer.fingerprint);
		await expect(f.service.approve({ ...peer, fingerprint: "c".repeat(64) })).rejects.toThrow(
			"security key changed",
		);
	});
	it("checks the authenticated roster and server authorization before allowing a pending device", async () => {
		const f = fixture();
		await f.service.start("parent", "family");
		const pending = {
			...f.device,
			deviceId: "pending",
			accountId: "child",
			approved: false,
		};
		await expect(f.service.approve(pending)).rejects.toThrow("Reload before approving");
		f.setRoster([f.device, pending]);
		await f.service.approve(pending);
		expect(f.calls).toContainEqual(
			expect.objectContaining({
				action: "approve",
				deviceId: "pending",
				fingerprint: pending.fingerprint,
			}),
		);
		expect(f.pins.pending).toBe(pending.fingerprint);
	});
	it("does not register pending or revoked devices as trusted while syncing", async () => {
		const f = fixture();
		await f.service.start("parent", "family");
		await f.service.open();
		for (const device of [
			{ ...f.device, deviceId: "pending", approved: false },
			{ ...f.device, deviceId: "revoked", revoked: true },
		]) {
			f.setRoster([f.device, device]);
			await expect(f.service.sync("room")).rejects.toThrow("not approved");
			expect(f.pins[device.deviceId]).toBeUndefined();
		}
	});
	it("makes stale-generation unsent messages actionable and discardable", async () => {
		const f = fixture();
		await f.service.start("parent", "family");
		await f.service.open();
		f.offline();
		await expect(f.service.send("room", "unsent")).rejects.toThrow("Offline");
		f.online();
		f.rotate();
		await expect(f.service.sync("room")).rejects.toThrow("Discard unsent messages");
		await f.service.discardPending("room");
		await expect(f.service.sync("room")).resolves.toEqual([]);
		expect(f.calls.filter((c) => c.action === "send")).toHaveLength(1);
	});
	it("orders history, avoids re-decrypting duplicates and purges tombstones", async () => {
		const f = fixture();
		await f.service.start("parent", "family");
		await f.service.open();
		f.message();
		expect((await f.service.sync("room"))[0].payload?.text).toBe("Received");
		await f.service.sync("room");
		expect(f.nativeCalls.filter((c) => c.action === "decrypt")).toHaveLength(1);
		await f.service.remove("room", "remote");
		expect(await f.service.sync("room")).toEqual([]);
	});
	it("batches browser history decrypts into one local state transaction", async () => {
		const f = fixture();
		const batches: Record<string, unknown>[][] = [];
		const adapter: ChatAdapter = {
			...f.adapter,
			nativeBatch: async <T>(account: string, commands: Record<string, unknown>[]) => {
				batches.push(commands);
				const results: T[] = [];
				for (const command of commands) {
					if (command.action === "decryptBatch") {
						const messages: { plaintext: string }[] = [];
						for (const item of command.messages as {
							ciphertext: string;
							message: ChatMessage;
						}[])
							messages.push(
								await f.adapter.native<{ plaintext: string }>(account, {
									action: "decrypt",
									roomId: command.roomId,
									generation: command.generation,
									...item,
								}),
							);
						results.push({ messages } as T);
					} else {
						results.push(await f.adapter.native<T>(account, command));
					}
				}
				return results;
			},
		};
		const service = chatService(adapter);
		await service.start("parent", "family");
		await service.open();
		f.message({ messageId: "first", sequence: 1 });
		f.addMessage({ messageId: "second", sequence: 2 });

		const result = await service.sync("room");

		expect(result.map((message) => message.messageId)).toEqual(["first", "second"]);
		expect(batches).toHaveLength(1);
		expect(batches[0].map((command) => command.action)).toEqual(["decryptBatch"]);
		expect(batches[0][0].messages).toHaveLength(2);
	});
	it("forwards message validation to native encryption", async () => {
		const f = fixture();
		await f.service.start("parent", "family");
		await f.service.open();
		await expect(f.service.send("room", " ")).rejects.toThrow("Enter a message");
		await expect(f.service.send("room", "x".repeat(16001))).rejects.toThrow("16,000");
		expect(f.nativeCalls.some((c) => c.action === "encrypt")).toBe(true);
	});
	it("cancels logout during enrollment before remote or native continuation", async () => {
		const f = fixture();
		let release: (v: unknown) => void = () => {};
		const identity = new Promise((resolve) => {
			release = resolve;
		});
		const service = chatService({
			...f.adapter,
			native: async <T>() => (await identity) as T,
		});
		const start = service.start("parent", "family");
		service.close();
		release(f.identity);
		await expect(start).rejects.toThrow("session ended");
		expect(f.calls).toEqual([]);
		await expect(service.open()).rejects.toThrow("on this device");
	});
	it("stops a paused remote enrollment after logout", async () => {
		const f = fixture();
		let release: () => void = () => {};
		const paused = new Promise<void>((resolve) => {
			release = resolve;
		});
		const adapter: ChatAdapter = {
			...f.adapter,
			remote: async <T>(c: Record<string, unknown>) => {
				const result = await f.adapter.remote<T>(c);
				if (c.action === "enroll") await paused;
				return result;
			},
		};
		const service = chatService(adapter);
		const start = service.start("parent", "family");
		await new Promise((resolve) => setTimeout(resolve, 0));
		service.close();
		release();
		await expect(start).rejects.toThrow("session ended");
		expect(f.calls.map((c) => c.action)).toEqual(["enroll"]);
	});
	it("waits for cancelled device work before reopening without concurrent crypto", async () => {
		const f = fixture();
		let release!: () => void;
		const paused = new Promise<void>((resolve) => {
			release = resolve;
		});
		let identities = 0;
		const service = chatService({
			...f.adapter,
			native: async <T>(account: string, command: Record<string, unknown>) => {
				if (command.action === "identity" && identities++ === 0) await paused;
				return f.adapter.native<T>(account, command);
			},
		});
		const first = service.start("parent", "family");
		const cancelled = expect(first).rejects.toThrow("session ended");
		service.close();
		const reopened = service.start("parent", "family");
		release();
		await cancelled;
		await expect(reopened).resolves.toMatchObject({ identity: f.identity });
		expect(f.calls.filter((command) => command.action === "enroll")).toHaveLength(1);
	});
	it("requests notification permission without sending a notification", async () => {
		const f = fixture();
		await f.service.start("parent", "family");
		await f.service.notify(true);
		expect(f.nativeCalls.at(-1)).toEqual({ action: "notification_permission" });
	});
	it("requests fixed private notifications without message data", async () => {
		const f = fixture();
		await f.service.start("parent", "family");
		await f.service.open();
		await f.service.notify();
		expect(f.nativeCalls.at(-1)).toEqual({ action: "notify" });
	});
	it("fails closed without contacting relay when secure local crypto is unavailable", async () => {
		const f = fixture();
		const service = chatService({
			...f.adapter,
			native: async () => {
				throw new Error("No IPC");
			},
		});
		await expect(service.start("parent", "family")).rejects.toThrow(
			"Encrypted chat could not start",
		);
		expect(f.calls).toEqual([]);
	});
});

it("restores private channel participants after reload and rejects unrelated encryption devices", async () => {
	const f = fixture();
	const channel = {
		roomId: "channel",
		name: "Weekend",
		participants: ["parent", "peer"],
	};
	const service = chatService({
		...f.adapter,
		remote: async <T>(command: Record<string, unknown>): Promise<T> => {
			if (command.action === "rooms") return { rooms: [channel] } as T;
			if (command.action === "createChannel") return channel as T;
			if (command.action === "sync")
				return {
					generation: 1,
					revision: 1,
					initialized: false,
					roster: [{ ...f.device, accountId: "outsider" }],
					welcomes: [],
					messages: [],
				} as T;
			return f.adapter.remote<T>(command);
		},
	});
	expect((await service.start("parent", "family")).rooms).toEqual([channel]);
	await expect(service.sync("channel")).rejects.toThrow("outside this private conversation");
	expect(await service.createChannel(" Weekend ", ["peer"])).toEqual(channel);
	await expect(service.sync("channel")).rejects.toThrow("outside this private conversation");
});

it("does not trust a pending device when server approval is denied", async () => {
	const f = fixture();
	const pending = {
		...f.device,
		deviceId: "pending",
		accountId: "relative",
		approved: false,
	};
	const service = chatService({
		...f.adapter,
		remote: async <T>(command: Record<string, unknown>): Promise<T> => {
			if (command.action === "roster") return { devices: [f.device, pending] } as T;
			if (command.action === "approve") throw new Error("Only a guardian may approve devices");
			return f.adapter.remote<T>(command);
		},
	});
	await service.start("parent", "family");
	expect(f.pins.pending).toBeUndefined();
	await expect(service.approve(pending)).rejects.toThrow("Only a guardian");
	expect(f.pins.pending).toBeUndefined();
});

it("manages channel membership, pruning, and device revocation through the native adapter", async () => {
	const f = fixture();
	const channel = { roomId: "channel", name: "Weekend", participants: ["parent"] };
	const service = chatService({
		...f.adapter,
		remote: async <T>(command: Record<string, unknown>): Promise<T> => {
			if (command.action === "rooms") return { rooms: [channel] } as T;
			if (command.action === "createChannel") return channel as T;
			if (command.action === "channelRename") return { ...channel, name: command.name } as T;
			if (command.action === "channelAddMember")
				return { ...channel, participants: ["parent", "peer"] } as T;
			return f.adapter.remote<T>(command);
		},
	});
	expect((await service.start("parent", "family")).rooms).toEqual([channel]);
	expect((await service.open("peer")).participants).toEqual(["parent", "peer"]);
	expect(await service.createChannel(" Weekend ", ["parent"])).toEqual(channel);
	expect((await service.renameChannel("channel", " Updated ")).name).toBe("Updated");
	expect((await service.addChannelMember("channel", "peer")).participants).toContain("peer");
	expect(await service.refreshRooms()).toEqual([channel]);
	await service.deleteChannel("channel");
	await service.revoke("device");
	expect(f.calls.map((call) => call.action)).toEqual(
		expect.arrayContaining(["channelDelete", "revoke"]),
	);
});

it("compresses large images before encrypted upload", async () => {
	const f = fixture();
	const close = vi.fn();
	vi.stubGlobal(
		"createImageBitmap",
		vi.fn(async () => ({ width: 4000, height: 2000, close })),
	);
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
		drawImage: vi.fn(),
	} as unknown as CanvasRenderingContext2D);
	vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) =>
		callback(new Blob(["small"], { type: "image/webp" })),
	);
	await f.service.start("parent", "family");
	await f.service.open();
	await f.service.send(
		"room",
		"Image",
		new File(["large image payload"], "photo", { type: "image/png" }),
	);
	expect(close).toHaveBeenCalledOnce();
	const encrypted = f.nativeCalls.find((call) => call.action === "encrypt");
	expect(JSON.parse(String(encrypted?.plaintext))).toMatchObject({
		attachment: expect.objectContaining({ name: "photo.webp", mediaType: "image/webp" }),
	});
});

it("keeps the shared connection when a screen closes and drops it when the session ends", async () => {
	const adapter: ChatAdapter = {
		native: vi.fn(),
		remote: vi.fn(),
		close: vi.fn(),
		connect: vi.fn(async () => {}),
		disconnect: vi.fn(async () => {}),
	};
	const service = chatService(adapter);
	await service.connect();
	expect(adapter.connect).toHaveBeenCalledOnce();
	service.close();
	expect(adapter.close).toHaveBeenCalledOnce();
	expect(adapter.disconnect).not.toHaveBeenCalled();
	service.disconnect();
	expect(adapter.close).toHaveBeenCalledTimes(2);
	expect(adapter.disconnect).toHaveBeenCalledOnce();
	// Adapters without a shared connection still work.
	const plain = chatService({ native: vi.fn(), remote: vi.fn() });
	await expect(plain.connect()).resolves.toBeUndefined();
	expect(() => plain.disconnect()).not.toThrow();
});

it("sends without downloading history and later reads only new messages", async () => {
	const f = fixture();
	await f.service.start("parent", "family");
	await f.service.open();
	await f.service.sync("room");
	const syncs = () => f.calls.filter((c) => c.action === "sync").map((c) => c.after);
	expect(syncs().at(-1)).toBe(0);
	f.calls.length = 0;
	await f.service.send("room", "quick hello");
	// Sending reads the room's keys and roster only, never the message history.
	expect(syncs()).toEqual([Number.MAX_SAFE_INTEGER]);
	f.calls.length = 0;
	await f.service.sync("room");
	// Each refresh starts from the newest message already read: none yet, then the sent one.
	expect(syncs()).toEqual([0]);
	f.calls.length = 0;
	await f.service.sync("room");
	expect(syncs()).toEqual([1]);
	f.calls.length = 0;
	await f.service.remove("room", "sent");
	expect(syncs()).toEqual([Number.MAX_SAFE_INTEGER]);
});

it("queues chat work instead of refusing it while another operation runs", async () => {
	const f = fixture();
	await f.service.start("parent", "family");
	await f.service.open();
	const [, messages] = await Promise.all([f.service.send("room", "first"), f.service.sync("room")]);
	expect(Array.isArray(messages)).toBe(true);
	// A closed screen still fails queued work instead of running it for the wrong session.
	const late = f.service.sync("room");
	f.service.close();
	await expect(late).rejects.toThrow("Chat session ended");
});

it("keeps undecryptable messages marked while reading only new ones", async () => {
	const f = fixture();
	const service = chatService({
		...f.adapter,
		async native<T>(account: string, c: Record<string, unknown>): Promise<T> {
			if (c.action === "decrypt" && c.ciphertext === "CORRUPT") throw new Error("Bad message");
			return f.adapter.native<T>(account, c);
		},
	});
	await service.start("parent", "family");
	await service.open();
	f.message({ messageId: "bad", sequence: 3, ciphertext: "CORRUPT" });
	const first = await service.sync("room");
	expect(first.find((m) => m.messageId === "bad")?.unavailable).toBe(true);
	// Not fetched again, but still shown as unavailable.
	const again = await service.sync("room");
	expect(f.calls.filter((c) => c.action === "sync").at(-1)?.after).toBe(3);
	expect(again.find((m) => m.messageId === "bad")?.unavailable).toBe(true);
	f.message({ messageId: "bad", sequence: 4, deleted: true, ciphertext: undefined });
	const removed = await service.sync("room");
	expect(removed.some((m) => m.messageId === "bad")).toBe(false);
});
