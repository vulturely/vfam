import type { FamilyAiService } from "../family-ai/service";
import type { BuddyCommand, BuddyOutput } from "./buddy";

/** Destination a FamBuddy reports when its answers come from a parent device. */
export const PARENT_DEVICE_DESTINATION = "Family AI on a parent device";

/**
 * After a parent approves a question, a FamBuddy using parent-device AI waits for
 * this device to answer with the family's key. The answer still needs parent review.
 */
export async function answerIfParentDevice(
	output: BuddyOutput,
	approved: { device: string; turn: string },
	familyAi: Pick<FamilyAiService, "answer"> | undefined,
	send: (command: BuddyCommand) => Promise<BuddyOutput>,
): Promise<BuddyOutput> {
	const waiting = output.turns.find(
		(turn) =>
			turn.scope.turn === approved.turn &&
			turn.scope.device === approved.device &&
			turn.stage === "AwaitingAnswer" &&
			turn.destination === PARENT_DEVICE_DESTINATION,
	);
	if (!waiting) return output;
	if (!familyAi) throw new Error("Set up family AI on this device to answer FamBuddy questions.");
	const answer = await familyAi.answer(waiting.text);
	return send({ action: "answer", device: approved.device, turn: approved.turn, text: answer });
}

export type FamBuddyAiMode = "parent_device" | "device_key";

/**
 * Chooses how a FamBuddy gets answers. Parent-device AI stores no key on the device;
 * a device key is sent only over a direct home-network connection, never via Vulture.
 */
export async function setFamBuddyAi(
	mode: FamBuddyAiMode,
	target: {
		service: { command(command: BuddyCommand): Promise<BuddyOutput> };
		device: string;
		familyAi: Pick<FamilyAiService, "provisionRobot">;
		local?: { gateway: string; token: string };
	},
): Promise<void> {
	if (mode === "device_key") {
		if (!target.local)
			throw new Error("Connect to this FamBuddy on your home network to store the key on it.");
		await target.familyAi.provisionRobot({ ...target.local, device: target.device });
		return;
	}
	await target.service.command({
		action: "save_provider",
		device: target.device,
		config: {
			provider: "parent_device",
			model: "",
			endpoint: "",
			api_key: "",
			max_microusd_per_token: 0,
		},
	});
}
