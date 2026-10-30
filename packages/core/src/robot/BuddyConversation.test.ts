import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Runtime } from "../runtime/registry.svelte";
import type { FamBuddySession } from "./directory.svelte";
import type { BuddyTurn } from "./buddy";
import BuddyConversation from "./BuddyConversation.svelte";
import { cameraEnd, cameraStart } from "./BuddyTalkTestMocks";

vi.mock("./BuddyTalk.svelte", async () => ({
	default: (await import("./BuddyTalkTestStub.svelte")).default,
}));

const turn: BuddyTurn = {
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
	destination: "provider",
};
const session: FamBuddySession = {
	registration: { id: "registration", name: "Kitchen", createdAt: "2026-01-01T00:00:00Z" },
	pair: {
		registration: "registration",
		token: `vrp_${"a".repeat(64)}`,
		pair: {
			origin: "https://relay.example",
			account: "fambuddy-parent:parent:channel",
			own: {
				accountId: "fambuddy-parent:parent:channel",
				deviceId: "device",
				fingerprint: "a".repeat(64),
				keyPackage: "key",
			},
			peer: {
				accountId: "fambuddy:device",
				deviceId: "device",
				fingerprint: "b".repeat(64),
				keyPackage: "peer-key",
			},
			binding: { channel: "channel", family: "family", device: "device" },
		},
	},
	service: { command: vi.fn(), watch: vi.fn(), openTalk: vi.fn() },
	output: {
		settings: [{ device: "device", wake_word: "hey buddy", muted: false, camera_enabled: false }],
		turns: [turn],
	},
	busy: false,
	error: "",
};

function setup() {
	const directory = {
		session: vi.fn(() => session),
		acquire: vi.fn(async () => {}),
		release: vi.fn(),
		command: vi.fn(async () => session.output),
		broadcast: vi.fn(async () => {}),
	};
	const runtime = {
		services: { fambuddy: directory },
	} as unknown as Runtime;
	render(BuddyConversation, {
		props: { id: "registration" },
		context: new Map([["vulture:runtime", runtime]]),
	});
	return directory;
}

beforeEach(() => {
	session.output.settings[0].camera_enabled = false;
	session.output.turns = [turn];
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

it("sends direct and broadcast announcements", async () => {
	const directory = setup();
	const input = await screen.findByLabelText("Message FamBuddy");
	await fireEvent.input(input, { target: { value: "Hello Kitchen" } });
	await fireEvent.click(screen.getByRole("button", { name: "Send to FamBuddy" }));
	expect(directory.command).toHaveBeenCalledWith("registration", {
		action: "announce",
		device: "device",
		text: "Hello Kitchen",
	});
	await fireEvent.input(input, { target: { value: "/broadcast Dinner" } });
	await fireEvent.click(screen.getByRole("button", { name: "Send to FamBuddy" }));
	expect(directory.broadcast).toHaveBeenCalledWith("Dinner");
	expect(screen.getByText("You · broadcast")).toBeVisible();
});

it("shows the live camera only once it is opened from the top bar or /camera", async () => {
	const directory = setup();
	const input = await screen.findByLabelText("Message FamBuddy");
	expect(screen.queryByText("Live camera")).toBeNull();
	await fireEvent.click(screen.getByRole("button", { name: "Open live camera" }));
	await vi.waitFor(() => expect(cameraStart).toHaveBeenCalledOnce());
	await screen.findByText("Live camera started.");
	expect(screen.getByText("Live camera")).toBeVisible();
	expect(directory.command).toHaveBeenCalledWith("registration", {
		action: "configure_camera",
		device: "device",
		enabled: true,
	});
	await fireEvent.click(screen.getByRole("button", { name: "Close live camera" }));
	await vi.waitFor(() => expect(cameraEnd).toHaveBeenCalledOnce());
	await screen.findByText("Live camera stopped.");
	expect(screen.queryByText("Live camera")).toBeNull();
	await fireEvent.input(input, { target: { value: "/camera" } });
	await fireEvent.click(screen.getByRole("button", { name: "Send to FamBuddy" }));
	await vi.waitFor(() => expect(cameraStart).toHaveBeenCalledTimes(2));
	expect(await screen.findByText("Live camera")).toBeVisible();
	await vi.waitFor(() => expect((input as HTMLInputElement).value).toBe(""));
	await fireEvent.input(input, { target: { value: "/stop" } });
	await fireEvent.click(screen.getByRole("button", { name: "Send to FamBuddy" }));
	await vi.waitFor(() => expect(cameraEnd).toHaveBeenCalledTimes(2));
	expect(screen.queryByText("Live camera")).toBeNull();
});

it("says so when the live camera does not start", async () => {
	cameraStart.mockResolvedValueOnce(false);
	setup();
	await fireEvent.click(await screen.findByRole("button", { name: "Open live camera" }));
	expect(await screen.findByText(/The live camera did not start/)).toBeVisible();
	expect(screen.queryByText("Live camera started.")).toBeNull();
});

it("reports a failure to open the live camera", async () => {
	const directory = setup();
	directory.command.mockRejectedValueOnce(new Error("Camera setting failed."));
	await fireEvent.click(await screen.findByRole("button", { name: "Open live camera" }));
	expect(await screen.findByText("Camera setting failed.")).toBeVisible();
	expect(cameraStart).not.toHaveBeenCalled();
});

it("autocompletes commands from the keyboard and the pointer", async () => {
	setup();
	const input = (await screen.findByLabelText("Message FamBuddy")) as HTMLInputElement;
	await fireEvent.input(input, { target: { value: "/" } });
	expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
		"/askAsk its AI a question",
		"/cameraOpen the live camera",
		"/stopClose the live camera",
		"/broadcastSay it on every FamBuddy",
	]);
	expect(input).toHaveAttribute("aria-expanded", "true");
	await fireEvent.keyDown(input, { key: "ArrowDown" });
	await fireEvent.keyDown(input, { key: "ArrowDown" });
	await fireEvent.keyDown(input, { key: "ArrowUp" });
	expect(input).toHaveAttribute("aria-activedescendant", "buddy-hint-1");
	await fireEvent.keyDown(input, { key: "ArrowUp" });
	await fireEvent.keyDown(input, { key: "ArrowUp" });
	expect(screen.getAllByRole("option")[3]).toHaveAttribute("aria-selected", "true");
	await fireEvent.keyDown(input, { key: "Enter" });
	expect(input.value).toBe("/broadcast ");
	expect(screen.queryByRole("listbox")).toBeNull();
	await fireEvent.input(input, { target: { value: "/c" } });
	await fireEvent.keyDown(input, { key: "Tab" });
	expect(input.value).toBe("/camera");
	await fireEvent.input(input, { target: { value: "/s" } });
	await fireEvent.keyDown(input, { key: "Escape" });
	expect(screen.queryByRole("listbox")).toBeNull();
	await fireEvent.keyDown(input, { key: "Enter" });
	await fireEvent.input(input, { target: { value: "/a" } });
	await fireEvent.mouseDown(screen.getByRole("option", { name: /\/ask/ }));
	expect(input.value).toBe("/ask ");
	await fireEvent.input(input, { target: { value: "hello" } });
	await fireEvent.keyDown(input, { key: "ArrowDown" });
	expect(screen.queryByRole("listbox")).toBeNull();
});

it("approves, edits, and rejects inline requests", async () => {
	const directory = setup();
	await fireEvent.click(await screen.findByRole("button", { name: "Approve question" }));
	expect(directory.command).toHaveBeenCalledWith("registration", {
		action: "approve",
		device: "device",
		turn: "turn",
		review: [1, 2, 3],
	});
	await fireEvent.input(screen.getByLabelText("Edit reviewed text"), {
		target: { value: "Edited question" },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Save edit" }));
	expect(directory.command).toHaveBeenCalledWith("registration", {
		action: "edit",
		device: "device",
		turn: "turn",
		text: "Edited question",
	});
	await fireEvent.click(screen.getByRole("button", { name: "Reject / cancel" }));
	expect(directory.command).toHaveBeenCalledWith("registration", {
		action: "cancel",
		device: "device",
		turn: "turn",
	});
});

it("asks the device's AI, shows what it says, and mutes it", async () => {
	session.output.captions = [
		{ device: "device", turn: "spoken", text: "Sunlight scatters.", started_at: "now" },
	];
	const directory = setup();
	const input = await screen.findByLabelText("Message FamBuddy");
	expect(await screen.findByText("Sunlight scatters.")).toBeVisible();
	expect(screen.getByText("Kitchen said")).toBeVisible();
	await fireEvent.click(screen.getByRole("radio", { name: "Ask AI" }));
	await fireEvent.input(input, { target: { value: "Why is the sky blue?" } });
	await fireEvent.click(screen.getByRole("button", { name: "Send to FamBuddy" }));
	expect(directory.command).toHaveBeenCalledWith("registration", {
		action: "ask",
		device: "device",
		text: "Why is the sky blue?",
	});
	await screen.findByText(/Approve the answer here/);
	await fireEvent.click(screen.getByRole("radio", { name: "Say it" }));
	await fireEvent.input(input, { target: { value: "/ask   " } });
	await fireEvent.click(screen.getByRole("button", { name: "Send to FamBuddy" }));
	expect(await screen.findByText("Write a question after /ask.")).toBeVisible();
	await fireEvent.input(input, { target: { value: "/ask What is rain?" } });
	await fireEvent.click(screen.getByRole("button", { name: "Send to FamBuddy" }));
	expect(directory.command).toHaveBeenCalledWith("registration", {
		action: "ask",
		device: "device",
		text: "What is rain?",
	});
	await fireEvent.click(screen.getByRole("button", { name: "Mute" }));
	expect(directory.command).toHaveBeenCalledWith("registration", {
		action: "configure",
		device: "device",
		wake_word: "hey buddy",
		muted: true,
	});
	session.output.captions = undefined;
});

it("offers to turn listening back on from the top bar when muted", async () => {
	session.output.settings[0].muted = true;
	const directory = setup();
	const button = await screen.findByRole("button", { name: "Turn listening on" });
	expect(button).toHaveAttribute("data-tooltip", "Turn listening on");
	await fireEvent.click(button);
	expect(directory.command).toHaveBeenCalledWith("registration", {
		action: "configure",
		device: "device",
		wake_word: "hey buddy",
		muted: false,
	});
	session.output.settings[0].muted = false;
});

it("shows who asked and which AI answered, and revises a pending answer", async () => {
	const answer: BuddyTurn = {
		...turn,
		stage: "AnswerPending",
		text: "Light scatters.",
		origin: { name: "Jamie", role: "child", channel: "voice" },
		answered_by: "provider",
	};
	session.output.turns = [answer];
	const directory = setup();
	expect(
		await screen.findByText("Jamie asked aloud · Answered by the FamBuddy's AI provider"),
	).toBeVisible();
	const revise = screen.getByRole("button", { name: "Revise" });
	expect(revise).toBeDisabled();
	await fireEvent.input(screen.getByLabelText("How should the answer change?"), {
		target: { value: "  make it simpler  " },
	});
	await fireEvent.click(revise);
	expect(directory.command).toHaveBeenCalledWith("registration", {
		action: "revise",
		device: "device",
		turn: "turn",
		instruction: "make it simpler",
	});
	directory.command.mockRejectedValueOnce(new Error("Revision failed."));
	await fireEvent.input(screen.getByLabelText("How should the answer change?"), {
		target: { value: "again" },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Revise" }));
	expect(await screen.findByText("Revision failed.")).toBeVisible();
});

it("lets a parent ask the cloud, answer, or dismiss a question FamBuddy couldn't answer", async () => {
	const waiting: BuddyTurn = {
		...turn,
		stage: "NeedsParent",
		review: null,
		text: "What happens when we die?",
		origin: { name: "Jamie", role: "child", channel: "voice" },
	};
	session.output.turns = [waiting];
	const directory = setup();
	expect(await screen.findByText("Needs you — FamBuddy couldn't answer this")).toBeVisible();
	expect(screen.getByText("Jamie asked aloud")).toBeVisible();
	expect(screen.queryByRole("button", { name: "Approve question" })).toBeNull();
	await fireEvent.click(screen.getByRole("button", { name: "Ask cloud AI" }));
	expect(directory.command).toHaveBeenCalledWith("registration", {
		action: "ask_cloud",
		device: "device",
		turn: "turn",
	});
	expect(await screen.findByText(/Sent to the cloud AI/)).toBeVisible();
	const answer = screen.getByRole("button", { name: "Answer it yourself" });
	expect(answer).toBeDisabled();
	await fireEvent.input(screen.getByLabelText("Your answer"), {
		target: { value: "  Let's talk about it tonight.  " },
	});
	await fireEvent.click(answer);
	expect(directory.command).toHaveBeenCalledWith("registration", {
		action: "edit",
		device: "device",
		turn: "turn",
		text: "Let's talk about it tonight.",
	});
	await fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
	expect(directory.command).toHaveBeenCalledWith("registration", {
		action: "cancel",
		device: "device",
		turn: "turn",
	});
	directory.command.mockRejectedValueOnce(new Error("No provider."));
	await fireEvent.click(screen.getByRole("button", { name: "Ask cloud AI" }));
	expect(await screen.findByText("No provider.")).toBeVisible();
	directory.command.mockRejectedValueOnce("boom");
	await fireEvent.click(screen.getByRole("button", { name: "Ask cloud AI" }));
	expect(await screen.findByText("Could not ask the cloud AI.")).toBeVisible();
});

it("explains why the cloud can't be asked when no cloud AI is set up", async () => {
	session.output.turns = [
		{ ...turn, stage: "NeedsParent", review: null, destination: "On-device AI" },
	];
	setup();
	expect(await screen.findByRole("button", { name: "Ask cloud AI" })).toBeDisabled();
	expect(screen.getByText(/No cloud AI is set up for this FamBuddy/)).toBeVisible();
});

it("shows FamBuddy's fixed reply for information, with no actions", async () => {
	session.output.turns = [
		{
			...turn,
			stage: "AnswerApproved",
			review: null,
			text: "I am unable to find an answer, please reach out to your parent for help.",
			destination: "FamBuddy's fixed reply",
			origin: { name: "", role: "child", channel: "voice" },
			answered_by: "local",
		},
	];
	setup();
	expect(await screen.findByText("Kitchen replied")).toBeVisible();
	expect(screen.getByText("A child asked aloud · Answered on the FamBuddy")).toBeVisible();
	expect(screen.getByText("No action needed.")).toBeVisible();
	expect(screen.queryByRole("button", { name: "Reject / cancel" })).toBeNull();
});

it("watches only once paired and never gives back a lease it did not take", async () => {
	const directory = {
		session: vi.fn(() => ({ ...session, service: undefined, pair: undefined })),
		acquire: vi.fn(async () => {}),
		release: vi.fn(),
	};
	render(BuddyConversation, {
		props: { id: "registration" },
		context: new Map([["vulture:runtime", { services: { fambuddy: directory } }]]),
	});
	await screen.findByRole("region", { name: "Chat with Kitchen" });
	cleanup();
	expect(directory.acquire).not.toHaveBeenCalled();
	expect(directory.release).not.toHaveBeenCalled();
	const paired = setup();
	expect(paired.acquire).toHaveBeenCalledWith("registration");
	cleanup();
	expect(paired.release).toHaveBeenCalledWith("registration");
});
