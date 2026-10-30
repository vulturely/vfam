import { createNativeClient } from "../repositories/nativeClient";
import { isNativeServerError } from "../repositories/server";
import {
	createFamBuddyTrustRepository,
	type FamBuddyTrustRepository,
} from "../repositories/fambuddyTrust";
import {
	AiMode,
	AnswerSource,
	AskerRole,
	ParentCommandRequest,
	TurnStage,
	UpdateState,
	type GatewayOutput,
} from "../api/protocol";
import type {
	BuddyAiMode,
	BuddyAnswerSource,
	BuddyAsker,
	BuddyCommand,
	BuddyOutput,
	BuddyStage,
	BuddyTurn,
	BuddyUpdateState,
} from "./buddy";
import { licenseFrom } from "./license";

export function gatewayClient(serverUrl: string) {
	const base = new URL(serverUrl, globalThis.location?.origin ?? "https://localhost");
	if (base.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) {
		throw new Error("FamBuddy requires HTTPS.");
	}
	return createNativeClient("fambuddy_gateway", base.toString().replace(/\/$/, ""));
}

const aiModeRequests: Record<BuddyAiMode | "unspecified", AiMode> = {
	unspecified: AiMode.UNSPECIFIED,
	local_only: AiMode.LOCAL_ONLY,
	local_first: AiMode.LOCAL_FIRST,
	cloud_only: AiMode.CLOUD_ONLY,
};

const aiModes: Partial<Record<AiMode, BuddyAiMode>> = {
	[AiMode.LOCAL_ONLY]: "local_only",
	[AiMode.LOCAL_FIRST]: "local_first",
	[AiMode.CLOUD_ONLY]: "cloud_only",
};

export function parentRequest(input: BuddyCommand): ParentCommandRequest {
	switch (input.action) {
		case "list":
			return new ParentCommandRequest({
				command: { case: "list", value: { family: input.family } },
			});
		case "configure_camera":
			return new ParentCommandRequest({
				command: {
					case: "configureCamera",
					value: { device: input.device, enabled: input.enabled },
				},
			});
		case "configure_captions":
			return new ParentCommandRequest({
				command: {
					case: "configureCaptions",
					value: { device: input.device, enabled: input.enabled },
				},
			});
		case "configure_screen_pin":
			return new ParentCommandRequest({
				command: {
					case: "configureScreenPin",
					value: { device: input.device, pin: input.pin },
				},
			});
		case "configure_updates":
			return new ParentCommandRequest({
				command: {
					case: "configureUpdates",
					value: { device: input.device, automatic: input.automatic },
				},
			});
		case "install_update":
			return new ParentCommandRequest({
				command: { case: "installUpdate", value: { device: input.device } },
			});
		case "revise":
			return new ParentCommandRequest({
				command: {
					case: "revise",
					value: { device: input.device, turn: input.turn, instruction: input.instruction },
				},
			});
		case "install_license":
			return new ParentCommandRequest({
				command: { case: "installLicense", value: { device: input.device, token: input.token } },
			});
		case "configure_ai_mode":
			return new ParentCommandRequest({
				command: {
					case: "configureAiMode",
					value: { device: input.device, mode: aiModeRequests[input.mode] },
				},
			});
		case "ask_cloud":
			return new ParentCommandRequest({
				command: { case: "askCloud", value: { device: input.device, turn: input.turn } },
			});
		case "label_voice":
			return new ParentCommandRequest({
				command: {
					case: "labelVoice",
					value: {
						device: input.device,
						speaker: input.speaker,
						name: input.name,
						role: input.role === "parent" ? AskerRole.PARENT : AskerRole.CHILD,
					},
				},
			});
		case "ask":
			return new ParentCommandRequest({
				command: { case: "ask", value: { device: input.device, text: input.text } },
			});
		case "configure":
			return new ParentCommandRequest({
				command: {
					case: "configure",
					value: {
						device: input.device,
						wakeWord: input.wake_word,
						muted: input.muted,
					},
				},
			});
		case "approve":
			return new ParentCommandRequest({
				command: {
					case: "approve",
					value: {
						device: input.device,
						turn: input.turn,
						review: Uint8Array.from(input.review),
					},
				},
			});
		case "answer":
			return new ParentCommandRequest({
				command: {
					case: "answer",
					value: { device: input.device, turn: input.turn, text: input.text },
				},
			});
		case "edit":
			return new ParentCommandRequest({
				command: {
					case: "edit",
					value: { device: input.device, turn: input.turn, text: input.text },
				},
			});
		case "cancel":
			return new ParentCommandRequest({
				command: {
					case: "cancel",
					value: { device: input.device, turn: input.turn },
				},
			});
		case "announce":
			return new ParentCommandRequest({
				command: {
					case: "announce",
					value: { device: input.device, text: input.text },
				},
			});
		case "save_provider":
			return new ParentCommandRequest({
				command: {
					case: "saveProvider",
					value: {
						device: input.device,
						config: {
							provider: input.config.provider,
							model: input.config.model,
							endpoint: input.config.endpoint,
							apiKey: input.config.api_key,
							maxMicrousdPerToken: BigInt(input.config.max_microusd_per_token),
							revision: input.config.revision ?? "",
							generation: input.config.generation ?? "",
							destination: input.config.destination ?? "",
						},
					},
				},
			});
		case "revoke":
			return new ParentCommandRequest({
				command: { case: "revoke", value: { device: input.device } },
			});
		case "start_talk":
			return new ParentCommandRequest({
				command: { case: "startTalk", value: { device: input.device } },
			});
		case "stop_talk":
			return new ParentCommandRequest({
				command: {
					case: "stopTalk",
					value: { device: input.device, session: input.session },
				},
			});
		case "talk":
			return new ParentCommandRequest({
				command: {
					case: "talk",
					value: {
						device: input.device,
						session: input.session,
						pcm:
							input.pcm === null
								? undefined
								: Uint8Array.from(atob(input.pcm), (value) => value.charCodeAt(0)),
					},
				},
			});
		case "logout":
			return new ParentCommandRequest({
				command: { case: "logout", value: {} },
			});
	}
}

const stages: Partial<Record<TurnStage, BuddyStage>> = {
	[TurnStage.QUESTION_PENDING]: "QuestionPending",
	[TurnStage.QUESTION_APPROVED]: "QuestionApproved",
	[TurnStage.AWAITING_ANSWER]: "AwaitingAnswer",
	[TurnStage.ANSWER_PENDING]: "AnswerPending",
	[TurnStage.ANSWER_APPROVED]: "AnswerApproved",
	[TurnStage.PLAYBACK_CLAIMED]: "PlaybackClaimed",
	[TurnStage.CANCELLED]: "Cancelled",
	[TurnStage.NEEDS_PARENT]: "NeedsParent",
};

const answerSources: Partial<Record<AnswerSource, BuddyAnswerSource>> = {
	[AnswerSource.PROVIDER]: "provider",
	[AnswerSource.PARENT_DEVICE]: "parent_device",
	[AnswerSource.LOCAL]: "local",
	[AnswerSource.CLOUD]: "cloud",
	[AnswerSource.PARENT]: "parent",
};

/** Anyone not known to be a parent is treated as a child. */
function asker(role: AskerRole | undefined): BuddyAsker {
	return role === AskerRole.PARENT ? "parent" : "child";
}

const updateStates: Partial<Record<UpdateState, BuddyUpdateState>> = {
	[UpdateState.CURRENT]: "current",
	[UpdateState.AVAILABLE]: "available",
	[UpdateState.INSTALLING]: "installing",
	[UpdateState.FAILED]: "failed",
};

export function gatewayOutput(output?: GatewayOutput): BuddyOutput {
	if (!output) throw new Error("Missing FamBuddy response.");
	return {
		settings: output.settings.map((value) => ({
			device: value.device,
			wake_word: value.wakeWord,
			muted: value.muted,
			camera_enabled: value.cameraEnabled,
			captions_enabled: value.captionsEnabled,
			screen_pin_set: value.screenPinSet,
			auto_update: value.autoUpdate,
			installed_version: value.installedVersion,
			available_version: value.availableVersion,
			update_state: updateStates[value.updateState] ?? "unknown",
			update_requested: value.updateRequested,
			license: licenseFrom(value.license),
			ai_mode: aiModes[value.aiMode] ?? "unknown",
			local_ai: value.localAi,
		})),
		captions: (output.captions ?? []).map((value) => ({
			device: value.device,
			turn: value.turn,
			text: value.text,
			started_at: value.startedAt,
		})),
		// A stage from a newer FamBuddy is left out rather than failing the whole view.
		turns: output.turns.flatMap((value) => {
			const scope = value.scope;
			if (!scope) throw new Error("Invalid FamBuddy review.");
			const stage = stages[value.stage];
			if (!stage) return [];
			const turn: BuddyTurn = {
				scope: {
					family: scope.family,
					speaker: scope.speaker,
					device: scope.device,
					session: scope.session,
					turn: scope.turn,
					destination_revision: scope.destinationRevision,
				},
				stage,
				text: value.text,
				review: value.review ? Array.from(value.review) : null,
				expires_at: value.expiresAt,
				destination: value.destination,
				origin: {
					name: value.origin?.name ?? "",
					role: asker(value.origin?.role),
					channel:
						value.origin?.channel === "voice" || value.origin?.channel === "app"
							? value.origin.channel
							: "",
				},
				answered_by: answerSources[value.answeredBy] ?? "unknown",
			};
			return [turn];
		}),
		voices: (output.voiceLabels ?? []).map((value) => ({
			speaker: value.speaker,
			name: value.name,
			role: asker(value.role),
		})),
		talk: output.talk ?? null,
		audio: output.audio.map((bytes) => btoa(String.fromCharCode(...bytes))),
	};
}

export async function pairBuddyPhone(serverUrl: string, code: string) {
	const response = (await gatewayClient(serverUrl).pairPhone({ code }, { timeoutMs: 10000 })) as {
		token: string;
		family: string;
		expiresAt: string;
	};
	return {
		token: response.token,
		family: response.family,
		expires_at: response.expiresAt,
	};
}

/** Native failures arrive as plain objects; screens show their message. */
async function readable<T>(call: Promise<T>): Promise<T> {
	try {
		return await call;
	} catch (cause) {
		if (isNativeServerError(cause)) throw new Error(cause.message, { cause });
		throw cause;
	}
}

/** The certificate fingerprint the FamBuddy presents, to compare with the one it prints. */
export function buddyCertificate(
	gateway: string,
	trust: FamBuddyTrustRepository = createFamBuddyTrustRepository(),
) {
	return readable(trust.certificate(gateway));
}

/** Trusts this FamBuddy only by the certificate the parent compared. */
export function confirmBuddyCertificate(
	gateway: string,
	fingerprint: string,
	trust: FamBuddyTrustRepository = createFamBuddyTrustRepository(),
) {
	return readable(trust.trust(gateway, fingerprint));
}
