<script lang="ts">
	interface Props {
		label: string;
		icon: typeof import("lucide-svelte/icons/sun").default;
		type?: "button" | "submit";
		active?: boolean;
		disabled?: boolean;
		class?: string;
		ariaHaspopup?: "menu";
		ariaExpanded?: boolean;
		ariaPressed?: boolean;
		onclick?: (event: MouseEvent) => void;
	}

	let {
		label,
		icon: Icon,
		type = "button",
		active = false,
		disabled = false,
		class: className = "",
		ariaHaspopup,
		ariaExpanded,
		ariaPressed,
		onclick,
	}: Props = $props();
</script>

<button
	{type}
	{disabled}
	class="v-icon-btn {className}"
	class:active
	aria-label={label}
	aria-haspopup={ariaHaspopup}
	aria-expanded={ariaExpanded}
	aria-pressed={ariaPressed}
	data-tooltip={label}
	{onclick}
>
	<Icon aria-hidden="true" size={18} strokeWidth={1.8} />
</button>

<style>
	.v-icon-btn {
		position: relative;
		display: inline-grid;
		place-items: center;
		flex: 0 0 auto;
		width: max(36px, calc(var(--v-control-h) - 4px));
		min-width: max(36px, calc(var(--v-control-h) - 4px));
		height: max(36px, calc(var(--v-control-h) - 4px));
		border-radius: 999px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--v-primary-text, var(--v-primary));
		cursor: pointer;
		transition:
			background 120ms ease,
			color 120ms ease,
			border-color 120ms ease,
			filter 120ms ease,
			transform 60ms ease;
	}

	.v-icon-btn::after {
		content: attr(data-tooltip);
		position: absolute;
		top: calc(100% + 8px);
		left: 50%;
		transform: translateX(-50%);
		z-index: 100;
		width: max-content;
		max-width: min(240px, 80vw);
		padding: 6px 10px;
		border-radius: var(--v-radius-sm);
		background: var(--v-fg);
		color: var(--v-bg);
		font-size: 0.75rem;
		font-weight: 500;
		line-height: 1.4;
		pointer-events: none;
		visibility: hidden;
		transition: visibility 0s linear 0s;
	}
	.v-icon-btn:focus-visible::after {
		visibility: visible;
		transition-delay: 1s;
	}
	@media (hover: hover) {
		.v-icon-btn:hover::after {
			visibility: visible;
			transition-delay: 1s;
		}
	}
	.v-icon-btn.active {
		background: var(--v-primary);
		color: var(--v-primary-fg);
		border-color: var(--v-primary);
	}

	@media (max-width: 760px) {
		.v-icon-btn {
			width: max(var(--v-control-h), 44px);
			min-width: max(var(--v-control-h), 44px);
			height: max(var(--v-control-h), 44px);
		}
	}
	.v-icon-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.v-icon-btn:not(:disabled):hover {
		background: color-mix(in srgb, var(--v-primary) 12%, transparent);
	}

	.v-icon-btn:not(:disabled):active {
		transform: scale(0.96);
	}

	.v-icon-btn:focus-visible {
		outline: 2px solid var(--v-ring);
		outline-offset: 2px;
	}
</style>
