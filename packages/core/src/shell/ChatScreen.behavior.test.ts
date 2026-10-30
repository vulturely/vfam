import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ChatMessage, ChatService } from "../chat/service";
import type { Runtime } from "../runtime/registry.svelte";
import ChatScreen from "./ChatScreen.svelte";
import { toastService } from "../services/toast.svelte";
import { createChatPeopleService } from "../chat/people";

vi.mock("./ChatComposerEditor.svelte", async () => ({
	default: (await import("./ChatComposerEditorTestStub.svelte")).default,
}));

const messages: ChatMessage[] = [
	{
		messageId: "image-message",
		clientId: "image-client",
		sequence: 1,
		generation: 1,
		deviceId: "peer",
		accountId: "sam",
		createdAt: 100,
		deleted: false,
		payload: {
			text: "",
			richText: JSON.stringify({
				type: "doc",
				content: [{ type: "paragraph", content: [{ type: "text", text: "Photo" }] }],
			}),
			attachment: {
				key: "key",
				iv: "iv",
				objectKey: "image-key",
				name: "photo.png",
				mediaType: "image/png",
			},
		},
	},
	{
		messageId: "video-message",
		clientId: "video-client",
		sequence: 2,
		generation: 1,
		deviceId: "peer",
		accountId: "sam",
		createdAt: 101,
		deleted: false,
		payload: {
			text: "Video",
			attachment: {
				key: "key",
				iv: "iv",
				objectKey: "video-key",
				name: "movie.mp4",
				mediaType: "video/mp4",
			},
		},
	},
	{
		messageId: "file-message",
		clientId: "file-client",
		sequence: 3,
		generation: 1,
		deviceId: "peer",
		accountId: "sam",
		createdAt: 102,
		deleted: false,
		payload: {
			text: "Document",
			attachment: {
				key: "key",
				iv: "iv",
				objectKey: "file-key",
				name: "notes.txt",
				mediaType: "text/plain",
			},
		},
	},
	{
		messageId: "unavailable-message",
		clientId: "unavailable-client",
		sequence: 4,
		generation: 1,
		deviceId: "peer",
		accountId: "sam",
		createdAt: 103,
		deleted: false,
		unavailable: true,
	},
];

const channel = { roomId: "channel", name: "Plans", participants: [] };

function setup() {
	const chat = {
		start: vi.fn(async () => ({
			identity: { deviceId: "own", fingerprint: "a".repeat(64), keyPackages: [] },
			devices: [
				{
					deviceId: "pending",
					accountId: "sam",
					fingerprint: "b".repeat(64),
					approved: false,
					revoked: false,
				},
			],
			rooms: [channel],
			pins: {},
		})),
		close: vi.fn(),
		open: vi.fn(async () => ({ roomId: "room", participants: [] })),
		send: vi.fn<ChatService["send"]>(async () => {}),
		sync: vi.fn(async () => messages),
		createChannel: vi.fn(),
		renameChannel: vi.fn(),
		addChannelMember: vi.fn(),
		deleteChannel: vi.fn(),
		refreshRooms: vi.fn<ChatService["refreshRooms"]>(async () => []),
		subscribe: vi.fn<ChatService["subscribe"]>(() => () => {}),
		remove: vi.fn(async () => {}),
		approve: vi.fn(async () => {}),
		revoke: vi.fn(async () => {}),
		notify: vi.fn(async () => {}),
		downloadAttachment: vi.fn(async () => new Uint8Array([1, 2, 3])),
		discardPending: vi.fn(async () => {}),
		connect: vi.fn(async () => {}),
		disconnect: vi.fn(),
	} satisfies ChatService;
	const runtime = {
		state: { identity: { id: "parent", role: "manager" }, familyId: "family" },
		services: {
			chat,
			chatPeople: createChatPeopleService({
				child: () => null,
				parent: () => ({ id: "parent", name: "Parent", role: "manager" }),
				family: {
					getMyFamily: vi.fn(async () => ({ id: "family" })),
					listMembers: vi.fn(async () => [{ id: "member", accountId: "sam" }]),
					getAccount: vi.fn(async () => ({ displayName: "Sam" })),
				} as never,
				learning: { listProfiles: async () => [] },
				childHome: { family: async () => [] },
			}),
			calls: {
				start: vi.fn(async () => {}),
				subscribe: vi.fn(() => () => {}),
				close: vi.fn(),
			},
		},
	} as unknown as Runtime;
	render(ChatScreen, { context: new Map([["vulture:runtime", runtime]]) });
	return { chat, runtime };
}

async function openFamily() {
	const button = await screen.findByRole("button", { name: "Family group" });
	await waitFor(() => expect(button).toBeEnabled());
	await fireEvent.click(button);
	await waitFor(() =>
		expect(screen.getByRole("textbox", { name: "Message", exact: true })).toBeEnabled(),
	);
}

beforeEach(() => {
	document.body.removeAttribute("style");
	vi.stubGlobal("URL", {
		createObjectURL: vi.fn((blob: Blob) => `blob:${blob.type}`),
		revokeObjectURL: vi.fn(),
	});
	vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
	cleanup();
	toastService.clear();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it("loads inline attachment previews and downloads every media type", async () => {
	const { chat } = setup();
	await openFamily();
	expect(await screen.findByAltText("photo.png")).toHaveAttribute("src", "blob:image/png");
	expect(screen.getByLabelText("movie.mp4")).toHaveAttribute("src", "blob:video/mp4");
	expect(screen.getByText("This message is unavailable on this device.")).toBeVisible();
	for (const name of ["Download photo.png", "Download movie.mp4", "Download notes.txt"]) {
		await fireEvent.click(screen.getByRole("button", { name }));
	}
	expect(chat.downloadAttachment).toHaveBeenCalledTimes(5);
	await fireEvent.click(screen.getByRole("button", { name: "Discard unsent messages" }));
	expect(chat.discardPending).toHaveBeenCalledWith("room");
	await fireEvent.click(screen.getByRole("button", { name: "Refresh messages" }));
	expect(chat.sync).toHaveBeenCalledWith("room");
});

it("approves and revokes devices and toggles private notifications", async () => {
	const { chat } = setup();
	const approve = await screen.findByRole("button", { name: "Approve device" });
	await waitFor(() => expect(approve).toBeEnabled());
	await fireEvent.click(approve);
	expect(chat.approve).toHaveBeenCalledWith(expect.objectContaining({ deviceId: "pending" }));
	const revoke = screen.getByRole("button", { name: "Revoke device" });
	await waitFor(() => expect(revoke).toBeEnabled());
	await fireEvent.click(revoke);
	expect(chat.revoke).toHaveBeenCalledWith("pending");
	const notifications = screen.getByRole("checkbox", {
		name: "Notifications without message previews",
	});
	await fireEvent.click(notifications);
	await waitFor(() => expect(chat.notify).toHaveBeenCalledWith(true));
	expect(notifications).toBeChecked();
	await fireEvent.click(notifications);
	expect(chat.notify).toHaveBeenCalledTimes(1);
	expect(notifications).not.toBeChecked();
});

it("deletes a synchronized message after confirmation", async () => {
	const { chat } = setup();
	await openFamily();
	await screen.findByAltText("photo.png");
	await fireEvent.click(screen.getAllByRole("button", { name: "Delete message" })[0]);
	expect(await screen.findByRole("alertdialog")).toHaveTextContent("Delete this message?");
	await fireEvent.click(
		screen.getAllByRole("button", { name: "Delete message", exact: true }).at(-1)!,
	);
	await waitFor(() => expect(chat.remove).toHaveBeenCalledWith("room", "image-message"));
});

it("reports upload progress and clears a delivered attachment", async () => {
	const { chat } = setup();
	await openFamily();
	let finish!: () => void;
	chat.send.mockImplementation(
		(_room, _text, _file, progress) =>
			new Promise<void>((resolve) => {
				progress?.(0.4);
				finish = () => {
					progress?.(1);
					resolve();
				};
			}),
	);
	await fireEvent.change(screen.getByLabelText("Encrypted attachment (up to 20 MiB)"), {
		target: { files: [new File(["image"], "draft.png", { type: "image/png" })] },
	});
	expect(screen.getByAltText("Preview of draft.png")).toBeVisible();
	await fireEvent.click(screen.getByRole("button", { name: "Send encrypted message" }));
	expect(await screen.findByText("Uploading image…")).toBeVisible();
	expect(screen.getByRole("progressbar", { name: "Image upload progress" })).toHaveAttribute(
		"aria-valuenow",
		"40",
	);
	finish();
	await waitFor(() => expect(chat.send).toHaveBeenCalledOnce());
	await waitFor(() => expect(screen.queryByAltText("Preview of draft.png")).toBeNull());
});

it("removes attachment drafts and rolls back optimistic text when sending fails", async () => {
	const { chat } = setup();
	chat.send.mockRejectedValue(new Error("Delivery failed"));
	await openFamily();
	await fireEvent.change(screen.getByLabelText("Encrypted attachment (up to 20 MiB)"), {
		target: { files: [new File(["image"], "draft.png", { type: "image/png" })] },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Remove attachment" }));
	expect(screen.queryByAltText("Preview of draft.png")).toBeNull();
	const editor = screen.getByRole("textbox", { name: "Message", exact: true });
	await fireEvent.input(editor, { target: { value: "Try later" } });
	await fireEvent.click(screen.getByRole("button", { name: "Send encrypted message" }));
	expect(await screen.findByRole("alert")).toHaveTextContent("Delivery failed");
	expect(screen.queryByText("Try later")).toBeNull();
	expect(editor).toHaveValue("Try later");
});

it("keeps chat usable after notification and synchronization failures", async () => {
	const { chat } = setup();
	chat.notify.mockRejectedValueOnce(new Error("Notifications denied"));
	await fireEvent.click(
		await screen.findByRole("checkbox", { name: "Notifications without message previews" }),
	);
	expect(await screen.findByRole("alert")).toHaveTextContent("Notifications denied");
	chat.sync.mockRejectedValueOnce(new Error("Sync offline"));
	await openFamily();
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Sync offline",
	);
	chat.sync.mockRejectedValueOnce("offline");
	await fireEvent.click(screen.getByRole("button", { name: "Refresh messages" }));
	expect(await screen.findAllByRole("alert").then((items) => items.at(-1))).toHaveTextContent(
		"Chat unavailable. Please retry.",
	);
});

it("loads attachment previews only when they intersect and cleans up observers", async () => {
	let intersect!: (entries: { isIntersecting: boolean; target: Element }[]) => void;
	const observe = vi.fn();
	const unobserve = vi.fn();
	vi.stubGlobal(
		"IntersectionObserver",
		class {
			constructor(callback: typeof intersect) {
				intersect = callback;
			}
			observe = observe;
			unobserve = unobserve;
			disconnect = vi.fn();
		},
	);
	const { chat } = setup();
	await openFamily();
	const attachments = document.querySelectorAll(".attachment-display");
	expect(observe).toHaveBeenCalledTimes(2);
	intersect([{ isIntersecting: false, target: attachments[0] }]);
	expect(chat.downloadAttachment).not.toHaveBeenCalled();
	intersect([{ isIntersecting: true, target: attachments[0] }]);
	await waitFor(() => expect(chat.downloadAttachment).toHaveBeenCalledOnce());
	intersect([{ isIntersecting: true, target: attachments[0] }]);
	expect(chat.downloadAttachment).toHaveBeenCalledOnce();
});

it("queues a socket refresh while a message refresh is already running", async () => {
	const { chat } = setup();
	let changed!: () => void;
	chat.subscribe.mockImplementation((listener) => {
		changed = listener;
		return () => {};
	});
	chat.refreshRooms.mockResolvedValue([{ roomId: "room", name: "Family", participants: [] }]);
	await openFamily();
	let finish!: (messages: ChatMessage[]) => void;
	chat.sync.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	await fireEvent.click(screen.getByRole("button", { name: "Refresh messages" }));
	changed();
	finish(messages);
	await waitFor(() => expect(chat.refreshRooms).toHaveBeenCalledOnce());
	await waitFor(() => expect(chat.sync).toHaveBeenCalledTimes(3));
});

it("announces incoming messages and reports notification delivery failures", async () => {
	const { chat } = setup();
	await openFamily();
	await fireEvent.click(
		screen.getByRole("checkbox", { name: "Notifications without message previews" }),
	);
	chat.sync.mockResolvedValueOnce([
		...messages,
		{ ...messages[0], messageId: "incoming", sequence: 5 },
	]);
	chat.notify.mockRejectedValueOnce(new Error("denied"));
	await fireEvent.click(screen.getByRole("button", { name: "Refresh messages" }));
	expect(await screen.findByRole("status")).toHaveTextContent(
		"New family message. Notifications are unavailable.",
	);
});
