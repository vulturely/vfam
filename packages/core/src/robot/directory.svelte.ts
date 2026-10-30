import { SvelteMap } from "svelte/reactivity";
import type { OidcAuth } from "../auth/oidc";
import type { ParentAuth } from "./remote/client";
import { famBuddyRecords } from "../api/fambuddy/fambuddyStorage";
import {
	createBuddyService,
	type BuddyCommand,
	type BuddyOutput,
	type BuddyService,
} from "./buddy";
import { RegisteredFamBuddy as Registration } from "../api/protocol";
import { enrollRegistered, type SavedRegisteredPair } from "./onboarding/enroll";
import {
	acknowledgeApproval,
	list,
	register as registerDevice,
	revoke as revokeDevice,
	type RegisteredFamBuddy,
} from "./onboarding/registry";
import { createRemoteBuddy } from "./remote/service";
import { relayOrigin } from "./remote/client";
import { answerIfParentDevice } from "./family-answer";
import type { FamilyAiService } from "../family-ai/service";

/** The FamBuddy paired on the home network, saved by the FamBuddy screen. */
export interface HomePairing {
	gateway: string;
	token: string;
	family: string;
	expires_at: string;
}

/** The session id of the home-network FamBuddy; registered ones use their registry id. */
export const HOME_BUDDY = "home";

export interface FamBuddySession {
	registration: RegisteredFamBuddy;
	pair?: SavedRegisteredPair;
	home?: HomePairing;
	service?: BuddyService;
	output: BuddyOutput;
	busy: boolean;
	error: string;
}

interface WatchLease {
	clients: number;
	controller: AbortController;
}

const emptyOutput = (): BuddyOutput => ({ settings: [], turns: [] });

function binding(session: FamBuddySession) {
	const value = session.pair?.pair?.binding;
	if (!value) throw new Error("Pair this FamBuddy before continuing.");
	return value;
}

function familyOf(session: FamBuddySession) {
	return session.home ? session.home.family : binding(session).family;
}

/** The device a conversation talks to: the paired one, or the home hub's first device. */
export function deviceOf(session: FamBuddySession) {
	return session.home
		? (session.output.settings[0]?.device ?? "")
		: (session.pair?.pair?.binding.device ?? "");
}

function message(cause: unknown, fallback: string) {
	return cause instanceof Error ? cause.message : fallback;
}

/** Waits before reconnecting a dropped live stream: 1 s, then longer, at most 30 s. */
const RECONNECT_DELAYS = [1_000, 2_000, 5_000, 10_000, 30_000];

function pause(ms: number, signal: AbortSignal) {
	return new Promise<void>((resolve) => {
		const stop = () => {
			clearTimeout(timer);
			resolve();
		};
		// A long outage retries many times; each wait lets go of its abort listener.
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", stop);
			resolve();
		}, ms);
		signal.addEventListener("abort", stop, { once: true });
	});
}

export function createFamBuddyDirectory(
	serverUrl: string,
	auth: ParentAuth & Partial<Pick<OidcAuth, "watchSessionBoundary">>,
	getOwner: () => string | undefined,
	familyAi?: Pick<FamilyAiService, "answer">,
) {
	const state = $state({
		sessions: [] as FamBuddySession[],
		loading: false,
		error: "",
	});
	const watchers = new SvelteMap<string, WatchLease>();
	/** Away-from-home access needs the family server on HTTPS port 443. */
	const available = (() => {
		try {
			relayOrigin(serverUrl);
			return true;
		} catch {
			return false;
		}
	})();
	let owner = "";
	let refreshing = false;

	function close() {
		for (const lease of watchers.values()) lease.controller.abort();
		watchers.clear();
		state.sessions = [];
		state.error = "";
		owner = "";
	}

	function currentOwner() {
		const next = getOwner();
		if (!next) throw new Error("Sign in to manage FamBuddy.");
		if (owner && owner !== next) close();
		owner = next;
		return owner;
	}

	function connect(registration: RegisteredFamBuddy, value: SavedRegisteredPair) {
		const ownerId = currentOwner();
		if (
			value.registration !== registration.id ||
			value.pair?.origin !== relayOrigin(serverUrl) ||
			value.pair?.own?.accountId !== value.pair?.account ||
			value.pair?.account !== `fambuddy-parent:${ownerId}:${value.pair?.binding?.channel}` ||
			!value.pair?.binding?.family ||
			!value.pair?.binding?.device ||
			!/^vrp_[0-9a-f]{64}$/.test(value.token)
		)
			throw new Error("Saved pairing is invalid. Revoke this device entry and pair it again.");
		return {
			pair: value,
			service: createRemoteBuddy(value.pair, auth, () => value.token, registration.id),
		};
	}

	function update(id: string, update: Partial<FamBuddySession>) {
		const index = state.sessions.findIndex((session) => session.registration.id === id);
		if (index >= 0) state.sessions[index] = { ...state.sessions[index], ...update };
	}

	async function restore(registration: RegisteredFamBuddy, previous?: FamBuddySession) {
		if (previous?.service) return { ...previous, registration };
		const session: FamBuddySession = previous ?? {
			registration,
			output: emptyOutput(),
			busy: false,
			error: "",
		};
		try {
			const value = await famBuddyRecords(serverUrl, currentOwner()).get<SavedRegisteredPair>(
				`registered:${registration.id}`,
			);
			if (value) Object.assign(session, connect(registration, value));
		} catch (cause) {
			session.error = message(cause, "Saved pairing could not be unlocked.");
		}
		return { ...session, registration };
	}

	async function restoreHome(previous?: FamBuddySession): Promise<FamBuddySession | undefined> {
		const saved = await famBuddyRecords(serverUrl, currentOwner()).get<HomePairing>("pairing");
		if (!saved || !(Date.parse(saved.expires_at) > Date.now())) return undefined;
		if (previous?.home?.token === saved.token) return previous;
		return {
			registration: new Registration({ id: HOME_BUDDY, name: "FamBuddy at home" }),
			home: saved,
			service: createBuddyService(saved.gateway, { getAccessToken: async () => saved.token }),
			output: emptyOutput(),
			busy: false,
			error: "",
		};
	}

	async function refresh() {
		if (refreshing) return;
		refreshing = true;
		state.loading = true;
		state.error = "";
		try {
			const ownerId = currentOwner();
			const home = await restoreHome(state.sessions.find((item) => item.home)).catch(
				() => undefined,
			);
			// Without a reachable family server there are no registered devices; this is not an error.
			const registrations = available ? await list({ server: serverUrl, auth }) : [];
			if (ownerId !== currentOwner()) return;
			const sessions = await Promise.all(
				registrations.map((registration) =>
					restore(
						registration,
						state.sessions.find((item) => item.registration.id === registration.id),
					),
				),
			);
			for (const id of watchers.keys()) {
				if (
					!registrations.some((registration) => registration.id === id) &&
					!(home && id === HOME_BUDDY)
				) {
					watchers.get(id)?.controller.abort();
					watchers.delete(id);
				}
			}
			state.sessions = home ? [home, ...sessions] : sessions;
		} catch (cause) {
			state.error = message(cause, "Unable to load FamBuddy devices.");
		} finally {
			state.loading = false;
			refreshing = false;
		}
	}

	async function acquire(id: string) {
		const session = state.sessions.find((item) => item.registration.id === id);
		if (!session?.service || !(session.pair || session.home))
			throw new Error("Pair this FamBuddy before continuing.");
		const existing = watchers.get(id);
		if (existing) {
			existing.clients++;
			return;
		}
		const controller = new AbortController();
		const lease = { clients: 1, controller };
		watchers.set(id, lease);
		const service = session.service;
		const family = familyOf(session);
		const current = () => !controller.signal.aborted && watchers.get(id) === lease;
		// A dropped live stream reconnects on its own, waiting longer after each failure in a row.
		void (async () => {
			let failures = 0;
			let reconnecting = "";
			while (current()) {
				try {
					for await (const output of service.watch(family, controller.signal)) {
						if (!current()) break;
						failures = 0;
						const stale =
							state.sessions.find((item) => item.registration.id === id)?.error === reconnecting;
						update(id, reconnecting && stale ? { output, error: "" } : { output });
						reconnecting = "";
					}
					if (current()) throw new Error("Device connection ended.");
				} catch (cause) {
					if (!current()) break;
					reconnecting = `${message(cause, "Device disconnected.")} Reconnecting…`;
					update(id, { error: reconnecting });
					await pause(
						RECONNECT_DELAYS[Math.min(failures++, RECONNECT_DELAYS.length - 1)],
						controller.signal,
					);
				}
			}
			if (watchers.get(id) === lease) watchers.delete(id);
		})();
	}

	function release(id: string) {
		const lease = watchers.get(id);
		if (!lease) return;
		lease.clients--;
		if (lease.clients <= 0) {
			lease.controller.abort();
			watchers.delete(id);
		}
	}

	/** A guardian saw a waiting approval: the family server then does not email about it. */
	async function acknowledge(id: string, turn: string) {
		if (id === HOME_BUDDY) return;
		await acknowledgeApproval({ server: serverUrl, auth }, id, turn);
	}

	async function command(id: string, input: BuddyCommand) {
		const session = state.sessions.find((item) => item.registration.id === id);
		if (!session?.service || !(session.pair || session.home))
			throw new Error("Pair this FamBuddy before continuing.");
		update(id, { busy: true, error: "" });
		try {
			const sent = await session.service.command(input);
			// Acting on a review means it was seen.
			if (["approve", "edit", "cancel"].includes(input.action) && "turn" in input)
				void acknowledge(id, input.turn).catch(() => {});
			const service = session.service;
			const response =
				input.action === "approve" || input.action === "revise"
					? await answerIfParentDevice(sent, input, familyAi, (next) => service.command(next))
					: sent;
			update(id, { output: response });
			if (input.action !== "list") {
				const latest = await session.service.command({
					action: "list",
					family: familyOf(session),
				});
				update(id, { output: latest });
			}
			return response;
		} catch (cause) {
			const error = message(cause, "FamBuddy unavailable.");
			update(id, { error });
			throw cause;
		} finally {
			update(id, { busy: false });
		}
	}

	/**
	 * The devices a paired FamBuddy controls: the paired one away from home, or every
	 * device of the home-network hub (read from the hub when not yet watched).
	 */
	async function devices(id: string) {
		const session = state.sessions.find((item) => item.registration.id === id);
		if (!session?.service || !(session.pair || session.home))
			throw new Error("Pair this FamBuddy before continuing.");
		if (!session.home) return [deviceOf(session)];
		const output = session.output.settings.length
			? session.output
			: await session.service.command({ action: "list", family: familyOf(session) });
		return output.settings.map((item) => item.device);
	}

	auth.watchSessionBoundary?.(close);

	return {
		available,
		get sessions() {
			return state.sessions;
		},
		get loading() {
			return state.loading;
		},
		get error() {
			return state.error;
		},
		session(id: string) {
			return state.sessions.find((session) => session.registration.id === id);
		},
		refresh,
		async register(name: string) {
			const registration = await registerDevice({ server: serverUrl, auth }, name);
			await refresh();
			return registration;
		},
		async pair(id: string, code: string) {
			const registration = state.sessions.find((item) => item.registration.id === id)?.registration;
			if (!registration) throw new Error("Choose a registered FamBuddy.");
			const value = await enrollRegistered({
				server: serverUrl,
				auth,
				owner: currentOwner(),
				registration: id,
				code,
			});
			const connected = connect(registration, value);
			update(id, { ...connected, error: "" });
		},
		async revoke(id: string) {
			const session = state.sessions.find((item) => item.registration.id === id);
			await revokeDevice({ server: serverUrl, auth }, id);
			if (session?.pair) {
				await famBuddyRecords(serverUrl, currentOwner()).deleteIf(
					`registered:${id}`,
					"channel",
					binding(session).channel,
				);
			}
			watchers.get(id)?.controller.abort();
			watchers.delete(id);
			state.sessions = state.sessions.filter((item) => item.registration.id !== id);
		},
		acquire,
		release,
		acknowledge,
		command,
		devices,
		async broadcast(text: string) {
			const sessions = state.sessions.filter(
				(session) => (session.pair || session.home) && deviceOf(session),
			);
			const results = await Promise.allSettled(
				sessions.map((session) =>
					command(session.registration.id, {
						action: "announce",
						device: deviceOf(session),
						text,
					}),
				),
			);
			const failed = results.filter((result) => result.status === "rejected").length;
			if (failed) throw new Error(`Message was not delivered to ${failed} FamBuddy device(s).`);
		},
		close,
	};
}

export type FamBuddyDirectory = ReturnType<typeof createFamBuddyDirectory>;
