import { afterEach, it, expect, vi } from "vitest";
import { startBuddyTalk } from "./talk";
afterEach(() => vi.unstubAllGlobals());
it("never opens a talk lease when microphone permission is denied", async () => {
	const command = vi.fn().mockResolvedValue({ talk: "session", settings: [], turns: [] });
	vi.stubGlobal("navigator", {
		mediaDevices: {
			getUserMedia: vi.fn().mockRejectedValue(new Error("Permission denied")),
		},
	});
	await expect(
		startBuddyTalk({ command, watch: vi.fn(), openTalk: vi.fn() }, "device", {
			onError: vi.fn(),
		}),
	).rejects.toThrow("Permission denied");
	expect(command).not.toHaveBeenCalled();
});

it("stops a late microphone grant after cancellation without opening a lease", async () => {
	let grant!: (stream: MediaStream) => void;
	const stop = vi.fn();
	const controller = new AbortController();
	const openTalk = vi.fn();
	const command = vi.fn();
	vi.stubGlobal("navigator", {
		mediaDevices: {
			getUserMedia: () =>
				new Promise<MediaStream>((resolve) => {
					grant = resolve;
				}),
		},
	});
	const result = startBuddyTalk({ command, watch: vi.fn(), openTalk }, "device", {
		signal: controller.signal,
		onError: vi.fn(),
	});
	controller.abort();
	grant({ getTracks: () => [{ stop }] } as unknown as MediaStream);
	await expect(result).rejects.toThrow("Live talk cancelled.");
	expect(stop).toHaveBeenCalledOnce();
	expect(openTalk).not.toHaveBeenCalled();
	expect(command).not.toHaveBeenCalled();
});

it("does not request microphone access after cancellation while fetching relay settings", async () => {
	let ready!: (value: RTCIceServer[]) => void;
	const getUserMedia = vi.fn();
	vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
	const controller = new AbortController();
	const openTalk = vi.fn();
	const result = startBuddyTalk(
		{
			command: vi.fn(),
			watch: vi.fn(),
			openTalk,
			iceServers: () =>
				new Promise((resolve) => {
					ready = resolve;
				}),
		},
		"device",
		{ signal: controller.signal, onError: vi.fn() },
	);
	controller.abort();
	ready([]);
	await expect(result).rejects.toThrow("Live talk cancelled.");
	expect(getUserMedia).not.toHaveBeenCalled();
	expect(openTalk).not.toHaveBeenCalled();
});
