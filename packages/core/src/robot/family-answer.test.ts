import { expect, it, vi } from "vitest";
import type { BuddyOutput, BuddyTurn } from "./buddy";
import { answerIfParentDevice, PARENT_DEVICE_DESTINATION, setFamBuddyAi } from "./family-answer";

const device = "00000000-0000-4000-8000-0000000000bb";
function turn(overrides: Partial<BuddyTurn> = {}): BuddyTurn {
	return {
		scope: {
			family: "family",
			speaker: "speaker",
			device,
			session: "session",
			turn: "turn-1",
			destination_revision: "revision",
		},
		stage: "AwaitingAnswer",
		text: "Why is the sky blue?",
		review: null,
		expires_at: new Date(Date.now() + 60_000).toISOString(),
		destination: PARENT_DEVICE_DESTINATION,
		...overrides,
	};
}
const output = (turns: BuddyTurn[]): BuddyOutput => ({ settings: [], turns });

it("answers an approved parent-device question on this device and sends only the answer", async () => {
	const familyAi = { answer: vi.fn(async () => "Sunlight scatters.") };
	const answered = output([turn({ stage: "AnswerPending", text: "Sunlight scatters." })]);
	const send = vi.fn(async () => answered);
	expect(
		await answerIfParentDevice(output([turn()]), { device, turn: "turn-1" }, familyAi, send),
	).toBe(answered);
	expect(familyAi.answer).toHaveBeenCalledWith("Why is the sky blue?");
	expect(send).toHaveBeenCalledWith({
		action: "answer",
		device,
		turn: "turn-1",
		text: "Sunlight scatters.",
	});
});

it("leaves turns alone unless they await a parent-device answer for the approved turn", async () => {
	const familyAi = { answer: vi.fn() };
	const send = vi.fn();
	for (const turns of [
		[turn({ stage: "AnswerPending" })],
		[turn({ destination: "https://api.openai.com/v1/chat/completions | gpt" })],
		[turn({ scope: { ...turn().scope, turn: "other" } })],
		[turn({ scope: { ...turn().scope, device: "other-device" } })],
		[],
	]) {
		const current = output(turns);
		expect(await answerIfParentDevice(current, { device, turn: "turn-1" }, familyAi, send)).toBe(
			current,
		);
	}
	expect(familyAi.answer).not.toHaveBeenCalled();
	expect(send).not.toHaveBeenCalled();
	await expect(
		answerIfParentDevice(output([turn()]), { device, turn: "turn-1" }, undefined, send),
	).rejects.toThrow("Set up family AI on this device");
});

it("switches FamBuddy to parent-device AI without sending any key", async () => {
	const service = { command: vi.fn(async () => output([])) };
	const familyAi = { provisionRobot: vi.fn() };
	await setFamBuddyAi("parent_device", { service, device, familyAi });
	expect(service.command).toHaveBeenCalledWith({
		action: "save_provider",
		device,
		config: {
			provider: "parent_device",
			model: "",
			endpoint: "",
			api_key: "",
			max_microusd_per_token: 0,
		},
	});
	expect(familyAi.provisionRobot).not.toHaveBeenCalled();
});

it("stores the key on FamBuddy only through a direct home-network connection", async () => {
	const service = { command: vi.fn() };
	const familyAi = { provisionRobot: vi.fn(async () => undefined) };
	await expect(setFamBuddyAi("device_key", { service, device, familyAi })).rejects.toThrow(
		"home network",
	);
	const local = { gateway: "https://buddy.local:5443", token: "pairing" };
	await setFamBuddyAi("device_key", { service, device, familyAi, local });
	expect(familyAi.provisionRobot).toHaveBeenCalledWith({ ...local, device });
	// The key itself never passes through the browser-side command channel.
	expect(service.command).not.toHaveBeenCalled();
});
