<script lang="ts">
	import X from "lucide-svelte/icons/x";
	import { toastService } from "../../services/toast.svelte";
</script>

<div class="v-toast-stack" aria-label="Notifications">
	{#each toastService.items as item (item.id)}
		<div
			class="v-toast"
			class:success={item.kind === "success"}
			class:info={item.kind === "info"}
			role={item.kind === "error" ? "alert" : "status"}
		>
			<p>{item.message}</p>
			{#if item.action}
				{@const action = item.action}
				<button
					type="button"
					class="action"
					onclick={() => {
						toastService.dismiss(item.id);
						action.run();
					}}>{action.label}</button
				>
			{/if}
			<button
				type="button"
				aria-label={item.kind === "error" ? "Dismiss error" : "Dismiss notification"}
				title="Dismiss"
				onclick={() => toastService.dismiss(item.id)}
			>
				<X aria-hidden="true" size={16} />
			</button>
		</div>
	{/each}
</div>

<style>
	.v-toast-stack {
		position: fixed;
		top: calc(var(--v-space) + env(safe-area-inset-top));
		right: calc(var(--v-space) + env(safe-area-inset-right));
		z-index: 1000;
		display: flex;
		flex-direction: column;
		gap: calc(var(--v-space) * 0.75);
		width: min(22rem, calc(100vw - var(--v-space) * 2));
		pointer-events: none;
	}
	.v-toast {
		display: flex;
		align-items: center;
		gap: var(--v-space);
		padding: calc(var(--v-space) * 1.25);
		border: 1px solid color-mix(in srgb, var(--v-danger) 45%, var(--v-border));
		border-radius: var(--v-radius-sm);
		background: var(--v-nav-surface, var(--v-surface));
		box-shadow: var(--v-shadow);
		color: var(--v-fg);
		pointer-events: auto;
	}
	.v-toast.info {
		border-color: color-mix(in srgb, var(--v-accent, var(--v-ring)) 45%, var(--v-border));
	}
	.v-toast button.action {
		width: auto;
		padding: 0 0.75rem;
		color: var(--v-accent, var(--v-fg));
		font-weight: 600;
	}
	.v-toast.info button:hover {
		background: color-mix(in srgb, var(--v-accent, var(--v-ring)) 12%, transparent);
		color: var(--v-fg);
	}
	.v-toast.success {
		border-color: color-mix(in srgb, var(--v-success, #288365) 45%, var(--v-border));
	}
	.v-toast p {
		flex: 1;
		margin: 0;
		overflow-wrap: anywhere;
	}
	.v-toast button {
		display: inline-flex;
		flex: 0 0 auto;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: none;
		border-radius: 999px;
		background: transparent;
		color: var(--v-muted);
		cursor: pointer;
	}
	.v-toast button:hover {
		background: color-mix(in srgb, var(--v-danger) 12%, transparent);
		color: var(--v-danger);
	}
	.v-toast.success button:hover {
		background: color-mix(in srgb, var(--v-success, #288365) 12%, transparent);
		color: var(--v-success, #288365);
	}
	.v-toast button:focus-visible {
		outline: 2px solid var(--v-ring);
		outline-offset: 2px;
	}
</style>
