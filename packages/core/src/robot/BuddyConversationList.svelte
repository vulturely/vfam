<script lang="ts">
	import Bot from "lucide-svelte/icons/bot";
	import type { FamBuddySession } from "./directory.svelte";

	let {
		sessions,
		selectedId,
		onSelect,
	}: {
		sessions: FamBuddySession[];
		selectedId: string;
		onSelect: (id: string) => void;
	} = $props();
</script>

{#if sessions.length}
	<section class="buddy-conversations" aria-label="FamBuddy conversations">
		<h3>FamBuddy</h3>
		{#each sessions as session (session.registration.id)}
			<button
				type="button"
				class:current={selectedId === session.registration.id}
				aria-pressed={selectedId === session.registration.id}
				disabled={!session.service}
				onclick={() => onSelect(session.registration.id)}
			>
				<span class="conversation-avatar" aria-hidden="true"><Bot size={18} /></span>
				<span>
					<strong>{session.registration.name}</strong>
					<small>{session.service ? "Direct conversation" : "Pair to chat"}</small>
				</span>
			</button>
		{/each}
	</section>
{/if}

<style>
	.buddy-conversations {
		display: grid;
		gap: 0.2rem;
		margin-top: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--v-border);
	}
	h3 {
		margin: 0;
		padding: 0 0.9rem 0.35rem;
		color: var(--v-muted);
		font-size: 0.7rem;
		font-weight: 500;
	}
	button {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		min-width: 0;
		padding: 0.6rem;
		border: 0;
		border-radius: 8px;
		background: transparent;
		color: var(--v-fg);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	button.current,
	button:hover {
		background: color-mix(in srgb, var(--v-primary) 8%, transparent);
	}
	button:disabled {
		cursor: default;
		opacity: 0.55;
	}
	button > span:last-child {
		display: grid;
		gap: 0.2rem;
		min-width: 0;
	}
	strong,
	small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	strong {
		font-size: 0.78rem;
	}
	small {
		color: var(--v-muted);
		font-size: 0.65rem;
	}
	.conversation-avatar {
		display: grid;
		place-items: center;
		flex: 0 0 auto;
		width: 32px;
		height: 32px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--v-primary) 12%, transparent);
		color: var(--v-primary-text, var(--v-primary));
	}
</style>
