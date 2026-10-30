export type CallCommand =
	| { action: "register"; name: string }
	| { action: "poll" | "leave"; device: string }
	| { action: "invite"; device: string; target: string; video: boolean }
	| { action: "accept" | "end"; device: string; call: string }
	| {
			action: "signal";
			device: string;
			call: string;
			kind: "offer" | "answer" | "candidate";
			payload: RTCSessionDescriptionInit | RTCIceCandidateInit;
	  };
export interface CallDevice {
	id: string;
	name: string;
	accountId: string;
	busy: boolean;
}
export interface CallEvent {
	type: "ringing" | "accepted" | "ended" | "signal";
	call: string;
	peer?: string;
	name?: string;
	video?: boolean;
	reason?: string;
	kind?: "offer" | "answer" | "candidate";
	payload?: RTCSessionDescriptionInit & RTCIceCandidateInit;
}
export interface CallReply {
	device?: string;
	call?: string;
	iceServer?: RTCIceServer;
	devices?: CallDevice[];
	events?: CallEvent[];
}
export interface CallAdapter {
	execute(command: CallCommand): Promise<CallReply>;
}
export interface CallState {
	available: boolean;
	phase: "idle" | "ringing" | "calling" | "connecting" | "connected";
	devices: CallDevice[];
	peer: string;
	video: boolean;
	muted: boolean;
	cameraOff: boolean;
	local?: MediaStream;
	remote?: MediaStream;
	error: string;
	notice: string;
}
export interface CallService {
	start(name: string): Promise<void>;
	subscribe(listener: (state: CallState) => void): () => void;
	call(device: CallDevice, video: boolean): Promise<void>;
	accept(): Promise<void>;
	hangup(): Promise<void>;
	mute(): void;
	camera(): void;
	close(): void;
}
export interface CallPlatform {
	media(video: boolean): Promise<MediaStream>;
	peer(config: RTCConfiguration): RTCPeerConnection;
	stream(): MediaStream;
}
