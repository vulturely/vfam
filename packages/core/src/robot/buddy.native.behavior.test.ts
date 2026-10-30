import { beforeEach, expect, it, vi } from "vitest";
import { createBuddyService } from "./buddy";
import { GatewayOutput } from "../api/protocol";

const client = vi.hoisted(() => ({
	parentCommand: vi.fn(),
	watchParent: vi.fn(),
	openTalk: vi.fn(),
}));
vi.mock("../repositories/nativeClient", () => ({ createNativeClient: () => client }));

beforeEach(() => vi.clearAllMocks());

it("sends commands and maps native watch responses", async () => {
	client.parentCommand.mockResolvedValue({ output: new GatewayOutput() });
	client.watchParent.mockReturnValue(
		(async function* () {
			yield { output: new GatewayOutput({ settings: [{ device: "device", wakeWord: "buddy" }] }) };
		})(),
	);
	const service = createBuddyService("https://gateway.example", {
		getAccessToken: async () => "vps_parent",
	});
	expect((await service.command({ action: "list", family: "family" })).settings).toEqual([]);
	const updates = [];
	for await (const update of service.watch("family", new AbortController().signal))
		updates.push(update);
	expect(updates[0].settings[0]).toMatchObject({ device: "device", wake_word: "buddy" });
	expect(client.watchParent).toHaveBeenCalledWith(
		{ family: "family" },
		expect.objectContaining({ headers: { authorization: "Bearer vps_parent" }, timeoutMs: 0 }),
	);
});

it("converts ICE settings and streams native talk answers", async () => {
	client.openTalk.mockReturnValue(
		(async function* () {
			yield { session: "session", answer: "answer" };
		})(),
	);
	const service = createBuddyService("https://gateway.example", {
		getAccessToken: async () => "vps_parent",
	});
	const signal = new AbortController().signal;
	const answers = [];
	for await (const answer of service.openTalk("device", "offer", signal, {
		video: true,
		iceServers: [
			{ urls: "turn:one", username: "user", credential: "secret" },
			{ urls: ["turn:two"], credential: { macKey: "key" } as unknown as string },
		],
	}))
		answers.push(answer);
	expect(answers).toEqual([{ session: "session", answer: "answer" }]);
	expect(client.openTalk.mock.calls[0][0]).toMatchObject({
		device: "device",
		offer: "offer",
		video: true,
		iceServers: [
			{ urls: ["turn:one"], username: "user", credential: "secret" },
			{ urls: ["turn:two"], username: "", credential: "" },
		],
	});
});

it("requires a parent token for every native operation", async () => {
	const service = createBuddyService("https://gateway.example", {
		getAccessToken: async () => null,
	});
	await expect(service.command({ action: "list", family: "family" })).rejects.toThrow(
		"Parent sign-in required",
	);
	await expect(async () => {
		for await (const _update of service.watch("family", new AbortController().signal)) {
			void _update;
		}
	}).rejects.toThrow("Parent sign-in required");
	await expect(async () => {
		for await (const _answer of service.openTalk("device", "offer", new AbortController().signal)) {
			void _answer;
		}
	}).rejects.toThrow("Parent sign-in required");
	expect(client.parentCommand).not.toHaveBeenCalled();
});
