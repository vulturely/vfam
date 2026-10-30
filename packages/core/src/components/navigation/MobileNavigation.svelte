<script lang="ts">
	import type { Snippet } from "svelte";
	import { cubicOut } from "svelte/easing";
	import X from "lucide-svelte/icons/x";
	import IconButton from "../controls/IconButton.svelte";

	const dragHintId = $props.id();
	let { children }: { children: Snippet<[() => void]> } = $props();
	let open = $state(false);
	let panel = $state<globalThis.HTMLDivElement>();
	let trigger = $state<globalThis.HTMLButtonElement>();
	const close = () => (open = false);
	let horizontalPosition = $state<number | null>(null);
	let dragging = $state(false);
	let drag:
		| {
				pointerId: number;
				startX: number;
				startY: number;
				center: number;
				moved: boolean;
		  }
		| undefined;
	let suppressNextClick = false;

	function clampPosition(center: number) {
		const halfWidth = (trigger?.getBoundingClientRect().width ?? 64) / 2;
		const inset = Math.min(16, Math.max(0, (window.innerWidth - halfWidth * 2) / 2));
		return Math.max(inset + halfWidth, Math.min(window.innerWidth - inset - halfWidth, center));
	}
	function startDrag(event: globalThis.PointerEvent) {
		if (!event.isPrimary || event.button !== 0 || !trigger) return;
		suppressNextClick = false;
		const bounds = trigger.getBoundingClientRect();
		drag = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			center: bounds.x + bounds.width / 2,
			moved: false,
		};
		trigger.setPointerCapture(event.pointerId);
	}
	function moveDrag(event: globalThis.PointerEvent) {
		if (!drag || drag.pointerId !== event.pointerId) return;
		const offset = event.clientX - drag.startX;
		if (Math.abs(offset) > 4 || Math.abs(event.clientY - drag.startY) > 4) drag.moved = true;
		if (!drag.moved) return;
		event.preventDefault();
		dragging = true;
		horizontalPosition = clampPosition(drag.center + offset);
	}
	function finishDrag(event: globalThis.PointerEvent) {
		if (!drag || drag.pointerId !== event.pointerId) return;
		if (drag.moved) suppressNextClick = true;
		drag = undefined;
		dragging = false;
		if (trigger?.hasPointerCapture(event.pointerId)) trigger.releasePointerCapture(event.pointerId);
	}
	function openMenu(event: globalThis.MouseEvent) {
		if (event.detail > 0 && suppressNextClick) {
			suppressNextClick = false;
			return;
		}
		suppressNextClick = false;
		open = true;
	}

	function slideSheet(node: globalThis.Element) {
		const distance =
			node.getBoundingClientRect().height + (parseFloat(window.getComputedStyle(node).bottom) || 0);
		return {
			duration: node.ownerDocument.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)")
				?.matches
				? 0
				: 220,
			easing: cubicOut,
			css: (_progress: number, remaining: number) =>
				`transform: translateY(${remaining * distance}px);`,
		};
	}

	$effect(() => {
		if (!open || !panel) return;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		panel.focus();
		function onPointer(event: globalThis.PointerEvent) {
			const target = event.target as globalThis.Node;
			if (!panel?.contains(target) && !trigger?.contains(target)) close();
		}
		function onKey(event: globalThis.KeyboardEvent) {
			if (event.key === "Escape") {
				event.preventDefault();
				close();
			}
			if (event.key !== "Tab" || !panel) return;
			const controls = Array.from(
				panel.querySelectorAll<globalThis.HTMLElement>(
					'button:not(:disabled), a[href], [tabindex="0"]',
				),
			);
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
		}
		document.addEventListener("pointerdown", onPointer);
		document.addEventListener("keydown", onKey);
		return () => {
			document.body.style.overflow = previousOverflow;
			document.removeEventListener("pointerdown", onPointer);
			document.removeEventListener("keydown", onKey);
			trigger?.focus();
		};
	});
</script>

<svelte:window
	onresize={() => {
		if (window.innerWidth > 760) close();
		if (horizontalPosition !== null) horizontalPosition = clampPosition(horizontalPosition);
	}}
/>

<button
	bind:this={trigger}
	class="v-mobile-trigger"
	class:dragging
	style:left={horizontalPosition === null ? "50%" : `${horizontalPosition}px`}
	type="button"
	aria-label="Open menu"
	aria-haspopup="dialog"
	aria-expanded={open}
	aria-describedby={dragHintId}
	onpointerdown={startDrag}
	onpointermove={moveDrag}
	onpointerup={finishDrag}
	onpointercancel={finishDrag}
	onlostpointercapture={finishDrag}
	onclick={openMenu}
>
	<span class="v-mobile-wordmark"
		><span class="v-mobile-initials">Vf</span><span class="v-mobile-suffix">am</span></span
	>
</button>
<span id={dragHintId} class="v-mobile-help"
	>Drag left or right to reposition. Activate to open navigation.</span
>
{#if open}
	<div class="v-mobile-overlay">
		<button
			class="v-mobile-backdrop"
			type="button"
			aria-label="Close navigation overlay"
			onclick={close}
		></button>
		<div
			bind:this={panel}
			class="v-mobile-panel"
			role="dialog"
			aria-modal="true"
			aria-label="Menu"
			tabindex="-1"
			transition:slideSheet
		>
			<span class="v-mobile-handle" aria-hidden="true"></span>
			<header>
				<strong class="v-mobile-wordmark"
					><span class="v-mobile-initials">Vf</span><span class="v-mobile-suffix">am</span></strong
				>
				<IconButton label="Close menu" icon={X} onclick={close} />
			</header>
			{@render children(close)}
		</div>
	</div>
{/if}

<style>
	.v-mobile-trigger,
	.v-mobile-overlay {
		display: none;
	}
	.v-mobile-help {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
		border: 0;
	}
	.v-mobile-wordmark {
		display: inline-flex;
		align-items: baseline;
	}
	.v-mobile-initials {
		font-family: "Snell Roundhand", "Apple Chancery", "Segoe Script", cursive;
		font-size: 1.3rem;
		font-style: italic;
		font-weight: 800;
		line-height: 1.1;
	}
	.v-mobile-suffix {
		font-family: inherit;
		font-size: 0.75rem;
		font-style: normal;
		font-weight: 400;
		line-height: 1.1;
	}
	@media (max-width: 760px) {
		.v-mobile-trigger {
			display: inline-flex;
			align-items: center;
			gap: var(--v-space);
			position: fixed;
			left: 50%;
			transform: translateX(-50%);
			bottom: calc(var(--v-space) * 2 + env(safe-area-inset-bottom));
			z-index: 60;
			min-height: 44px;
			padding: 0 calc(var(--v-space) * 1.5);
			border: 1px solid var(--v-border);
			border-radius: 999px;
			background: var(--v-glass, var(--v-surface));
			color: var(--v-fg);
			backdrop-filter: blur(18px);
			-webkit-backdrop-filter: blur(18px);
			box-shadow:
				var(--v-shadow),
				0 4px 16px rgba(0, 0, 0, 0.16);
			font: inherit;
			font-weight: 600;
			cursor: grab;
			touch-action: none;
			user-select: none;
			-webkit-user-select: none;
		}
		.v-mobile-trigger.dragging,
		.v-mobile-trigger:active {
			cursor: grabbing;
		}
		.v-mobile-overlay {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 100;
		}
		.v-mobile-backdrop {
			position: absolute;
			inset: 0;
			width: 100%;
			height: 100%;
			border: 0;
			background: rgba(15, 8, 19, 0.5);
			backdrop-filter: blur(4px);
			cursor: pointer;
		}
		.v-mobile-panel {
			position: absolute;
			bottom: calc(var(--v-space) * 2 + env(safe-area-inset-bottom));
			left: calc(var(--v-space) * 2 + env(safe-area-inset-left));
			right: calc(var(--v-space) * 2 + env(safe-area-inset-right));
			max-height: min(
				80dvh,
				40rem,
				calc(100dvh - var(--v-space) * 4 - env(safe-area-inset-top) - env(safe-area-inset-bottom))
			);
			padding: calc(var(--v-space) * 1.5) calc(var(--v-space) * 2) calc(var(--v-space) * 2);
			overscroll-behavior: contain;
			overflow-y: auto;
			border: 1px solid var(--v-border);
			border-radius: calc(var(--v-radius) + 6px);
			background: var(--v-surface);
			color: var(--v-fg);
			box-shadow: var(--v-shadow);
		}
		.v-mobile-handle {
			display: block;
			width: 40px;
			height: 4px;
			margin: 0 auto var(--v-space);
			border-radius: 999px;
			background: var(--v-muted);
			opacity: 0.4;
		}
		header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: var(--v-space);
			margin-bottom: var(--v-space);
		}
		.v-mobile-panel:focus {
			outline: none;
		}
		.v-mobile-trigger:focus-visible {
			outline: 2px solid var(--v-ring);
			outline-offset: 3px;
		}
	}
</style>
