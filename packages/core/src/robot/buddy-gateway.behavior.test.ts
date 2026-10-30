import { describe, expect, it } from "vitest";
import { gatewayOutput, parentRequest } from "./buddy-gateway";
import type { BuddyCommand } from "./buddy";
import {
	AiMode,
	AnswerSource,
	AskerRole,
	GatewayOutput,
	LicenseState,
	TurnReview,
	TurnScope,
	TurnStage,
	UpdateState,
	VoiceLabel,
} from "../api/protocol";

const base = {
	family: "family",
	device: "device",
	turn: "turn",
	review: [1, 2],
	text: "text",
	session: "session",
	pcm: "AQID",
	config: {
		provider: "openai",
		model: "model",
		endpoint: "https://ai.example",
		api_key: "secret",
		max_microusd_per_token: 2,
		revision: "revision",
		generation: "1",
		destination: "destination",
	},
};

it("maps every parent command variant to the generated request", () => {
	const cases: [BuddyCommand["action"], string][] = [
		["list", "list"],
		["configure_camera", "configureCamera"],
		["configure_captions", "configureCaptions"],
		["configure_screen_pin", "configureScreenPin"],
		["configure_updates", "configureUpdates"],
		["install_update", "installUpdate"],
		["ask", "ask"],
		["configure", "configure"],
		["approve", "approve"],
		["edit", "edit"],
		["cancel", "cancel"],
		["announce", "announce"],
		["save_provider", "saveProvider"],
		["revoke", "revoke"],
		["start_talk", "startTalk"],
		["stop_talk", "stopTalk"],
		["talk", "talk"],
		["logout", "logout"],
	];
	for (const [action, expected] of cases) {
		const request = parentRequest({ action, ...base } as BuddyCommand);
		expect(request[expected]).toBeDefined();
	}
	expect(parentRequest({ action: "approve", ...base }).approve).toMatchObject({
		device: "device",
		turn: "turn",
		review: new Uint8Array([1, 2]),
	});
	expect(
		parentRequest({ action: "configure_screen_pin", device: "device", pin: "1234" })
			.configureScreenPin,
	).toEqual({ device: "device", pin: "1234" });
	expect(
		parentRequest({ action: "configure_screen_pin", device: "device", pin: "" }).configureScreenPin,
	).toEqual({ device: "device", pin: "" });
	expect(
		parentRequest({ action: "configure_updates", device: "device", automatic: true })
			.configureUpdates,
	).toEqual({ device: "device", automatic: true });
	expect(
		parentRequest({ action: "configure_updates", device: "device", automatic: false })
			.configureUpdates,
	).toEqual({ device: "device", automatic: false });
	expect(parentRequest({ action: "install_update", device: "device" }).installUpdate).toEqual({
		device: "device",
	});
	expect(parentRequest({ action: "talk", ...base }).talk).toMatchObject({
		pcm: new Uint8Array([1, 2, 3]),
	});
	expect(parentRequest({ action: "talk", ...base, pcm: null }).talk).toMatchObject({
		pcm: undefined,
	});
	expect(parentRequest({ action: "save_provider", ...base }).saveProvider).toMatchObject({
		device: "device",
		config: {
			provider: "openai",
			model: "model",
			endpoint: "https://ai.example",
			apiKey: "secret",
			maxMicrousdPerToken: 2n,
			revision: "revision",
			generation: "1",
			destination: "destination",
		},
	});
});

describe("gateway output mapping", () => {
	it("maps every update state to readable text and anything else to unknown", () => {
		const states = [
			UpdateState.CURRENT,
			UpdateState.AVAILABLE,
			UpdateState.INSTALLING,
			UpdateState.FAILED,
			UpdateState.UNSPECIFIED,
			99 as UpdateState,
			undefined,
		].map(
			(updateState) =>
				gatewayOutput(new GatewayOutput({ settings: [{ device: "device", updateState }] }))
					.settings[0].update_state,
		);
		expect(states).toEqual([
			"current",
			"available",
			"installing",
			"failed",
			"unknown",
			"unknown",
			"unknown",
		]);
	});

	it("maps settings, every review stage, playback, and audio", () => {
		const turns = [
			TurnStage.QUESTION_PENDING,
			TurnStage.QUESTION_APPROVED,
			TurnStage.AWAITING_ANSWER,
			TurnStage.ANSWER_PENDING,
			TurnStage.ANSWER_APPROVED,
			TurnStage.PLAYBACK_CLAIMED,
			TurnStage.CANCELLED,
			TurnStage.NEEDS_PARENT,
		].map(
			(stage) =>
				new TurnReview({
					scope: new TurnScope({
						family: "family",
						speaker: "speaker",
						device: "device",
						session: "session",
						turn: "turn",
						destinationRevision: "revision",
					}),
					stage,
					text: "text",
					review: new Uint8Array([1]),
					expiresAt: "later",
					destination: "destination",
				}),
		);
		const result = gatewayOutput(
			new GatewayOutput({
				settings: [
					{
						device: "device",
						wakeWord: "buddy",
						muted: true,
						cameraEnabled: true,
						captionsEnabled: true,
						screenPinSet: true,
						autoUpdate: true,
						installedVersion: "v0.1.56",
						availableVersion: "v0.1.57",
						updateState: UpdateState.AVAILABLE,
						updateRequested: true,
					},
				],
				turns,
				captions: [{ device: "device", turn: "turn", text: "Hello", startedAt: "now" }],
				talk: "talk",
				audio: [new Uint8Array([1, 2, 3])],
			}),
		);
		expect(result.settings[0]).toEqual({
			device: "device",
			wake_word: "buddy",
			muted: true,
			camera_enabled: true,
			captions_enabled: true,
			screen_pin_set: true,
			auto_update: true,
			installed_version: "v0.1.56",
			available_version: "v0.1.57",
			update_state: "available",
			update_requested: true,
			// An older FamBuddy does not report a license.
			license: { state: "unknown", edition: "", features: [], expires_at: "" },
			// Nor an AI mode or on-device AI.
			ai_mode: "unknown",
			local_ai: false,
		});
		expect(result.captions).toEqual([
			{ device: "device", turn: "turn", text: "Hello", started_at: "now" },
		]);
		expect(result.turns.map((turn) => turn.stage)).toEqual([
			"QuestionPending",
			"QuestionApproved",
			"AwaitingAnswer",
			"AnswerPending",
			"AnswerApproved",
			"PlaybackClaimed",
			"Cancelled",
			"NeedsParent",
		]);
		expect(result.turns[0]).toMatchObject({
			text: "text",
			review: [1],
			expires_at: "later",
			destination: "destination",
		});
		expect(result.talk).toBe("talk");
		expect(result.audio).toEqual(["AQID"]);
	});

	it("rejects missing output and scope", () => {
		expect(() => gatewayOutput(undefined)).toThrow("Missing FamBuddy response");
		expect(() => gatewayOutput(new GatewayOutput({ turns: [{}] }))).toThrow(
			"Invalid FamBuddy review",
		);
	});

	it("leaves out a turn in an unknown stage and keeps the rest of the view", () => {
		const result = gatewayOutput(
			new GatewayOutput({
				settings: [{ device: "device" }],
				turns: [
					{ scope: new TurnScope({ turn: "unspecified" }), stage: TurnStage.UNSPECIFIED },
					{ scope: new TurnScope({ turn: "future" }), stage: 99 as TurnStage },
					{ scope: new TurnScope({ turn: "waiting" }), stage: TurnStage.NEEDS_PARENT },
				],
			}),
		);
		expect(result.turns.map((turn) => [turn.scope.turn, turn.stage])).toEqual([
			["waiting", "NeedsParent"],
		]);
		expect(result.settings).toHaveLength(1);
	});
});

describe("revise, voices and who asked", () => {
	it("maps revise and voice labels to the contract", () => {
		expect(
			parentRequest({
				action: "revise",
				device: "device",
				turn: "turn",
				instruction: "simpler",
			}).revise,
		).toEqual({ device: "device", turn: "turn", instruction: "simpler" });
		expect(
			parentRequest({
				action: "label_voice",
				device: "device",
				speaker: "speaker",
				name: "Jamie",
				role: "child",
			}).labelVoice,
		).toEqual({ device: "device", speaker: "speaker", name: "Jamie", role: AskerRole.CHILD });
		expect(
			parentRequest({
				action: "label_voice",
				device: "device",
				speaker: "speaker",
				name: "Mum",
				role: "parent",
			}).labelVoice,
		).toMatchObject({ role: AskerRole.PARENT });
	});

	it("maps origins, answer sources and voices, treating unknown askers as children", () => {
		const scope = new TurnScope({ device: "device", turn: "turn" });
		const result = gatewayOutput(
			new GatewayOutput({
				turns: [
					new TurnReview({
						scope,
						stage: TurnStage.ANSWER_PENDING,
						origin: { name: "Jamie", role: AskerRole.CHILD, channel: "voice" },
						answeredBy: AnswerSource.LOCAL,
					}),
					new TurnReview({
						scope,
						stage: TurnStage.QUESTION_PENDING,
						origin: { role: AskerRole.PARENT, channel: "app" },
						answeredBy: AnswerSource.PARENT_DEVICE,
					}),
					new TurnReview({ scope, stage: TurnStage.QUESTION_PENDING, origin: { channel: "x" } }),
					new TurnReview({ scope, stage: TurnStage.QUESTION_PENDING }),
				],
				voiceLabels: [
					new VoiceLabel({ speaker: "a", name: "Jamie", role: AskerRole.CHILD }),
					new VoiceLabel({ speaker: "b", name: "", role: AskerRole.UNSPECIFIED }),
					new VoiceLabel({ speaker: "c", name: "Mum", role: AskerRole.PARENT }),
				],
			}),
		);
		expect(result.turns.map((turn) => [turn.origin, turn.answered_by])).toEqual([
			[{ name: "Jamie", role: "child", channel: "voice" }, "local"],
			[{ name: "", role: "parent", channel: "app" }, "parent_device"],
			[{ name: "", role: "child", channel: "" }, "unknown"],
			[{ name: "", role: "child", channel: "" }, "unknown"],
		]);
		expect(result.voices).toEqual([
			{ speaker: "a", name: "Jamie", role: "child" },
			{ speaker: "b", name: "", role: "child" },
			{ speaker: "c", name: "Mum", role: "parent" },
		]);
		for (const [source, expected] of [
			[AnswerSource.PROVIDER, "provider"],
			[AnswerSource.CLOUD, "cloud"],
			[AnswerSource.PARENT, "parent"],
		] as const)
			expect(
				gatewayOutput(
					new GatewayOutput({
						turns: [new TurnReview({ scope, stage: TurnStage.ANSWER_PENDING, answeredBy: source })],
					}),
				).turns[0].answered_by,
			).toBe(expected);
	});
});

describe("FamBuddy licenses", () => {
	it("sends a license, or an empty token to remove it, for one device", () => {
		expect(
			parentRequest({ action: "install_license", device: "device", token: "sap" }).installLicense,
		).toEqual({ device: "device", token: "sap" });
		expect(
			parentRequest({ action: "install_license", device: "device", token: "" }).installLicense,
		).toEqual({ device: "device", token: "" });
	});

	it("maps each device's license state, edition, features and end", () => {
		const settings = (state: LicenseState) => ({
			device: state.toString(),
			license: {
				state,
				edition: "Family",
				features: ["fambuddy.live_camera"],
				expiresAt: "2027-01-01T00:00:00Z",
			},
		});
		const result = gatewayOutput(
			new GatewayOutput({
				settings: [
					settings(LicenseState.VALID),
					settings(LicenseState.EXPIRED),
					settings(LicenseState.NONE),
					settings(LicenseState.UNSPECIFIED),
				],
			}),
		);
		expect(result.settings.map((item) => item.license?.state)).toEqual([
			"valid",
			"expired",
			"none",
			"unknown",
		]);
		expect(result.settings[0].license).toEqual({
			state: "valid",
			edition: "Family",
			features: ["fambuddy.live_camera"],
			expires_at: "2027-01-01T00:00:00Z",
		});
	});
});

describe("on-device AI", () => {
	it("sends each AI mode, and unspecified for the default", () => {
		for (const [mode, expected] of [
			["unspecified", AiMode.UNSPECIFIED],
			["local_only", AiMode.LOCAL_ONLY],
			["local_first", AiMode.LOCAL_FIRST],
			["cloud_only", AiMode.CLOUD_ONLY],
		] as const)
			expect(
				parentRequest({ action: "configure_ai_mode", device: "device", mode }).configureAiMode,
			).toEqual({ device: "device", mode: expected });
	});

	it("asks the cloud for one waiting question", () => {
		expect(parentRequest({ action: "ask_cloud", device: "device", turn: "turn" }).askCloud).toEqual(
			{ device: "device", turn: "turn" },
		);
	});

	it("maps the AI mode in effect and whether on-device AI is available", () => {
		const result = gatewayOutput(
			new GatewayOutput({
				settings: [
					{ device: "a", aiMode: AiMode.LOCAL_ONLY, localAi: true },
					{ device: "b", aiMode: AiMode.LOCAL_FIRST },
					{ device: "c", aiMode: AiMode.CLOUD_ONLY },
					{ device: "d", aiMode: AiMode.UNSPECIFIED },
					{ device: "e", aiMode: 42 as AiMode },
				],
			}),
		);
		expect(result.settings.map((item) => [item.ai_mode, item.local_ai])).toEqual([
			["local_only", true],
			["local_first", false],
			["cloud_only", false],
			["unknown", false],
			["unknown", false],
		]);
	});

	it("marks the fixed reply as answered on the FamBuddy", () => {
		const result = gatewayOutput(
			new GatewayOutput({
				turns: [
					new TurnReview({
						scope: new TurnScope({ turn: "reply" }),
						stage: TurnStage.ANSWER_APPROVED,
						destination: "FamBuddy's fixed reply",
						answeredBy: AnswerSource.LOCAL,
					}),
				],
			}),
		);
		expect(result.turns[0]).toMatchObject({
			stage: "AnswerApproved",
			destination: "FamBuddy's fixed reply",
			answered_by: "local",
		});
	});
});
