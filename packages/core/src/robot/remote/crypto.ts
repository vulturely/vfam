import { famBuddyCrypto } from "../../api/fambuddy/fambuddyStorage";
export interface Peer {
	accountId: string;
	deviceId: string;
	fingerprint: string;
	keyPackage: string;
}
export interface Binding {
	channel: string;
	family: string;
	device: string;
}
export interface RemotePair {
	binding: Binding;
	origin: string;
	account: string;
	own: Peer;
	peer: Peer;
}
interface Identity {
	deviceId: string;
	fingerprint: string;
	keyPackages: string[];
}
interface Envelope {
	version: number;
	binding: Binding;
	id: string;
	expires_at: number;
	payload: unknown;
}
function encode(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}
function decode(value: string): Uint8Array {
	return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
export function remoteCrypto(origin: string) {
	// Both native and browser adapters isolate FamBuddy from family-chat keys.
	const engine = famBuddyCrypto(origin);
	return {
		close: () => engine.close(),
		async identity(account: string): Promise<Peer> {
			const identity = await engine.execute<Identity>(account, {
				action: "identity",
			});
			return {
				accountId: account,
				deviceId: identity.deviceId,
				fingerprint: identity.fingerprint,
				keyPackage: identity.keyPackages[0],
			};
		},
		async join(pair: RemotePair, welcome: string) {
			await engine.execute(pair.account, {
				action: "join",
				roomId: pair.binding.channel,
				generation: 1,
				roster: [pair.own, pair.peer],
				welcome,
			});
		},
		async seal(pair: RemotePair, payload: unknown) {
			const id = crypto.randomUUID();
			const envelope: Envelope = {
				version: 1,
				binding: pair.binding,
				id,
				expires_at: Date.now() + 30_000,
				payload,
			};
			const plaintext = JSON.stringify(envelope);
			if (new TextEncoder().encode(plaintext).length > 100_000)
				throw new Error("Remote request is too large.");
			const result = await engine.execute<{ ciphertext: string }>(pair.account, {
				action: "encrypt",
				roomId: pair.binding.channel,
				generation: 1,
				plaintext,
			});
			return { id, ciphertext: decode(result.ciphertext) };
		},
		async open(pair: RemotePair, ciphertext: Uint8Array): Promise<unknown> {
			if (!ciphertext.length || ciphertext.length > 131_072)
				throw new Error("Invalid encrypted response.");
			const result = await engine.execute<{
				plaintext: string;
				senderId: string;
				deviceId: string;
			}>(pair.account, {
				action: "decrypt",
				roomId: pair.binding.channel,
				generation: 1,
				ciphertext: encode(ciphertext),
			});
			if (result.senderId !== pair.peer.accountId || result.deviceId !== pair.peer.deviceId)
				throw new Error("Unrecognized FamBuddy key.");
			const envelope = JSON.parse(result.plaintext) as Envelope;
			const now = Date.now();
			if (
				!envelope ||
				envelope.version !== 1 ||
				!envelope.binding ||
				typeof envelope.id !== "string" ||
				!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(envelope.id) ||
				!Number.isSafeInteger(envelope.expires_at) ||
				envelope.binding.channel !== pair.binding.channel ||
				envelope.binding.device !== pair.binding.device ||
				envelope.binding.family !== pair.binding.family ||
				envelope.expires_at <= now ||
				envelope.expires_at > now + 35_000
			)
				throw new Error("Remote response expired or has an invalid device binding.");
			return envelope.payload;
		},
	};
}
