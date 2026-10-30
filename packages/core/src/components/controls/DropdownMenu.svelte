<script lang="ts">
	import { onDestroy } from "svelte";
	import type { ComponentType } from "svelte";
	import ChevronDown from "lucide-svelte/icons/chevron-down";
	import Copy from "lucide-svelte/icons/copy";
	import Check from "lucide-svelte/icons/check";

	interface Item {
		/** Stable unique key for the item (labels can repeat, e.g. when a user's
		 * display name equals their account id). */
		id: string;
		label: string;
		icon: ComponentType;
		onSelect: () => void;
		/** Optional section header; items with the same section are grouped. */
		section?: string;
		/** When true, show a copy button that copies the label to the clipboard. */
		copyable?: boolean;
	}

	let {
		triggerIcon: TriggerIcon,
		triggerLabel,
		items,
		triggerImageUrl = null,
		triggerBorderless = false,
		showTriggerArrow = true,
		menuPlacement = "bottom-end",
	}: {
		triggerIcon: ComponentType;
		triggerLabel: string;
		items: Item[];
		/** Optional profile image shown in place of the trigger icon. */
		triggerImageUrl?: string | null;
		/** Remove the trigger's border/background. */
		triggerBorderless?: boolean;
		/** Show the chevron arrow next to the trigger. */
		showTriggerArrow?: boolean;
		/** Where the menu opens relative to the trigger. */
		menuPlacement?: "bottom-end" | "side-start";
	} = $props();

	// Group items by their section, preserving order.
	const groups = $derived(
		items.reduce<{ section: string; items: Item[] }[]>((acc, item) => {
			const section = item.section ?? "";
			const last = acc[acc.length - 1];
			if (last && last.section === section) {
				last.items.push(item);
			} else {
				acc.push({ section, items: [item] });
			}
			return acc;
		}, []),
	);

	let open = $state(false);
	let root: HTMLDivElement | undefined = $state();
	let copiedLabel = $state<string | null>(null);

	async function copyItem(item: Item) {
		try {
			await navigator.clipboard.writeText(item.label);
			copiedLabel = item.label;
			setTimeout(() => {
				if (copiedLabel === item.label) copiedLabel = null;
			}, 1500);
		} catch {
			// Clipboard unavailable; ignore.
		}
	}

	function onDocClick(e: MouseEvent) {
		if (root && !root.contains(e.target as Node)) open = false;
	}

	$effect(() => {
		if (open) {
			document.addEventListener("click", onDocClick);
			return () => document.removeEventListener("click", onDocClick);
		}
	});

	onDestroy(() => document.removeEventListener("click", onDocClick));
</script>

<div class="v-dropdown" bind:this={root}>
	<button
		type="button"
		class="v-dropdown-trigger"
		class:borderless={triggerBorderless}
		class:image-trigger={triggerImageUrl != null}
		aria-haspopup="menu"
		aria-expanded={open}
		title={triggerLabel}
		onclick={() => (open = !open)}
	>
		{#if triggerImageUrl}
			<img class="v-dropdown-img" src={triggerImageUrl} alt="" aria-hidden="true" />
		{:else}
			<TriggerIcon aria-hidden="true" size={20} strokeWidth={2.4}></TriggerIcon>
		{/if}
		{#if showTriggerArrow}
			<span class="v-dropdown-arrow" class:open>
				<ChevronDown aria-hidden="true" size={16} strokeWidth={2.4} />
			</span>
		{/if}
	</button>
	{#if open}
		<div class="v-dropdown-menu" class:side-start={menuPlacement === "side-start"} role="menu">
			{#each groups as group, gi (group.section)}
				{#if gi > 0}
					<div class="v-dropdown-sep" role="separator"></div>
				{/if}
				{#if group.section}
					<div class="v-dropdown-section" role="presentation">
						{group.section}
					</div>
				{/if}
				{#each group.items as item (item.id)}
					<div class="v-dropdown-item">
						<button
							type="button"
							role="menuitem"
							class="v-dropdown-item-main"
							onclick={() => {
								open = false;
								item.onSelect();
							}}
						>
							<span class="v-dropdown-item-icon">
								<item.icon aria-hidden="true" size={18} strokeWidth={2.2} />
							</span>
							<span class="v-dropdown-item-label">{item.label}</span>
						</button>
						{#if item.copyable}
							<button
								type="button"
								class="v-dropdown-copy"
								aria-label={`Copy ${item.label}`}
								title="Copy"
								onclick={() => void copyItem(item)}
							>
								{#if copiedLabel === item.label}
									<Check aria-hidden="true" size={16} strokeWidth={2.2} />
								{:else}
									<Copy aria-hidden="true" size={16} strokeWidth={2.2} />
								{/if}
							</button>
						{/if}
					</div>
				{/each}
			{/each}
		</div>
	{/if}
</div>

<style>
	.v-dropdown {
		position: relative;
		display: inline-flex;
	}
	.v-dropdown-trigger {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: calc(var(--v-space) / 2);
		padding: 0 calc(var(--v-space) * 0.75);
		min-width: max(var(--v-control-h), 44px);
		height: max(var(--v-control-h), 44px);
		border-radius: 999px;
		border: 1px solid var(--v-border);
		background: var(--v-surface);
		color: var(--v-fg);
		cursor: pointer;
		transition:
			background 120ms ease,
			color 120ms ease,
			filter 120ms ease,
			transform 60ms ease;
	}
	.v-dropdown-trigger.borderless {
		background: transparent;
		border-color: transparent;
	}
	.v-dropdown-trigger:hover {
		filter: brightness(1.05);
	}
	.v-dropdown-trigger:active {
		transform: scale(0.96);
	}
	.v-dropdown-trigger:focus-visible {
		outline: 2px solid var(--v-ring);
		outline-offset: 2px;
	}
	.v-dropdown-img {
		width: calc(max(var(--v-control-h), 44px) - 8px);
		height: calc(max(var(--v-control-h), 44px) - 8px);
		border-radius: 999px;
		object-fit: cover;
	}
	.v-dropdown-arrow {
		transition: transform 150ms ease;
	}
	.v-dropdown-arrow.open {
		transform: rotate(180deg);
	}
	.v-dropdown-menu {
		position: absolute;
		top: calc(100% + 0.6rem);
		right: 0;
		z-index: 50;
		min-width: 12rem;
		max-width: calc(100vw - calc(var(--v-space) * 2));
		display: grid;
		gap: calc(var(--v-space) / 2);
		padding: calc(var(--v-space) * 1.25);
		/* Water-drop shape: rounded bottom, pointed tip at the top-right. */
		border-radius: 1.1rem 1.1rem 1.4rem 1.4rem;
		background: linear-gradient(
			160deg,
			color-mix(in srgb, var(--v-surface) 92%, var(--v-primary) 8%),
			var(--v-surface)
		);
		border: 1px solid var(--v-border);
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.22);
	}
	/* The droplet tip pointing up toward the trigger. */
	.v-dropdown-menu::before {
		content: "";
		position: absolute;
		top: -0.45rem;
		right: 1.1rem;
		width: 0.9rem;
		height: 0.9rem;
		background: inherit;
		border-left: 1px solid var(--v-border);
		border-top: 1px solid var(--v-border);
		transform: rotate(45deg);
		border-radius: 0.15rem;
	}
	/* Side placement: opens upward and to the right from a left-side trigger. */
	.v-dropdown-menu.side-start {
		top: auto;
		right: auto;
		bottom: 0;
		left: calc(100% + 0.6rem);
	}
	.v-dropdown-menu.side-start::before {
		top: auto;
		right: auto;
		bottom: 1rem;
		left: -0.45rem;
		border-left: none;
		border-top: none;
		border-right: 1px solid var(--v-border);
		border-bottom: 1px solid var(--v-border);
	}
	.v-dropdown-item {
		display: flex;
		align-items: center;
		gap: calc(var(--v-space) / 2);
		width: 100%;
		border-radius: var(--v-radius-sm);
	}
	.v-dropdown-item:hover {
		background: color-mix(in srgb, var(--v-primary) 12%, transparent);
	}
	.v-dropdown-item-main {
		display: flex;
		align-items: center;
		gap: var(--v-space);
		flex: 1;
		min-width: 0;
		padding: calc(var(--v-space) * 0.9) var(--v-space);
		border: none;
		background: transparent;
		color: var(--v-fg);
		font: inherit;
		font-size: 0.95rem;
		cursor: pointer;
		text-align: left;
	}
	.v-dropdown-copy {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		margin-right: calc(var(--v-space) / 2);
		border: none;
		border-radius: var(--v-radius-sm);
		background: transparent;
		color: var(--v-muted);
		cursor: pointer;
	}
	.v-dropdown-copy:hover {
		color: var(--v-fg);
		background: color-mix(in srgb, var(--v-primary) 12%, transparent);
	}
	/* Fixed-width icon column so all labels align vertically. */
	.v-dropdown-item-icon {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
	}
	.v-dropdown-item-label {
		flex: 1;
		min-width: 0;
	}
	/* Full-width separator between items (bleeds past the menu padding). */
	.v-dropdown-sep {
		height: 1px;
		margin: calc(var(--v-space) / 2) calc(var(--v-space) * -1.25);
		background: var(--v-border);
	}
	/* Section header label. */
	.v-dropdown-section {
		padding: calc(var(--v-space) / 2) var(--v-space) 0;
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--v-muted);
	}
</style>
