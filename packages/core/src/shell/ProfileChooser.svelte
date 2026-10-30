<script lang="ts">
	import { getContext, onMount } from "svelte";
	import type { Runtime } from "../runtime/registry.svelte";
	import type { LearningProfile } from "../learning/types";
	import { Button, ErrorToast } from "../components/index";
	import AppIcon from "../components/display/AppIcon.svelte";
	import ParentPinSettings from "./ParentPinSettings.svelte";
	import ChildPinSettings from "./ChildPinSettings.svelte";
	import Unlock from "lucide-svelte/icons/lock-open";
	import ArrowLeft from "lucide-svelte/icons/arrow-left";
	const runtime = getContext<Runtime>("vulture:runtime");
	type Choice = Pick<LearningProfile, "id" | "displayName">;
	let profiles = $state<Choice[]>([]);
	// From a child session the chooser offers the parent (by PIN) and siblings (by their PIN).
	const child = $derived(
		runtime.state.childSession?.status === "active" ? runtime.state.childSession : null,
	);
	let guardianName = $state("");
	const parentName = $derived(
		child ? guardianName || "Parent" : (runtime.state.identity?.name ?? "Parent"),
	);
	let settingParentPin = $state(false);
	// A shared device asks for the parent PIN before opening the parent profile.
	let parentPrompt = $state(false);
	let selected = $state<Choice | null>(null);
	let access = $state<{ enabled: boolean; loginId: string } | null>(null);
	const pinPlaceholder = "_\u3000_\u3000_\u3000_\u3000_\u3000_";
	let pin = $state("");
	let loading = $state(true);
	let busy = $state(false);
	let error = $state("");
	async function load() {
		loading = true;
		error = "";
		try {
			if (child) {
				const members = await runtime.services.childHome.family();
				const guardians = members.filter((member) => member.guardian);
				guardianName = guardians.length === 1 ? guardians[0]!.displayName : "";
				const self = `profile:${child.profileId}`;
				profiles = members
					.filter((member) => member.child && member.participantId !== self)
					.map((member) => ({
						id: member.participantId.slice("profile:".length),
						displayName: member.displayName,
					}));
				return;
			}
			const family = await runtime.services.family.getMyFamily();
			if (!family) {
				runtime.router.navigate("family:setup");
				return;
			}
			profiles = await runtime.services.learning.listProfiles(family.id);
			if (profiles.length === 0) {
				if (runtime.state.parentLocked) parentPrompt = true;
				else runtime.router.navigate("home:parent");
			}
		} catch {
			error = "Could not load profiles. Please try again.";
		} finally {
			loading = false;
		}
	}
	onMount(() => {
		void load();
	});
	async function chooseParent() {
		if (busy) return;
		busy = true;
		error = "";
		try {
			if (child) {
				parentPrompt = true;
				pin = "";
			} else if (!(await runtime.services.auth.getParentPinAccess()).enabled)
				settingParentPin = true;
			else if (runtime.state.parentLocked) {
				parentPrompt = true;
				pin = "";
			} else runtime.router.navigate("home:parent");
		} catch {
			error = "Could not open your parent profile. Please try again.";
		} finally {
			busy = false;
		}
	}
	async function choose(profile: Choice) {
		if (busy) return;
		busy = true;
		error = "";
		try {
			// A sibling's sign-in code stays on the server; the PIN is checked by profile.
			access = child
				? { enabled: true, loginId: "" }
				: await runtime.services.auth.getChildPinAccess(profile.id);
			selected = profile;
			pin = "";
		} catch {
			error = "Could not open this profile. Please try again.";
		} finally {
			busy = false;
		}
	}
	async function unlockParent(event: globalThis.SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		busy = true;
		error = "";
		try {
			if (child) {
				await runtime.services.auth.unlockParent(pin);
				return;
			}
			await runtime.unlockParentProfile(pin);
			runtime.router.navigate("home:parent");
		} catch {
			error =
				"Check your parent PIN. After five incorrect attempts, wait 15 minutes or sign in again.";
			pin = "";
		} finally {
			busy = false;
		}
	}
	async function forgotParentPin() {
		if (busy) return;
		busy = true;
		error = "";
		try {
			if (child) await runtime.services.auth.signIn();
			else await runtime.forgotParentPin();
		} catch {
			error = "Could not start sign-in. Please try again.";
		} finally {
			busy = false;
		}
	}
	function parentPinSaved() {
		runtime.parentPinSaved();
		runtime.router.navigate("home:parent");
	}
	async function open(event: globalThis.SubmitEvent) {
		event.preventDefault();
		if (!access?.enabled || busy) return;
		busy = true;
		error = "";
		try {
			if (child && selected) await runtime.services.auth.switchChildProfile(selected.id, pin);
			else await runtime.services.auth.signInChild(access.loginId, pin);
		} catch {
			error =
				"Check your PIN. After five incorrect attempts, wait 15 minutes or ask a guardian to reset it.";
			pin = "";
			busy = false;
		}
	}
</script>

<section class="chooser" aria-labelledby="profile-choice-title">
	<div class="brand"><AppIcon size={48} rounded /></div>
	{#if settingParentPin}
		<h1 id="profile-choice-title">Your parent PIN</h1>
		<ParentPinSettings
			auth={runtime.services.auth}
			initialOpen
			onSave={parentPinSaved}
			onBack={() => {
				settingParentPin = false;
			}}
		/>
	{:else if runtime.state.parentPinReset}
		<h1 id="profile-choice-title">Set a new parent PIN</h1>
		<ParentPinSettings auth={runtime.services.auth} initialOpen resetting onSave={parentPinSaved} />
		<div class="secondary-links">
			<Button variant="ghost" onclick={() => runtime.logout()}>Sign out</Button>
		</div>
	{:else if parentPrompt}
		<h1 id="profile-choice-title">{parentName}</h1>
		<form onsubmit={unlockParent}>
			<input
				aria-label="Parent PIN"
				placeholder={pinPlaceholder}
				type="password"
				inputmode="numeric"
				pattern={"[0-9]{6}"}
				minlength="6"
				maxlength="6"
				bind:value={pin}
				autocomplete="current-password"
				required
				disabled={busy}
			/>
			<div class="actions">
				{#if profiles.length || child}<Button
						variant="ghost"
						icon={ArrowLeft}
						type="button"
						disabled={busy}
						onclick={() => {
							parentPrompt = false;
							pin = "";
							error = "";
						}}>Profiles</Button
					>{/if}
				<Button type="submit" variant="ghost" icon={Unlock} disabled={busy}
					>{busy ? "Unlocking…" : "Unlock"}</Button
				>
			</div>
		</form>
		<div class="secondary-links">
			<Button variant="ghost" disabled={busy} onclick={forgotParentPin}
				>Forgot PIN? Sign in to reset</Button
			>
			{#if !child}<Button variant="ghost" disabled={busy} onclick={() => runtime.logout()}
					>Sign out</Button
				>{/if}
		</div>
	{:else if selected}
		<h1 id="profile-choice-title">{selected.displayName}</h1>
		{#if access?.enabled}
			<form onsubmit={open}>
				<input
					aria-label="Six-digit PIN"
					placeholder={pinPlaceholder}
					type="password"
					inputmode="numeric"
					pattern={"[0-9]{6}"}
					minlength="6"
					maxlength="6"
					bind:value={pin}
					autocomplete="current-password"
					required
					disabled={busy}
				/>
				<div class="actions">
					<Button
						variant="ghost"
						icon={ArrowLeft}
						type="button"
						disabled={busy}
						onclick={() => {
							selected = null;
							access = null;
							pin = "";
							error = "";
						}}>Profiles</Button
					>
					<Button type="submit" variant="ghost" icon={Unlock} disabled={busy}
						>{busy ? "Unlocking…" : "Unlock"}</Button
					>
				</div>
			</form>
		{:else}
			<Button
				variant="ghost"
				icon={ArrowLeft}
				type="button"
				disabled={busy}
				onclick={() => {
					selected = null;
					access = null;
					pin = "";
					error = "";
				}}>Profiles</Button
			>
			<ChildPinSettings
				auth={runtime.services.auth}
				profileId={selected.id}
				displayName={selected.displayName}
				onSave={(value) => {
					access = value;
				}}
			/>{/if}
	{:else}
		<h1 id="profile-choice-title">Who’s here?</h1>
		{#if loading}<p role="status">Loading profiles…</p>
		{:else if profiles.length || child}
			<div class="profiles" aria-label="Choose a profile">
				<button type="button" disabled={busy} onclick={() => void chooseParent()}
					><span class="avatar parent">{parentName.charAt(0)}</span><strong>{parentName}</strong
					><small>Parent</small></button
				>
				{#each profiles as profile (profile.id)}<button
						type="button"
						disabled={busy}
						onclick={() => void choose(profile)}
						><span class="avatar">{profile.displayName.charAt(0)}</span><strong
							>{profile.displayName}</strong
						><small>Child</small></button
					>{/each}
			</div>
		{/if}
	{/if}
	{#if error}<ErrorToast message={error} />
		{#if !selected && !parentPrompt}<Button variant="ghost" onclick={() => void load()}
				>Try again</Button
			>{/if}{/if}
</section>

<style>
	.chooser {
		width: min(100%, 500px);
		margin: 0 auto;
		text-align: center;
		box-sizing: border-box;
		padding: clamp(1.5rem, 5vw, 3rem);
		border: 1px solid color-mix(in srgb, var(--v-border) 65%, transparent);
		border-radius: 28px;
		background: color-mix(in srgb, var(--v-surface) 65%, transparent);
		backdrop-filter: blur(24px);
		-webkit-backdrop-filter: blur(24px);
	}
	.brand {
		display: flex;
		justify-content: center;
		margin: 0 0 3rem;
	}
	h1 {
		font-size: clamp(1.7rem, 5vw, 2.1rem);
		font-weight: 650;
		letter-spacing: -0.04em;
		margin: 0 0 2rem;
	}
	.profiles {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 1.5rem;
	}
	.profiles button {
		display: grid;
		justify-items: center;
		align-content: start;
		gap: 0.5rem;
		width: 104px;
		padding: 0.5rem 0;
		background: transparent;
		border: 0;
		color: var(--v-fg);
		font: inherit;
		cursor: pointer;
	}
	.avatar {
		display: grid;
		place-items: center;
		width: 72px;
		height: 72px;
		background: var(--v-surface);
		border: 1px solid var(--v-border);
		border-radius: 50%;
		color: var(--v-primary-text, var(--v-primary));
		font-size: 1.5rem;
	}
	.parent {
		background: color-mix(in srgb, var(--v-primary) 10%, var(--v-bg));
		border-color: transparent;
	}
	strong {
		font-weight: 600;
		font-size: 0.9rem;
		max-width: 100%;
		overflow-wrap: anywhere;
	}
	small {
		font-size: 0.75rem;
		color: var(--v-muted);
	}
	.secondary-links {
		display: grid;
		justify-items: center;
		gap: 0.25rem;
		margin-top: 2.5rem;
	}
	.secondary-links :global(button) {
		min-height: 0;
		padding: 0.35rem 0.75rem;
		font-size: 0.78rem;
		font-weight: 400;
		color: var(--v-muted);
	}
	form {
		display: grid;
		gap: 1.25rem;
		max-width: 320px;
		margin-inline: auto;
	}
	input[type="password"] {
		width: 100%;
		min-width: 0;
		min-height: 46px;
		box-sizing: border-box;
		padding: 0.7rem 0;
		border-radius: 0;
		border: 0;
		outline: none;
		background: transparent;
		box-shadow: none;
		color: var(--v-fg);
		font: inherit;
		font-size: 1.5rem;
		text-align: center;
		letter-spacing: 0.55em;
	}
	input[type="password"]::placeholder {
		color: var(--v-muted);
		letter-spacing: normal;
		opacity: 0.65;
	}
	button:focus-visible {
		outline: 2px solid var(--v-primary);
		outline-offset: 4px;
	}
	form :global(.v-btn) {
		border-radius: 8px;
	}
	.actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	[role="status"] {
		color: var(--v-muted);
		font-size: 0.85rem;
	}
	@media (max-width: 540px) {
		.profiles {
			gap: 1rem;
		}
	}
</style>
