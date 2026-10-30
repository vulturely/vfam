import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import RichTextEditor from "./RichTextEditor.svelte";
import type { Editor } from "@tiptap/core";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

it("applies every formatting command and updates text and document JSON", async () => {
	const { container } = render(RichTextEditor, {
		docJson: "not-json",
		text: "Format me",
	});
	const host = container.querySelector(".v-rich-text-editor-content") as HTMLElement & {
		editor: Editor;
	};
	host.editor.commands.selectAll();
	for (const name of [
		"Bold",
		"Italic",
		"Underline",
		"Strikethrough",
		"Inline code",
		"Heading 1",
		"Heading 2",
		"Heading 3",
		"Bulleted list",
		"Numbered list",
		"Task list",
		"Quote",
		"Horizontal rule",
		"Clear formatting",
		"Undo",
		"Redo",
	]) {
		await fireEvent.click(screen.getByRole("button", { name }));
	}
	const prompts = vi.spyOn(globalThis, "prompt");
	for (const response of ["https://example.com", "", null]) {
		prompts.mockReturnValueOnce(response);
		await fireEvent.click(screen.getByRole("button", { name: "Link" }));
	}
	host.editor.commands.selectAll();
	await fireEvent.click(screen.getByRole("button", { name: "Bold" }));
	expect(host.editor.getJSON().content?.length).toBeGreaterThan(0);
});

it("uploads pasted and dropped images and falls back to local data URLs", async () => {
	const upload = vi.fn(async () => "blob:uploaded");
	const { container } = render(RichTextEditor, { text: "", onUploadImage: upload });
	const host = container.querySelector(".v-rich-text-editor-content") as HTMLElement & {
		editor: Editor;
	};
	const file = {
		name: "image.png",
		type: "image/png",
		size: 3,
		arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
	};
	const paste = new Event("paste", { bubbles: true, cancelable: true });
	Object.assign(paste, { clipboardData: { files: [file], getData: () => "" } });
	await fireEvent(host, paste);
	await waitFor(() => expect(upload).toHaveBeenCalledWith(file));
	expect(host.editor.getHTML()).toContain("blob:uploaded");
	upload.mockRejectedValue(new Error("offline"));
	const fallbackPaste = new Event("paste", { bubbles: true, cancelable: true });
	Object.assign(fallbackPaste, { clipboardData: { files: [file], getData: () => "" } });
	await fireEvent(host, fallbackPaste);
	await waitFor(() => expect(host.editor.getHTML()).toContain("data:image/png;base64,AQID"));
	const emptyDrop = new Event("drop", { bubbles: true });
	Object.assign(emptyDrop, { clipboardData: { files: [] } });
	await fireEvent(host, emptyDrop);
	expect(container.querySelectorAll("img").length).toBeGreaterThan(0);
});

it("embeds dropped images locally and ignores non-image clipboard content", async () => {
	const { container } = render(RichTextEditor, { docJson: "invalid", text: "" });
	const host = container.querySelector(".v-rich-text-editor-content") as HTMLElement & {
		editor: Editor;
	};
	const file = {
		name: "drop.png",
		type: "image/png",
		size: 1,
		arrayBuffer: async () => new Uint8Array([1]).buffer,
	};
	const drop = new Event("drop", { bubbles: true, cancelable: true });
	Object.assign(drop, { clipboardData: { files: [file] } });
	host.editor.view.props.handleDrop?.(
		host.editor.view,
		drop as unknown as DragEvent,
		null as never,
		false,
	);
	await waitFor(() => expect(host.editor.getHTML()).toContain("data:image/png;base64,AQ=="));
	const textOnly = new Event("paste", { bubbles: true });
	Object.assign(textOnly, {
		clipboardData: { files: [{ ...file, type: "text/plain" }], getData: () => "" },
	});
	await fireEvent(host, textOnly);
	expect(host.editor.getHTML()).toContain("drop.png");
	await vi.waitFor(() => expect(host.editor.isFocused).toBe(true));
});
