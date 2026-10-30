<script lang="ts">
	import { onDestroy } from "svelte";
	import Check from "lucide-svelte/icons/check";
	import Search from "lucide-svelte/icons/search";
	import X from "lucide-svelte/icons/x";

	interface Option {
		value: string;
		label: string;
		/** Optional profile image shown before the label. */
		avatarUrl?: string | null;
		/** Optional secondary line (e.g. the account id) under the label. */
		subtitle?: string;
	}

	let {
		label,
		options,
		selected = $bindable([]),
		placeholder = "Select…",
		searchPlaceholder = "Search…",
	}: {
		label?: string;
		options: Option[];
		selected?: string[];
		placeholder?: string;
		searchPlaceholder?: string;
	} = $props();

	let open = $state(false);
	let query = $state("");
	let root: HTMLDivElement | undefined = $state();

	const filtered = $derived(
		options.filter((option) =>
			`${option.label} ${option.subtitle ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()),
		),
	);

	function toggle(value: string) {
		selected = selected.includes(value)
			? selected.filter((v) => v !== value)
			: [...selected, value];
	}

	function remove(value: string) {
		selected = selected.filter((v) => v !== value);
	}

	function onDocClick(e: MouseEvent) {
		if (root && !root.contains(e.target as Node)) {
			open = false;
			query = "";
		}
	}

	$effect(() => {
		if (open) {
			document.addEventListener("click", onDocClick);
			return () => document.removeEventListener("click", onDocClick);
		}
	});

	onDestroy(() => document.removeEventListener("click", onDocClick));
</script>

<div class="v-multi-combobox" bind:this={root}>
	{#if label}
		<span class="v-multi-combobox-label">{label}</span>
	{/if}

	<button
		type="button"
		class="v-multi-combobox-trigger"
		aria-haspopup="listbox"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		{#if selected.length === 0}
			<span class="v-multi-combobox-placeholder">{placeholder}</span>
		{:else}
			<span class="v-multi-combobox-chips">
				{#each selected as value (value)}
					<span class="v-multi-combobox-chip">
						{options.find((o) => o.value === value)?.label ?? value}
						<span
							role="button"
							tabindex="0"
							class="v-multi-combobox-chip-remove"
							aria-label={`Remove ${value}`}
							title="Remove"
							onclick={(e) => {
								e.stopPropagation();
								remove(value);
							}}
							onkeydown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									e.stopPropagation();
									remove(value);
								}
							}}
						>
							<X aria-hidden="true" size={12} strokeWidth={2.4} />
						</span>
					</span>
				{/each}
			</span>
		{/if}
	</button>

	{#if open}
		<div class="v-multi-combobox-menu" role="listbox">
			<div class="v-multi-combobox-search">
				<Search aria-hidden="true" size={16} strokeWidth={2.2} />
				<input
					type="text"
					bind:value={query}
					placeholder={searchPlaceholder}
					aria-label={searchPlaceholder}
				/>
			</div>
			<div class="v-multi-combobox-list">
				{#if filtered.length === 0}
					<div class="v-multi-combobox-empty">No options found.</div>
				{:else}
					{#each filtered as option (option.value)}
						<button
							type="button"
							class="v-multi-combobox-option"
							class:selected={selected.includes(option.value)}
							role="option"
							aria-selected={selected.includes(option.value)}
							onclick={() => toggle(option.value)}
						>
							<span class="v-multi-combobox-check">
								{#if selected.includes(option.value)}
									<Check aria-hidden="true" size={16} strokeWidth={2.4} />
								{/if}
							</span>
							{#if option.avatarUrl}
								<img
									class="v-multi-combobox-avatar"
									src={option.avatarUrl}
									alt=""
									aria-hidden="true"
								/>
							{:else}
								<span class="v-multi-combobox-avatar v-multi-combobox-avatar-fallback">
									{option.label.charAt(0).toUpperCase()}
								</span>
							{/if}
							<span class="v-multi-combobox-option-text">
								<span class="v-multi-combobox-option-label">
									{option.label}
								</span>
								{#if option.subtitle}
									<span class="v-multi-combobox-option-subtitle">
										{option.subtitle}
									</span>
								{/if}
							</span>
						</button>
					{/each}
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.v-multi-combobox {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: calc(var(--v-space) * 0.55);
	}
	.v-multi-combobox-label {
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--v-muted);
	}
	.v-multi-combobox-trigger {
		display: flex;
		align-items: center;
		gap: calc(var(--v-space) * 0.5);
		width: 100%;
		min-height: max(var(--v-control-h), 44px);
		padding: calc(var(--v-space) * 0.5) calc(var(--v-space) * 0.75);
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius-sm);
		background: var(--v-bg);
		color: var(--v-fg);
		font: inherit;
		cursor: pointer;
		text-align: left;
	}
	.v-multi-combobox-trigger:focus-visible {
		outline: 2px solid var(--v-ring);
		outline-offset: 1px;
	}
	.v-multi-combobox-placeholder {
		color: var(--v-muted);
		flex: 1;
	}
	.v-multi-combobox-chips {
		display: flex;
		flex-wrap: wrap;
		gap: calc(var(--v-space) * 0.35);
		flex: 1;
		min-width: 0;
	}
	.v-multi-combobox-chip {
		display: inline-flex;
		align-items: center;
		gap: calc(var(--v-space) * 0.3);
		max-width: 100%;
		padding: 0.15rem 0.4rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--v-primary) 14%, var(--v-bg));
		color: var(--v-fg);
		font-size: 0.82rem;
		font-weight: 600;
	}
	.v-multi-combobox-chip-remove {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1rem;
		height: 1rem;
		padding: 0;
		border: none;
		border-radius: 999px;
		background: transparent;
		color: var(--v-muted);
		cursor: pointer;
	}
	.v-multi-combobox-chip-remove:hover {
		color: var(--v-fg);
		background: color-mix(in srgb, var(--v-primary) 20%, transparent);
	}

	.v-multi-combobox-menu {
		position: absolute;
		top: calc(100% + 0.4rem);
		left: 0;
		right: 0;
		z-index: 60;
		display: grid;
		gap: calc(var(--v-space) * 0.5);
		padding: calc(var(--v-space) * 0.5);
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius-sm);
		background: var(--v-surface);
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.22);
	}
	.v-multi-combobox-search {
		display: flex;
		align-items: center;
		gap: calc(var(--v-space) * 0.5);
		padding: 0 calc(var(--v-space) * 0.75);
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius-sm);
		background: var(--v-bg);
		color: var(--v-muted);
	}
	.v-multi-combobox-search input {
		flex: 1;
		min-width: 0;
		min-height: 2.25rem;
		border: none;
		background: transparent;
		color: var(--v-fg);
		font: inherit;
		outline: none;
	}
	.v-multi-combobox-list {
		display: grid;
		gap: calc(var(--v-space) * 0.2);
		max-height: 12rem;
		overflow-y: auto;
	}
	.v-multi-combobox-option {
		display: flex;
		align-items: center;
		gap: calc(var(--v-space) * 0.5);
		width: 100%;
		min-height: 2.5rem;
		padding: 0 calc(var(--v-space) * 0.5);
		border: none;
		border-radius: calc(var(--v-radius-sm) * 0.6);
		background: transparent;
		color: var(--v-fg);
		font: inherit;
		font-size: 0.9rem;
		cursor: pointer;
		text-align: left;
	}
	.v-multi-combobox-option:hover,
	.v-multi-combobox-option.selected {
		background: color-mix(in srgb, var(--v-primary) 12%, transparent);
	}
	.v-multi-combobox-check {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		color: var(--v-primary);
	}
	.v-multi-combobox-avatar {
		flex: 0 0 auto;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 999px;
		object-fit: cover;
	}
	.v-multi-combobox-avatar-fallback {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: color-mix(in srgb, var(--v-primary) 18%, var(--v-bg));
		color: var(--v-fg);
		font-size: 0.8rem;
		font-weight: 700;
	}
	.v-multi-combobox-option-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		line-height: 1.2;
	}
	.v-multi-combobox-option-label {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.v-multi-combobox-option-subtitle {
		color: var(--v-muted);
		font-size: 0.78rem;
		overflow-wrap: anywhere;
	}
	.v-multi-combobox-empty {
		padding: calc(var(--v-space) * 0.75);
		color: var(--v-muted);
		font-size: 0.9rem;
		text-align: center;
	}
</style>
