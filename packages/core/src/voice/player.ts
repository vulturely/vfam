/** Plays audio bytes on this device; one sound at a time. */
export interface AudioPlayer {
	play(audio: Uint8Array, contentType: string): Promise<void>;
	stop(): void;
}

export function audioPlayer(): AudioPlayer {
	let current: { element: HTMLAudioElement; url: string; settle: () => void } | undefined;
	function release() {
		if (!current) return;
		current.element.pause();
		URL.revokeObjectURL(current.url);
		current.settle();
		current = undefined;
	}
	return {
		play(audio, contentType) {
			release();
			return new Promise<void>((resolve, reject) => {
				const url = URL.createObjectURL(new Blob([new Uint8Array(audio)], { type: contentType }));
				const element = new Audio(url);
				const playing = { element, url, settle: resolve };
				current = playing;
				const finish = (error?: Error) => {
					if (current !== playing) return;
					URL.revokeObjectURL(url);
					current = undefined;
					if (error) reject(error);
					else resolve();
				};
				element.onended = () => finish();
				element.onerror = () => finish(new Error("The audio could not be played."));
				element.play().catch(() => finish(new Error("The audio could not be played.")));
			});
		},
		stop: release,
	};
}
