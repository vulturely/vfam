import type { CallPlatform } from "./types";

export const browserCallPlatform: CallPlatform = {
	media: async (video) => {
		if (!navigator.mediaDevices?.getUserMedia)
			throw new Error(
				"Microphone and camera access require a secure HTTPS window with media support.",
			);
		return navigator.mediaDevices.getUserMedia({ audio: true, video });
	},
	peer: (config) => new RTCPeerConnection(config),
	stream: () => new MediaStream(),
};
