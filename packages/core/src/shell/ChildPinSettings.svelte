<script lang="ts">
	import ChevronDown from "lucide-svelte/icons/chevron-down";
	import KeyRound from "lucide-svelte/icons/key-round";
	import Eye from "lucide-svelte/icons/eye";
	import EyeOff from "lucide-svelte/icons/eye-off";
	import { animateDetails } from "../components/animateDetails";
	import { onMount } from "svelte";
	import type { OidcAuth } from "../auth/oidc";
	import { Button, ErrorToast } from "../components/index";
	let {
		auth,
		profileId,
		displayName,
		onSave,
		flat = false,
		grouped = false,
		initialOpen = false,
		onOpenChange,
	}: {
		auth: OidcAuth;
		profileId: string;
		displayName: string;
		flat?: boolean;
		grouped?: boolean;
		initialOpen?: boolean;
		onOpenChange?: (open: boolean) => void;
		onSave?: (access: { enabled: boolean; loginId: string }) => void;
	} = $props();
	let access = $state<{ enabled: boolean; loginId: string } | null>(null);
	let pin = $state("");
	let confirmation = $state("");
	const pinPlaceholder = "_\u3000_\u3000_\u3000_\u3000_\u3000_";
	let showPin = $state(false);
	let showConfirmation = $state(false);
	let busy = $state(false);
	let error = $state("");
	let notice = $state("");
	let editing = $state(false);
	function pinAccordion(node: globalThis.HTMLDetailsElement) {
		node.open = initialOpen;
		return animateDetails(node, onOpenChange);
	}
	async function load() {
		busy = true;
		error = "";
		try {
			access = await auth.getChildPinAccess(profileId);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Could not load child access.";
		} finally {
			busy = false;
		}
	}
	onMount(() => {
		void load();
	});
	async function save(disable = false) {
		if (busy) return;
		error = "";
		notice = "";
		if (!disable && (!/^\d{6}$/.test(pin) || pin !== confirmation)) {
			error = "Enter six digits and make sure both PINs match.";
			return;
		}
		busy = true;
		try {
			access = await auth.setChildPin(profileId, disable ? "" : pin);
			pin = "";
			confirmation = "";
			showPin = false;
			showConfirmation = false;
			editing = false;
			notice = disable ? "PIN access disabled." : "PIN saved.";
			onSave?.(access);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Could not save PIN.";
		} finally {
			busy = false;
		}
	}
</script>

<section aria-label={`${displayName}'s PIN access`}>
	<details class="pin-accordion" class:flat class:grouped use:pinAccordion>
		<summary>
			{#if grouped}<span class="group-icon"
					><KeyRound size={22} strokeWidth={1.5} aria-hidden="true" /></span
				>
				<span class="group-copy"
					><span
						>Profile PIN {#if access?.enabled && !editing}<span class="set">Set</span>{/if}</span
					><small>Protect this child’s profile with six digits.</small></span
				>
				<ChevronDown class="group-chevron" size={17} aria-hidden="true" />
			{:else}<span class="section-title"
					><KeyRound size={15} strokeWidth={1.6} aria-hidden="true" />Profile PIN</span
				>{#if access?.enabled && !editing}<span class="set">Set</span>{/if}{/if}
		</summary>
		<div class="accordion-body">
			<div class="pin-content">
				{#if busy}<p role="status">Saving…</p>{/if}
				<ErrorToast message={error} />
				{#if notice}<p role="status">{notice}</p>{/if}
				{#if access && (!access.enabled || editing)}
					<form
						onsubmit={(event) => {
							event.preventDefault();
							void save();
						}}
					>
						<div class="fields">
							<label
								><span class="sr-only"
									>{access.enabled ? "New six-digit PIN" : "Six-digit PIN"}</span
								><input
									placeholder={pinPlaceholder}
									type={showPin ? "text" : "password"}
									inputmode="numeric"
									pattern={"[0-9]{6}"}
									minlength="6"
									maxlength="6"
									autocomplete="new-password"
									bind:value={pin}
									required
									disabled={busy}
								/><button
									class="pin-visibility"
									type="button"
									aria-label={showPin ? "Hide PIN" : "Show PIN"}
									aria-pressed={showPin}
									disabled={busy}
									onclick={() => (showPin = !showPin)}
									>{#if showPin}<EyeOff size={16} aria-hidden="true" />{:else}<Eye
											size={16}
											aria-hidden="true"
										/>{/if}</button
								></label
							>
							<label
								><span class="sr-only">Confirm PIN</span><input
									placeholder={pinPlaceholder}
									type={showConfirmation ? "text" : "password"}
									inputmode="numeric"
									pattern={"[0-9]{6}"}
									minlength="6"
									maxlength="6"
									autocomplete="new-password"
									bind:value={confirmation}
									required
									disabled={busy}
								/><button
									class="pin-visibility"
									type="button"
									aria-label={showConfirmation ? "Hide confirmation PIN" : "Show confirmation PIN"}
									aria-pressed={showConfirmation}
									disabled={busy}
									onclick={() => (showConfirmation = !showConfirmation)}
									>{#if showConfirmation}<EyeOff size={16} aria-hidden="true" />{:else}<Eye
											size={16}
											aria-hidden="true"
										/>{/if}</button
								></label
							>
						</div>
						<p class="hint">Use six matching digits. Keep the PIN private.</p>
						<div class="actions">
							<Button type="submit" disabled={busy}
								>{access.enabled ? "Reset PIN" : "Set PIN"}</Button
							>{#if editing}<Button
									variant="ghost"
									disabled={busy}
									onclick={() => {
										editing = false;
										pin = "";
										confirmation = "";
									}}>Cancel</Button
								>{/if}
						</div>
					</form>
				{:else if access?.enabled}
					<div class="actions">
						<button
							type="button"
							disabled={busy}
							onclick={() => {
								editing = true;
								notice = "";
							}}>Reset PIN</button
						><button type="button" disabled={busy} onclick={() => void save(true)}
							>Disable PIN access</button
						>
					</div>
				{:else if !busy}<Button onclick={() => void load()}>Retry child access</Button>{/if}
				{#if access?.enabled}
					<details>
						<summary>Sign-in on another device</summary>
						<div class="code">
							<p>Use this code with the PIN.</p>
							<code>{access.loginId}</code><button
								type="button"
								onclick={async () => {
									try {
										await globalThis.navigator.clipboard.writeText(access!.loginId);
										notice = "Code copied.";
									} catch {
										error = "Select the code to copy it.";
									}
								}}>Copy code</button
							>
						</div>
					</details>
				{/if}
			</div>
		</div>
	</details>
</section>

<style>
	section,
	form {
		display: grid;
		gap: 1rem;
	}
	.section-title {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	.pin-content {
		display: grid;
		gap: 1rem;
		padding-top: 12px;
	}
	.pin-accordion {
		box-sizing: border-box;
		border: 1px solid color-mix(in srgb, var(--v-fg) 12%, transparent);
		border-radius: 14px;
		box-shadow: none;
		padding: 0 12px;
	}
	.pin-accordion > summary {
		list-style: none;
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 0.75rem;
		font-weight: 500;
		padding: 16px 0;
	}
	.pin-accordion > summary::-webkit-details-marker {
		display: none;
	}
	.pin-accordion[open] {
		padding-bottom: 12px;
	}
	.pin-accordion[open] > summary {
		border-bottom: 1px solid color-mix(in srgb, var(--v-fg) 7%, transparent);
		margin-inline: -12px;
		padding-inline: 12px;
	}
	.pin-accordion.grouped {
		border: 0;
		border-radius: 0;
		padding: 0;
	}
	.pin-accordion.grouped > summary {
		padding: 1rem;
		margin: 0;
		gap: 1rem;
		border: 0;
		font-size: 0.85rem;
	}
	.group-icon {
		flex: 0 0 38px;
		width: 38px;
		height: 38px;
		display: grid;
		place-items: center;
	}
	.group-copy {
		flex: 1;
		min-width: 0;
		display: grid;
		gap: 0.25rem;
	}
	.group-copy small {
		color: var(--v-muted);
		font-size: 0.72rem;
		font-weight: 400;
		line-height: 1.4;
	}
	.group-copy .set {
		margin-left: 0.5rem;
	}
	.grouped :global(.group-chevron) {
		flex-shrink: 0;
		transition: transform 200ms ease;
	}
	.grouped[open] :global(.group-chevron) {
		transform: rotate(180deg);
	}
	.grouped > .accordion-body {
		padding: 0 1rem 1rem;
		border-top: 1px solid var(--v-border);
	}
	.pin-accordion.flat {
		border: 0;
		border-radius: 0;
		padding-inline: 0;
	}
	.pin-accordion.flat > summary,
	.pin-accordion.flat[open] > summary {
		margin-inline: -12px;
		padding-inline: 12px;
		background: color-mix(in srgb, var(--v-fg) 4%, transparent);
		transition: background 180ms ease;
		border-bottom: 0;
	}
	.pin-accordion.flat > summary:hover {
		background: color-mix(in srgb, var(--v-fg) 7%, transparent);
	}
	.accordion-body {
		display: flow-root;
	}
	.set {
		color: var(--v-primary-text, var(--v-primary));
		font-size: 0.75rem;
	}
	p {
		color: var(--v-muted);
		line-height: 1.5;
		font-size: 0.8rem;
		margin: 0;
	}
	.fields {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0;
		border: 1px solid color-mix(in srgb, var(--v-fg) 12%, transparent);
		border-radius: 8px;
		overflow: hidden;
	}
	.fields > label {
		position: relative;
		min-width: 0;
	}
	.pin-visibility {
		position: absolute;
		right: 4px;
		top: 50%;
		transform: translateY(-50%);
		display: grid;
		place-items: center;
		width: 28px;
		height: 32px;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--v-muted);
		cursor: pointer;
	}
	.fields > label + label {
		border-left: 1px dotted color-mix(in srgb, var(--v-fg) 25%, transparent);
	}
	.fields input {
		width: 100%;
		padding-inline: 32px;
		height: 40px !important;
		min-height: 40px !important;
		border: 0;
		border-radius: 0;
		background: transparent;
		outline: none;
		text-align: center;
	}
	.fields input:focus-visible {
		outline: none;
		background: color-mix(in srgb, var(--v-primary) 5%, transparent);
	}
	.fields input::placeholder {
		font-size: 0.7rem;
		font-weight: 300;
		opacity: 1;
		color: color-mix(in srgb, var(--v-muted) 80%, transparent);
	}
	.hint {
		margin: calc(-1rem + 1px) 0 0;
		text-align: left;
		font-size: 0.7rem;
		font-weight: 300;
		color: color-mix(in srgb, var(--v-muted) 80%, transparent);
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	label {
		display: grid;
		gap: 0.45rem;
		font-size: 0.8rem;
	}
	input {
		box-sizing: border-box;
		min-width: 0;
		min-height: 44px;
		width: 100%;
		border: 1px solid var(--v-border);
		border-radius: 8px;
		padding: 0.7rem;
		background: var(--v-surface);
		color: var(--v-fg);
		font: inherit;
	}
	button:focus-visible,
	summary:focus-visible {
		outline: 2px solid var(--v-primary);
		outline-offset: 2px;
	}
	.actions {
		display: flex;
		gap: 1.25rem;
		align-items: center;
	}
	button {
		padding: 0.3rem 0;
		border: 0;
		background: transparent;
		font: inherit;
		font-size: 0.8rem;
		color: var(--v-muted);
		cursor: pointer;
	}
	.actions :global(.v-btn) {
		border-radius: 8px;
	}
	details {
		font-size: 0.8rem;
		color: var(--v-muted);
	}
	summary {
		cursor: pointer;
		padding-block: 0.5rem;
	}
	.code {
		display: grid;
		gap: 0.75rem;
		padding-top: 0.75rem;
	}
	code {
		overflow-wrap: anywhere;
		user-select: all;
		color: var(--v-fg);
	}
	.code button {
		justify-self: start;
	}
</style>
