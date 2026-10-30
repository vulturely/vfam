<script lang="ts">
	import UiUndo2 from "lucide-svelte/icons/undo-2";
	import UiRedo2 from "lucide-svelte/icons/redo-2";
	import UiBold from "lucide-svelte/icons/bold";
	import UiItalic from "lucide-svelte/icons/italic";
	import UiUnderline from "lucide-svelte/icons/underline";
	import UiStrikethrough from "lucide-svelte/icons/strikethrough";
	import UiCode from "lucide-svelte/icons/code";
	import UiHeading1 from "lucide-svelte/icons/heading-1";
	import UiHeading2 from "lucide-svelte/icons/heading-2";
	import UiHeading3 from "lucide-svelte/icons/heading-3";
	import UiList from "lucide-svelte/icons/list";
	import UiListOrdered from "lucide-svelte/icons/list-ordered";
	import UiListTodo from "lucide-svelte/icons/list-todo";
	import UiQuote from "lucide-svelte/icons/quote";
	import UiLink from "lucide-svelte/icons/link";
	import UiMinus from "lucide-svelte/icons/minus";
	import UiRemoveFormatting from "lucide-svelte/icons/remove-formatting";
	import { onMount } from "svelte";
	import { Editor } from "@tiptap/core";
	import StarterKit from "@tiptap/starter-kit";
	import Image from "@tiptap/extension-image";
	import Link from "@tiptap/extension-link";
	import Placeholder from "@tiptap/extension-placeholder";
	import Underline from "@tiptap/extension-underline";
	import TaskList from "@tiptap/extension-task-list";
	import TaskItem from "@tiptap/extension-task-item";

	interface RichTextImageFile {
		name: string;
		type: string;
		size: number;
		arrayBuffer: () => Promise<ArrayBuffer>;
	}

	interface ClipboardLike {
		clipboardData?: {
			files?: ArrayLike<RichTextImageFile>;
		} | null;
		preventDefault?: () => void;
	}

	const emptyDocumentJson = JSON.stringify({
		type: "doc",
		content: [{ type: "paragraph" }],
	});

	let {
		docJson = $bindable(emptyDocumentJson),
		text = $bindable(""),
		placeholder = "Write description…",
		onUploadImage,
	}: {
		docJson?: string;
		text?: string;
		placeholder?: string;
		onUploadImage?: (file: RichTextImageFile) => Promise<string>;
	} = $props();

	let editorHost = $state<unknown>(null);
	let editor = $state<Editor | null>(null);
	let editorStateVersion = $state(0);

	onMount(() => {
		const nextEditor = new Editor({
			element: editorHost as never,
			extensions: [
				StarterKit.configure({ link: false, underline: false }),
				TaskList,
				TaskItem,
				Image.configure({
					inline: false,
					allowBase64: true,
				}),
				Link.configure({
					openOnClick: false,
					autolink: true,
					defaultProtocol: "https",
				}),
				Underline,
				Placeholder.configure({
					placeholder,
				}),
			],
			content: initialContent(docJson, text),
			editorProps: {
				attributes: {
					class: "v-rich-text-editor-content",
					"aria-label": "Description",
				},
				handlePaste: (view, event) => {
					const clipboard = event as unknown as ClipboardLike;
					const files = clipboard?.clipboardData?.files;
					if (!files || files.length === 0) return false;
					const image = Array.from(files).find((file) => file.type.startsWith("image/"));
					if (!image) return false;
					event.preventDefault?.();
					void uploadPastedImage(image);
					return true;
				},
				handleDrop: (view, event) => {
					const drop = event as unknown as ClipboardLike;
					const files = drop?.clipboardData?.files;
					if (!files || files.length === 0) return false;
					const image = Array.from(files).find((file) => file.type.startsWith("image/"));
					if (!image) return false;
					event.preventDefault?.();
					void uploadPastedImage(image);
					return true;
				},
			},
			onUpdate: ({ editor }) => {
				docJson = JSON.stringify(editor.getJSON());
				text = editor.getText().trim();
				editorStateVersion += 1;
			},
			onSelectionUpdate: () => {
				editorStateVersion += 1;
			},
		});
		editor = nextEditor;
		return () => nextEditor.destroy();
	});

	async function uploadPastedImage(file: RichTextImageFile) {
		if (!editor) return;
		try {
			if (onUploadImage) {
				const url = await onUploadImage(file);
				editor.chain().focus().setImage({ src: url, alt: file.name }).run();
				return;
			}
		} catch {
			// Fall through to a local base64 embed so paste still works when the
			// task is not yet saved or the upload backend is unavailable.
		}
		const dataUrl = await fileToDataUrl(file);
		editor.chain().focus().setImage({ src: dataUrl, alt: file.name }).run();
	}

	async function fileToDataUrl(file: RichTextImageFile) {
		const bytes = new Uint8Array(await file.arrayBuffer());
		let binary = "";
		for (const byte of bytes) binary += String.fromCharCode(byte);
		const contentType = file.type || "image/png";
		return `data:${contentType};base64,${globalThis.btoa(binary)}`;
	}

	function initialContent(serializedDoc: string, fallbackText: string) {
		try {
			return JSON.parse(serializedDoc);
		} catch {
			return fallbackText
				? {
						type: "doc",
						content: [
							{
								type: "paragraph",
								content: [{ type: "text", text: fallbackText }],
							},
						],
					}
				: JSON.parse(emptyDocumentJson);
		}
	}

	function runCommand(command: (editor: Editor) => boolean) {
		if (!editor) return;
		command(editor);
		editorStateVersion += 1;
	}

	function isActive(name: string, attributes?: Record<string, unknown>) {
		if (editorStateVersion < 0) return false;
		return editor?.isActive(name, attributes) ?? false;
	}

	function setLink() {
		if (!editor) return;
		const previousUrl = editor.getAttributes("link").href as string | undefined;
		const url = globalThis.prompt("Link URL", previousUrl ?? "https://");
		if (url === null) return;
		if (url === "") {
			editor.chain().focus().extendMarkRange("link").unsetLink().run();
			return;
		}
		editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
	}
</script>

<div class="v-rich-text-editor">
	<div class="v-rich-text-toolbar" aria-label="Description formatting">
		<button
			type="button"
			aria-label="Undo"
			title="Undo"
			onclick={() => runCommand((editor) => editor.chain().focus().undo().run())}
			><UiUndo2 aria-hidden="true" size={18} strokeWidth={1.8} /></button
		>
		<button
			type="button"
			aria-label="Redo"
			title="Redo"
			onclick={() => runCommand((editor) => editor.chain().focus().redo().run())}
			><UiRedo2 aria-hidden="true" size={18} strokeWidth={1.8} /></button
		>
		<span class="v-rich-text-toolbar-sep" aria-hidden="true"></span>
		<button
			type="button"
			aria-label="Bold"
			title="Bold"
			class:active={isActive("bold")}
			onclick={() => runCommand((editor) => editor.chain().focus().toggleBold().run())}
			><UiBold aria-hidden="true" size={18} strokeWidth={1.8} /></button
		>
		<button
			type="button"
			aria-label="Italic"
			title="Italic"
			class:active={isActive("italic")}
			onclick={() => runCommand((editor) => editor.chain().focus().toggleItalic().run())}
			><UiItalic aria-hidden="true" size={18} strokeWidth={1.8} /></button
		>
		<button
			type="button"
			aria-label="Underline"
			title="Underline"
			class:active={isActive("underline")}
			onclick={() => runCommand((editor) => editor.chain().focus().toggleUnderline().run())}
			><UiUnderline aria-hidden="true" size={18} strokeWidth={1.8} /></button
		>
		<button
			type="button"
			aria-label="Strikethrough"
			title="Strikethrough"
			class:active={isActive("strike")}
			onclick={() => runCommand((editor) => editor.chain().focus().toggleStrike().run())}
			><UiStrikethrough aria-hidden="true" size={18} strokeWidth={1.8} /></button
		>
		<button
			type="button"
			aria-label="Inline code"
			title="Inline code"
			class:active={isActive("code")}
			onclick={() => runCommand((editor) => editor.chain().focus().toggleCode().run())}
			><UiCode aria-hidden="true" size={18} strokeWidth={1.8} /></button
		>
		<span class="v-rich-text-toolbar-sep" aria-hidden="true"></span>
		<button
			type="button"
			aria-label="Heading 1"
			title="Heading 1"
			class:active={isActive("heading", { level: 1 })}
			onclick={() =>
				runCommand((editor) => editor.chain().focus().toggleHeading({ level: 1 }).run())}
			><UiHeading1 aria-hidden="true" size={18} strokeWidth={1.8} /></button
		>
		<button
			type="button"
			aria-label="Heading 2"
			title="Heading 2"
			class:active={isActive("heading", { level: 2 })}
			onclick={() =>
				runCommand((editor) => editor.chain().focus().toggleHeading({ level: 2 }).run())}
			><UiHeading2 aria-hidden="true" size={18} strokeWidth={1.8} /></button
		>
		<button
			type="button"
			aria-label="Heading 3"
			title="Heading 3"
			class:active={isActive("heading", { level: 3 })}
			onclick={() =>
				runCommand((editor) => editor.chain().focus().toggleHeading({ level: 3 }).run())}
			><UiHeading3 aria-hidden="true" size={18} strokeWidth={1.8} /></button
		>
		<span class="v-rich-text-toolbar-sep" aria-hidden="true"></span>
		<button
			type="button"
			aria-label="Bulleted list"
			title="Bulleted list"
			class:active={isActive("bulletList")}
			onclick={() => runCommand((editor) => editor.chain().focus().toggleBulletList().run())}
			><UiList aria-hidden="true" size={18} strokeWidth={1.8} /></button
		>
		<button
			type="button"
			aria-label="Numbered list"
			title="Numbered list"
			class:active={isActive("orderedList")}
			onclick={() => runCommand((editor) => editor.chain().focus().toggleOrderedList().run())}
			><UiListOrdered aria-hidden="true" size={18} strokeWidth={1.8} /></button
		>
		<button
			type="button"
			aria-label="Task list"
			title="Task list"
			class:active={isActive("taskList")}
			onclick={() => runCommand((editor) => editor.chain().focus().toggleTaskList().run())}
			><UiListTodo aria-hidden="true" size={18} strokeWidth={1.8} /></button
		>
		<button
			type="button"
			aria-label="Quote"
			title="Quote"
			class:active={isActive("blockquote")}
			onclick={() => runCommand((editor) => editor.chain().focus().toggleBlockquote().run())}
			><UiQuote aria-hidden="true" size={18} strokeWidth={1.8} /></button
		>
		<span class="v-rich-text-toolbar-sep" aria-hidden="true"></span>
		<button
			type="button"
			aria-label="Link"
			title="Link"
			class:active={isActive("link")}
			onclick={setLink}><UiLink aria-hidden="true" size={18} strokeWidth={1.8} /></button
		>
		<button
			type="button"
			aria-label="Horizontal rule"
			title="Horizontal rule"
			onclick={() => runCommand((editor) => editor.chain().focus().setHorizontalRule().run())}
			><UiMinus aria-hidden="true" size={18} strokeWidth={1.8} /></button
		>
		<button
			type="button"
			aria-label="Clear formatting"
			title="Clear formatting"
			onclick={() =>
				runCommand((editor) => editor.chain().focus().clearNodes().unsetAllMarks().run())}
			><UiRemoveFormatting aria-hidden="true" size={18} strokeWidth={1.8} /></button
		>
	</div>
	<div bind:this={editorHost} class="v-rich-text-editor-surface"></div>
</div>

<style>
	.v-rich-text-editor {
		display: grid;
		gap: calc(var(--v-space) * 0.55);
	}
	.v-rich-text-toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: calc(var(--v-space) * 0.45);
		padding: calc(var(--v-space) * 0.45);
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius-sm);
		background: color-mix(in srgb, var(--v-surface) 70%, var(--v-bg));
	}
	.v-rich-text-toolbar button {
		min-height: 2rem;
		border: 1px solid transparent;
		border-radius: calc(var(--v-radius-sm) * 0.75);
		background: transparent;
		color: var(--v-fg);
		font: inherit;
		font-size: 0.82rem;
		font-weight: 800;
		padding: 0 calc(var(--v-space) * 0.7);
		cursor: pointer;
	}
	.v-rich-text-toolbar button:hover,
	.v-rich-text-toolbar button:focus-visible,
	.v-rich-text-toolbar button.active {
		border-color: var(--v-border);
		background: var(--v-bg);
		outline: none;
	}
	.v-rich-text-toolbar-sep {
		align-self: stretch;
		width: 1px;
		background: var(--v-border);
		margin: 0 calc(var(--v-space) * 0.25);
	}
	.v-rich-text-editor-surface {
		min-height: 12rem;
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius-sm);
		background: var(--v-bg);
		color: var(--v-fg);
		padding: var(--v-space) calc(var(--v-space) * 1.25);
	}
	:global(.v-rich-text-editor-content) {
		min-height: calc(12rem - var(--v-space) * 2);
		outline: none;
		line-height: 1.45;
	}
	:global(.v-rich-text-editor-content p),
	:global(.v-rich-text-editor-content h3),
	:global(.v-rich-text-editor-content ul),
	:global(.v-rich-text-editor-content ol),
	:global(.v-rich-text-editor-content blockquote) {
		margin: 0 0 calc(var(--v-space) * 0.75);
	}
	:global(.v-rich-text-editor-content p:last-child),
	:global(.v-rich-text-editor-content h3:last-child),
	:global(.v-rich-text-editor-content ul:last-child),
	:global(.v-rich-text-editor-content ol:last-child),
	:global(.v-rich-text-editor-content blockquote:last-child) {
		margin-bottom: 0;
	}
	:global(.v-rich-text-editor-content ul),
	:global(.v-rich-text-editor-content ol) {
		padding-left: calc(var(--v-space) * 1.3);
	}
	:global(.v-rich-text-editor-content blockquote) {
		border-left: 3px solid var(--v-border);
		color: var(--v-muted);
		padding-left: var(--v-space);
	}
	:global(.v-rich-text-editor-content code) {
		border-radius: calc(var(--v-radius-sm) * 0.6);
		background: var(--v-surface);
		padding: 0 0.25rem;
	}
	:global(.v-rich-text-editor-content p.is-editor-empty:first-child::before) {
		color: var(--v-muted);
		content: attr(data-placeholder);
		float: left;
		height: 0;
		pointer-events: none;
	}
</style>
