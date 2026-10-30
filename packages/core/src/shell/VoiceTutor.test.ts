import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import VoiceTutor from "./VoiceTutor.svelte";
import VoiceSettings from "./VoiceSettings.svelte";
import type { VoiceService, VoiceReply } from "../voice/service";
import type { SpeechInput } from "../voice/browser";
const reply: VoiceReply = {
	enabled: true,
	text: "Spell the fruit",
	intent: "read",
};
function setup() {
	const service: VoiceService = {
		status: vi.fn().mockResolvedValue(reply),
		policy: vi.fn().mockResolvedValue(reply),
		turn: vi.fn().mockResolvedValue(reply),
	};
	let transcribe!: (text: string) => void;
	let fail!: (message: string) => void;
	let mute!: () => void;
	const input: SpeechInput = {
		stop: vi.fn(),
		finish: vi.fn(),
		listen: vi.fn(async (t, f, m) => {
			transcribe = t;
			fail = f;
			mute = m;
		}),
	};
	const output = { stop: vi.fn(), speak: vi.fn() };
	const onAnswer = vi.fn();
	const component = render(VoiceTutor, {
		service,
		sessionId: "session",
		onAnswer,
		input,
		output,
	});
	return {
		service,
		input,
		output,
		onAnswer,
		component,
		transcribe: (s: string) => transcribe(s),
		fail: (s: string) => fail(s),
		mute: () => mute(),
	};
}
async function listen() {
	const button = await screen.findByRole("button", { name: "Hold to talk" });
	await waitFor(() => expect(button).toBeEnabled());
	await fireEvent.pointerDown(button);
}
afterEach(() => {
	cleanup();
	vi.useRealTimers();
});
it("shows consent gate and graceful permission failure", async () => {
	const s = setup();
	await listen();
	s.fail("Permission denied");
	expect(await screen.findByRole("alert")).toHaveTextContent("Permission denied");
	vi.mocked(s.service.status).mockResolvedValue({ ...reply, enabled: false });
	await listen();
	// With voice turned off the tutor disappears; typing is the only answer method.
	await waitFor(() =>
		expect(screen.queryByRole("region", { name: "FamBud voice tutor" })).toBeNull(),
	);
	expect(s.input.listen).toHaveBeenCalledTimes(1);
});
it("reads an approved response and supports physical mute and release", async () => {
	const s = setup();
	await listen();
	await fireEvent.pointerUp(await screen.findByRole("button", { name: "Hold to talk" }));
	expect(s.input.finish).toHaveBeenCalled();
	s.transcribe("read");
	await waitFor(() => expect(s.output.speak).toHaveBeenCalled());
	expect(s.service.turn).toHaveBeenCalledWith("session", "read");
	await listen();
	s.mute();
	expect(await screen.findByText("Voice is muted")).toBeVisible();
});
it("interrupt discards a delayed provider response", async () => {
	const s = setup();
	let resolve!: (reply: VoiceReply) => void;
	vi.mocked(s.service.turn).mockImplementation(
		() =>
			new Promise((r) => {
				resolve = r;
			}),
	);
	await listen();
	s.transcribe("read");
	await fireEvent.click(screen.getByRole("button", { name: "Stop voice" }));
	resolve(reply);
	await waitFor(() =>
		expect(screen.getByText("Hold the button and say your answer")).toBeVisible(),
	);
	expect(s.output.speak).not.toHaveBeenCalled();
});
it("reviews answers without saving and releases microphone on unmount", async () => {
	const s = setup();
	vi.mocked(s.service.turn).mockResolvedValue({ ...reply, intent: "answer" });
	await listen();
	s.transcribe("my answer is apple");
	await waitFor(() => expect(s.onAnswer).toHaveBeenCalledWith("apple"));
	s.component.unmount();
	expect(s.input.stop).toHaveBeenCalled();
	expect(s.output.stop).toHaveBeenCalled();
});
it("reports provider failure", async () => {
	const s = setup();
	vi.mocked(s.service.turn).mockRejectedValue(new Error("offline"));
	await listen();
	s.transcribe("read");
	expect(await screen.findByRole("alert")).toHaveTextContent("provider unavailable");
});
it("requires explicit guardian action and supports disabling", async () => {
	const service: VoiceService = {
		status: vi.fn(),
		turn: vi.fn(),
		policy: vi.fn().mockResolvedValue({ ...reply, enabled: false }),
	};
	render(VoiceSettings, { service, profileId: "profile" });
	await screen.findByText("Voice disabled · off by default");
	expect(service.policy).toHaveBeenCalledWith("profile", undefined);
	expect(service.policy).not.toHaveBeenCalledWith("profile", true);
	vi.mocked(service.policy).mockResolvedValue(reply);
	await fireEvent.click(screen.getByRole("switch", { name: "Allow browser speech processing" }));
	await screen.findByText("Voice enabled");
	expect(service.policy).toHaveBeenLastCalledWith("profile", true);
	await fireEvent.click(screen.getByRole("switch", { name: "Allow browser speech processing" }));
	await waitFor(() => expect(service.policy).toHaveBeenLastCalledWith("profile", false));
});

it("bounds delayed responses and suppresses their late completion", async () => {
	const s = setup();
	let resolve!: (value: VoiceReply) => void;
	vi.mocked(s.service.turn).mockImplementation(
		() =>
			new Promise((r) => {
				resolve = r;
			}),
	);
	await listen();
	vi.useFakeTimers();
	s.transcribe("read");
	await vi.advanceTimersByTimeAsync(10001);
	expect(screen.getByRole("alert")).toHaveTextContent("took too long");
	resolve(reply);
	await vi.advanceTimersByTimeAsync(1);
	expect(s.output.speak).not.toHaveBeenCalled();
});
it("releasing while consent is loading never opens the microphone", async () => {
	const s = setup();
	const talk = await screen.findByRole("button", { name: "Hold to talk" });
	await waitFor(() => expect(talk).toBeEnabled());
	let resolve!: (value: VoiceReply) => void;
	vi.mocked(s.service.status).mockImplementation(
		() =>
			new Promise((r) => {
				resolve = r;
			}),
	);
	const button = await screen.findByRole("button", { name: "Hold to talk" });
	await fireEvent.pointerDown(button);
	await fireEvent.pointerUp(button);
	resolve(reply);
	await waitFor(() =>
		expect(screen.getByText("Hold the button and say your answer")).toBeVisible(),
	);
	expect(s.input.listen).not.toHaveBeenCalled();
});

it("shows the cloud-processing notice and requires a successful reload after policy failure", async () => {
	const service: VoiceService = {
		status: vi.fn(),
		turn: vi.fn(),
		policy: vi
			.fn()
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValue({ ...reply, enabled: false }),
	};
	render(VoiceSettings, { service, profileId: "profile" });
	expect(await screen.findByRole("alert")).toHaveTextContent("Retry before changing permission");
	expect(screen.getByRole("switch")).toBeDisabled();
	expect(screen.getByText(/Browser speech processing may send audio/)).toBeVisible();
	await fireEvent.click(screen.getByRole("button", { name: "Retry voice settings" }));
	await waitFor(() => expect(screen.getByRole("switch")).toBeEnabled());
	expect(service.policy).not.toHaveBeenCalledWith("profile", true);
});
