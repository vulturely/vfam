import { afterEach, expect, it, vi } from "vitest";
import { mediaSignaling } from "./media";

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

it("opens media, normalizes ICE servers, filters sessions and cleans up", async () => {
	const send = vi.fn().mockResolvedValue({ talk: "session" });
	const signaling = mediaSignaling(send, "family");
	const controller = new AbortController();
	const events = signaling.open("device", "offer", controller.signal, {
		video: true,
		iceServers: [
			{ urls: "stun:relay.example" },
			{
				urls: ["turn:relay.example"],
				username: "user",
				credential: "credential",
			},
		],
	});
	const next = events.next();
	await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
	signaling.receive({ session: "other", answer: "wrong" });
	signaling.receive({ session: "session", answer: "answer" });

	await expect(next).resolves.toEqual({
		value: { session: "session", answer: "answer" },
		done: false,
	});
	expect(send).toHaveBeenCalledWith(
		{ action: "list", family: "family" },
		{
			device: "device",
			offer: "offer",
			video: true,
			ice_servers: [
				{ urls: ["stun:relay.example"], username: "", credential: "" },
				{ urls: ["turn:relay.example"], username: "user", credential: "credential" },
			],
		},
	);
	controller.abort();
	await expect(events.next()).resolves.toEqual({ value: undefined, done: true });
	expect(send).toHaveBeenCalledWith({ action: "stop_talk", device: "device", session: "session" });
});

it("reports disconnected media sessions", async () => {
	const send = vi.fn().mockResolvedValue({ talk: "session" });
	const signaling = mediaSignaling(send, "family");
	const events = signaling.open("device", "offer", new AbortController().signal);
	const next = events.next();
	await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
	signaling.disconnect();
	await expect(next).rejects.toThrow("Encrypted media connection ended.");
});

it("rejects devices that do not authorize media", async () => {
	const send = vi.fn().mockResolvedValue({});
	const signaling = mediaSignaling(send, "family");
	const events = signaling.open("device", "offer", new AbortController().signal);
	await expect(events.next()).rejects.toThrow("Device did not authorize live media.");
	expect(send).toHaveBeenCalledOnce();
});

it("bounds queued signaling events", async () => {
	const send = vi.fn().mockResolvedValue({ talk: "session" });
	const signaling = mediaSignaling(send, "family");
	const events = signaling.open("device", "offer", new AbortController().signal);
	const next = events.next();
	await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
	for (let index = 0; index < 9; index++)
		signaling.receive({ session: "session", answer: `answer-${index}` });
	await expect(next).rejects.toThrow("Media signaling overflow.");
});

it("honors an already-aborted signal", async () => {
	const send = vi.fn();
	const controller = new AbortController();
	controller.abort();
	const signaling = mediaSignaling(send, "family");
	await expect(signaling.open("device", "offer", controller.signal).next()).rejects.toThrow();
	expect(send).not.toHaveBeenCalled();
});

it("renews capture leases and reports renewal failures", async () => {
	vi.useFakeTimers();
	const send = vi.fn().mockImplementation((command) => {
		if (command.action === "list") return Promise.resolve({ talk: "session" });
		if (command.action === "talk") return Promise.reject(new Error("expired"));
		return Promise.resolve({});
	});
	const signaling = mediaSignaling(send, "family");
	const events = signaling.open("device", "offer", new AbortController().signal);
	const next = events.next();
	const rejection = expect(next).rejects.toThrow("Live media permission ended.");
	await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
	await vi.advanceTimersByTimeAsync(5000);
	await rejection;
});
