<script lang="ts">
	import { onMount, type Snippet } from "svelte";
	import { cubicOut } from "svelte/easing";
	import Button from "../controls/Button.svelte";
	import IconButton from "../controls/IconButton.svelte";
	import Save from "lucide-svelte/icons/save";
	import X from "lucide-svelte/icons/x";
	let {
		title,
		subtitle = "",
		children,
		actions,
		navigation,
		onclose,
		onsave,
		disabled = false,
		saveLabel = "Save",
		embedded = false,
	}: {
		embedded?: boolean;
		title: string;
		subtitle?: string;
		children: Snippet;
		actions?: Snippet;
		navigation?: Snippet;
		onclose: () => void;
		onsave?: () => void;
		disabled?: boolean;
		saveLabel?: string;
	} = $props();
	let closing = $state(false);
	let panel: globalThis.HTMLElement;
	function portal(node: globalThis.HTMLElement) {
		if (embedded) return;
		node.ownerDocument.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			},
		};
	}
	function reveal(node: globalThis.Element) {
		return {
			duration: node.ownerDocument.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)")
				?.matches
				? 0
				: 280,
			easing: cubicOut,
			css: (t: number) =>
				`clip-path: inset(0 ${(1 - t) * 100}% 0 0); transform: translateX(${(t - 1) * 24}px); opacity: ${t};`,
		};
	}
	onMount(() => {
		const previous = document.activeElement as globalThis.HTMLElement | null;
		const previousLabel = previous?.getAttribute("aria-label");
		// Only one editor owns keyboard focus at a time, even across workspaces.
		document.dispatchEvent(new globalThis.CustomEvent("vulture:side-form-open", { detail: panel }));
		const onopen = () => onclose();
		document.addEventListener("vulture:side-form-open", onopen);
		const viewport = window.visualViewport;
		function updateViewport() {
			panel.style.setProperty("--v-form-height", `${viewport?.height ?? window.innerHeight}px`);
			panel.style.setProperty("--v-form-top", `${viewport?.offsetTop ?? 0}px`);
		}
		updateViewport();
		viewport?.addEventListener("resize", updateViewport);
		viewport?.addEventListener("scroll", updateViewport);
		panel.focus();
		const onkey = (event: globalThis.KeyboardEvent) => {
			if (event.defaultPrevented || closing) return;
			if (event.key === "Escape") {
				event.preventDefault();
				onclose();
			}
			if (embedded || event.key !== "Tab") return;
			const controls = Array.from(
				panel.querySelectorAll<globalThis.HTMLElement>(
					'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
				),
			).filter((node) => node.getClientRects().length);
			const first = controls[0],
				last = controls.at(-1);
			if (
				event.shiftKey &&
				(document.activeElement === first || document.activeElement === panel)
			) {
				event.preventDefault();
				last?.focus();
			} else if (
				!event.shiftKey &&
				(document.activeElement === last || document.activeElement === panel)
			) {
				event.preventDefault();
				first?.focus();
			}
		};
		document.addEventListener("keydown", onkey);
		return () => {
			viewport?.removeEventListener("resize", updateViewport);
			viewport?.removeEventListener("scroll", updateViewport);
			document.removeEventListener("keydown", onkey);
			document.removeEventListener("vulture:side-form-open", onopen);
			const replacement = previousLabel
				? Array.from(document.querySelectorAll<globalThis.HTMLElement>("[aria-label]")).find(
						(element) => element.getAttribute("aria-label") === previousLabel,
					)
				: undefined;
			const target = previous?.isConnected ? previous : replacement;
			if (
				target &&
				(panel.contains(document.activeElement) || document.activeElement === document.body)
			)
				target.focus();
		};
	});
</script>

<div
	bind:this={panel}
	use:portal
	class="v-side-form"
	class:closing
	class:embedded
	onintrostart={() => (closing = false)}
	onoutrostart={() => (closing = true)}
	role={embedded ? "region" : "dialog"}
	aria-label={title}
	tabindex="-1"
	transition:reveal
>
	<header>
		<div class="info">
			<h2>{title}</h2>
			{#if subtitle}<p>{subtitle}</p>{/if}
		</div>
		{#if embedded}<IconButton icon={X} label="Close" onclick={onclose} />{/if}
	</header>
	<div class="body">{@render children()}</div>
	<footer>
		{#if navigation}{@render navigation()}{/if}
		<div class="actions">
			{#if actions}{@render actions()}{:else if onsave}<Button
					icon={Save}
					onclick={onsave}
					{disabled}>{saveLabel}</Button
				>{/if}
			{#if !embedded}<Button icon={X} variant="ghost" onclick={onclose}>Close</Button>{/if}
		</div>
	</footer>
</div>

<style>
	.v-side-form {
		position: fixed;
		z-index: 70;
		left: calc(var(--v-control-h) + var(--v-space) * 3 + 2px);
		top: var(--v-side-panel-top);
		height: var(--v-side-panel-height);
		width: min(480px, calc(100vw - var(--v-control-h) - var(--v-space) * 5));
		display: flex;
		flex-direction: column;
		min-height: 0;
		border-left: 1px solid var(--v-border);
		border-radius: 0 var(--v-radius) var(--v-radius) 0;
		color: var(--v-fg);
		background: var(--v-nav-surface, var(--v-surface));
		backdrop-filter: blur(24px);
		-webkit-backdrop-filter: blur(24px);
		box-shadow: 14px 0 35px #0002;
		overflow: hidden;
	}
	.v-side-form.embedded {
		position: absolute;
		inset: 0 auto 0 0;
		box-sizing: border-box;
		width: min(360px, 100%);
		max-width: 100%;
		height: 100%;
		min-height: 0;
		border: 0;
		border-right: 1px solid var(--v-border);
		border-radius: 0 20px 20px 0;
		background: color-mix(in srgb, var(--v-surface) 85%, transparent);
		backdrop-filter: blur(24px) saturate(140%);
		-webkit-backdrop-filter: blur(24px) saturate(140%);
		box-shadow: none;
		overflow: hidden;
		z-index: 10;
		margin: 0;
	}
	.embedded header {
		padding: 16px;
	}
	.embedded .body {
		padding: 16px;
		min-width: 0;
		overflow-y: auto;
		overflow-x: hidden;
		flex: 1;
		gap: 12px;
	}
	.embedded .body :global(form),
	.embedded .body :global(label),
	.embedded .body :global(input),
	.embedded .body :global(select) {
		min-width: 0;
		max-width: 100%;
		box-sizing: border-box;
	}
	.embedded footer {
		padding: 8px;
		flex-wrap: wrap;
	}
	.embedded .actions {
		flex-wrap: wrap;
	}
	.embedded footer :global(.v-btn) {
		width: 36px;
		min-width: 36px;
		height: 36px;
		min-height: 36px;
		padding: 6px;
		position: relative;
		gap: 0;
	}
	.embedded footer :global(.v-btn),
	.embedded footer :global(.v-btn:hover),
	.embedded :global(.v-icon-btn:hover) {
		background: transparent;
		color: var(--v-primary-text, var(--v-primary));
	}
	.embedded footer :global(.v-btn-label) {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.v-side-form:focus {
		outline: none;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 20px;
		border-bottom: 1px solid var(--v-border);
		flex-shrink: 0;
	}
	h2 {
		margin: 0;
		font-size: 1rem;
	}
	p {
		margin: 5px 0 0;
		font-size: 0.78rem;
		color: var(--v-muted);
	}
	.info {
		min-width: 0;
	}
	footer {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 16px;
		border-top: 1px solid var(--v-border);
		flex-shrink: 0;
	}
	.actions {
		margin-left: auto;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
		flex-shrink: 0;
	}
	footer :global(.v-btn),
	footer :global(.v-btn:focus-visible) {
		border: 0;
		border-radius: var(--v-radius-sm);
		outline: none;
	}
	footer :global(.v-btn:focus-visible .v-btn-label) {
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.body {
		padding: 20px;
		overflow-y: auto;
		overscroll-behavior: contain;
		min-height: 0;
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	:global(body:has(.v-side-form:not(.closing):not(.embedded)) .v-sidebar) {
		width: calc(
			var(--v-control-h) + var(--v-space) * 3 + 2px +
				min(480px, 100vw - var(--v-control-h) - var(--v-space) * 5)
		);
	}
	@media (max-width: 760px) {
		:global(body:has(.v-side-form:not(.embedded))) {
			overflow: hidden;
		}
		footer :global(.v-btn) {
			width: 36px;
			min-width: 36px;
			height: 36px;
			min-height: 36px;
			padding: 6px;
			border-radius: 8px;
			gap: 0;
			position: relative;
		}
		footer :global(.v-btn-label) {
			position: absolute;
			width: 1px;
			height: 1px;
			padding: 0;
			margin: -1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
		footer :global(.v-btn:focus-visible) {
			filter: brightness(1.3);
		}
		.v-side-form {
			left: 0;
			top: var(--v-form-top, 0px);
			bottom: auto;
			width: 100%;
			height: var(--v-form-height, 100dvh);
			border-left: 0;
			border-radius: 0 24px 24px 0;
		}
		h2 {
			font-size: 18px;
			letter-spacing: -0.02em;
		}
		p {
			font-size: 12px;
		}
		/* Override the app control reset for readable iOS inputs and touch targets. */
		.body
			:global(
				input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="range"]):not(
						[type="color"]
					):not([type="hidden"])
			),
		.body :global(select),
		.body :global(textarea) {
			font-size: 16px !important;
			min-height: 48px !important;
			border-radius: 12px;
		}
		footer :global(.v-btn) {
			touch-action: manipulation;
			-webkit-tap-highlight-color: transparent;
		}
		:global(body:has(.v-side-form:not(.embedded)) .v-sidebar) {
			visibility: hidden;
		}
		header {
			padding: calc(12px + env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 10px
				max(16px, env(safe-area-inset-left));
			gap: 8px;
		}
		footer {
			padding: 6px max(16px, env(safe-area-inset-right)) calc(6px + env(safe-area-inset-bottom))
				max(16px, env(safe-area-inset-left));
		}
		.body {
			padding: 20px max(20px, env(safe-area-inset-right)) 24px max(20px, env(safe-area-inset-left));
			gap: 24px;
			scroll-padding-block: 20px;
		}
	}
</style>
