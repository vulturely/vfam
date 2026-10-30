<script lang="ts">
	import type { Snippet } from "svelte";

	let { children }: { children: Snippet } = $props();
</script>

<div class="v-card">
	{@render children()}
</div>

<style>
	.v-card {
		width: 100%;
		max-width: 100%;
		background: var(--v-glass, var(--v-surface));
		backdrop-filter: blur(18px);
		-webkit-backdrop-filter: blur(18px);
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius);
		padding: clamp(calc(var(--v-space) * 1.5), 3vw, calc(var(--v-space) * 3));
		box-shadow: var(--v-shadow, 0 1px 2px rgba(0, 0, 0, 0.06));
	}
</style>
