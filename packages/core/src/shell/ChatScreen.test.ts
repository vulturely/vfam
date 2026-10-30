import { cleanup, render, screen, within, waitFor, fireEvent } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("./ChatComposerEditor.svelte", async () => ({
	default: (await import("./ChatComposerEditorTestStub.svelte")).default,
}));
vi.mock("../robot/BuddyConversation.svelte", async () => ({
	default: (await import("../robot/BuddyConversationTestStub.svelte")).default,
}));
import ChatScreen from "./ChatScreen.svelte";
import type { Runtime } from "../runtime/registry.svelte";
import { toastService } from "../services/toast.svelte";
import { createChatPeopleService } from "../chat/people";
import { createChatViewState } from "../chat/viewState.svelte";
afterEach(() => {
	cleanup();
	toastService.clear();
});
async function inputMessage(text: string) {
	const editor = screen.getByRole("textbox", { name: "Message", exact: true });
	await fireEvent.input(editor, { target: { value: text } });
}
function setup(
	hasFamily = true,
	rooms: import("../chat/service").ChatRoom[] = [],
	buddies: import("../robot/directory.svelte").FamBuddySession[] = [],
) {
	const familyId = "00000000-0000-0000-0000-000000000010";
	let roomState = [...rooms];
	const chat = {
		start: vi.fn(async () => ({
			identity: {
				deviceId: "own",
				fingerprint: "a".repeat(64),
				keyPackages: [],
			},
			devices: [],
			rooms: roomState,
			pins: {},
		})),
		close: vi.fn(),
		open: vi.fn(async (peer?: string) => ({
			roomId: peer ? `direct-${peer}` : "room",
			participants: [],
		})),
		send: vi.fn(async () => {}),
		sync: vi.fn(async (): Promise<import("../chat/service").ChatMessage[]> => []),
		createChannel: vi.fn(async (name: string, participants: string[]) => ({
			roomId: "channel",
			name,
			participants: ["parent", ...participants],
		})),
		renameChannel: vi.fn(async (roomId: string, name: string) => {
			roomState = roomState.map((room) => (room.roomId === roomId ? { ...room, name } : room));
			return roomState.find((room) => room.roomId === roomId)!;
		}),
		addChannelMember: vi.fn(async (roomId: string, accountId: string) => {
			roomState = roomState.map((room) =>
				room.roomId === roomId
					? { ...room, participants: [...room.participants, accountId] }
					: room,
			);
			return roomState.find((room) => room.roomId === roomId)!;
		}),
		deleteChannel: vi.fn(async (roomId: string) => {
			roomState = roomState.filter((room) => room.roomId !== roomId);
		}),
		refreshRooms: vi.fn(async () => roomState),
		subscribe: vi.fn<(listener: () => void) => () => void>(() => () => {}),
		remove: vi.fn(async () => {}),
	};
	const calls = {
		start: vi.fn(async () => {}),
		subscribe: vi.fn(() => () => {}),
		close: vi.fn(),
	};
	const family = {
		getMyFamily: vi.fn(async () => (hasFamily ? { id: familyId } : null)),
		listMembers: vi.fn(async () => [
			{ id: "member", accountId: "alex" },
			{ id: "member-2", accountId: "sam" },
		]),
		getAccount: vi.fn(async (accountId: string) => ({
			displayName: accountId === "sam" ? "Sam" : "Alex",
		})),
	};
	const runtime = {
		state: {
			identity: { id: "parent", role: "manager" },
			familyId: "family-parent",
		},
		services: {
			chat,
			family,
			chatView: createChatViewState(),
			chatPeople: createChatPeopleService({
				child: () => null,
				parent: () => ({ id: "parent", name: "Parent", role: "manager" }),
				family: family as never,
				learning: { listProfiles: async () => [] },
				childHome: { family: async () => [] },
			}),
			calls,
			fambuddy: { refresh: vi.fn(async () => {}), sessions: buddies },
		},
	} as unknown as Runtime;
	const view = render(ChatScreen, { context: new Map([["vulture:runtime", runtime]]) });
	return { chat, family, familyId, calls, runtime, view };
}
it("starts encrypted chat using the saved family ID rather than the login placeholder", async () => {
	const { chat, family, familyId } = setup();
	await waitFor(() => expect(chat.start).toHaveBeenCalledWith("parent", familyId));
	expect(family.getMyFamily).toHaveBeenCalledOnce();
	expect(family.listMembers).toHaveBeenCalledWith(familyId);
	await fireEvent.click(screen.getByText("Device security"));
	expect(
		screen.getByText("Security keys are managed by the app. No codes to compare."),
	).toBeVisible();
	expect(screen.queryByLabelText(/Fingerprint from device/)).toBeNull();
	expect(screen.queryByRole("alert")).toBeNull();
});
it("does not enroll a chat device without a saved family", async () => {
	const { chat } = setup(false);
	expect(await screen.findByRole("alert")).toHaveTextContent("Join a family");
	expect(chat.start).not.toHaveBeenCalled();
});

it("renders an optimistic message before chat delivery completes and logs UI timing", async () => {
	const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
	let finishSend!: () => void;
	const { chat } = setup();
	chat.send.mockImplementation(
		() =>
			new Promise<void>((resolve) => {
				finishSend = resolve;
			}),
	);

	const familyButton = await screen.findByRole("button", {
		name: "Family group",
	});
	await waitFor(() => expect(familyButton).toBeEnabled());
	await fireEvent.click(familyButton);
	const editor = await screen.findByRole("textbox", {
		name: "Message",
		exact: true,
	});
	await waitFor(() => expect(editor).toBeEnabled());
	expect(editor.tagName).toBe("TEXTAREA");
	await fireEvent.input(editor, {
		target: { value: "Shows before delivery" },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Send encrypted message" }));

	expect(
		await within(screen.getByRole("list", { name: "Messages" })).findByText(
			"Shows before delivery",
		),
	).toBeVisible();
	await waitFor(() => expect(chat.send).toHaveBeenCalledOnce());
	expect(debug).toHaveBeenCalledWith(
		"[chat-ui]",
		"optimistic-message",
		expect.objectContaining({ elapsedMs: expect.any(Number) }),
	);
	const optimisticLog = debug.mock.calls.find(([, event]) => event === "optimistic-message");
	expect(optimisticLog?.[2].elapsedMs).toBeGreaterThanOrEqual(0);
	finishSend();
	debug.mockRestore();
});

it("keeps call controls in chat and waits for an explicit action before registering calls", async () => {
	const { calls } = setup();
	const familyButton = await screen.findByRole("button", { name: "Family group" });
	await waitFor(() => expect(familyButton).toBeEnabled());
	await fireEvent.click(familyButton);
	expect(calls.start).not.toHaveBeenCalled();
	await fireEvent.click(await screen.findByRole("button", { name: "Start audio call" }));
	await waitFor(() => expect(calls.start).toHaveBeenCalledWith("Family device"));
	expect(screen.getByRole("checkbox", { name: "Enable calls" })).toBeVisible();
});

it("opens a paired FamBuddy conversation from the sidebar", async () => {
	setup(
		true,
		[],
		[
			{
				registration: { id: "buddy", name: "Kitchen", createdAt: "2026-01-01T00:00:00Z" },
				service: { command: vi.fn(), watch: vi.fn(), openTalk: vi.fn() },
				output: { settings: [], turns: [] },
				busy: false,
				error: "",
			},
		],
	);
	await fireEvent.click(await screen.findByRole("button", { name: /Kitchen/ }));
	expect(screen.getByText("Buddy conversation")).toBeVisible();
});

it("creates a named private channel with selected members and keeps direct chat separate", async () => {
	const { chat } = setup();
	await screen.findByRole("button", { name: "Message alex" });
	await fireEvent.click(screen.getByRole("button", { name: "Create channel" }));
	expect(screen.getByRole("button", { name: "Save channel", exact: true })).toBeDisabled();
	await fireEvent.input(screen.getByRole("textbox", { name: "Channel name" }), {
		target: { value: "Weekend plans" },
	});
	await fireEvent.click(screen.getByRole("checkbox", { name: "Alex" }));
	await fireEvent.click(screen.getByRole("button", { name: "Save channel", exact: true }));
	await waitFor(() => expect(chat.createChannel).toHaveBeenCalledWith("Weekend plans", ["alex"]));
	expect(await screen.findByRole("heading", { name: "Weekend plans" })).toBeVisible();
	expect(chat.sync).toHaveBeenCalledWith("channel");
	await waitFor(() => expect(screen.getByRole("button", { name: "Message alex" })).toBeEnabled());
	await fireEvent.click(screen.getByRole("button", { name: "Message alex" }));
	expect(await screen.findByRole("heading", { name: "Conversation with Alex" })).toBeVisible();
});

it("shows channel actions beside its name and supports rename, add member, and delete", async () => {
	const { chat } = setup(true, [
		{
			roomId: "channel",
			name: "Weekend plans",
			participants: ["parent"],
		},
	]);

	const user = userEvent.setup();
	const trigger = await screen.findByRole("button", {
		name: "Actions for Weekend plans",
	});
	expect(trigger).toBeVisible();
	expect(trigger).toHaveAttribute("aria-haspopup", "menu");
	expect(trigger).toHaveAttribute("title", "Channel actions");
	const row = trigger.parentElement;
	expect(row).toHaveClass("channel-row");
	expect(row?.firstElementChild).toHaveAccessibleName(/Weekend plans/);
	expect(row?.lastElementChild).toBe(trigger);

	await user.click(trigger);
	let menu = document.querySelector('[role="menu"]');
	expect(menu).toHaveTextContent("Rename channel");
	expect(menu).toHaveTextContent("Add member");
	expect(menu).toHaveTextContent("Delete channel");
	await user.click(menu!.querySelector('[role="menuitem"]')!);
	expect(await screen.findByRole("dialog")).toBeVisible();
	const nameInput = await screen.findByRole("textbox", {
		name: "Channel name",
	});
	await fireEvent.input(nameInput, { target: { value: "Renamed plans" } });
	await fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
	await waitFor(() => expect(chat.renameChannel).toHaveBeenCalledWith("channel", "Renamed plans"));

	await fireEvent.click(await screen.findByRole("button", { name: "Actions for Renamed plans" }));
	menu = document.querySelector('[role="menu"]');
	const addMemberItem = [...menu!.querySelectorAll('[role="menuitem"]')].find((item) =>
		item.textContent?.includes("Add member"),
	);
	expect(addMemberItem).toBeTruthy();
	await fireEvent.click(addMemberItem!);
	expect(await screen.findByRole("dialog")).toBeVisible();
	await fireEvent.change(await screen.findByRole("combobox", { name: "Add a member" }), {
		target: { value: "sam" },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Add member", exact: true }));
	await waitFor(() => expect(chat.addChannelMember).toHaveBeenCalledWith("channel", "sam"));

	await fireEvent.click(await screen.findByRole("button", { name: "Actions for Renamed plans" }));
	menu = document.querySelector('[role="menu"]');
	const deleteItem = [...menu!.querySelectorAll('[role="menuitem"]')].find((item) =>
		item.textContent?.includes("Delete channel"),
	);
	expect(deleteItem).toBeTruthy();
	await fireEvent.click(deleteItem!);
	expect(await screen.findByRole("alertdialog")).toHaveTextContent("Delete this channel?");
	await fireEvent.click(screen.getByRole("button", { name: "Delete channel", exact: true }));
	await waitFor(() => expect(chat.deleteChannel).toHaveBeenCalledWith("channel"));
	expect(screen.queryByRole("button", { name: "Actions for Renamed plans" })).toBeNull();
});

it("isolates unsent drafts between private conversations, the family room and new channels", async () => {
	const { chat } = setup();
	const alexButton = await screen.findByRole("button", {
		name: "Message alex",
	});
	await waitFor(() => expect(alexButton).toBeEnabled());
	await fireEvent.click(alexButton);
	await waitFor(() =>
		expect(screen.getByRole("textbox", { name: "Message", exact: true })).toBeEnabled(),
	);
	await inputMessage("Private draft for Alex");
	await fireEvent.click(screen.getByRole("button", { name: "Family group", exact: true }));
	await waitFor(() =>
		expect(screen.getByRole("textbox", { name: "Message", exact: true })).toBeEnabled(),
	);
	expect(screen.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("");
	await inputMessage("Family draft");
	await waitFor(() => expect(alexButton).toBeEnabled());
	await fireEvent.click(alexButton);
	await waitFor(() =>
		expect(screen.getByRole("textbox", { name: "Message", exact: true })).toBeEnabled(),
	);
	expect(screen.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(
		"Private draft for Alex",
	);
	await fireEvent.click(screen.getByRole("button", { name: "Create channel" }));
	await fireEvent.input(screen.getByRole("textbox", { name: "Channel name" }), {
		target: { value: "Weekend" },
	});
	await fireEvent.click(screen.getByRole("checkbox", { name: "Alex" }));
	await fireEvent.click(screen.getByRole("button", { name: "Save channel", exact: true }));
	await waitFor(() =>
		expect(screen.getByRole("textbox", { name: "Message", exact: true })).toBeEnabled(),
	);
	expect(screen.getByRole("textbox", { name: "Message", exact: true })).toBeEmptyDOMElement();
	expect(chat.send).not.toHaveBeenCalled();
});

it("keeps the open conversation, its messages and drafts when chat is left and reopened", async () => {
	const { chat, runtime, view } = setup(true, [{ roomId: "room", participants: [] }]);
	chat.sync.mockResolvedValue([
		{
			messageId: "m1",
			clientId: "c1",
			sequence: 1,
			generation: 1,
			deviceId: "other",
			accountId: "alex",
			createdAt: Math.floor(Date.now() / 1000),
			deleted: false,
			payload: { text: "Dinner at six" },
		},
	]);
	const family = await screen.findByRole("button", { name: "Family group" });
	await waitFor(() => expect(family).toBeEnabled());
	await fireEvent.click(family);
	expect(await screen.findByText("Dinner at six")).toBeVisible();
	const editor = await screen.findByRole("textbox", { name: "Message", exact: true });
	await fireEvent.input(editor, { target: { value: "On my way" } });
	view.unmount();
	// Leaving chat keeps its session: nothing is torn down.
	expect(chat.close).not.toHaveBeenCalled();
	chat.sync.mockClear();
	render(ChatScreen, { context: new Map([["vulture:runtime", runtime]]) });
	// The conversation shows at once from what was kept, then refreshes quietly.
	expect(screen.getByText("Dinner at six")).toBeVisible();
	expect(screen.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("On my way");
	await waitFor(() => expect(chat.refreshRooms).toHaveBeenCalled());
	await waitFor(() => expect(chat.sync).toHaveBeenCalled());
	expect(chat.start).toHaveBeenCalledOnce();
});

it("starts over when another person opens chat", async () => {
	const { runtime, view, chat } = setup();
	const family = await screen.findByRole("button", { name: "Family group" });
	await waitFor(() => expect(family).toBeEnabled());
	view.unmount();
	const kept = runtime.services.chatView;
	expect(kept.owner).toBe("parent");
	kept.owner = "someone-else";
	kept.drafts.set("room", { text: "private", richTextJson: "" });
	kept.status = undefined;
	render(ChatScreen, { context: new Map([["vulture:runtime", runtime]]) });
	await waitFor(() => expect(chat.start).toHaveBeenCalledTimes(2));
	await waitFor(() => expect(kept.owner).toBe("parent"));
	expect(kept.drafts.has("room")).toBe(false);
});

it("clears the box at once while sending and gives the text back if sending fails", async () => {
	const { chat } = setup(true, [{ roomId: "room", participants: [] }]);
	let fail!: (error: Error) => void;
	chat.send.mockImplementation(
		() =>
			new Promise<void>((_resolve, reject) => {
				fail = reject;
			}),
	);
	const family = await screen.findByRole("button", { name: "Family group" });
	await waitFor(() => expect(family).toBeEnabled());
	await fireEvent.click(family);
	const editor = await screen.findByRole("textbox", { name: "Message", exact: true });
	await waitFor(() => expect(editor).toBeEnabled());
	await fireEvent.input(editor, { target: { value: "See you soon" } });
	await fireEvent.click(screen.getByRole("button", { name: "Send encrypted message" }));
	// The message shows, the box is empty and stays usable while it is delivered.
	expect(await screen.findByText("See you soon")).toBeVisible();
	await waitFor(() => expect(editor).toHaveValue(""));
	expect(editor).toBeEnabled();
	fail(new Error("Offline"));
	expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
	await waitFor(() => expect(editor).toHaveValue("See you soon"));
	expect(screen.queryByText("See you soon", { selector: "li *" })).toBeNull();
});

it("folds live updates that arrive during a refresh into one more refresh", async () => {
	const { chat } = setup(true, [{ roomId: "room", participants: [] }]);
	let notify!: () => void;
	chat.subscribe.mockImplementation((listener: () => void) => {
		notify = listener;
		return () => {};
	});
	const family = await screen.findByRole("button", { name: "Family group" });
	await waitFor(() => expect(family).toBeEnabled());
	await fireEvent.click(family);
	await waitFor(() => expect(chat.subscribe).toHaveBeenCalled());
	const editor = await screen.findByRole("textbox", { name: "Message", exact: true });
	await waitFor(() => expect(editor).toBeEnabled());
	let finish!: () => void;
	chat.refreshRooms.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = () => resolve([{ roomId: "room", participants: [] }]);
			}),
	);
	const before = chat.refreshRooms.mock.calls.length;
	notify();
	notify();
	notify();
	// The screen stays usable while the refresh runs in the background.
	expect(editor).toBeEnabled();
	finish();
	await waitFor(() => expect(chat.refreshRooms.mock.calls.length).toBe(before + 2));
	chat.refreshRooms.mockRejectedValueOnce(new Error("Refresh failed"));
	notify();
	expect(await screen.findByRole("alert")).toHaveTextContent("Refresh failed");
});

it("keeps a failed message as the draft of the conversation it was sent from", async () => {
	const { chat, runtime } = setup(true, [{ roomId: "room", participants: [] }]);
	let fail!: (error: Error) => void;
	chat.send.mockImplementation(
		() =>
			new Promise<void>((_resolve, reject) => {
				fail = reject;
			}),
	);
	const family = await screen.findByRole("button", { name: "Family group" });
	await waitFor(() => expect(family).toBeEnabled());
	await fireEvent.click(family);
	const editor = await screen.findByRole("textbox", { name: "Message", exact: true });
	await waitFor(() => expect(editor).toBeEnabled());
	await fireEvent.input(editor, { target: { value: "For the family" } });
	await fireEvent.click(screen.getByRole("button", { name: "Send encrypted message" }));
	await waitFor(() => expect(editor).toHaveValue(""));
	await fireEvent.click(screen.getByRole("button", { name: "Message alex" }));
	await screen.findByRole("heading", { name: "Conversation with Alex" });
	fail(new Error("Offline"));
	await waitFor(() =>
		expect(runtime.services.chatView.drafts.get("room")?.text).toBe("For the family"),
	);
	expect(screen.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("");
});

it("waits quietly for a parent to approve a new device, then opens chat", async () => {
	const { chat } = setup(true, [{ roomId: "room", participants: [] }]);
	const own = (approved: boolean) => ({
		identity: { deviceId: "own", fingerprint: "a".repeat(64), keyPackages: [] },
		devices: [
			{
				deviceId: "own",
				accountId: "parent",
				fingerprint: "a".repeat(64),
				approved,
				revoked: false,
			},
		],
		rooms: [{ roomId: "room", participants: [] }],
		pins: {},
	});
	chat.start.mockReset();
	chat.start.mockResolvedValueOnce(own(false) as never).mockResolvedValue(own(true) as never);
	let notify!: () => void;
	chat.subscribe.mockImplementation((listener: () => void) => {
		notify = listener;
		return () => {};
	});
	const family = await screen.findByRole("button", { name: "Family group" });
	await waitFor(() => expect(family).toBeEnabled());
	await fireEvent.click(family);
	expect(await screen.findByText(/Waiting for a parent to approve this device/)).toBeVisible();
	expect(chat.sync).not.toHaveBeenCalled();
	expect(screen.queryByRole("alert")).toBeNull();
	await waitFor(() => expect(chat.subscribe).toHaveBeenCalled());
	notify();
	await waitFor(() => expect(chat.start).toHaveBeenCalledTimes(2));
	await waitFor(() =>
		expect(screen.queryByText(/Waiting for a parent to approve this device/)).toBeNull(),
	);
	await waitFor(() => expect(chat.sync).toHaveBeenCalledWith("room"));
});
