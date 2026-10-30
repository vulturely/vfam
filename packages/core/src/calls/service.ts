import type { OidcAuth } from "../auth/oidc";
import { createCallAdapter } from "../api/calls/callApi";
import { browserCallPlatform } from "./platform";
import type { CallAdapter, CallEvent, CallPlatform, CallService, CallState } from "./types";

export type {
	CallAdapter,
	CallCommand,
	CallDevice,
	CallEvent,
	CallPlatform,
	CallReply,
	CallService,
	CallState,
} from "./types";

export function createCallService(url: string, auth: OidcAuth): CallService {
	// Defer configuration validation to start so an unavailable call deployment
	// cannot prevent the rest of the application from loading.
	let adapter: CallAdapter | undefined;
	const service = callService({
		execute: (command) => (adapter ??= createCallAdapter(url, auth)).execute(command),
	});
	auth.watchSessionBoundary(() => service.close());
	return service;
}
export function callService(
	adapter: CallAdapter,
	platform: CallPlatform = browserCallPlatform,
): CallService {
	let state: CallState = {
		available: false,
		phase: "idle",
		devices: [],
		peer: "",
		video: false,
		muted: false,
		cameraOff: true,
		error: "",
		notice: "",
	};
	const listeners = new Set<(state: CallState) => void>();
	let device = "",
		call = "",
		epoch = 0,
		generation = 0;
	let pc: RTCPeerConnection | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let deadline: ReturnType<typeof setTimeout> | undefined;
	let candidates: RTCIceCandidateInit[] = [];
	let sending = Promise.resolve();
	let starting = false,
		operating = false;
	let deferred: CallEvent[] = [];
	function update(patch: Partial<CallState>) {
		state = { ...state, ...patch };
		listeners.forEach((f) => f(state));
	}
	function cleanup(notice = "") {
		generation++;
		clearTimeout(deadline);
		if (pc) {
			pc.onicecandidate = null;
			pc.ontrack = null;
			pc.onconnectionstatechange = null;
			pc.close();
			pc = undefined;
		}
		for (const stream of [state.local, state.remote]) stream?.getTracks().forEach((t) => t.stop());
		call = "";
		candidates = [];
		deferred = [];
		update({
			phase: "idle",
			local: undefined,
			remote: undefined,
			muted: false,
			cameraOff: true,
			peer: "",
			notice,
		});
	}
	async function end(notice = "") {
		const id = call;
		cleanup(notice);
		if (id && device) await adapter.execute({ action: "end", device, call: id }).catch(() => {});
	}
	function fail(cause: unknown) {
		update({
			error: cause instanceof Error ? cause.message : "Call unavailable.",
		});
		void end();
	}
	function signal(
		kind: "offer" | "answer" | "candidate",
		payload: RTCSessionDescriptionInit | RTCIceCandidateInit,
	) {
		const id = call,
			d = device,
			ticket = generation;
		const operation = sending
			.catch(() => {})
			.then(async () => {
				if (ticket !== generation || !id) return;
				await adapter.execute({
					action: "signal",
					device: d,
					call: id,
					kind,
					payload,
				});
			});
		sending = operation;
		void operation.catch((e) => {
			if (ticket === generation) fail(e);
		});
		return operation;
	}
	async function media(video: boolean) {
		const ticket = generation;
		const stream = await platform.media(video);
		if (ticket !== generation || !device) {
			stream.getTracks().forEach((t) => t.stop());
			throw new Error("Call ended.");
		}
		update({ local: stream, video, cameraOff: !video });
	}
	function prepare(iceServer: RTCIceServer | undefined) {
		if (!iceServer) throw new Error("TURN credentials unavailable.");
		const peer = platform.peer({
			iceServers: [iceServer],
			iceTransportPolicy: "relay",
		});
		pc = peer;
		const remote = platform.stream();
		update({ remote });
		state.local?.getTracks().forEach((track) => peer.addTrack(track, state.local!));
		peer.ontrack = (event) => {
			remote.addTrack(event.track);
			update({ remote });
		};
		peer.onicecandidate = (event) => {
			if (event.candidate) void signal("candidate", event.candidate.toJSON());
		};
		peer.onconnectionstatechange = () => {
			if (peer !== pc) return;
			if (peer.connectionState === "connected") update({ phase: "connected" });
			if (["failed", "disconnected", "closed"].includes(peer.connectionState))
				void end("Call disconnected.");
		};
		clearTimeout(deadline);
		// Fail closed even if polling/server timers fail. Credentials and calls last <=10 minutes.
		deadline = setTimeout(() => {
			void end("Call time limit reached.");
		}, 600000);
	}
	async function event(e: CallEvent) {
		if (operating) {
			deferred.push(e);
			return;
		}
		if (e.type === "ringing") {
			if (call) {
				if (call !== e.call) await adapter.execute({ action: "end", device, call: e.call });
				return;
			}
			call = e.call;
			update({
				phase: "ringing",
				peer: e.name ?? "Family device",
				video: e.video ?? false,
				error: "",
				notice: "",
			});
			return;
		}
		if (e.call !== call) return;
		if (e.type === "ended") {
			cleanup(`Call ended: ${e.reason ?? "hangup"}.`);
			return;
		}
		const peer = pc,
			ticket = generation;
		if (e.type === "accepted" && peer) {
			clearTimeout(deadline);
			deadline = setTimeout(() => {
				void end("Call time limit reached.");
			}, 600000);
			update({ phase: "connecting" });
			const offer = await peer.createOffer();
			if (ticket !== generation) return;
			await peer.setLocalDescription(offer);
			if (ticket === generation) await signal("offer", offer);
		}
		if (e.type === "signal" && peer && e.payload) {
			if (e.kind === "candidate") {
				if (!peer.remoteDescription) candidates.push(e.payload);
				else await peer.addIceCandidate(e.payload);
			} else {
				await peer.setRemoteDescription(e.payload);
				if (ticket !== generation) return;
				for (const c of candidates) await peer.addIceCandidate(c);
				candidates = [];
				if (e.kind === "offer") {
					const answer = await peer.createAnswer();
					if (ticket !== generation) return;
					await peer.setLocalDescription(answer);
					if (ticket === generation) await signal("answer", answer);
				}
			}
		}
	}
	async function deliver(e: CallEvent) {
		const ticket = generation;
		try {
			await event(e);
		} catch (cause) {
			if (ticket === generation) throw cause;
		}
	}
	async function poll(ticket: number) {
		try {
			const reply = await adapter.execute({ action: "poll", device });
			if (ticket !== epoch) return;
			update({ devices: reply.devices ?? [] });
			for (const e of reply.events ?? []) {
				if (ticket !== epoch) return;
				await deliver(e);
			}
		} catch (cause) {
			if (ticket !== epoch) return;
			service.close();
			update({
				error: cause instanceof Error ? cause.message : "Signaling disconnected.",
			});
			return;
		}
		if (ticket === epoch)
			timer = setTimeout(() => {
				void poll(ticket);
			}, 500);
	}
	const service: CallService = {
		subscribe(listener) {
			listeners.add(listener);
			listener(state);
			return () => {
				listeners.delete(listener);
			};
		},
		async start(name) {
			if (device || starting) return;
			starting = true;
			const ticket = ++epoch;
			try {
				const reply = await adapter.execute({ action: "register", name });
				if (!reply.device) throw new Error("Device registration failed.");
				if (ticket !== epoch) {
					void adapter.execute({ action: "leave", device: reply.device }).catch(() => {});
					return;
				}
				device = reply.device;
				update({ available: true, error: "", notice: "" });
				void poll(ticket);
			} catch (e) {
				if (ticket === epoch)
					update({
						error: e instanceof Error ? e.message : "Calls unavailable.",
					});
				throw e;
			} finally {
				starting = false;
			}
		},
		async call(target, video) {
			if (!device || state.phase !== "idle" || operating) return;
			operating = true;
			const ticket = generation,
				ownDevice = device;
			update({ phase: "calling", peer: target.name, error: "", notice: "" });
			try {
				await media(video);
				const reply = await adapter.execute({
					action: "invite",
					device: ownDevice,
					target: target.id,
					video,
				});
				if (ticket !== generation) {
					if (reply.call)
						void adapter
							.execute({ action: "end", device: ownDevice, call: reply.call })
							.catch(() => {});
					return;
				}
				if (!reply.call) throw new Error("Call invitation failed.");
				call = reply.call;
				prepare(reply.iceServer);
				clearTimeout(deadline);
				deadline = setTimeout(() => {
					void end("No answer.");
				}, 30000);
			} catch (e) {
				if (ticket === generation) fail(e);
			} finally {
				operating = false;
				const events = deferred;
				deferred = [];
				for (const e of events) {
					try {
						await deliver(e);
					} catch (cause) {
						fail(cause);
					}
				}
			}
		},
		async accept() {
			if (state.phase !== "ringing" || operating) return;
			operating = true;
			const ticket = generation;
			update({ phase: "connecting", error: "" });
			try {
				await media(state.video);
				const reply = await adapter.execute({ action: "accept", device, call });
				if (ticket !== generation) return;
				prepare(reply.iceServer);
			} catch (e) {
				if (ticket === generation) fail(e);
			} finally {
				operating = false;
				const events = deferred;
				deferred = [];
				for (const e of events) {
					try {
						await deliver(e);
					} catch (cause) {
						fail(cause);
					}
				}
			}
		},
		hangup: () => end("Call ended."),
		mute() {
			const muted = !state.muted;
			state.local?.getAudioTracks().forEach((t) => {
				t.enabled = !muted;
			});
			update({ muted });
		},
		camera() {
			const cameraOff = !state.cameraOff;
			state.local?.getVideoTracks().forEach((t) => {
				t.enabled = !cameraOff;
			});
			update({ cameraOff });
		},
		close() {
			++epoch;
			clearTimeout(timer);
			cleanup();
			const d = device;
			device = "";
			if (d) void adapter.execute({ action: "leave", device: d }).catch(() => {});
			update({ available: false, devices: [] });
		},
	};
	return service;
}
