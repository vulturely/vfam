import { expect, it } from "vitest";
import { remoteOutput } from "./output";

it("reads the hub's voice labels and treats unlabelled voices as children", () => {
	const base = { settings: [], turns: [] };
	expect(remoteOutput(base)).toEqual(base);
	expect(
		remoteOutput({
			...base,
			voice_labels: [
				{ speaker: "a", name: "Mum", role: "parent" },
				{ speaker: "b", name: "", role: "unspecified" },
				{},
			],
		}),
	).toEqual({
		...base,
		voices: [
			{ speaker: "a", name: "Mum", role: "parent" },
			{ speaker: "b", name: "", role: "child" },
			{ speaker: "", name: "", role: "child" },
		],
	});
});

it("reads each FamBuddy's license from the hub's JSON", () => {
	const settings = { device: "d", wake_word: "hi", muted: false };
	const output = remoteOutput({
		turns: [],
		settings: [
			{
				...settings,
				license: {
					state: "valid",
					edition: "Family",
					features: ["fambuddy.live_camera"],
					expires_at: null,
				},
			},
			{ ...settings, license: { state: "unspecified" } },
			{ ...settings, license: "broken" },
			settings,
		] as never,
	});
	expect(output.settings.map((item) => item.license)).toEqual([
		{ state: "valid", edition: "Family", features: ["fambuddy.live_camera"], expires_at: "" },
		{ state: "unknown", edition: "", features: [], expires_at: "" },
		undefined,
		undefined,
	]);
	expect(remoteOutput({ turns: [] } as never).settings).toEqual([]);
	expect(
		remoteOutput({
			turns: [],
			settings: [{ ...settings, license: { state: "expired", expires_at: "2026-01-01" } }],
		} as never).settings[0].license,
	).toMatchObject({ state: "expired", expires_at: "2026-01-01" });
});

it("flattens the hub's nested update status", () => {
	const settings = (updates: unknown) =>
		remoteOutput({
			settings: [{ device: "d", wake_word: "w", muted: false, updates } as never],
			turns: [],
		}).settings[0];
	expect(
		settings({
			automatic: true,
			installed: "v0.1.5",
			available: "v0.1.6",
			state: "available",
			requested: true,
		}),
	).toMatchObject({
		auto_update: true,
		installed_version: "v0.1.5",
		available_version: "v0.1.6",
		update_state: "available",
		update_requested: true,
	});
	expect(settings({ state: "unspecified", installed: 7 })).toMatchObject({
		auto_update: false,
		installed_version: "",
		update_state: "unknown",
		update_requested: false,
	});
	expect(settings(undefined)).not.toHaveProperty("update_state");
});

it("reads the AI mode in effect and whether on-device AI is available", () => {
	const settings = (extra: object) =>
		remoteOutput({
			settings: [{ device: "d", wake_word: "w", muted: false, ...extra } as never],
			turns: [],
		}).settings[0];
	expect(settings({ ai_mode: "local_only", local_ai: true })).toMatchObject({
		ai_mode: "local_only",
		local_ai: true,
	});
	expect(settings({ ai_mode: "local_first" }).ai_mode).toBe("local_first");
	expect(settings({ ai_mode: "cloud_only", local_ai: "yes" })).toMatchObject({
		ai_mode: "cloud_only",
		local_ai: false,
	});
	// An older FamBuddy reports neither.
	expect(settings({ ai_mode: "unspecified" })).toMatchObject({
		ai_mode: "unknown",
		local_ai: false,
	});
	expect(settings({})).toMatchObject({ ai_mode: "unknown", local_ai: false });
});

it("keeps questions waiting for a parent and leaves out stages it does not know", () => {
	const turn = (stage: string) => ({ stage, scope: { turn: stage } });
	const output = remoteOutput({
		settings: [],
		turns: [turn("NeedsParent"), turn("SomethingNew"), turn("AnswerPending")] as never,
		voice_labels: [],
	});
	expect(output.turns.map((item) => item.stage)).toEqual(["NeedsParent", "AnswerPending"]);
	expect(remoteOutput({ settings: [] } as never).turns).toEqual([]);
});
