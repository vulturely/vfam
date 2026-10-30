import type { BuddyCommand, BuddyOutput } from "../buddy";
export interface MediaRequest {
	device: string;
	offer: string;
	video: boolean;
	ice_servers: { urls: string[]; username: string; credential: string }[];
}
export interface MediaEvent {
	session: string;
	answer?: string;
	error?: string;
}
/** SDP is pushed over MLS; heartbeats only renew the explicit short capture lease. */
export function mediaSignaling(
	send: (command: BuddyCommand, media?: MediaRequest) => Promise<BuddyOutput>,
	family: string,
) {
	const listeners = new Set<(event: MediaEvent) => void>();
	return {
		receive(event: MediaEvent) {
			for (const listener of listeners) listener(event);
		},
		disconnect() {
			for (const listener of listeners)
				listener({ session: "", error: "Encrypted media connection ended." });
		},
		async *open(
			device: string,
			offer: string,
			signal: AbortSignal,
			options: { video?: boolean; iceServers?: RTCIceServer[] } = {},
		) {
			let session: string | undefined;
			const queue: MediaEvent[] = [];
			let wake: (() => void) | undefined;
			const listener = (event: MediaEvent) => {
				if (queue.length >= 8)
					queue.splice(0, queue.length, {
						session: "",
						error: "Media signaling overflow.",
					});
				else queue.push(event);
				wake?.();
			};
			const aborted = () => wake?.();
			listeners.add(listener);
			signal.addEventListener("abort", aborted);
			let heartbeat: ReturnType<typeof setInterval> | undefined;
			let renewing = false;
			try {
				signal.throwIfAborted();
				const ice_servers = (options.iceServers ?? []).map((server) => ({
					urls: typeof server.urls === "string" ? [server.urls] : server.urls,
					username: server.username ?? "",
					credential: typeof server.credential === "string" ? server.credential : "",
				}));
				const output = await send(
					{ action: "list", family },
					{ device, offer, video: !!options.video, ice_servers },
				);
				session = output.talk ?? undefined;
				if (!session) throw new Error("Device did not authorize live media.");
				heartbeat = setInterval(() => {
					if (renewing || signal.aborted || !session) return;
					renewing = true;
					void send({ action: "talk", device, session, pcm: null })
						.catch(() =>
							listener({
								session: session!,
								error: "Live media permission ended.",
							}),
						)
						.finally(() => {
							renewing = false;
						});
				}, 5000);
				while (!signal.aborted) {
					const event = queue.shift();
					if (!event) {
						await new Promise<void>((resolve) => {
							wake = resolve;
							if (signal.aborted || queue.length) resolve();
						});
						wake = undefined;
						continue;
					}
					if (event.session && event.session !== session) continue;
					if (event.error) throw new Error(event.error);
					if (event.answer) yield { session, answer: event.answer };
				}
			} finally {
				if (heartbeat) clearInterval(heartbeat);
				signal.removeEventListener("abort", aborted);
				listeners.delete(listener);
				if (session) await send({ action: "stop_talk", device, session }).catch(() => {});
			}
		},
	};
}
