<script lang="ts">
	import { getContext } from "svelte";
	import Bot from "lucide-svelte/icons/bot";
	import Plus from "lucide-svelte/icons/plus";
	import Link from "lucide-svelte/icons/link";
	import RefreshCw from "lucide-svelte/icons/refresh-cw";
	import ShieldCheck from "lucide-svelte/icons/shield-check";
	import type { Runtime } from "../runtime/registry.svelte";
	import RegisteredBuddies from "../robot/RegisteredBuddies.svelte";
	import BuddySetup from "../robot/BuddySetup.svelte";
	import BuddyLicense from "../robot/BuddyLicense.svelte";
	import { NEEDS_LICENSE, REMOTE_ACCESS, lacks } from "../robot/license";
	import { ErrorToast, IconButton } from "../components/index";
	const runtime = getContext<Runtime>("vulture:runtime");
	let registrationOpen = $state(false);
	let pairingOpen = $state(false);
	let deviceList = $state<{ refreshDevices(): Promise<void> }>();
</script>

<section class="fambuddy-screen" aria-label="FamBuddy">
	<header>
		<Bot size={23} strokeWidth={1.6} aria-hidden="true" />
		<div>
			<h1>FamBuddy</h1>
			<p>
				<ShieldCheck size={12} aria-hidden="true" /> Your approval, every step.
			</p>
		</div>
		<IconButton
			class="refresh-fambuddy"
			icon={RefreshCw}
			label="Refresh devices"
			onclick={() => void deviceList?.refreshDevices()}
		/>
		<IconButton
			icon={Link}
			label="Home-network pairing"
			active={pairingOpen}
			onclick={() => (pairingOpen = true)}
		/>
		<IconButton
			class="add-fambuddy"
			icon={Plus}
			label="Register a FamBuddy for away from home"
			onclick={() => (registrationOpen = true)}
		/>
	</header>
	<div class="screen-content">
		{#if runtime.state.identity?.role === "manager"}
			{#key `${runtime.config.serverUrl}:${runtime.state.identity.id}`}
				<BuddyLicense service={runtime.services.fambuddyLicense} />
				<BuddySetup
					owner={runtime.state.identity.id}
					server={runtime.config.serverUrl}
					auth={runtime.services.auth}
					familyAi={runtime.services.familyAi}
					bind:pairingOpen
				/>
				<section class="away" aria-labelledby="fambuddy-away">
					<div>
						<h2 id="fambuddy-away">Away from home <span>Optional</span></h2>
						<p>
							Register a FamBuddy with your family server to approve its requests when you are not
							on your home network.
						</p>
						{#if lacks(runtime.services.fambuddyLicense.license, REMOTE_ACCESS)}
							<p class="needs-license">
								{NEEDS_LICENSE}: away-from-home access is a paid feature. Install a license above to
								use it.
							</p>
						{/if}
					</div>
					<RegisteredBuddies bind:this={deviceList} bind:registrationOpen />
				</section>
			{/key}
		{:else}<ErrorToast message="A parent account is required to manage FamBuddy." />{/if}
	</div>
</section>

<style>
	.fambuddy-screen {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
		margin: auto;
		color: var(--v-fg);
		border: 1px solid var(--v-border);
		border-radius: 22px;
		background: var(--v-glass, var(--v-surface));
		overflow: hidden;
	}
	header {
		display: flex;
		align-items: center;
		gap: calc(var(--v-space) * 1.5);
		padding: calc(var(--v-space) * 2) calc(var(--v-space) * 2.5);
		border-bottom: 1px solid var(--v-border);
	}
	header > div {
		min-width: 0;
	}
	header :global(.refresh-fambuddy) {
		margin-left: auto;
	}
	h1 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
	}
	header p {
		display: flex;
		align-items: center;
		gap: calc(var(--v-space) / 2);
		margin: calc(var(--v-space) / 2) 0 0;
		font-size: 0.75rem;
		color: var(--v-muted);
	}
	.screen-content {
		display: grid;
		align-content: start;
		gap: calc(var(--v-space) * 4);
		min-width: 0;
		min-height: 0;
		overflow: auto;
		padding: clamp(calc(var(--v-space) * 1.5), 3vw, calc(var(--v-space) * 3));
	}
	.away {
		display: grid;
		gap: calc(var(--v-space) * 1.5);
		padding-top: calc(var(--v-space) * 3);
		border-top: 1px solid var(--v-border);
	}
	.away h2 {
		display: flex;
		align-items: center;
		gap: var(--v-space);
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
	}
	.away h2 span {
		padding: 2px calc(var(--v-space) * 0.75);
		border-radius: 999px;
		background: color-mix(in srgb, var(--v-fg) 8%, transparent);
		color: var(--v-muted);
		font-size: 0.7rem;
		font-weight: 600;
	}
	.away p {
		margin: calc(var(--v-space) / 2) 0 0;
		max-width: 65ch;
		color: var(--v-muted);
		font-size: 0.8125rem;
		line-height: 1.6;
	}
	.away .needs-license {
		color: var(--v-fg);
		font-weight: 600;
	}
	@media (max-width: 760px) {
		.fambuddy-screen {
			border-radius: 0;
		}
	}
</style>
