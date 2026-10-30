import type { BuddyAnswerSource, BuddyTurn } from "./buddy";

/** "Jamie asked aloud", "A child asked aloud", "You asked in VFAM". */
export function askedBy(turn: Pick<BuddyTurn, "origin">): string {
	const origin = turn.origin;
	if (!origin) return "";
	if (origin.channel === "app")
		return origin.role === "parent" ? "A parent asked in VFAM" : "Asked in VFAM";
	const who = origin.name || (origin.role === "parent" ? "A parent" : "A child");
	return origin.channel === "voice" ? `${who} asked aloud` : `${who} asked`;
}

/** Which AI, or person, wrote the pending answer. */
export function answeredBy(source: BuddyAnswerSource): string {
	switch (source) {
		case "provider":
			return "Answered by the FamBuddy's AI provider";
		case "parent_device":
			return "Answered by family AI on a parent's device";
		case "local":
			return "Answered on the FamBuddy";
		case "cloud":
			return "Answered by a cloud AI a parent chose";
		case "parent":
			return "Written by a parent";
		default:
			return "Answer source unknown";
	}
}

/** What the hub names the destination of its fixed reply, a turn that needs no action. */
export const FIXED_REPLY_DESTINATION = "FamBuddy's fixed reply";
/** What the hub names the destination of a question on a FamBuddy without a cloud AI. */
export const ON_DEVICE_DESTINATION = "On-device AI";

/** The FamBuddy's own "please reach out to your parent" reply; shown for information only. */
export function isFixedReply(turn: Pick<BuddyTurn, "destination">): boolean {
	return turn.destination === FIXED_REPLY_DESTINATION;
}

/**
 * Why a question waiting for a parent cannot be sent to a cloud AI, or "" when it can.
 * A question records its FamBuddy's AI provider when it is asked; without one it records
 * the on-device AI.
 */
export function cloudUnavailable(turn: Pick<BuddyTurn, "destination">): string {
	return turn.destination === ON_DEVICE_DESTINATION
		? "No cloud AI is set up for this FamBuddy. Add one in its AI answers settings."
		: "";
}
