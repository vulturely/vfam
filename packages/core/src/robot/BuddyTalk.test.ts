import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import BuddyTalk from "./BuddyTalk.svelte";
import { startBuddyTalk } from "./talk";
vi.mock("./talk", () => ({ startBuddyTalk: vi.fn() }));
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

const service = { command: vi.fn(), watch: vi.fn(), openTalk: vi.fn() };

it("waits for playback instead of claiming the camera is established from signaling", async () => {
	vi.mocked(startBuddyTalk).mockResolvedValue(vi.fn(async () => {}));
	render(BuddyTalk, { service, device: "device", video: true });
	await fireEvent.click(screen.getByRole("button", { name: "Start live view" }));
	await screen.findByText("Connected. Waiting for media from the device.");
	expect(screen.queryByText("Live camera playback started.")).toBeNull();
	const video = screen.getByLabelText("FamBuddy live camera");
	await fireEvent(video, new Event("playing"));
	expect(screen.queryByText("Live camera playback started.")).toBeNull();
	Object.defineProperty(video, "videoWidth", { value: 640 });
	await fireEvent(video, new Event("playing"));
	expect(screen.getByText("Live camera playback started.")).toBeVisible();
	await fireEvent(video, new Event("waiting"));
	expect(screen.getByText("Connected. Waiting for media from the device.")).toBeVisible();
});

it("keeps a correctly labeled playback retry available after repeated rejection", async () => {
	const play = vi
		.spyOn(HTMLMediaElement.prototype, "play")
		.mockRejectedValue(new Error("NotAllowedError"));
	vi.mocked(startBuddyTalk).mockImplementation(async (_service, _device, options) => {
		options.onAudio?.({} as MediaStream);
		return vi.fn(async () => {});
	});
	render(BuddyTalk, { service, device: "device", video: true });
	await fireEvent.click(screen.getByRole("button", { name: "Start live view" }));
	const retry = await screen.findByRole("button", {
		name: "Play live video and audio",
	});
	await fireEvent.click(retry);
	expect(play).toHaveBeenCalledTimes(2);
	expect(retry).toBeVisible();
	play.mockResolvedValue();
	await fireEvent.click(retry);
	expect(screen.queryByRole("button", { name: "Play live video and audio" })).toBeNull();
	expect(screen.getByText("Connected. Waiting for media from the device.")).toBeVisible();
});

it("releases acquired media after startup and connection failures", async () => {
	const release = vi.fn();
	vi.mocked(startBuddyTalk).mockRejectedValueOnce("denied");
	render(BuddyTalk, {
		service,
		device: "device",
		acquireMedia: () => release,
	});
	await fireEvent.click(screen.getByRole("button", { name: "Start live talk" }));
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Microphone access unavailable.",
	);
	expect(release).toHaveBeenCalledOnce();
	vi.mocked(startBuddyTalk).mockImplementation(async (_service, _device, options) => {
		options.onError();
		return vi.fn(async () => {});
	});
	await fireEvent.click(screen.getByRole("button", { name: "Start live talk" }));
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		/Live talk stopped/,
	);
});

it("does not start without required media or while disabled", async () => {
	const release = vi.fn();
	const acquireMedia = vi.fn(() => undefined);
	render(BuddyTalk, { service, device: "device", acquireMedia });
	await fireEvent.click(screen.getByRole("button", { name: "Start live talk" }));
	expect(startBuddyTalk).not.toHaveBeenCalled();
	cleanup();
	render(BuddyTalk, {
		service,
		device: "device",
		startDisabled: true,
		acquireMedia: () => release,
	});
	expect(screen.getByRole("button", { name: "Start live talk" })).toBeDisabled();
	expect(startBuddyTalk).not.toHaveBeenCalled();
});

it("finishes a late start without reactivating an unmounted component", async () => {
	let resolve!: (finish: () => Promise<void>) => void;
	vi.mocked(startBuddyTalk).mockReturnValue(
		new Promise((resolvePromise) => {
			resolve = resolvePromise;
		}),
	);
	const finish = vi.fn(async () => {});
	const view = render(BuddyTalk, { service, device: "device" });
	await fireEvent.click(screen.getByRole("button", { name: "Start live talk" }));
	view.unmount();
	resolve(finish);
	await vi.waitFor(() => expect(finish).toHaveBeenCalledOnce());
	expect(screen.queryByRole("button", { name: "End live talk" })).toBeNull();
});
