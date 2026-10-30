import type { Page } from "@playwright/test";
import { seedOidcSession } from "../../../integration/fixtures";
import { nativeResponse } from "../../../integration/nativeRpc";
import { GatewayOutput, TurnStage } from "../../../../packages/core/src/api/protocol";

export const deviceId = "00000000-0000-0000-0000-000000000020";
const family = "00000000-0000-0000-0000-000000000010";
const owner = "00000000-0000-0000-0000-000000000001";
export const gateway = "https://fambuddy-emulator.invalid";
export const pairingCode = "synthetic-pairing-code";

interface GatewayCall {
	command: { case: string; value: Record<string, unknown> };
}

/** Synthetic native boundary; no credentials or commands reach a real gateway. */
export async function installFixture(page: Page) {
	const calls: GatewayCall[] = [];
	const output = new GatewayOutput({
		settings: [{ device: deviceId, wakeWord: "hey buddy", muted: false }],
		turns: [
			{
				scope: {
					family,
					device: deviceId,
					speaker: owner,
					session: owner,
					turn: owner,
					destinationRevision: "test-provider",
				},
				stage: TurnStage.QUESTION_PENDING,
				text: "Why is the sky blue?",
				review: new Uint8Array(32).fill(1),
				expiresAt: new Date(Date.now() + 300000).toISOString(),
				destination: "Synthetic test provider",
			},
		],
	});
	await page.route("**/vulture.server.v1.VultureControl/*", (route) => nativeResponse(route));
	await page.route("**/vulture.server.v1.RobotGatewayService/*", (route) => nativeResponse(route));
	await page.route("**/vulture.server.v1.VultureControl/GetMyFamily", (route) =>
		nativeResponse(route, { family: { id: family, name: "Emulator test household" } }),
	);
	await seedOidcSession(page);
	await page.route(`${gateway}/**`, async (route) => {
		if (route.request().method() === "OPTIONS") return nativeResponse(route);
		const input = route.request().postDataJSON();
		const path = new URL(route.request().url()).pathname;
		if (path === "/vulture.fambuddy.v1.FamBuddyGatewayService/PairPhone") {
			if (input.code !== pairingCode) return nativeResponse(route, undefined, 16);
			return nativeResponse(route, {
				token: `vps_${"b".repeat(64)}`,
				family,
				expiresAt: new Date(Date.now() + 3600000).toISOString(),
			});
		}
		if (path === "/vulture.fambuddy.v1.FamBuddyGatewayService/WatchParent") {
			return nativeResponse(route, { output });
		}
		if (path !== "/vulture.fambuddy.v1.FamBuddyGatewayService/ParentCommand")
			return nativeResponse(route, undefined, 12);
		const [[action, value]] = Object.entries(input) as [[string, Record<string, unknown>]];
		const command = { case: action, value };
		calls.push({ command });
		if (command.case === "approve") {
			const turn = output.turns[0];
			if (turn.stage === TurnStage.QUESTION_PENDING) {
				turn.stage = TurnStage.ANSWER_PENDING;
				turn.text = "Sunlight scatters.";
				turn.review = new Uint8Array(32).fill(2);
			} else {
				output.turns = [];
			}
		} else if (command.case === "cancel") {
			output.turns = [];
		} else if (command.case === "configure") {
			output.settings[0].muted = Boolean(command.value.muted);
			output.settings[0].wakeWord = String(command.value.wakeWord);
			if (command.value.muted) output.turns = [];
		} else if (command.case === "revoke") {
			output.settings = [];
			output.turns = [];
		}
		await nativeResponse(route, { output });
	});
	return { calls, cleanup: () => Promise.resolve() };
}
