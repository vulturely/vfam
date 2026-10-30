<script lang="ts">
	import { onMount } from "svelte";
	import Globe from "lucide-svelte/icons/globe";
	import Check from "lucide-svelte/icons/check";
	import X from "lucide-svelte/icons/x";
	import { ErrorToast, IconButton } from "../components/index";
	import type { TimetableService } from "../timetable/service";
	let {
		service,
		profileId,
		flat = false,
	}: {
		service: TimetableService;
		profileId: string;
		flat?: boolean;
	} = $props();
	let timezone = $state("UTC"),
		saved = $state("UTC"),
		loading = $state(true),
		busy = $state(false),
		error = $state("");
	const zones = [
		...new Set([
			"UTC",
			Intl.DateTimeFormat().resolvedOptions().timeZone,
			...Intl.supportedValuesOf("timeZone"),
		]),
	];
	onMount(async () => {
		try {
			const result = await service.get(profileId);
			timezone = saved = result.timezone;
		} catch {
			error = "Could not load profile timezone.";
		} finally {
			loading = false;
		}
	});
	async function save() {
		if (busy || timezone === saved) return;
		busy = true;
		error = "";
		try {
			const result = await service.setTimezone(profileId, timezone);
			timezone = saved = result.timezone;
		} catch {
			error = "Could not save timezone. Please try again.";
		} finally {
			busy = false;
		}
	}
</script>

<section class="timezone" class:flat aria-label="Profile timezone">
	<header>
		<Globe size={15} aria-hidden="true" />
		<h3>Timezone</h3>
	</header>
	<p>Used for this child’s calendar, learning times, and daily schedule.</p>
	<form
		onsubmit={(e) => {
			e.preventDefault();
			void save();
		}}
	>
		<select aria-label="Child timezone" bind:value={timezone} disabled={loading || busy}
			>{#each [...new Set([saved, ...zones])] as zone (zone)}<option value={zone}
					>{zone.replaceAll("_", " ")}</option
				>{/each}</select
		>
		{#if timezone !== saved}<IconButton
				icon={X}
				label="Cancel timezone change"
				disabled={busy}
				onclick={() => {
					timezone = saved;
					error = "";
				}}
			/><IconButton icon={Check} label="Save profile timezone" type="submit" disabled={busy} />{/if}
	</form>
	{#if loading}<p role="status">Loading timezone…</p>{/if}
	<ErrorToast message={error} />
</section>

<style>
	.timezone {
		border: 1px solid var(--v-border);
		border-radius: 12px;
		padding: 1rem;
		min-width: 0;
	}
	.timezone.flat {
		border: 0;
		border-radius: 0;
		padding: 0.75rem 0 0;
	}
	header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--v-muted);
	}
	h3 {
		margin: 0;
		font-size: 0.85rem;
		font-weight: 550;
	}
	p {
		margin: 0.5rem 0 0.75rem;
		color: var(--v-muted);
		font-size: 0.75rem;
		line-height: 1.5;
	}
	form {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	select {
		flex: 1;
		min-width: 0;
		padding: 0.5rem 0;
		background: transparent;
		color: var(--v-fg);
		font: inherit;
		font-size: 0.85rem;
		border: 0;
		outline: none;
	}
	option {
		background: var(--v-surface);
		color: var(--v-fg);
	}
</style>
