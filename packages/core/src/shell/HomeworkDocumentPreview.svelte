<script lang="ts">
	let { text }: { text: string } = $props();
</script>

<!-- Typed homework is plain text; it is never rendered as HTML. -->
<div class="homework-document-preview" role="document" aria-label="Homework document">
	{#if text.trim()}<p>{text}</p>{:else}<p class="empty">No instructions.</p>{/if}
</div>

<style>
	.homework-document-preview {
		min-width: 0;
		overflow: auto;
		padding: 20px;
	}
	p {
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		line-height: 1.6;
	}
	.empty {
		color: var(--v-muted);
	}
</style>
