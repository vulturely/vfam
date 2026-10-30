<script lang="ts">
	import { Button } from "../components/index";
	import type { BuddyAsker, BuddyVoice } from "./buddy";

	let {
		voices,
		busy,
		onsave,
	}: {
		/** Every voice enrolled on this FamBuddy. */
		voices: BuddyVoice[];
		busy: boolean;
		/** Names a voice; rejects when it was not saved. */
		onsave: (speaker: string, name: string, role: BuddyAsker) => Promise<unknown>;
	} = $props();
	let names = $state<Record<string, string>>({});
	let roles = $state<Record<string, BuddyAsker>>({});

	function nameOf(voice: BuddyVoice) {
		return names[voice.speaker] ?? voice.name;
	}
	function roleOf(voice: BuddyVoice) {
		return roles[voice.speaker] ?? voice.role;
	}
	async function save(voice: BuddyVoice) {
		try {
			await onsave(voice.speaker, nameOf(voice).trim(), roleOf(voice));
		} catch {
			// The caller shows why it failed; the entry stays for a retry.
		}
	}
</script>

<h3>Voices</h3>
<p>
	Name each voice this FamBuddy knows and say whether it is a child or a parent. A voice without a
	name is treated as a child, so a child's questions never go to a cloud AI unless a parent chooses.
</p>
{#if voices.length}
	<ul class="voices">
		{#each voices as voice, index (voice.speaker)}
			<li>
				<input
					aria-label={`Name for voice ${index + 1}`}
					placeholder={`Voice ${index + 1}`}
					maxlength="40"
					value={nameOf(voice)}
					oninput={(event) => (names[voice.speaker] = event.currentTarget.value)}
				/>
				<select
					aria-label={`Who is voice ${index + 1}`}
					value={roleOf(voice)}
					onchange={(event) =>
						(roles[voice.speaker] = event.currentTarget.value === "parent" ? "parent" : "child")}
				>
					<option value="child">Child</option>
					<option value="parent">Parent</option>
				</select>
				<Button
					variant="ghost"
					disabled={busy || !nameOf(voice).trim()}
					onclick={() => void save(voice)}>Save</Button
				>
			</li>
		{/each}
	</ul>
{:else}
	<p>No voices are enrolled on this FamBuddy yet.</p>
{/if}

<style>
	.voices {
		display: grid;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.voices li {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	.voices input,
	.voices select {
		min-height: 36px;
		padding: 0 0.5rem;
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius-sm);
		background: var(--v-bg);
		color: var(--v-fg);
		font: inherit;
	}
	.voices input {
		flex: 1;
		min-width: 0;
	}
</style>
