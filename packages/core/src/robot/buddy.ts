import { gatewayClient, parentRequest, gatewayOutput } from "./buddy-gateway";
import { isNativeServerError } from "../repositories/server";
import type { OidcAuth } from "../auth/oidc";
import type { FamBuddyLicense } from "./license";

export type BuddyStage =
	| "QuestionPending"
	| "QuestionApproved"
	| "AwaitingAnswer"
	| "AnswerPending"
	| "AnswerApproved"
	| "PlaybackClaimed"
	| "Cancelled"
	/** The on-device AI could not answer a child's question; it waits for a parent. */
	| "NeedsParent";
/** Every stage this app knows; a turn in any other stage is left out of the view. */
export const BUDDY_STAGES: readonly BuddyStage[] = [
	"QuestionPending",
	"QuestionApproved",
	"AwaitingAnswer",
	"AnswerPending",
	"AnswerApproved",
	"PlaybackClaimed",
	"Cancelled",
	"NeedsParent",
];
/**
 * How a FamBuddy answers questions, in the hub's JSON names. A child's question only
 * ever goes to the on-device AI; a parent may then choose to ask the cloud for it.
 */
export type BuddyAiMode = "local_only" | "local_first" | "cloud_only";
/** What the device's updater last reported; "unknown" until it reports. */
export type BuddyUpdateState = "current" | "available" | "installing" | "failed" | "unknown";
export interface BuddySettings {
	device: string;
	wake_word: string;
	muted: boolean;
	camera_enabled?: boolean;
	captions_enabled?: boolean;
	/** Whether a PIN guards Wi-Fi changes on the device's own screen. */
	screen_pin_set?: boolean;
	/** Whether the device installs signed updates on its own when idle; off by default. */
	auto_update?: boolean;
	/** Release tags such as "v0.1.57"; empty when unknown. */
	installed_version?: string;
	available_version?: string;
	update_state?: BuddyUpdateState;
	/** A parent asked for the available update now and the device has not started it yet. */
	update_requested?: boolean;
	/** What this FamBuddy's license allows now; never the token. */
	license?: FamBuddyLicense;
	/** The mode in effect; "unknown" when the FamBuddy did not report one. */
	ai_mode?: BuddyAiMode | "unknown";
	/** On-device AI can answer now: the hardware allows it, it is licensed and running. */
	local_ai?: boolean;
}
/** What a FamBuddy is saying now; shown only while captions are on. */
export interface BuddyCaption {
	device: string;
	turn: string;
	text: string;
	started_at: string;
}
export type BuddyAsker = "child" | "parent";
/** Which AI, or person, wrote a pending answer. */
export type BuddyAnswerSource =
	"provider" | "parent_device" | "local" | "cloud" | "parent" | "unknown";
export interface BuddyVoice {
	speaker: string;
	name: string;
	/** Unlabelled voices are treated as a child. */
	role: BuddyAsker;
}
export interface BuddyTurn {
	scope: {
		family: string;
		speaker: string;
		device: string;
		session: string;
		turn: string;
		destination_revision: string;
	};
	stage: BuddyStage;
	text: string;
	review: number[] | null;
	expires_at: string;
	destination: string;
	/** Who asked, and how: aloud on the FamBuddy or from VFAM. */
	origin?: { name: string; role: BuddyAsker; channel: "voice" | "app" | "" };
	answered_by?: BuddyAnswerSource;
}
export interface BuddyOutput {
	talk?: string | null;
	audio?: string[];
	settings: BuddySettings[];
	turns: BuddyTurn[];
	captions?: BuddyCaption[];
	/** Parents only: every enrolled voice and who it belongs to. */
	voices?: BuddyVoice[];
}
export type BuddyCommand =
	| { action: "logout" }
	| {
			action: "save_provider";
			device: string;
			config: {
				provider: string;
				model: string;
				endpoint: string;
				api_key: string;
				max_microusd_per_token: number;
				revision?: string;
				generation?: string;
				destination?: string;
			};
	  }
	| { action: "configure_camera"; device: string; enabled: boolean }
	| { action: "configure_captions"; device: string; enabled: boolean }
	/** Sets the PIN needed on the device's own screen; an empty pin removes it. */
	| { action: "configure_screen_pin"; device: string; pin: string }
	/** Whether the device installs signed updates on its own whenever it is idle. */
	| { action: "configure_updates"; device: string; automatic: boolean }
	/** Asks the device to install its available update now. */
	| { action: "install_update"; device: string }
	/** Sends a pending answer back to its AI with an instruction; the new one needs approval. */
	| { action: "revise"; device: string; turn: string; instruction: string }
	/** Names an enrolled voice and says whether it is a child or a parent. */
	| { action: "label_voice"; device: string; speaker: string; name: string; role: BuddyAsker }
	/** Installs the device's FamBuddy license from SAP; an empty token removes it. */
	| { action: "install_license"; device: string; token: string }
	/** How the device answers questions; "unspecified" returns to the default. */
	| { action: "configure_ai_mode"; device: string; mode: BuddyAiMode | "unspecified" }
	/** Sends a question waiting for a parent to the device's cloud AI; the answer needs approval. */
	| { action: "ask_cloud"; device: string; turn: string }
	/** A parent's question for the device's AI; its answer still needs approval. */
	| { action: "ask"; device: string; text: string }
	| { action: "revoke"; device: string }
	| { action: "start_talk"; device: string }
	| { action: "stop_talk"; device: string; session: string }
	| { action: "talk"; device: string; session: string; pcm: string | null }
	| { action: "list"; family: string }
	| { action: "configure"; device: string; wake_word: string; muted: boolean }
	| { action: "approve"; device: string; turn: string; review: number[] }
	| { action: "edit"; device: string; turn: string; text: string }
	/** Answer produced on this parent device for an approved parent-device-AI question. */
	| { action: "answer"; device: string; turn: string; text: string }
	| { action: "cancel"; device: string; turn: string }
	| { action: "announce"; device: string; text: string };
export interface BuddyService {
	readonly liveTalkAvailable?: boolean;
	readonly providerSettingsAvailable?: boolean;
	command(input: BuddyCommand): Promise<BuddyOutput>;
	iceServers?(): Promise<RTCIceServer[]>;
	openTalk(
		device: string,
		offer: string,
		signal: AbortSignal,
		options?: { video?: boolean; iceServers?: RTCIceServer[] },
	): AsyncIterable<{ session: string; answer?: string }>;
	watch(family: string, signal: AbortSignal): AsyncIterable<BuddyOutput>;
}

/** Native failures arrive as plain objects; screens show their message. */
function readable(cause: unknown): unknown {
	return isNativeServerError(cause) ? new Error(cause.message, { cause }) : cause;
}

/** Typed native gateway client. Never route transcripts through a cloud relay. */
export function createBuddyService(
	serverUrl: string,
	auth: Pick<OidcAuth, "getAccessToken">,
): BuddyService {
	return {
		async *openTalk(device, offer, signal, options) {
			const token = await auth.getAccessToken();
			if (!token?.startsWith("vps_")) throw new Error("Parent sign-in required.");
			yield* gatewayClient(serverUrl).openTalk(
				{
					device,
					offer,
					video: options?.video ?? false,
					iceServers: (options?.iceServers ?? []).map((s) => ({
						urls: typeof s.urls === "string" ? [s.urls] : s.urls,
						username: s.username ?? "",
						credential: typeof s.credential === "string" ? s.credential : "",
					})),
				},
				{
					headers: { authorization: `Bearer ${token}` },
					signal,
					timeoutMs: 0,
				},
			) as AsyncIterable<{ session: string; answer?: string }>;
		},
		async *watch(family, signal) {
			const token = await auth.getAccessToken();
			if (!token?.startsWith("vps_")) throw new Error("Parent sign-in required.");
			try {
				for await (const response of gatewayClient(serverUrl).watchParent(
					{ family },
					{ headers: { authorization: `Bearer ${token}` }, signal, timeoutMs: 0 },
				) as AsyncIterable<{ output?: import("../api/protocol").GatewayOutput }>) {
					yield gatewayOutput(response.output);
				}
			} catch (cause) {
				throw readable(cause);
			}
		},
		async command(input) {
			const token = await auth.getAccessToken();
			if (!token?.startsWith("vps_")) throw new Error("Parent sign-in required.");
			let response: { output?: import("../api/protocol").GatewayOutput };
			try {
				response = (await gatewayClient(serverUrl).parentCommand(parentRequest(input), {
					headers: { authorization: `Bearer ${token}` },
					timeoutMs: 30000,
				})) as { output?: import("../api/protocol").GatewayOutput };
			} catch (cause) {
				throw readable(cause);
			}
			return gatewayOutput(response.output);
		},
	};
}
