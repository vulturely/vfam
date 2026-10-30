<script lang="ts">
	/* eslint-disable no-useless-assignment -- bindable props are outputs consumed by the parent. */
	import type { Snippet } from "svelte";
	let {
		text = $bindable(""),
		docJson = $bindable(""),
		disabled = false,
		actions,
	}: {
		text?: string;
		docJson?: string;
		disabled?: boolean;
		actions?: Snippet;
	} = $props();
	function updateDocument() {
		docJson = JSON.stringify({
			type: "doc",
			content: text
				? [{ type: "paragraph", content: [{ type: "text", text }] }]
				: [{ type: "paragraph" }],
		});
	}
</script>

<textarea aria-label="Message" bind:value={text} {disabled} oninput={updateDocument}></textarea>
{@render actions?.()}
