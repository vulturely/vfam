import { expect, it } from "vitest";
import { createChatViewState } from "./viewState.svelte";

it("forgets every conversation, message and draft on reset", () => {
	const view = createChatViewState();
	view.owner = "parent";
	view.roomId = "room";
	view.title = "Conversation with Sam";
	view.securityOpen = true;
	view.drafts.set("room", { text: "draft", richTextJson: "" });
	view.roomMessages.set("room", []);
	view.pendingMessages.set("c1", {
		roomId: "room",
		message: {
			messageId: "pending:c1",
			clientId: "c1",
			sequence: 1,
			generation: 0,
			deviceId: "d",
			accountId: "parent",
			createdAt: 0,
			deleted: false,
		},
	});
	view.reset();
	expect(view).toMatchObject({
		owner: "",
		roomId: "",
		title: "Family group",
		securityOpen: false,
		status: undefined,
	});
	expect(view.drafts.size + view.roomMessages.size + view.pendingMessages.size).toBe(0);
});
