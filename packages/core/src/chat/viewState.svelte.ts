import { SvelteMap } from "svelte/reactivity";
import type { ChatMessage, ChatStatus } from "./service";
import type { ChatPeople, ChatPerson } from "./people";

export interface ChatDraft {
	text: string;
	richTextJson: string;
	files?: globalThis.File[];
}

/**
 * What the chat screen shows, kept for the whole session so leaving and returning
 * to chat keeps the open conversation, its messages and unsent drafts.
 */
export interface ChatViewState {
	/** The signed-in identity this state belongs to; another identity starts empty. */
	owner: string;
	status?: ChatStatus;
	members: ChatPerson[];
	me?: ChatPeople["self"];
	memberNames: Record<string, string>;
	roomId: string;
	title: string;
	selectedPeer?: string;
	selectedChannel: string;
	securityOpen: boolean;
	notifications: boolean;
	drafts: SvelteMap<string, ChatDraft>;
	roomMessages: SvelteMap<string, ChatMessage[]>;
	pendingMessages: SvelteMap<string, { roomId: string; message: ChatMessage }>;
	/** Forgets everything, for a new session. */
	reset(): void;
}

export function createChatViewState(): ChatViewState {
	const drafts = new SvelteMap<string, ChatDraft>();
	const roomMessages = new SvelteMap<string, ChatMessage[]>();
	const pendingMessages = new SvelteMap<string, { roomId: string; message: ChatMessage }>();
	const view = $state({
		owner: "",
		status: undefined as ChatStatus | undefined,
		members: [] as ChatPerson[],
		me: undefined as ChatPeople["self"] | undefined,
		memberNames: {} as Record<string, string>,
		roomId: "",
		title: "Family group",
		selectedPeer: undefined as string | undefined,
		selectedChannel: "",
		securityOpen: false,
		notifications: false,
	});
	return Object.assign(view, {
		drafts,
		roomMessages,
		pendingMessages,
		reset() {
			Object.assign(view, {
				owner: "",
				status: undefined,
				members: [],
				me: undefined,
				memberNames: {},
				roomId: "",
				title: "Family group",
				selectedPeer: undefined,
				selectedChannel: "",
				securityOpen: false,
				notifications: false,
			});
			drafts.clear();
			roomMessages.clear();
			pendingMessages.clear();
		},
	});
}
