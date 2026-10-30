import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import CallScreen from "./CallScreen.svelte";
import type { CallState } from "../calls/service";
import type { Runtime } from "../runtime/registry.svelte";

function setup(initial: CallState) {
	let listener: ((state: CallState) => void) | undefined;
	const calls = {
		start: vi.fn(async () => {}),
		subscribe: vi.fn((next) => {
			listener = next;
			next(initial);
			return () => {};
		}),
		call: vi.fn(async () => {}),
		accept: vi.fn(async () => {}),
		hangup: vi.fn(async () => {}),
		mute: vi.fn(),
		camera: vi.fn(),
		close: vi.fn(),
	};
	const runtime = {
		state: { identity: { name: "Parent" } },
		services: { calls },
	} as unknown as Runtime;
	const onActiveChange = vi.fn();
	render(CallScreen, {
		props: { embedded: true, onActiveChange },
		context: new Map([["vulture:runtime", runtime]]),
	});
	return { calls, publish: (state: CallState) => listener?.(state), onActiveChange };
}

const devices = [
	{ id: "peer", name: "Family tablet", accountId: "sam", busy: false },
	{ id: "busy", name: "Busy tablet", accountId: "other", busy: true },
];
const base: CallState = {
	available: true,
	phase: "idle",
	devices,
	peer: "",
	video: false,
	muted: false,
	cameraOff: false,
	error: "",
	notice: "",
};

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it("starts calls and disables busy devices", async () => {
	const { calls } = setup(base);
	await fireEvent.click(screen.getAllByRole("button", { name: "Audio call", exact: true })[0]);
	expect(calls.call).toHaveBeenCalledWith(devices[0], false);
	await fireEvent.click(screen.getAllByRole("button", { name: "Video call", exact: true })[0]);
	expect(calls.call).toHaveBeenCalledWith(devices[0], true);
	expect(screen.getByText("Busy tablet · Busy")).toBeVisible();
});

it("handles ringing, connected media controls, and playback recovery", async () => {
	vi.stubGlobal("MediaStream", class {});
	const { calls, publish } = setup(base);
	publish({
		...base,
		phase: "ringing",
		peer: "Family tablet",
		video: true,
	});
	expect(await screen.findByText("Incoming video call")).toBeVisible();
	await fireEvent.click(screen.getByRole("button", { name: "Reject" }));
	expect(calls.hangup).toHaveBeenCalledOnce();
	await fireEvent.click(screen.getByRole("button", { name: "Accept" }));
	expect(calls.accept).toHaveBeenCalledOnce();
	const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new Error("blocked"));
	publish({
		...base,
		phase: "connected",
		peer: "Family tablet",
		video: true,
		muted: true,
		cameraOff: true,
		local: new MediaStream(),
		remote: new MediaStream(),
	});
	expect(await screen.findByRole("status")).toHaveTextContent("Connected");
	expect(screen.getByText("Camera off")).toBeVisible();
	await fireEvent.click(screen.getByRole("button", { name: "Unmute" }));
	expect(calls.mute).toHaveBeenCalledOnce();
	await fireEvent.click(screen.getByRole("button", { name: "Turn camera on" }));
	expect(calls.camera).toHaveBeenCalledOnce();
	const remote = screen.getByLabelText("Family device media") as HTMLVideoElement;
	publish({ ...base, phase: "connected", video: true, remote: new MediaStream() });
	expect(await screen.findByRole("button", { name: "Play call audio" })).toBeVisible();
	play.mockResolvedValue(undefined);
	await fireEvent.click(screen.getByRole("button", { name: "Play call audio" }));
	await waitFor(() => expect(remote.play).toHaveBeenCalled());
	await fireEvent.click(screen.getByRole("button", { name: "Hang up" }));
	expect(calls.hangup).toHaveBeenCalledTimes(2);
	await fireEvent.click(screen.getByRole("button", { name: "Minimize call" }));
});
