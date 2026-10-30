<script lang="ts">
	import { Button } from "../components/index";
	import type { BuddySettings } from "./buddy";

	let {
		settings,
		busy,
		onautomatic,
		oninstall,
	}: {
		settings: BuddySettings;
		busy: boolean;
		/** Turns automatic installs on or off. Rejects when the change was not saved. */
		onautomatic: (automatic: boolean) => Promise<unknown>;
		/** Asks the device to install its available update now. Rejects when not sent. */
		oninstall: () => Promise<unknown>;
	} = $props();
	const id = $props.id();
	let sending = $state(false);

	const automatic = $derived(settings.auto_update ?? false);
	const phase = $derived(
		settings.update_requested || settings.update_state === "installing"
			? "installing"
			: (settings.update_state ?? "unknown"),
	);
	const status = $derived(
		phase === "installing"
			? "Updating…"
			: phase === "failed"
				? "Last update failed — the FamBuddy kept its previous version."
				: phase === "available"
					? `Update available: ${settings.available_version || "new version"}`
					: phase === "current"
						? "Up to date"
						: "Update status: not reported yet",
	);
	const canInstall = $derived(phase === "failed" || (phase === "available" && !automatic));

	async function send(action: () => Promise<unknown>) {
		sending = true;
		try {
			await action();
		} catch {
			// The caller shows why it failed; the controls stay available for a retry.
		} finally {
			sending = false;
		}
	}
</script>

<div class="buddy-updates">
	<h4>Software updates</h4>
	<p class="update-version">
		{settings.installed_version
			? `Installed version: ${settings.installed_version}`
			: "Installed version: not reported yet"}
	</p>
	<p class="update-status" role="status">{status}</p>
	{#if canInstall}
		<div class="update-actions">
			<Button disabled={busy || sending} onclick={() => void send(oninstall)}>Update now</Button>
		</div>
		<p>The FamBuddy pauses for 1–3 minutes while it updates.</p>
	{/if}
	<div class="update-row">
		<div>
			<span class="update-label" id="{id}-label">Install updates automatically</span>
			<p id="{id}-note">
				{automatic
					? "On: the FamBuddy installs signed updates on its own whenever it is idle."
					: "Off: updates wait until you choose Update now."}
			</p>
		</div>
		<button
			class="switch"
			role="switch"
			type="button"
			aria-labelledby="{id}-label"
			aria-describedby="{id}-note"
			aria-checked={automatic}
			disabled={busy || sending}
			onclick={() => void send(() => onautomatic(!automatic))}><span></span></button
		>
	</div>
</div>

<style>
	.buddy-updates {
		display: grid;
		min-width: 0;
		gap: var(--v-space);
	}
	h4,
	p {
		margin: 0;
	}
	h4 {
		font-size: 0.875rem;
		font-weight: 600;
	}
	p {
		color: var(--v-muted);
		font-size: 0.8125rem;
		line-height: 1.6;
	}
	.update-status,
	.update-label {
		color: var(--v-fg);
		font-weight: 600;
	}
	.update-label {
		font-size: 0.8125rem;
	}
	.update-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--v-space);
	}
	.update-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: calc(var(--v-space) * 2);
	}
	.switch {
		flex: 0 0 36px;
		width: 36px;
		height: 21px;
		border: 1px solid var(--v-border);
		border-radius: 999px;
		padding: 2px;
		background: color-mix(in srgb, var(--v-fg) 10%, transparent);
		cursor: pointer;
		transition: background 160ms ease;
	}
	.switch span {
		display: block;
		width: 15px;
		height: 15px;
		border-radius: 50%;
		background: var(--v-muted);
		transition: transform 160ms ease;
	}
	.switch[aria-checked="true"] {
		background: var(--v-primary);
	}
	.switch[aria-checked="true"] span {
		transform: translateX(14px);
		background: var(--v-primary-fg);
	}
	.switch:disabled {
		cursor: default;
		opacity: 0.5;
	}
	.switch:focus-visible {
		outline: 2px solid var(--v-primary);
		outline-offset: 3px;
	}
</style>
