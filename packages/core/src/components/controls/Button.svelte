<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		icon?: typeof import("lucide-svelte/icons/plus").default;
		variant?: "primary" | "ghost" | "danger";
		type?: "button" | "submit";
		form?: string;
		disabled?: boolean;
		onclick?: (event: MouseEvent) => void;
		onpointerdown?: (event: globalThis.PointerEvent) => void;
		onpointerup?: (event: globalThis.PointerEvent) => void;
		onpointercancel?: (event: globalThis.PointerEvent) => void;
		onpointerleave?: (event: globalThis.PointerEvent) => void;
		onkeydown?: (event: globalThis.KeyboardEvent) => void;
		onkeyup?: (event: globalThis.KeyboardEvent) => void;
		children: Snippet;
	}

	let {
		icon: Icon,
		variant = "primary",
		type = "button",
		form,
		disabled = false,
		onclick,
		onpointerdown,
		onpointerup,
		onpointercancel,
		onpointerleave,
		onkeydown,
		onkeyup,
		children,
	}: Props = $props();
	let ripple = $state<{
		x: number;
		y: number;
		size: number;
		id: number;
	} | null>(null);
	let rippleId = 0;
	function activate(event: globalThis.MouseEvent) {
		if (!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
			const bounds =
				event.currentTarget instanceof globalThis.HTMLElement
					? event.currentTarget.getBoundingClientRect()
					: null;
			if (bounds) {
				const size = Math.hypot(bounds.width, bounds.height) * 2;
				ripple = {
					x: (event.detail ? event.clientX - bounds.left : bounds.width / 2) - size / 2,
					y: (event.detail ? event.clientY - bounds.top : bounds.height / 2) - size / 2,
					size,
					id: ++rippleId,
				};
			}
		}
		onclick?.(event);
	}
</script>

<button
	{type}
	{form}
	{disabled}
	class="v-btn v-btn-{variant}"
	onclick={activate}
	{onpointerdown}
	{onpointerup}
	{onpointercancel}
	{onpointerleave}
	{onkeydown}
	{onkeyup}
>
	{#if ripple}
		{#key ripple.id}
			<span
				class="v-btn-ripple"
				aria-hidden="true"
				style:left={`${ripple.x}px`}
				style:top={`${ripple.y}px`}
				style:width={`${ripple.size}px`}
				style:height={`${ripple.size}px`}
				onanimationend={() => (ripple = null)}
			></span>
		{/key}
	{/if}
	{#if Icon}<Icon aria-hidden="true" size={18} strokeWidth={1.8} />{/if}
	<span class="v-btn-label">{@render children()}</span>
</button>

<style>
	.v-btn {
		position: relative;
		overflow: hidden;
		isolation: isolate;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--v-space);
		min-height: max(36px, calc(var(--v-control-h) - 4px));
		padding: calc(var(--v-space) * 0.5) calc(var(--v-space) * 1.5);
		width: fit-content;
		justify-self: start;
		max-width: 100%;
		vertical-align: middle;
		border-radius: 999px;
		border: 1px solid transparent;
		font: inherit;
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			filter 120ms ease,
			transform 60ms ease;
	}
	.v-btn-ripple {
		position: absolute;
		pointer-events: none;
		border-radius: 50%;
		background: currentColor;
		opacity: 0;
		animation: v-button-ripple 480ms ease-out forwards;
	}
	@keyframes v-button-ripple {
		from {
			transform: scale(0);
			opacity: 0.24;
		}
		to {
			transform: scale(1);
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.v-btn-ripple {
			animation: none;
		}
	}
	.v-btn :global(svg) {
		flex-shrink: 0;
	}
	.v-btn-label {
		min-width: 0;
		overflow-wrap: anywhere;
		line-height: 1.4;
	}
	@media (max-width: 760px) {
		.v-btn {
			min-height: max(var(--v-control-h), 44px);
		}
	}
	.v-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.v-btn:not(:disabled):hover {
		filter: brightness(1.05);
	}
	.v-btn:not(:disabled):active {
		transform: scale(0.98);
	}
	.v-btn-primary {
		background: var(--v-primary);
		color: var(--v-primary-fg);
	}
	.v-btn-ghost {
		background: transparent;
		color: var(--v-fg);
		color: var(--v-primary-text, var(--v-primary));
	}
	.v-btn:focus-visible {
		outline: 2px solid var(--v-ring);
		outline-offset: 3px;
	}
	.v-btn-ghost:not(:disabled):hover {
		background: color-mix(in srgb, var(--v-primary) 12%, transparent);
	}
	.v-btn-danger {
		background: var(--v-danger);
		color: #ffffff;
	}
</style>
