import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/svelte";
import { afterEach, describe, it, expect, vi } from "vitest";
import BuddyControls from "./BuddyControls.svelte";
import type { BuddyCommand, BuddyService, BuddyOutput } from "./buddy";
afterEach(cleanup);
describe("FamBuddy parent review", () => {
	it("requires separate approval and refuses an unsaved edit", async () => {
		const output: BuddyOutput = {
			settings: [],
			turns: [
				{
					scope: {
						family: "family",
						speaker: "speaker",
						device: "device",
						session: "session",
						turn: "turn",
						destination_revision: "provider",
					},
					stage: "QuestionPending",
					text: "Why is the sky blue?",
					review: [1, 2, 3],
					expires_at: new Date(Date.now() + 60000).toISOString(),
					destination: "approved endpoint | model",
				},
			],
		};
		const calls: BuddyCommand[] = [];
		const service: BuddyService = {
			openTalk: vi.fn(),
			async *watch(_family, signal) {
				yield structuredClone(output);
				await new Promise<void>((resolve) =>
					signal.addEventListener("abort", () => resolve(), { once: true }),
				);
			},
			command: vi.fn(async (command) => {
				calls.push(command);
				if (command.action === "approve") {
					output.turns[0] = {
						...output.turns[0],
						stage: "AnswerPending",
						text: "Sunlight scatters.",
						review: [4, 5, 6],
					};
				}
				return structuredClone(output);
			}),
		};
		render(BuddyControls, { service, familyId: "family" });
		const approve = await screen.findByRole("button", {
			name: "Approve question and send to AI",
		});
		const editor = screen.getByLabelText("Edit reviewed text");
		await fireEvent.input(editor, { target: { value: "New question" } });
		expect(approve).toBeDisabled();
		await fireEvent.input(editor, {
			target: { value: "Why is the sky blue?" },
		});
		await fireEvent.click(approve);
		await screen.findByText("Sunlight scatters.");
		// A new review clears the question draft and still needs another click.
		expect(calls.filter((c) => c.action === "approve")).toHaveLength(1);
		const answer = screen.getByRole("button", {
			name: "Approve answer for speech",
		});
		await waitFor(() => expect(answer).toBeEnabled());
		await fireEvent.click(answer);
		await waitFor(() => expect(calls.filter((c) => c.action === "approve")).toHaveLength(2));
	});
});

it("answers an approved parent-device question with this device's family AI", async () => {
	const output: BuddyOutput = {
		settings: [],
		turns: [
			{
				scope: {
					family: "family",
					speaker: "speaker",
					device: "device",
					session: "session",
					turn: "turn",
					destination_revision: "provider",
				},
				stage: "QuestionPending",
				text: "Why is the sky blue?",
				review: [1, 2, 3],
				expires_at: new Date(Date.now() + 60000).toISOString(),
				destination: "Family AI on a parent device",
			},
		],
	};
	const calls: BuddyCommand[] = [];
	const service: BuddyService = {
		openTalk: vi.fn(),
		async *watch(_family, signal) {
			yield structuredClone(output);
			await new Promise<void>((resolve) =>
				signal.addEventListener("abort", () => resolve(), { once: true }),
			);
		},
		command: vi.fn(async (command) => {
			calls.push(command);
			if (command.action === "approve")
				output.turns[0] = { ...output.turns[0], stage: "AwaitingAnswer", review: null };
			if (command.action === "answer")
				output.turns[0] = {
					...output.turns[0],
					stage: "AnswerPending",
					text: command.text,
					review: [4, 5, 6],
				};
			return structuredClone(output);
		}),
	};
	const familyAi = { answer: vi.fn(async () => "Sunlight scatters.") };
	render(BuddyControls, { service, familyId: "family", familyAi: familyAi as never });
	await fireEvent.click(
		await screen.findByRole("button", { name: "Approve question and send to AI" }),
	);
	await screen.findByText("Sunlight scatters.");
	expect(familyAi.answer).toHaveBeenCalledWith("Why is the sky blue?");
	expect(calls.find((c) => c.action === "answer")).toEqual({
		action: "answer",
		device: "device",
		turn: "turn",
		text: "Sunlight scatters.",
	});
	// The parent still approves the answer separately before speech.
	expect(screen.getByRole("button", { name: "Approve answer for speech" })).toBeInTheDocument();
});

it("hides household settings remotely and does not refresh a revoked device", async () => {
	const command = vi.fn(async () => ({ settings: [], turns: [] }));
	const service: BuddyService = {
		liveTalkAvailable: false,
		providerSettingsAvailable: false,
		openTalk: vi.fn(),
		command,
		async *watch(_family, signal) {
			yield {
				settings: [
					{ device: "device", wake_word: "hey buddy", muted: true },
					{ device: "other", wake_word: "hey bird", muted: true },
				],
				turns: [],
			};
			await new Promise<void>((resolve) =>
				signal.addEventListener("abort", () => resolve(), { once: true }),
			);
		},
	};
	render(BuddyControls, { service, familyId: "family" });
	const [revoke] = await screen.findAllByRole("button", {
		name: "Revoke this device",
	});
	expect(screen.queryByText("AI provider settings")).not.toBeInTheDocument();
	expect(
		screen.getAllByText(/Sign in to Vulture to choose how this FamBuddy gets AI answers/),
	).toHaveLength(2);
	await fireEvent.click(revoke);
	await waitFor(() =>
		expect(screen.getAllByRole("button", { name: "Revoke this device" })).toHaveLength(1),
	);
	expect(screen.getByRole("group", { name: "Device other" })).toBeInTheDocument();
	expect(command.mock.calls).toEqual([[{ action: "revoke", device: "device" }]]);
	expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

function delayedWatchFixture() {
	let release!: () => void;
	const teardown = new Promise<void>((resolve) => {
		release = resolve;
	});
	const signals: AbortSignal[] = [];
	let held = false;
	const watch = vi.fn(async function* (_family: string, signal: AbortSignal) {
		if (held) throw new Error("Relay lease is still held");
		held = true;
		const first = signals.length === 0;
		signals.push(signal);
		try {
			yield { settings: [], turns: [] };
			await new Promise<void>((resolve) => {
				if (signal.aborted) resolve();
				else signal.addEventListener("abort", () => resolve(), { once: true });
			});
		} finally {
			if (first) await teardown;
			held = false;
		}
	});
	const service: BuddyService = {
		openTalk: vi.fn(),
		command: vi.fn(async () => ({ settings: [], turns: [] })),
		watch,
	};
	return { service, watch, signals, release };
}

it("waits for delayed watch teardown and starts only the latest queued reconnect", async () => {
	const fixture = delayedWatchFixture();
	const view = render(BuddyControls, {
		service: fixture.service,
		familyId: "family",
	});
	await waitFor(() => expect(fixture.watch).toHaveBeenCalledTimes(1));
	const reconnect = screen.getByRole("button", { name: "Reconnect device" });
	await fireEvent.click(reconnect);
	await fireEvent.click(reconnect);
	expect(fixture.signals[0].aborted).toBe(true);
	expect(fixture.watch).toHaveBeenCalledTimes(1);
	fixture.release();
	await waitFor(() => expect(fixture.watch).toHaveBeenCalledTimes(2));
	expect(fixture.signals[1].aborted).toBe(false);
	expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	view.unmount();
	expect(fixture.signals[1].aborted).toBe(true);
});

it("does not start a queued reconnect after the controls unmount", async () => {
	const fixture = delayedWatchFixture();
	const view = render(BuddyControls, {
		service: fixture.service,
		familyId: "family",
	});
	await waitFor(() => expect(fixture.watch).toHaveBeenCalledTimes(1));
	await fireEvent.click(screen.getByRole("button", { name: "Reconnect device" }));
	view.unmount();
	fixture.release();
	// Let the old iterator and queued restart finish their asynchronous cleanup.
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(fixture.watch).toHaveBeenCalledTimes(1);
	expect(fixture.signals[0].aborted).toBe(true);
});

it("dispatches mute during a pending refresh and ignores the old listening snapshot", async () => {
	const listening: BuddyOutput = {
		settings: [{ device: "device", wake_word: "hey buddy", muted: false }],
		turns: [],
	};
	const muted: BuddyOutput = {
		settings: [{ ...listening.settings[0], muted: true }],
		turns: [],
	};
	let finishOld!: (output: BuddyOutput) => void;
	const old = new Promise<BuddyOutput>((resolve) => {
		finishOld = resolve;
	});
	let lists = 0;
	const command = vi.fn(async (request: BuddyCommand) => {
		if (request.action === "list") return ++lists === 1 ? old : muted;
		return muted;
	});
	const service: BuddyService = {
		command,
		openTalk: vi.fn(),
		async *watch(_family, signal) {
			yield listening;
			await new Promise<void>((resolve) =>
				signal.addEventListener("abort", () => resolve(), { once: true }),
			);
		},
	};
	render(BuddyControls, { service, familyId: "family" });
	await screen.findByText("Listening enabled");
	await fireEvent.input(screen.getByLabelText("Announcement or message"), {
		target: { value: "Hello" },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Send for local speech" }));
	await waitFor(() => expect(lists).toBe(1));
	await fireEvent.click(screen.getByRole("button", { name: "Mute and cancel all requests" }));
	await waitFor(() =>
		expect(command).toHaveBeenCalledWith({
			action: "configure",
			device: "device",
			wake_word: "hey buddy",
			muted: true,
		}),
	);
	await screen.findByText("Muted");
	finishOld(listening);
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "Enable local listening" })).toBeEnabled(),
	);
	expect(screen.queryByText("Listening enabled")).not.toBeInTheDocument();
});

it("keeps a screen PIN form open when the device did not take the PIN", async () => {
	const output: BuddyOutput = {
		settings: [{ device: "device", wake_word: "hey buddy", muted: false, screen_pin_set: false }],
		turns: [],
	};
	const service: BuddyService = {
		openTalk: vi.fn(),
		async *watch(_family, signal) {
			yield structuredClone(output);
			await new Promise<void>((resolve) =>
				signal.addEventListener("abort", () => resolve(), { once: true }),
			);
		},
		command: vi.fn(async (command: BuddyCommand) => {
			if (command.action === "configure_screen_pin") throw new Error("FamBuddy is offline.");
			return structuredClone(output);
		}),
	};
	render(BuddyControls, { service, familyId: "family" });
	await fireEvent.click(await screen.findByRole("button", { name: "Set PIN" }));
	await fireEvent.input(screen.getByLabelText("New PIN"), { target: { value: "2468" } });
	await fireEvent.input(screen.getByLabelText("Enter the PIN again"), {
		target: { value: "2468" },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Save PIN" }));
	expect(await screen.findByText("FamBuddy is offline.")).toBeVisible();
	expect(screen.getByLabelText("New PIN")).toHaveValue("2468");
	expect(screen.getByText("No PIN")).toBeVisible();
});
