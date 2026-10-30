import { createChatAdapter, type ChatAdapter } from "../api/chat/chatApi";
import type { OidcAuth } from "../auth/oidc";

export interface ChatDevice {
	deviceId: string;
	accountId: string;
	fingerprint: string;
	approved: boolean;
	revoked: boolean;
	keyPackages?: string[];
	keyPackage?: string;
}
export interface ChatRoom {
	name?: string | null;
	roomId: string;
	participants: string[];
}
export interface ChatPayload {
	text: string;
	richText?: string;
	attachment?: {
		name: string;
		mediaType: string;
		objectKey: string;
		key: string;
		iv: string;
	};
}
export interface ChatMessage {
	messageId: string;
	clientId: string;
	sequence: number;
	generation: number;
	deviceId: string;
	accountId: string;
	createdAt: number;
	deleted: boolean;
	ciphertext?: string;
	payload?: ChatPayload;
	unavailable?: boolean;
}
interface Identity {
	deviceId: string;
	fingerprint: string;
	keyPackages: string[];
}
interface Generation {
	generation: number;
	roster: ChatDevice[];
	welcomes: { deviceId: string; ciphertext: string }[];
}
interface Snapshot extends Generation {
	revision: number;
	initialized: boolean;
	participants?: string[];
	name?: string | null;
	messages: ChatMessage[];
	generations?: Generation[];
	hasMore?: boolean;
}
export interface ChatStatus {
	identity: Identity;
	devices: ChatDevice[];
	rooms: ChatRoom[];
	pins: Record<string, string>;
}
export interface ChatService {
	start(accountId: string, familyId: string): Promise<ChatStatus>;
	approve(device: ChatDevice): Promise<void>;
	revoke(deviceId: string): Promise<void>;
	open(peerAccountId?: string): Promise<ChatRoom>;
	createChannel(name: string, participantAccountIds: string[]): Promise<ChatRoom>;
	renameChannel(roomId: string, name: string): Promise<ChatRoom>;
	addChannelMember(roomId: string, accountId: string): Promise<ChatRoom>;
	deleteChannel(roomId: string): Promise<void>;
	refreshRooms(): Promise<ChatRoom[]>;
	sync(roomId: string): Promise<ChatMessage[]>;
	subscribe(listener: () => void): () => void;
	downloadAttachment(attachment: NonNullable<ChatPayload["attachment"]>): Promise<Uint8Array>;
	send(
		roomId: string,
		text: string,
		file?: File,
		onUploadProgress?: (progress: number) => void,
		richTextJson?: string,
	): Promise<void>;
	remove(roomId: string, messageId: string): Promise<void>;
	discardPending(roomId: string): Promise<void>;
	notify(requestPermission?: boolean): Promise<void>;
	/** Opens the chat connection as the app loads, so chat is ready when opened. */
	connect(): Promise<void>;
	/** Stops this screen's chat work; the shared connection stays open. */
	close(): void;
	/** Ends chat for the session: closes the screen's work and the shared connection. */
	disconnect(): void;
}
function encodeBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}
function decodeBase64(value: string): Uint8Array {
	return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function imageForUpload(file: File) {
	if (
		!file.type.startsWith("image/") ||
		file.type === "image/gif" ||
		typeof createImageBitmap === "undefined"
	)
		return {
			bytes: new Uint8Array(await file.arrayBuffer()),
			name: file.name,
			mediaType: file.type || "application/octet-stream",
		};
	try {
		const image = await createImageBitmap(file);
		const scale = Math.min(1, 1920 / Math.max(image.width, image.height));
		const canvas = document.createElement("canvas");
		canvas.width = Math.round(image.width * scale);
		canvas.height = Math.round(image.height * scale);
		const context = canvas.getContext("2d");
		if (!context) {
			image.close();
			return {
				bytes: new Uint8Array(await file.arrayBuffer()),
				name: file.name,
				mediaType: file.type || "application/octet-stream",
			};
		}
		context.drawImage(image, 0, 0, canvas.width, canvas.height);
		image.close();
		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, "image/webp", 0.82),
		);
		if (!blob || blob.size >= file.size)
			return {
				bytes: new Uint8Array(await file.arrayBuffer()),
				name: file.name,
				mediaType: file.type || "application/octet-stream",
			};
		const name = /\.[^.]+$/.test(file.name)
			? file.name.replace(/\.[^.]+$/, ".webp")
			: `${file.name}.webp`;
		return {
			bytes: new Uint8Array(await blob.arrayBuffer()),
			name,
			mediaType: "image/webp",
		};
	} catch {
		return {
			bytes: new Uint8Array(await file.arrayBuffer()),
			name: file.name,
			mediaType: file.type || "application/octet-stream",
		};
	}
}
export function createChatService(serverUrl: string, auth: OidcAuth): ChatService {
	const service = chatService(createChatAdapter(serverUrl, auth));
	auth.watchSessionBoundary(() => service.disconnect());
	return service;
}
/** The UI receives plaintext only after the shared MLS engine authenticates it. */
export function chatService(adapter: ChatAdapter): ChatService {
	let context: { accountId: string; familyId: string; identity: Identity } | undefined;
	let epoch = 0;
	// Chat operations run one at a time, in the order they were asked for.
	let queue = Promise.resolve();
	const roomParticipants = new Map<string, string[]>();
	// The last server sequence each room was read up to this session, and the messages
	// that could not be decrypted, so later reads fetch only what is new.
	const cursors = new Map<string, { after: number; unavailable: Map<string, ChatMessage> }>();
	/** Sync without messages: enough to read the room's key generation and roster. */
	const NO_MESSAGES = Number.MAX_SAFE_INTEGER;
	function current() {
		if (!context) throw new Error("Open chat on this device first.");
		return context;
	}
	async function native<T>(command: Record<string, unknown>): Promise<T> {
		const ticket = epoch;
		const startedAt = performance.now();
		const value = await adapter.native<T>(current().accountId, command);
		if (ticket !== epoch) throw new Error("Chat session ended.");
		if (import.meta.env.DEV)
			console.debug("[chat-ui] local crypto", {
				action: command.action,
				durationMs: Math.round(performance.now() - startedAt),
			});
		return value;
	}
	async function nativeBatch<T>(commands: Record<string, unknown>[]): Promise<T[]> {
		if (!commands.length) return [];
		const c = current();
		const ticket = epoch;
		const startedAt = performance.now();
		let values: T[];
		if (adapter.nativeBatch) {
			values = await adapter.nativeBatch<T>(c.accountId, commands);
		} else {
			values = [];
			for (const command of commands) values.push(await native<T>(command));
		}
		if (ticket !== epoch) throw new Error("Chat session ended.");
		if (import.meta.env.DEV)
			console.debug("[chat-ui] local crypto batch", {
				actions: commands.map((command) => command.action),
				count: commands.length,
				durationMs: Math.round(performance.now() - startedAt),
			});
		return values;
	}
	async function remote<T>(command: Record<string, unknown>): Promise<T> {
		const c = current();
		const ticket = epoch;
		const value = await adapter.remote<T>({
			familyId: c.familyId,
			deviceId: c.identity.deviceId,
			...command,
		});
		if (ticket !== epoch) throw new Error("Chat session ended.");
		return value;
	}
	async function pins(): Promise<Record<string, string>> {
		const value = await native<{ pins: Record<string, string> }>({
			action: "pins",
			familyId: current().familyId,
		});
		return value.pins;
	}
	// Trust on first use through the authenticated family relay. Never silently
	// replace a stored key; independent out-of-band verification is not claimed.
	async function rememberApproved(roster: ChatDevice[]) {
		const known = await pins();
		for (const device of roster) {
			if (!device.approved || device.revoked || known[device.deviceId]) continue;
			if (!/^[a-f0-9]{64}$/i.test(device.fingerprint))
				throw new Error("A family device returned an invalid security key.");
			await native({
				action: "pin",
				familyId: current().familyId,
				deviceId: device.deviceId,
				fingerprint: device.fingerprint,
			});
			known[device.deviceId] = device.fingerprint;
		}
		return known;
	}
	async function trusted(roster: ChatDevice[], roomId: string) {
		const participants = roomParticipants.get(roomId);
		if (!participants) throw new Error("Select this conversation before synchronizing it.");
		if (participants.length && roster.some((d) => !participants.includes(d.accountId)))
			throw new Error("The server returned a device outside this private conversation.");
		if (roster.some((device) => !device.approved || device.revoked))
			throw new Error("A device is not approved for family chat.");
		const known = await rememberApproved(roster);
		if (roster.some((d) => known[d.deviceId] !== d.fingerprint)) {
			throw new Error(
				"A known device’s security key changed. Chat is paused. Revoke that device and register a replacement using a new browser profile or device.",
			);
		}
	}
	async function join(roomId: string, generation: Generation) {
		await trusted(generation.roster, roomId);
		const group = await native<{
			exists: boolean;
			initializerWelcome?: string;
		}>({
			action: "exists",
			roomId,
			generation: generation.generation,
		});
		const welcome = generation.welcomes.find((w) => w.deviceId === current().identity.deviceId);
		if (group.exists) {
			if (!group.initializerWelcome || group.initializerWelcome === welcome?.ciphertext) return;
			// A durable local candidate may have lost the initialization CAS while
			// offline. Compare the relay's committed welcome before replacing it.
			await native({
				action: "dropGroup",
				roomId,
				generation: generation.generation,
			});
		}
		if (!welcome) return;
		await native({
			action: "join",
			roomId,
			generation: generation.generation,
			welcome: welcome.ciphertext,
			roster: generation.roster,
		});
	}
	async function prepare(roomId: string, after = 0): Promise<Snapshot> {
		let snapshot = await remote<Snapshot>({ action: "sync", roomId, after });
		if (snapshot.participants) roomParticipants.set(roomId, snapshot.participants);
		if (!snapshot.initialized) {
			await trusted(snapshot.roster, roomId);
			const created = await native<{
				welcomes: { deviceId: string; ciphertext: string }[];
			}>({
				action: "create",
				roomId,
				generation: snapshot.generation,
				roster: snapshot.roster,
			});
			try {
				await remote({
					action: "initialize",
					roomId,
					generation: snapshot.generation,
					revision: snapshot.revision,
					welcomes: created.welcomes,
				});
			} catch (error) {
				// A failed response may follow a committed initialization. Preserve the
				// creator's only private state until the relay confirms another winner.
				const committed = await remote<Snapshot>({
					action: "sync",
					roomId,
					after: 0,
				});
				if (!committed.initialized || committed.generation !== snapshot.generation) throw error;
				const own = current().identity.deviceId;
				if (
					committed.welcomes.find((w) => w.deviceId === own)?.ciphertext !==
					created.welcomes.find((w) => w.deviceId === own)?.ciphertext
				) {
					await native({
						action: "dropGroup",
						roomId,
						generation: snapshot.generation,
					});
				}
			}
			snapshot = await remote<Snapshot>({ action: "sync", roomId, after });
		}
		await join(roomId, snapshot);
		return snapshot;
	}
	async function exclusive<T>(operation: () => Promise<T>): Promise<T> {
		const ticket = epoch;
		const previous = queue;
		let release!: () => void;
		queue = new Promise<void>((resolve) => {
			release = resolve;
		});
		try {
			await previous;
			if (ticket !== epoch) throw new Error("Chat session ended.");
			const result = await operation();
			if (ticket !== epoch) throw new Error("Chat session ended.");
			return result;
		} finally {
			release();
		}
	}
	async function deliver(
		roomId: string,
		item: {
			generation: number;
			clientId: string;
			ciphertext: string;
			plaintext?: string;
		},
	) {
		const message = await remote<ChatMessage>({
			action: "send",
			roomId,
			generation: item.generation,
			clientId: item.clientId,
			ciphertext: item.ciphertext,
		});
		if (item.plaintext) {
			await native({
				action: "cacheAndAck",
				roomId,
				clientId: item.clientId,
				message: {
					...message,
					id: message.messageId,
					ciphertext: undefined,
					payload: JSON.parse(item.plaintext) as ChatPayload,
				},
			});
		} else {
			await native({ action: "ack", roomId, clientId: item.clientId });
		}
	}
	function closeScreen() {
		epoch++;
		adapter.close?.();
		context = undefined;
		roomParticipants.clear();
		cursors.clear();
	}
	return {
		async start(accountId, familyId) {
			return exclusive(async () => {
				const ticket = epoch;
				if (context?.accountId !== accountId || context?.familyId !== familyId) {
					roomParticipants.clear();
					cursors.clear();
				}
				context = undefined;
				let identity: Identity;
				try {
					identity = await adapter.native<Identity>(accountId, {
						action: "identity",
					});
				} catch {
					throw new Error(
						"Encrypted chat could not start on this device. Use HTTPS and allow secure browser storage, or retry in the desktop app.",
					);
				}
				if (ticket !== epoch) throw new Error("Chat session ended.");
				context = { accountId, familyId, identity };
				await native({
					action: "pin",
					familyId,
					deviceId: identity.deviceId,
					fingerprint: identity.fingerprint,
				});
				await remote({ action: "enroll", ...identity });
				const roster = await remote<{ devices: ChatDevice[] }>({
					action: "roster",
				});
				const pins = await rememberApproved(roster.devices);
				const rooms = await remote<{ rooms: ChatRoom[] }>({ action: "rooms" });
				for (const room of rooms.rooms) roomParticipants.set(room.roomId, room.participants);
				return {
					identity,
					devices: roster.devices,
					rooms: rooms.rooms,
					pins,
				};
			});
		},
		async approve(device) {
			return exclusive(async () => {
				const roster = await remote<{ devices: ChatDevice[] }>({
					action: "roster",
				});
				const currentDevice = roster.devices.find(
					(item) =>
						item.deviceId === device.deviceId &&
						item.accountId === device.accountId &&
						item.fingerprint === device.fingerprint &&
						!item.revoked,
				);
				if (!currentDevice) throw new Error("Device security changed. Reload before approving it.");
				const known = await pins();
				if (known[device.deviceId] && known[device.deviceId] !== device.fingerprint)
					throw new Error(
						"A known device’s security key changed. Revoke it and register a replacement.",
					);
				if (!currentDevice.approved)
					await remote({
						action: "approve",
						deviceId: device.deviceId,
						fingerprint: device.fingerprint,
					});
				await rememberApproved([{ ...currentDevice, approved: true }]);
			});
		},
		async revoke(deviceId) {
			return exclusive(async () => {
				await remote({ action: "revoke", deviceId });
			});
		},
		async open(peerAccountId) {
			return exclusive(async () => {
				const room = await remote<{ roomId: string }>({
					action: "open",
					peerAccountId,
				});
				const participants = peerAccountId ? [current().accountId, peerAccountId] : [];
				roomParticipants.set(room.roomId, participants);
				return { ...room, participants };
			});
		},
		async createChannel(name, participantAccountIds) {
			return exclusive(async () => {
				const room = await remote<ChatRoom>({
					action: "createChannel",
					name: name.trim(),
					participantAccountIds,
				});
				roomParticipants.set(room.roomId, room.participants);
				return room;
			});
		},
		async renameChannel(roomId, name) {
			return exclusive(async () => {
				const room = await remote<ChatRoom>({
					action: "channelRename",
					roomId,
					name: name.trim(),
				});
				roomParticipants.set(room.roomId, room.participants);
				return room;
			});
		},
		async addChannelMember(roomId, accountId) {
			return exclusive(async () => {
				const room = await remote<ChatRoom>({
					action: "channelAddMember",
					roomId,
					accountId,
				});
				roomParticipants.set(room.roomId, room.participants);
				return room;
			});
		},
		async deleteChannel(roomId) {
			return exclusive(async () => {
				await remote({ action: "channelDelete", roomId });
				roomParticipants.delete(roomId);
			});
		},
		async refreshRooms() {
			return exclusive(async () => {
				const result = await remote<{ rooms: ChatRoom[] }>({ action: "rooms" });
				for (const [roomId, participants] of roomParticipants) {
					if (!result.rooms.some((room) => room.roomId === roomId)) roomParticipants.delete(roomId);
					else if (!participants.length) {
						const room = result.rooms.find((item) => item.roomId === roomId);
						if (room) roomParticipants.set(roomId, room.participants);
					}
				}
				for (const room of result.rooms) roomParticipants.set(room.roomId, room.participants);
				return result.rooms;
			});
		},
		async sync(roomId) {
			return exclusive(async () => {
				const seen = cursors.get(roomId) ?? { after: 0, unavailable: new Map() };
				let snapshot = await prepare(roomId, seen.after);
				for (const generation of snapshot.generations ?? []) await join(roomId, generation);
				const pending = await native<{
					messages: {
						generation: number;
						clientId: string;
						ciphertext: string;
						plaintext?: string;
					}[];
				}>({ action: "outbox", roomId });
				if (pending.messages.some((item) => item.generation !== snapshot.generation)) {
					throw new Error(
						"Unsent messages belong to an earlier device-key generation. Discard unsent messages to continue; their text was not sent to the new group.",
					);
				}
				for (const item of pending.messages) {
					if (item.generation === snapshot.generation) await deliver(roomId, item);
				}
				const history = await native<{ messages: ChatMessage[] }>({
					action: "history",
					roomId,
				});
				const byId = new Map(history.messages.map((m) => [m.messageId, m]));
				// Messages read earlier that could not be decrypted stay shown as unavailable.
				for (const [id, message] of seen.unavailable) if (!byId.has(id)) byId.set(id, message);
				const remoteMessages: ChatMessage[] = [];
				let page = snapshot.messages;
				while (page.length) {
					remoteMessages.push(...page);
					if (page.length < 100 && !snapshot.hasMore) break;
					snapshot = await remote<Snapshot>({
						action: "sync",
						roomId,
						after: page.at(-1)!.sequence,
					});
					page = snapshot.messages;
				}
				const undecrypted: ChatMessage[] = [];
				for (const message of remoteMessages) {
					if (message.deleted) {
						byId.delete(message.messageId);
						seen.unavailable.delete(message.messageId);
						await native({
							action: "purge",
							roomId,
							ids: [message.messageId],
						});
					} else if (!byId.has(message.messageId)) undecrypted.push(message);
				}
				const results = new Map<string, { plaintext: string } | undefined>();
				const decryptIndividually = async () => {
					for (const message of undecrypted) {
						try {
							results.set(
								message.messageId,
								await native<{ plaintext: string }>({
									action: "decrypt",
									roomId,
									generation: message.generation,
									ciphertext: message.ciphertext,
									message,
								}),
							);
						} catch {
							results.set(message.messageId, undefined);
						}
					}
				};
				if (adapter.nativeBatch && undecrypted.length > 1) {
					const byGeneration = new Map<number, ChatMessage[]>();
					for (const message of undecrypted) {
						const group = byGeneration.get(message.generation) ?? [];
						group.push(message);
						byGeneration.set(message.generation, group);
					}
					const batchCommands = [...byGeneration].map(([generation, messages]) => ({
						action: "decryptBatch",
						roomId,
						generation,
						messages: messages.map(({ ciphertext, ...message }) => ({
							ciphertext,
							message,
						})),
					}));
					try {
						const batches = await nativeBatch<{
							messages: { plaintext: string }[];
						}>(batchCommands);
						[...byGeneration.values()].forEach((messages, groupIndex) => {
							messages.forEach((message, messageIndex) => {
								results.set(message.messageId, batches[groupIndex]?.messages[messageIndex]);
							});
						});
					} catch {
						// Browser batches commit atomically. Fall back per message so one
						// corrupt item cannot hide valid later messages.
						await decryptIndividually();
					}
				} else {
					await decryptIndividually();
				}
				undecrypted.forEach((message) => {
					const plaintext = results.get(message.messageId)?.plaintext;
					if (!plaintext) {
						const marker = { ...message, ciphertext: undefined, unavailable: true };
						byId.set(message.messageId, marker);
						seen.unavailable.set(message.messageId, marker);
						return;
					}
					try {
						const payload = JSON.parse(plaintext) as ChatPayload;
						// Browser batch decrypt already persisted verified plaintext and
						// MLS ratchet state together. Avoid another vault write per message.
						byId.set(message.messageId, {
							...message,
							ciphertext: undefined,
							payload,
						});
					} catch {
						const marker = { ...message, ciphertext: undefined, unavailable: true };
						byId.set(message.messageId, marker);
						seen.unavailable.set(message.messageId, marker);
					}
				});
				// Next time, only messages after the newest one read so far are fetched.
				seen.after = remoteMessages.reduce(
					(latest, message) => Math.max(latest, message.sequence),
					seen.after,
				);
				cursors.set(roomId, seen);
				return [...byId.values()].sort((a, b) => a.sequence - b.sequence);
			});
		},
		subscribe(listener) {
			return adapter.subscribe?.(current().familyId, listener) ?? (() => {});
		},
		async downloadAttachment(attachment) {
			const c = current();
			if (!adapter.downloadAttachment) throw new Error("Chat attachment download is unavailable.");
			const ciphertext = await adapter.downloadAttachment(c.familyId, attachment.objectKey);
			const plaintext = await crypto.subtle.decrypt(
				{ name: "AES-GCM", iv: new Uint8Array(decodeBase64(attachment.iv)) },
				await crypto.subtle.importKey(
					"raw",
					new Uint8Array(decodeBase64(attachment.key)),
					"AES-GCM",
					false,
					["decrypt"],
				),
				new Uint8Array(ciphertext),
			);
			return new Uint8Array(plaintext);
		},
		async send(roomId, text, file, onUploadProgress, richTextJson) {
			return exclusive(async () => {
				const snapshot = await prepare(roomId, NO_MESSAGES);
				const payload: ChatPayload = {
					text: text.trim(),
					...(richTextJson && text.trim() ? { richText: richTextJson } : {}),
				};
				if (file) {
					const upload = await imageForUpload(file);
					const key = crypto.getRandomValues(new Uint8Array(32));
					const iv = crypto.getRandomValues(new Uint8Array(12));
					const encryptionKey = await crypto.subtle.importKey("raw", key, "AES-GCM", false, [
						"encrypt",
					]);
					const ciphertext = new Uint8Array(
						await crypto.subtle.encrypt({ name: "AES-GCM", iv }, encryptionKey, upload.bytes),
					);
					if (!adapter.uploadAttachment) throw new Error("Chat attachment upload is unavailable.");
					const objectKey = await adapter.uploadAttachment(
						current().familyId,
						ciphertext,
						onUploadProgress,
					);
					payload.attachment = {
						name: upload.name,
						mediaType: upload.mediaType,
						objectKey,
						key: encodeBase64(key),
						iv: encodeBase64(iv),
					};
				}
				const plaintext = JSON.stringify(payload);
				const queued = await native<{
					messages: {
						generation: number;
						clientId: string;
						ciphertext: string;
						plaintext?: string;
					}[];
				}>({ action: "outbox", roomId });
				const retry = queued.messages.find(
					(item) => item.generation === snapshot.generation && item.plaintext === plaintext,
				);
				if (retry) {
					await deliver(roomId, retry);
					return;
				}
				const clientId = crypto.randomUUID();
				const encrypted = await native<{ ciphertext: string }>({
					action: "encrypt",
					roomId,
					generation: snapshot.generation,
					plaintext,
					clientId,
				});
				await deliver(roomId, {
					generation: snapshot.generation,
					clientId,
					ciphertext: encrypted.ciphertext,
					plaintext,
				});
			});
		},
		async remove(roomId, messageId) {
			return exclusive(async () => {
				const snapshot = await prepare(roomId, NO_MESSAGES);
				await remote({
					action: "delete",
					roomId,
					generation: snapshot.generation,
					messageId,
				});
				await native({ action: "purge", roomId, ids: [messageId] });
			});
		},
		async connect() {
			await adapter.connect?.();
		},
		close: closeScreen,
		disconnect() {
			closeScreen();
			void adapter.disconnect?.().catch(() => {});
		},
		async discardPending(roomId) {
			return exclusive(async () => {
				const pending = await native<{ messages: { clientId: string }[] }>({
					action: "outbox",
					roomId,
				});
				for (const item of pending.messages)
					await native({ action: "ack", roomId, clientId: item.clientId });
			});
		},
		async notify(requestPermission = false) {
			await native({
				action: requestPermission ? "notification_permission" : "notify",
			});
		},
	};
}
