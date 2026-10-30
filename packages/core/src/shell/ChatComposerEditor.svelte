<script lang="ts">
	import type { Snippet } from "svelte";
	/* eslint-disable no-useless-assignment -- bindable props are outputs consumed by the parent. */
	import { onMount } from "svelte";
	import { Editor } from "@tiptap/core";
	import FileHandler from "@tiptap/extension-file-handler";
	import StarterKit from "@tiptap/starter-kit";
	import Link from "@tiptap/extension-link";
	import Placeholder from "@tiptap/extension-placeholder";
	import Underline from "@tiptap/extension-underline";
	import Bold from "lucide-svelte/icons/bold";
	import Italic from "lucide-svelte/icons/italic";
	import UnderlineIcon from "lucide-svelte/icons/underline";
	import Strikethrough from "lucide-svelte/icons/strikethrough";
	import List from "lucide-svelte/icons/list";
	import ListOrdered from "lucide-svelte/icons/list-ordered";
	import LinkIcon from "lucide-svelte/icons/link";
	import ImagePlus from "lucide-svelte/icons/image-plus";
	import Paperclip from "lucide-svelte/icons/paperclip";
	import Video from "lucide-svelte/icons/video";

	const emptyDocument = JSON.stringify({
		type: "doc",
		content: [{ type: "paragraph" }],
	});
	let {
		docJson = $bindable(emptyDocument),
		text = $bindable(""),
		disabled = false,
		onSend,
		onPickAttachment,
		onFilesAdded,
		actions,
	}: {
		docJson?: string;
		text?: string;
		disabled?: boolean;
		onSend?: () => void;
		onPickAttachment?: (kind: "image" | "file" | "video") => void;
		onFilesAdded?: (files: File[]) => void;
		/** Shown at the right end of the bottom bar, after the formatting controls. */
		actions?: Snippet;
	} = $props();

	let host = $state<HTMLDivElement>();
	let editor = $state<Editor | null>(null);
	let selectionVersion = $state(0);

	onMount(() => {
		const instance = new Editor({
			element: host,
			extensions: [
				StarterKit.configure({ link: false, underline: false }),
				Underline,
				Link.configure({
					openOnClick: false,
					autolink: true,
					defaultProtocol: "https",
				}),
				Placeholder.configure({ placeholder: "Write a message…" }),
				FileHandler.configure({
					onPaste: (_editor, files) => onFilesAdded?.(files),
					onDrop: (_editor, files) => onFilesAdded?.(files),
				}),
			],
			content: parseDocument(docJson),
			editorProps: {
				attributes: {
					class: "chat-rich-editor-content",
					role: "textbox",
					"aria-label": "Message",
					"aria-multiline": "true",
				},
				handleKeyDown: (_view, event) => {
					if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
						event.preventDefault();
						onSend?.();
						return true;
					}
					return false;
				},
			},
			onUpdate: ({ editor: changed }) => {
				docJson = JSON.stringify(changed.getJSON());
				text = changed.getText().trim();
			},
			onSelectionUpdate: () => {
				selectionVersion += 1;
			},
		});
		editor = instance;
		return () => instance.destroy();
	});

	$effect(() => {
		const instance = editor;
		const value = docJson;
		if (!instance || JSON.stringify(instance.getJSON()) === value) return;
		instance.commands.setContent(parseDocument(value), { emitUpdate: false });
	});

	$effect(() => {
		editor?.setEditable(!disabled);
	});

	function parseDocument(value: string) {
		try {
			const parsed: unknown = JSON.parse(value);
			if (parsed && typeof parsed === "object") return parsed;
		} catch {
			// Reset malformed editor state to an empty document.
		}
		return JSON.parse(emptyDocument);
	}

	function active(name: string) {
		return selectionVersion >= 0 && (editor?.isActive(name) ?? false);
	}

	function setLink() {
		if (!editor) return;
		const oldUrl = editor.getAttributes("link").href as string | undefined;
		const url = globalThis.prompt("Link URL", oldUrl ?? "https://");
		if (url === null) return;
		if (!url) {
			editor.chain().focus().extendMarkRange("link").unsetLink().run();
			return;
		}
		editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
	}
</script>

<div class="chat-rich-editor">
	<div class="chat-rich-surface" bind:this={host}></div>
	<div class="chat-rich-bar">
		<div class="chat-rich-toolbar" aria-label="Message formatting">
			<button
				type="button"
				aria-label="Bold"
				title="Bold"
				class:active={active("bold")}
				{disabled}
				onclick={() => editor?.chain().focus().toggleBold().run()}
				><Bold size={16} aria-hidden="true" /></button
			>
			<button
				type="button"
				aria-label="Italic"
				title="Italic"
				class:active={active("italic")}
				{disabled}
				onclick={() => editor?.chain().focus().toggleItalic().run()}
				><Italic size={16} aria-hidden="true" /></button
			>
			<button
				type="button"
				aria-label="Underline"
				title="Underline"
				class:active={active("underline")}
				{disabled}
				onclick={() => editor?.chain().focus().toggleUnderline().run()}
				><UnderlineIcon size={16} aria-hidden="true" /></button
			>
			<button
				type="button"
				aria-label="Strikethrough"
				title="Strikethrough"
				class:active={active("strike")}
				{disabled}
				onclick={() => editor?.chain().focus().toggleStrike().run()}
				><Strikethrough size={16} aria-hidden="true" /></button
			>
			<span aria-hidden="true"></span>
			<button
				type="button"
				aria-label="Bulleted list"
				title="Bulleted list"
				class:active={active("bulletList")}
				{disabled}
				onclick={() => editor?.chain().focus().toggleBulletList().run()}
				><List size={16} aria-hidden="true" /></button
			>
			<button
				type="button"
				aria-label="Numbered list"
				title="Numbered list"
				class:active={active("orderedList")}
				{disabled}
				onclick={() => editor?.chain().focus().toggleOrderedList().run()}
				><ListOrdered size={16} aria-hidden="true" /></button
			>
			<button
				type="button"
				aria-label="Link"
				title="Link"
				class:active={active("link")}
				{disabled}
				onclick={setLink}><LinkIcon size={16} aria-hidden="true" /></button
			>
			<span aria-hidden="true"></span>
			<button
				type="button"
				aria-label="Add image"
				title="Add image"
				{disabled}
				onclick={() => onPickAttachment?.("image")}
				><ImagePlus size={16} aria-hidden="true" /></button
			>
			<button
				type="button"
				aria-label="Attach file"
				title="Attach file"
				{disabled}
				onclick={() => onPickAttachment?.("file")}
				><Paperclip size={16} aria-hidden="true" /></button
			>
			<button
				type="button"
				aria-label="Add video"
				title="Add video"
				{disabled}
				onclick={() => onPickAttachment?.("video")}><Video size={16} aria-hidden="true" /></button
			>
		</div>
		{@render actions?.()}
	</div>
</div>

<style>
	.chat-rich-editor {
		display: grid;
		gap: 0.25rem;
		min-width: 0;
		width: 100%;
	}
	/* Formatting controls on the left, the caller's actions (Send) on the right. */
	.chat-rich-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		min-width: 0;
		padding-top: 0.2rem;
		border-top: 1px solid var(--v-border);
	}
	.chat-rich-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-start;
		min-width: 0;
		gap: 0.15rem;
	}
	.chat-rich-toolbar button {
		display: grid;
		place-items: center;
		width: 1.7rem;
		height: 1.65rem;
		padding: 0;
		border: 1px solid transparent;
		border-radius: 0.3rem;
		background: transparent;
		color: var(--v-muted);
		cursor: pointer;
	}
	.chat-rich-toolbar button:hover,
	.chat-rich-toolbar button:focus-visible,
	.chat-rich-toolbar button.active {
		border-color: var(--v-border);
		background: var(--v-surface);
		color: var(--v-fg);
		outline: none;
	}
	.chat-rich-toolbar button:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}
	.chat-rich-toolbar > span {
		width: 1px;
		height: 1.1rem;
		margin: 0 0.15rem;
		background: var(--v-border);
	}
	.chat-rich-surface {
		min-width: 0;
	}
	:global(.chat-rich-editor-content) {
		/* Room around the text being typed. */
		padding: 0.6rem 0.25rem;
		min-height: 1.8rem;
		max-height: 7rem;
		overflow-y: auto;
		outline: none;
		color: var(--v-fg);
		font: inherit;
		font-size: 0.8rem;
		line-height: 1.45;
		overflow-wrap: anywhere;
	}
	:global(.chat-rich-editor-content p) {
		margin: 0;
	}
	:global(.chat-rich-editor-content p.is-editor-empty:first-child::before) {
		float: left;
		height: 0;
		color: var(--v-muted);
		content: attr(data-placeholder);
		pointer-events: none;
	}
</style>
