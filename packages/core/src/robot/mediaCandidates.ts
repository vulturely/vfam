/** Gather a bounded offer without letting an unavailable TURN route block usable ones. */
export function gatherMediaCandidates(peer: RTCPeerConnection, signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.reject(new Error("Live talk cancelled."));
	const usable = () => {
		const relayOnly = peer.getConfiguration().iceTransportPolicy === "relay";
		return (peer.localDescription?.sdp ?? "")
			.split(/\r?\n/)
			.some(
				(line) => line.startsWith("a=candidate:") && (!relayOnly || /\btyp relay\b/.test(line)),
			);
	};
	const unavailable = () =>
		new Error("Unable to establish an audio/video route. Check your network and retry.");
	if (peer.iceGatheringState === "complete")
		return usable() ? Promise.resolve() : Promise.reject(unavailable());
	return new Promise((resolve, reject) => {
		const finish = (error?: Error) => {
			clearTimeout(timer);
			peer.removeEventListener("icegatheringstatechange", changed);
			signal.removeEventListener("abort", aborted);
			if (error) reject(error);
			else resolve();
		};
		const changed = () => {
			if (peer.iceGatheringState === "complete") finish(usable() ? undefined : unavailable());
		};
		const aborted = () => finish(new Error("Live talk cancelled."));
		// An unreachable TURN URL can keep gathering active despite a working relay.
		// The SDP already contains gathered candidates, so it is safe to send at the limit.
		const timer = setTimeout(() => finish(usable() ? undefined : unavailable()), 15000);
		peer.addEventListener("icegatheringstatechange", changed);
		signal.addEventListener("abort", aborted, { once: true });
	});
}
