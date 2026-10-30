import { expect, it, vi } from "vitest";
import type { IpcClient } from "../api/ipc";
import { createSpeechRepository } from "./speech";

it("reads text aloud through the native speech command", async () => {
	const invoke = vi.fn(async () => undefined);
	const repository = createSpeechRepository({ invoke } as unknown as IpcClient, () => true);
	expect(repository.available()).toBe(true);
	await repository.speak("apple");
	expect(invoke).toHaveBeenCalledWith("speech_speak", { input: { text: "apple" } });
});

it("stops the native voice", async () => {
	const invoke = vi.fn(async () => undefined);
	await createSpeechRepository({ invoke } as unknown as IpcClient, () => true).stop();
	expect(invoke).toHaveBeenCalledWith("speech_stop");
});
