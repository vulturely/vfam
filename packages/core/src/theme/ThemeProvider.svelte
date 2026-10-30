<script lang="ts">
	import type { Snippet } from "svelte";
	import type { Profile } from "../runtime/defineApp";
	import { PRESETS } from "./presets";

	let { profile, children }: { profile: Profile; children?: Snippet } = $props();

	$effect(() => {
		const root = document.documentElement;
		root.dataset.vTheme ||= "light";
		for (const [key, value] of Object.entries(PRESETS[profile])) {
			root.style.setProperty(key, value);
		}
	});
</script>

{@render children?.()}

<style>
	:global(html) {
		--v-side-panel-top: calc(var(--v-space) * 2 + env(safe-area-inset-top));
		--v-side-panel-height: calc(
			100dvh - var(--v-space) * 4 - env(safe-area-inset-top) - env(safe-area-inset-bottom)
		);
		font-size: var(--v-font-base);
		background: var(--v-bg);
		background-image: var(--v-bg-gradient, none);
		background-attachment: fixed;
		color: var(--v-fg);
		scrollbar-width: thin;
		scrollbar-color: var(--v-border) transparent;
	}
	:global(html::-webkit-scrollbar) {
		width: 2px;
		height: 2px;
	}
	:global(html::-webkit-scrollbar-track) {
		background: transparent;
	}
	:global(html::-webkit-scrollbar-thumb) {
		border-radius: 999px;
		background: var(--v-border);
	}

	/* On small screens, scale the base font down globally so all rem/em-based
     text tightens up without touching individual components. */
	@media (max-width: 760px) {
		:global(html) {
			font-size: calc(var(--v-font-base) * 0.88);
		}
	}

	:global(html[data-v-theme="dark"]) {
		color-scheme: dark;
		--v-bg: #25283d !important;
		--v-brand-fg: #f0c75e !important;
		--v-bg-gradient:
			radial-gradient(ellipse at 0% 0%, rgba(37, 52, 92, 0.3) 0%, rgba(37, 52, 92, 0) 65%),
			linear-gradient(180deg, #25283d, #292d44) !important;
		--v-surface: #192239 !important;
		--v-glass: rgba(25, 34, 57, 0.92) !important;
		--v-nav-surface: rgba(25, 34, 57, 0.96) !important;
		--v-nav-selected: #223a55 !important;
		--v-shadow: 0 2px 12px rgba(2, 12, 16, 0.18) !important;
		--v-fg: #edf3ff !important;
		--v-muted: #b7c5df !important;
		--v-primary: #1a659e !important;
		--v-primary-fg: #ffffff !important;
		--v-danger: #ff8f9b !important;
		--v-border: rgba(222, 245, 247, 0.08) !important;
		--v-ring: #80bde9 !important;
		--v-primary-text: #91c9f0;
	}

	:global(html[data-v-theme="dark"] body) {
		background: var(--v-bg);
		background-image: var(--v-bg-gradient, none);
		background-attachment: fixed;
		color: var(--v-fg);
	}

	:global(body) {
		margin: 0;
		min-width: 320px;
		min-height: 100vh;
		min-height: 100dvh;
		background: var(--v-bg);
		background-image: var(--v-bg-gradient, none);
		background-attachment: fixed;
		color: var(--v-fg);
		font-family:
			Inter,
			ui-sans-serif,
			system-ui,
			-apple-system,
			BlinkMacSystemFont,
			"Segoe UI",
			sans-serif;
	}

	:global(*),
	:global(*::before),
	:global(*::after) {
		box-sizing: border-box;
	}

	/* Keep single-line fields aligned across shared components and native forms. */
	:global(
		html[data-v-theme]
			body
			input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="range"]):not(
				[type="color"]
			):not([type="hidden"])
	),
	:global(html[data-v-theme] body select:not([multiple]):not([size])) {
		height: max(var(--v-control-h), 44px);
		min-height: max(var(--v-control-h), 44px);
		box-sizing: border-box;
		padding-block: 0;
		font: inherit;
		line-height: normal;
	}
	:global(html[data-v-theme] body select) {
		appearance: none;
		-webkit-appearance: none;
		background-image: none;
		cursor: pointer;
	}
	:global(input[type="checkbox"]) {
		width: 18px;
		height: 18px;
		margin: 0;
		flex-shrink: 0;
		accent-color: var(--v-primary);
		cursor: pointer;
	}
	:global(input[type="checkbox"]:focus-visible) {
		outline: 2px solid var(--v-ring);
		outline-offset: 3px;
	}
	:global(select:focus-visible) {
		outline: 2px solid var(--v-ring);
		outline-offset: 2px;
	}
	/* Text fields show focus through their border instead of an outline ring. */
	:global(input:not([type="checkbox"], [type="radio"]):focus),
	:global(textarea:focus) {
		outline: none;
	}
	:global(input:not([type="checkbox"], [type="radio"]):focus-visible),
	:global(textarea:focus-visible) {
		border-color: var(--v-primary);
	}
	:global(button:has(> svg)) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--v-space);
	}
	:global(button > svg) {
		flex-shrink: 0;
	}
	:global(.v-button-row) {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--v-space);
	}

	:global(button),
	:global(input),
	:global(textarea),
	:global(select) {
		font: inherit;
	}
</style>
