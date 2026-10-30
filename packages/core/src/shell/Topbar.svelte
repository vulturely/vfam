<script lang="ts">
	import type { Runtime } from "../runtime/registry.svelte";
	import User from "lucide-svelte/icons/user";

	let { runtime }: { runtime: Runtime } = $props();

	const identity = $derived(runtime.state.identity);
	const pictureUrl = $derived(identity?.picture ?? null);
</script>

<header class="v-topbar" aria-label={`${runtime.config.name} toolbar`}>
	{#if identity}
		<div class="v-topbar-user">
			{#if pictureUrl}
				<img class="v-topbar-avatar" src={pictureUrl} alt="" aria-hidden="true" />
			{:else}
				<span class="v-topbar-avatar v-topbar-avatar-fallback">
					<User aria-hidden="true" size={20} strokeWidth={2.4} />
				</span>
			{/if}
			<div class="v-topbar-id">
				<span class="v-topbar-name">{identity.name}</span>
				<span class="v-topbar-role">{identity.role}</span>
			</div>
		</div>
	{/if}
</header>

<style>
	.v-topbar {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--v-space);
		min-height: 0;
		padding: calc(16px + env(safe-area-inset-top)) clamp(12px, 3vw, 24px) 0;
		background: transparent;
		border-bottom: 0;
	}
	.v-topbar-user {
		display: flex;
		align-items: center;
		gap: calc(var(--v-space) * 0.75);
		min-width: 0;
		padding: 6px 14px 6px 6px;
		border-radius: 999px;
		background: var(--v-nav-surface, var(--v-surface));
		box-shadow: var(--v-shadow);
	}
	.v-topbar-avatar {
		flex: 0 0 auto;
		width: 32px;
		height: 32px;
		border-radius: 999px;
		object-fit: cover;
	}
	.v-topbar-avatar-fallback {
		display: grid;
		place-items: center;
		background: color-mix(in srgb, var(--v-primary) 14%, transparent);
		color: var(--v-primary-text, var(--v-primary));
	}
	.v-topbar-id {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0;
		min-width: 0;
		line-height: 1.2;
	}
	.v-topbar-name {
		font-weight: 700;
		color: var(--v-fg);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.v-topbar-role {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: capitalize;
		color: var(--v-muted);
		white-space: nowrap;
	}

	@media (max-width: 540px) {
		.v-topbar {
			gap: var(--v-space);
			justify-content: flex-start;
			padding: calc(12px + env(safe-area-inset-top)) 12px 0;
		}
		.v-topbar-user {
			padding: 4px 12px 4px 4px;
		}
	}
</style>
