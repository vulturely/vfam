<script lang="ts">
	import type { Snippet } from "svelte";

	let { children }: { children: Snippet } = $props();
</script>

<span class="v-badge">
	{@render children()}
</span>

<style>
	.v-badge {
		display: inline-block;
		padding: 0.15em 0.6em;
		border-radius: 999px;
		background: color-mix(in srgb, var(--v-primary) 15%, transparent);
		color: var(--v-primary-text, var(--v-primary));
		font-size: 0.8em;
		font-weight: 600;
		text-transform: capitalize;
	}
</style>
