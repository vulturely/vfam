<script lang="ts">
	import type { Component } from "svelte";

	let {
		screens,
		current,
	}: {
		screens: Map<string, Component>;
		current: { screen: string; params: Record<string, string> };
	} = $props();
</script>

{#if current.screen}
	{@const C = screens.get(current.screen)}
	{#if C}
		<C screen={current.screen} {...current.params} />
	{:else}
		<p class="v-missing">Unknown screen: <code>{current.screen}</code></p>
	{/if}
{:else}
	<p class="v-missing">Select a section from the sidebar.</p>
{/if}

<style>
	.v-missing {
		color: var(--v-muted);
		padding: calc(var(--v-space) * 3);
	}
</style>
