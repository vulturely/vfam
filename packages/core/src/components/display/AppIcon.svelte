<script lang="ts">
	/** Compact Vfam wordmark used in the app's brand areas. */
	let { size = 36, rounded = false }: { size?: number; rounded?: boolean } = $props();
</script>

<span
	class="v-app-icon"
	class:rounded
	style:font-size={`${size * 0.65}px`}
	style:min-height={`${size}px`}
	aria-label="Vfam"
>
	<span class="initials">Vf</span><span class="suffix">am</span>
</span>

<style>
	.v-app-icon {
		display: inline-flex;
		align-items: baseline;
		justify-content: center;
		color: var(--v-brand-fg, #8c6500);
		white-space: nowrap;
		flex: 0 0 auto;
		line-height: 1;
		padding-block: 4px;
	}
	.initials {
		font-family: "Snell Roundhand", "Apple Chancery", "Segoe Script", cursive;
		font-style: italic;
		font-weight: 900;
		-webkit-text-stroke: 0.35px currentColor;
	}
	.suffix {
		font-family: inherit;
		font-size: 0.5em;
		font-weight: 600;
	}
	.v-app-icon.rounded {
		border-radius: var(--v-radius);
	}
</style>
