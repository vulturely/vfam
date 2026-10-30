import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import ChatComposerEditor from "./ChatComposerEditor.svelte";
import type { Editor } from "@tiptap/core";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

it("formats messages, edits links, and sends only non-shift Enter", async () => {
	const onSend = vi.fn();
	const { container } = render(ChatComposerEditor, {
		docJson: "invalid",
		onSend,
	});
	const host = container.querySelector(".chat-rich-editor-content") as HTMLElement & {
		editor: Editor;
	};
	host.editor.commands.insertContent("Message");
	host.editor.commands.selectAll();
	for (const name of [
		"Bold",
		"Italic",
		"Underline",
		"Strikethrough",
		"Bulleted list",
		"Numbered list",
	]) {
		await fireEvent.click(screen.getByRole("button", { name }));
	}
	const prompt = vi.spyOn(globalThis, "prompt");
	prompt.mockReturnValueOnce("https://example.com");
	await fireEvent.click(screen.getByRole("button", { name: "Link" }));
	prompt.mockReturnValueOnce("");
	await fireEvent.click(screen.getByRole("button", { name: "Link" }));
	prompt.mockReturnValueOnce(null);
	await fireEvent.click(screen.getByRole("button", { name: "Link" }));
	host.editor.commands.insertContent("Message");
	await fireEvent.keyDown(host, { key: "Enter", shiftKey: true });
	expect(onSend).not.toHaveBeenCalled();
	await fireEvent.keyDown(host, { key: "Enter" });
	expect(onSend).toHaveBeenCalledOnce();
	expect(host.editor.getText()).toContain("Message");
});

it("forwards attachment choices and file-handler events", async () => {
	const onPickAttachment = vi.fn();
	const onFilesAdded = vi.fn();
	const { container } = render(ChatComposerEditor, { onPickAttachment, onFilesAdded });
	for (const [name, kind] of [
		["Add image", "image"],
		["Attach file", "file"],
		["Add video", "video"],
	] as const) {
		await fireEvent.click(screen.getByRole("button", { name }));
		expect(onPickAttachment).toHaveBeenCalledWith(kind);
	}
	const host = container.querySelector(".chat-rich-editor-content")!;
	const file = new File(["image"], "image.png", { type: "image/png" });
	const paste = new Event("paste", { bubbles: true, cancelable: true });
	Object.assign(paste, { clipboardData: { files: [file], getData: () => "" } });
	await fireEvent(host, paste);
	await waitFor(() => expect(onFilesAdded).toHaveBeenCalledWith([file]));
});
