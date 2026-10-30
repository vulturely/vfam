import type { BuddyService } from "./buddy";
import { gatherMediaCandidates } from "./mediaCandidates";

/** Encrypted live media; the native backend carries signaling and authority, never media frames. */
export async function startBuddyTalk(
	service: BuddyService,
	device: string,
	options: {
		signal?: AbortSignal;
		video?: boolean;
		onError: () => void;
		onAudio?: (stream: MediaStream | null) => void;
	},
): Promise<() => Promise<void>> {
	const { onError, onAudio = () => {} } = options;
	const controller = new AbortController();
	let stream: MediaStream | undefined;
	let peer: RTCPeerConnection | undefined;
	let session: string | undefined;
	let stopped = false;
	const stop = async () => {
		if (stopped) return;
		stopped = true;
		options.signal?.removeEventListener("abort", cancelled);
		controller.abort();
		stream?.getTracks().forEach((track) => track.stop());
		peer?.close();
		onAudio(null);
		if (session) {
			try {
				await service.command({ action: "stop_talk", device, session });
			} catch {
				/* Closing the signaling stream also revokes the short lease. */
			}
		}
	};
	const cancelled = () => {
		void stop();
	};
	options.signal?.addEventListener("abort", cancelled, { once: true });
	try {
		options.signal?.throwIfAborted();
		const iceServers = service.iceServers ? await service.iceServers() : [];
		if (stopped) throw new Error("Live talk cancelled.");
		if (!options.video)
			stream = await navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: true, noiseSuppression: true },
				video: false,
			});
		if (stopped) {
			stream?.getTracks().forEach((track) => track.stop());
			throw new Error("Live talk cancelled.");
		}
		peer = new RTCPeerConnection({
			iceServers,
			iceTransportPolicy: iceServers.length ? "relay" : "all",
			bundlePolicy: "max-bundle",
		});
		if (options.video) {
			peer.addTransceiver("audio", { direction: "recvonly" });
			peer.addTransceiver("video", { direction: "recvonly" });
		}
		for (const track of stream?.getAudioTracks() ?? []) {
			peer.addTrack(track, stream!);
			track.onended = () => {
				void stop();
				onError();
			};
		}
		const incoming = new MediaStream();
		peer.ontrack = (event) => {
			incoming.addTrack(event.track);
			onAudio(incoming);
		};
		peer.onconnectionstatechange = () => {
			if (peer && ["failed", "disconnected"].includes(peer.connectionState)) {
				void stop();
				onError();
			}
		};
		await peer.setLocalDescription(await peer.createOffer());
		await gatherMediaCandidates(peer, controller.signal);
		const offer = peer.localDescription?.sdp;
		if (!offer) throw new Error("Unable to prepare live audio.");
		const connection = peer;
		let resolveReady!: () => void;
		let rejectReady!: (error: unknown) => void;
		const ready = new Promise<void>((resolve, reject) => {
			resolveReady = resolve;
			rejectReady = reject;
		});
		const aborted = () => rejectReady(new Error("Live talk cancelled."));
		controller.signal.addEventListener("abort", aborted, { once: true });
		if (controller.signal.aborted) aborted();
		const timeout = setTimeout(
			() => rejectReady(new Error("Device did not answer. Check its connection.")),
			12000,
		);
		void (async () => {
			try {
				for await (const event of service.openTalk(device, offer, controller.signal, {
					video: options.video,
					iceServers,
				})) {
					session = event.session;
					if (event.answer && !connection.remoteDescription) {
						await connection.setRemoteDescription({
							type: "answer",
							sdp: event.answer,
						});
						resolveReady();
					}
				}
				if (!stopped) throw new Error("Live talk connection ended.");
			} catch (error) {
				rejectReady(error);
				if (!stopped) {
					await stop();
					onError();
				}
			} finally {
				clearTimeout(timeout);
				controller.signal.removeEventListener("abort", aborted);
			}
		})();
		await ready;
		clearTimeout(timeout);
		return stop;
	} catch (error) {
		await stop();
		throw error;
	}
}
