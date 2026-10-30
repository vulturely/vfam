import { bootstrap, decodeSetup, encodeSetup } from "../../api/fambuddy/fambuddyBootstrap";
import { acquireFamBuddyRelay, famBuddyRecords } from "../../api/fambuddy/fambuddyStorage";
import { parentHeaders, relayClient, relayOrigin } from "../remote/client";
import { remoteCrypto, type Binding, type Peer, type RemotePair } from "../remote/crypto";
import { registryClient, type ParentConnection } from "./registry";

interface Setup extends ParentConnection {
	owner: string;
	registration: string;
	code: string;
}
export interface SavedRegisteredPair {
	registration: string;
	pair: RemotePair;
	token: string;
}
interface Invitation {
	id: string;
	device: string;
	expiresAt: number;
	bearer: string;
	bootstrapHash: string;
}
interface Response {
	version: number;
	registration: string;
	origin: string;
	binding: Binding;
	peer: Peer;
	welcome: string;
	token: string;
}
const uuid = (value: unknown): value is string =>
	typeof value === "string" &&
	/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value) &&
	value !== "00000000-0000-0000-0000-000000000000";
const hex = (value: unknown): value is string =>
	typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
function exact(value: unknown, fields: string[]): value is Record<string, unknown> {
	return (
		!!value &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Object.keys(value).length === fields.length &&
		fields.every((field) => Object.hasOwn(value, field))
	);
}
function invalid(): Error {
	return new Error("FamBuddy returned an invalid setup response.");
}
function base64(value: unknown, max: number): value is string {
	if (typeof value !== "string" || !value.length || value.length > max) return false;
	try {
		return encodeSetup(decodeSetup(value)) === value;
	} catch {
		return false;
	}
}
function response(
	value: unknown,
	setup: Setup,
	invite: Invitation,
	origin: string,
	channel: string,
): Response {
	if (
		!exact(value, ["version", "registration", "origin", "binding", "peer", "welcome", "token"]) ||
		value.version !== 1 ||
		value.registration !== setup.registration ||
		value.origin !== origin ||
		!exact(value.binding, ["channel", "family", "device"]) ||
		value.binding.channel !== channel ||
		value.binding.device !== invite.device ||
		!uuid(value.binding.family) ||
		!exact(value.peer, ["accountId", "deviceId", "fingerprint", "keyPackage"]) ||
		value.peer.accountId !== `fambuddy-device:${invite.device}:${channel}` ||
		!uuid(value.peer.deviceId) ||
		!hex(value.peer.fingerprint) ||
		!base64(value.peer.keyPackage, 16_384) ||
		!base64(value.welcome, 100_000) ||
		typeof value.token !== "string" ||
		!/^vrp_[0-9a-f]{64}$/.test(value.token)
	) {
		throw invalid();
	}
	return value as unknown as Response;
}
async function digest(value: string) {
	const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function credential() {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return `vfr_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function enrollRegistered(setup: Setup): Promise<SavedRegisteredPair> {
	setup.signal?.throwIfAborted();
	if (!uuid(setup.registration) || !setup.owner || setup.owner.length > 128) throw invalid();
	const origin = relayOrigin(setup.server);
	const records = famBuddyRecords(setup.server, setup.owner);
	const key = `registered:${setup.registration}`;
	let release: (() => Promise<void>) | undefined;
	const engine = remoteCrypto(origin);
	const controller = new AbortController();
	const abort = () => controller.abort();
	setup.signal?.addEventListener("abort", abort, { once: true });
	const channel = crypto.randomUUID();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let begun = false;
	let saveAttempted = false;
	try {
		release = await acquireFamBuddyRelay(origin, `enrollment:${setup.owner}:${setup.registration}`);
		setup.signal?.throwIfAborted();
		if ((await records.get(key)) !== null)
			throw new Error(
				"This FamBuddy is already paired on this app. Disconnect it before pairing again.",
			);
		const invite = await bootstrap<Invitation>({
			action: "parse",
			code: setup.code,
		});
		if (
			!uuid(invite.id) ||
			!uuid(invite.device) ||
			!hex(invite.bootstrapHash) ||
			!Number.isSafeInteger(invite.expiresAt) ||
			invite.expiresAt <= Date.now() ||
			invite.expiresAt > Date.now() + 600_000
		)
			throw invalid();
		timer = setTimeout(() => controller.abort(), invite.expiresAt - Date.now());
		const account = `fambuddy-parent:${setup.owner}:${channel}`;
		const own = await engine.identity(account);
		const secret = credential();
		const plaintext = encodeSetup(
			new TextEncoder().encode(
				JSON.stringify({
					version: 1,
					registration: setup.registration,
					channel,
					origin,
					credential: secret,
					peer: own,
				}),
			),
		);
		const sealed = await bootstrap<{ ciphertext: string }>({
			action: "seal",
			code: setup.code,
			direction: "request",
			plaintext,
		});
		const client = registryClient(origin);
		const request = {
			registration: setup.registration,
			invite: invite.id,
			device: invite.device,
			endpoint: own.deviceId,
			bootstrapHash: invite.bootstrapHash,
			channel,
			deviceHash: await digest(secret),
			request: new Uint8Array(decodeSetup(sealed.ciphertext)),
		};
		const headers = await parentHeaders(setup.auth);
		controller.signal.throwIfAborted();
		begun = true;
		await client.beginEnrollment(request, {
			headers,
			signal: controller.signal,
			timeoutMs: 10_000,
		});
		for await (const event of client.watchEnrollment(
			{ invite: invite.id },
			{
				headers: await parentHeaders(setup.auth),
				signal: controller.signal,
				timeoutMs: Math.max(1, invite.expiresAt - Date.now()),
			},
		) as AsyncIterable<{ response: Uint8Array }>) {
			controller.signal.throwIfAborted();
			if (!event.response.length) continue;
			const opened = await bootstrap<{ plaintext: string }>({
				action: "open",
				code: setup.code,
				direction: "response",
				ciphertext: encodeSetup(event.response),
			});
			let value: unknown;
			try {
				value = JSON.parse(
					new TextDecoder("utf-8", { fatal: true }).decode(decodeSetup(opened.plaintext)),
				);
			} catch {
				throw invalid();
			}
			const reply = response(value, setup, invite, origin, channel);
			const pair: RemotePair = {
				origin,
				account,
				own,
				peer: reply.peer,
				binding: reply.binding,
			};
			await engine.join(pair, reply.welcome);
			controller.signal.throwIfAborted();
			const result: SavedRegisteredPair = {
				registration: setup.registration,
				pair,
				token: reply.token,
			};
			saveAttempted = true;
			await records.put(key, result);
			controller.signal.throwIfAborted();
			await client.confirmEnrollment(
				{ invite: invite.id },
				{
					headers: await parentHeaders(setup.auth),
					signal: controller.signal,
					timeoutMs: 10_000,
				},
			);
			controller.signal.throwIfAborted();
			return result;
		}
		throw new Error("FamBuddy setup connection ended before confirmation.");
	} catch (cause) {
		let cleanupFailed = false;
		if (begun) {
			try {
				await relayClient(origin).revokeChannel(
					{ channel },
					{
						headers: await parentHeaders(setup.auth),
						timeoutMs: 5000,
					},
				);
			} catch {
				cleanupFailed = true;
			}
		}
		if (saveAttempted) {
			try {
				await records.deleteIf(key, "channel", channel);
			} catch {
				cleanupFailed = true;
			}
		}
		if (cleanupFailed)
			throw new Error(
				"Setup failed and cleanup could not be confirmed. Revoke this FamBuddy entry before retrying.",
				{ cause },
			);
		throw cause;
	} finally {
		controller.abort();
		if (timer) clearTimeout(timer);
		setup.signal?.removeEventListener("abort", abort);
		engine.close();
		await release?.();
	}
}
