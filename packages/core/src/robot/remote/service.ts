import { acquireFamBuddyRelay } from "../../api/fambuddy/fambuddyStorage";
import type { BuddyService, BuddyCommand, BuddyOutput } from "../buddy";
import { remoteOutput } from "./output";
import { parentHeaders, relayClient, type ParentAuth } from "./client";
import { remoteCrypto, type RemotePair } from "./crypto";
import { mediaSignaling, type MediaRequest, type MediaEvent } from "./media";
import { getMediaRelay } from "../onboarding/registry";
interface Reply {
	media?: MediaEvent;
	request?: string;
	output?: BuddyOutput;
	error?: string;
}
interface Pending {
	resolve: (value: BuddyOutput) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}
interface Connection {
	ready: boolean;
	signal: AbortSignal;
	pending: Map<string, Pending>;
}
export function createRemoteBuddy(
	pair: RemotePair,
	auth: ParentAuth,
	localToken: () => string,
	registration?: string,
): BuddyService {
	const client = relayClient(pair.origin);
	const engine = remoteCrypto(pair.origin);
	let active: Connection | undefined;
	async function publish(
		connection: Connection,
		command: BuddyCommand,
		watch = false,
		media?: MediaRequest,
	) {
		if (connection.signal.aborted) throw new Error("Remote connection ended.");
		const message = await engine.seal(pair, {
			token: localToken(),
			command,
			watch,
			...(media ? { media } : {}),
		});
		const headers = await parentHeaders(auth);
		return { ...message, headers };
	}
	async function send(command: BuddyCommand, media?: MediaRequest) {
		const connection = active;
		if (!connection?.ready || connection.signal.aborted)
			throw new Error("Reconnect remote approvals before continuing.");
		const message = await publish(connection, command, false, media);
		if (active !== connection || connection.signal.aborted)
			throw new Error("Remote connection ended; command was not sent.");
		const response = new Promise<BuddyOutput>((resolve, reject) => {
			const timer = setTimeout(() => {
				connection.pending.delete(message.id);
				reject(
					new Error(
						"Device did not confirm. Reconnect to check status; the command was not retried.",
					),
				);
			}, 25_000);
			connection.pending.set(message.id, { resolve, reject, timer });
		});
		// Attach rejection handling before the network call, which can outlive a timeout.
		const observed = response.catch((error: unknown) => {
			throw error;
		});
		void observed.catch(() => {});
		try {
			await client.publishEnvelope(
				{ channel: pair.binding.channel, ciphertext: new Uint8Array(message.ciphertext) },
				{
					headers: message.headers,
					signal: connection.signal,
					timeoutMs: 5000,
				},
			);
		} catch (error) {
			const pending = connection.pending.get(message.id);
			if (pending) {
				clearTimeout(pending.timer);
				connection.pending.delete(message.id);
				pending.reject(new Error("Device unavailable. Command was not retried."));
			}
			throw error;
		}
		return observed;
	}
	const signaling = mediaSignaling(send, pair.binding.family);
	return {
		liveTalkAvailable: !!registration,
		providerSettingsAvailable: true,
		async iceServers() {
			if (!registration) throw new Error("Register this device to enable outside-home live media.");
			const relay = await getMediaRelay({ server: pair.origin, auth }, registration);
			return [
				{
					urls: relay.urls,
					username: relay.username,
					credential: relay.credential,
				},
			];
		},
		openTalk(device, offer, signal, options) {
			if (!registration) throw new Error("Register this device to enable outside-home live media.");
			return signaling.open(device, offer, signal, options);
		},
		command: send,
		async *watch(family, signal) {
			if (family !== pair.binding.family) throw new Error("Remote household mismatch.");
			const release = await acquireFamBuddyRelay(pair.origin, pair.account);
			const connection: Connection = {
				ready: false,
				signal,
				pending: new Map(),
			};
			active = connection;
			try {
				signal.throwIfAborted();
				for await (const event of client.watchEnvelopes(
					{ channel: pair.binding.channel },
					{ headers: await parentHeaders(auth), signal, timeoutMs: 0 },
				) as AsyncIterable<{ ready?: boolean; ciphertext: Uint8Array }>) {
					if (event.ready) {
						const message = await publish(connection, { action: "list", family }, true);
						await client.publishEnvelope(
							{ channel: pair.binding.channel, ciphertext: new Uint8Array(message.ciphertext) },
							{ headers: message.headers, signal, timeoutMs: 5000 },
						);
						continue;
					}
					const reply = (await engine.open(pair, event.ciphertext)) as Reply;
					if (reply.media) signaling.receive(reply.media);
					const pending = reply.request ? connection.pending.get(reply.request) : undefined;
					if (pending && reply.request) {
						connection.pending.delete(reply.request);
						clearTimeout(pending.timer);
						if (reply.error || !reply.output)
							pending.reject(new Error(reply.error ?? "Invalid device response."));
						else pending.resolve(remoteOutput(reply.output));
					} else if (reply.error) {
						throw new Error(reply.error);
					}
					if (reply.output && !pending) {
						connection.ready = true;
						yield remoteOutput(reply.output);
					}
				}
			} finally {
				if (active === connection) {
					active = undefined;
					signaling.disconnect();
				}
				for (const pending of connection.pending.values()) {
					clearTimeout(pending.timer);
					pending.reject(new Error("Remote connection ended; no commands were retried."));
				}
				connection.pending.clear();
				await release();
			}
		},
	};
}
