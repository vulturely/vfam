<script lang="ts">
	import { onDestroy } from "svelte";
	import type { ComponentType } from "svelte";
	import type { FeatureHighlight } from "../theme/features";

	let {
		features,
	}: {
		features: FeatureHighlight[];
	} = $props();

	let index = $state(0);
	const count = $derived(features.length);

	// Auto-rotate the highlighted feature every 4s, pausing briefly when the
	// user interacts with the dots.
	let timer: ReturnType<typeof setInterval> | undefined;
	function startTimer() {
		stopTimer();
		timer = setInterval(() => {
			index = (index + 1) % count;
		}, 4000);
	}
	function stopTimer() {
		if (timer) clearInterval(timer);
	}
	function select(i: number) {
		index = i;
		startTimer();
	}

	$effect(() => {
		if (count === 0) return;
		startTimer();
		return stopTimer;
	});

	onDestroy(stopTimer);
</script>

<div class="v-hero-features" aria-label={count > 1 ? "Feature highlights" : "Highlight"}>
	{#if count > 0}
		{@const feature = features[index % count]}
		{@const FeatureIcon = feature.icon as ComponentType}
		<div class="v-feature-card" aria-live="polite">
			<span class="v-feature-icon">
				<FeatureIcon aria-hidden="true" size={24} strokeWidth={2} />
			</span>
			<span class="v-feature-copy">
				<strong class="v-feature-title">{feature.title}</strong>
				<span class="v-feature-blurb">{feature.blurb}</span>
			</span>
		</div>
	{/if}

	{#if count > 1}
		<div class="v-feature-dots" role="tablist" aria-label="Feature selector">
			{#each features as feature, i (feature.title)}
				<button
					type="button"
					class="v-feature-dot"
					class:active={i === index}
					aria-label={`Feature ${i + 1}: ${feature.title}`}
					aria-selected={i === index}
					role="tab"
					onclick={() => select(i)}
				></button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.v-hero-features {
		min-width: 0;
		display: grid;
		gap: calc(var(--v-space) * 1.5);
	}
	.v-feature-card {
		display: flex;
		align-items: flex-start;
		gap: var(--v-space);
		padding: calc(var(--v-space) * 1.5);
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius);
		background: var(--v-glass, var(--v-surface));
		color: var(--v-fg);
		min-height: 7rem;
	}
	.v-feature-icon {
		flex: 0 0 auto;
		display: grid;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		border-radius: var(--v-radius-sm);
		background: color-mix(in srgb, var(--v-primary) 16%, transparent);
		color: var(--v-primary-text, var(--v-primary));
	}
	.v-feature-copy {
		display: grid;
		gap: calc(var(--v-space) / 2);
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.v-feature-title {
		font-size: 1.05rem;
		line-height: 1.2;
	}
	.v-feature-blurb {
		color: var(--v-muted);
		line-height: 1.5;
	}
	.v-feature-dots {
		display: flex;
		gap: var(--v-space);
		justify-content: center;
	}
	.v-feature-dot {
		width: 0.65rem;
		height: 0.65rem;
		padding: 0;
		border-radius: 999px;
		border: 1px solid var(--v-border);
		background: var(--v-glass, var(--v-surface));
		cursor: pointer;
	}
	.v-feature-dot.active {
		background: var(--v-primary);
		border-color: var(--v-primary-text, var(--v-primary));
	}
</style>
