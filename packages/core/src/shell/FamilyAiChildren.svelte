<script lang="ts">
	import { onMount } from "svelte";
	import { Button, ErrorToast } from "../components/index";
	import type { ChildAiMode, FamilyAiService, KeyOffer } from "../family-ai/service";

	let {
		service,
		children,
	}: { service: FamilyAiService; children: { id: string; displayName: string }[] } = $props();

	let modes = $state<Record<string, ChildAiMode>>({});
	let offers = $state<KeyOffer[]>([]);
	let sharing = $state<{ offer: KeyOffer; code: string }>();
	let busy = $state(false);
	let error = $state("");
	let notice = $state("");

	async function run(action: () => Promise<void>) {
		if (busy) return;
		busy = true;
		error = "";
		notice = "";
		try {
			await action();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Family AI settings are unavailable.";
		} finally {
			busy = false;
		}
	}
	const refresh = async () => {
		[modes, offers] = await Promise.all([service.childModes(), service.keyOffers()]);
	};
	onMount(() => {
		void run(refresh);
	});

	function setMode(profileId: string, mode: ChildAiMode) {
		void run(async () => {
			await service.setChildMode(profileId, mode);
			await refresh();
			notice =
				mode === "child_device"
					? "Open the AI tutor setup on the child's device, then share the key here."
					: "AI now runs on parent devices. For full revocation, also create a new key at your provider.";
		});
	}
	function share(offer: KeyOffer) {
		void run(async () => {
			sharing = { offer, code: await service.respondToKeyOffer(offer.id) };
		});
	}
	function confirm() {
		const current = sharing;
		if (!current) return;
		void run(async () => {
			await service.sendKey(current.offer.id);
			sharing = undefined;
			await refresh();
			notice = `The family AI key was sent to ${current.offer.childName}'s device.`;
		});
	}
	function mismatch() {
		sharing = undefined;
		void run(async () => {
			await refresh();
			error = "Codes did not match, so nothing was sent. Ask your child to start setup again.";
		});
	}
</script>

<section class="family-ai-children" aria-label="Children's AI">
	<h3>Children's AI</h3>
	<p class="note">
		You choose where each child's AI requests run. Answers give hints and steps, not the answers.
	</p>
	{#each children as child (child.id)}
		<label class="child-mode"
			>{child.displayName}
			<select
				value={modes[child.id] ?? "parent_devices"}
				disabled={busy}
				onchange={(event) =>
					setMode(child.id, (event.currentTarget as HTMLSelectElement).value as ChildAiMode)}
			>
				<option value="parent_devices">Parent devices (approve each request)</option>
				<option value="child_device">This child's device</option>
			</select>
		</label>
	{/each}
	{#if sharing}
		<div class="sharing" role="group" aria-label="Confirm key sharing">
			<p>
				Check that {sharing.offer.childName}'s screen shows
				<strong class="code">{sharing.code.slice(0, 3)} {sharing.code.slice(3)}</strong>
			</p>
			<p class="note">
				Someone with the device could copy the key, so set a spending limit with your provider.
			</p>
			<div class="actions">
				<Button disabled={busy} onclick={confirm}>Codes match, send key</Button>
				<Button variant="ghost" disabled={busy} onclick={mismatch}>Codes don't match</Button>
			</div>
		</div>
	{:else}
		{#each offers as offer (offer.id)}
			<div class="offer">
				<span>{offer.childName}'s device is asking for the family AI key.</span>
				<Button disabled={busy} onclick={() => share(offer)}>Share key</Button>
			</div>
		{/each}
	{/if}
	{#if notice}<p role="status">{notice}</p>{/if}
	<ErrorToast message={error} />
</section>

<style>
	.family-ai-children {
		display: grid;
		gap: var(--v-space);
		margin-top: calc(var(--v-space) * 2);
	}
	h3 {
		margin: 0;
		font-size: 1rem;
	}
	.note {
		margin: 0;
		font-size: 0.85rem;
		color: var(--v-muted);
	}
	.child-mode {
		display: grid;
		gap: 4px;
	}
	select {
		font: inherit;
		padding: var(--v-space);
		min-height: 44px;
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius-sm);
		background: var(--v-bg);
		color: var(--v-fg);
		max-width: 100%;
	}
	.offer,
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--v-space);
		align-items: center;
	}
	.code {
		font-size: 1.3rem;
		letter-spacing: 0.15em;
	}
</style>
