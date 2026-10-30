<script lang="ts">
	import type { Snippet } from "svelte";

	const inputId = $props.id();

	let {
		value = $bindable(""),
		label,
		placeholder,
		type = "text",
		trailing,
	}: {
		value?: string;
		label?: string;
		placeholder?: string;
		type?: string;
		/** Optional content rendered inside the field, flush to the right edge. */
		trailing?: Snippet;
	} = $props();
</script>

<div class="v-field">
	{#if label}
		<label class="v-field-label" for={inputId}>{label}</label>
	{/if}
	<span class="v-field-input">
		<input
			id={inputId}
			aria-label={label ?? placeholder}
			class:has-trailing={Boolean(trailing)}
			{type}
			bind:value
			{placeholder}
		/>
		{#if trailing}
			<span class="v-field-trailing">{@render trailing()}</span>
		{/if}
	</span>
</div>

<style>
	.v-field {
		display: flex;
		flex-direction: column;
		gap: calc(var(--v-space) / 2);
	}
	.v-field-label {
		font-weight: 600;
		color: var(--v-fg);
	}
	.v-field-input {
		position: relative;
		display: flex;
		align-items: center;
	}
	input {
		width: 100%;
		min-height: max(var(--v-control-h), 44px);
		border-radius: var(--v-radius-sm);
		border: 1px solid var(--v-border);
		background: var(--v-bg);
		color: var(--v-fg);
		padding: 0 calc(var(--v-space) * 1.5);
		font: inherit;
	}
	input.has-trailing {
		padding-right: calc(max(var(--v-control-h), 44px) + var(--v-space));
	}
	input::placeholder {
		color: var(--v-muted);
	}
	input:focus-visible {
		border-color: var(--v-primary);
	}
	.v-field-trailing {
		position: absolute;
		right: calc(var(--v-space) / 2);
		top: 50%;
		transform: translateY(-50%);
		display: flex;
	}
</style>
