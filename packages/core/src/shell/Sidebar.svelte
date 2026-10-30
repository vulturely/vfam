<script lang="ts">
	import type { Runtime } from "../runtime/registry.svelte";
	import LogOut from "lucide-svelte/icons/log-out";
	import UsersRound from "lucide-svelte/icons/users-round";
	import Power from "lucide-svelte/icons/power";
	import { DropdownMenu as Menu } from "bits-ui";
	import Moon from "lucide-svelte/icons/moon";
	import Sun from "lucide-svelte/icons/sun";
	import MobileNavigation from "../components/navigation/MobileNavigation.svelte";
	import AppIcon from "../components/display/AppIcon.svelte";
	import type { ShellNav } from "./shellNav";

	let { runtime, nav }: { runtime: Runtime; nav?: ShellNav } = $props();

	const items = $derived<ShellNav["items"]>(nav ? nav.items : runtime.navItems);
	const current = $derived(nav ? nav.current : runtime.router.current.screen);
	const profile = $derived(items.find((item) => item.id === "profile"));
	const visible = $derived<ShellNav["items"]>(
		nav
			? nav.items.filter((item) => item.id !== "profile")
			: runtime.navItems.filter((item) => {
					if (item.id === "profile") return false;
					const role = runtime.state.identity?.role;
					if (!role || !item.roles || item.roles.length === 0) return true;
					return item.roles.includes(role);
				}),
	);

	const ProfileIcon = $derived(profile?.icon);
	const pictureUrl = $derived(nav ? nav.picture : (runtime.state.identity?.picture ?? null));
	const ThemeIcon = $derived(runtime.theme.mode === "light" ? Sun : Moon);
	function onDesktopNavSelect(event: MouseEvent, id: string) {
		// Vulture owns hash routes. SvelteKit's cached hash can differ after
		// session restoration and suppress an otherwise valid native link click.
		if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		event.preventDefault();
		go(id);
	}
	function go(id: string) {
		if (nav) nav.navigate(id);
		else runtime.router.navigate(id);
	}
	// Parents choose between their own and their children's profiles on shared devices.
	const canSwitchProfile = $derived(
		!!nav || (!!runtime.state.identity && runtime.canAccessScreen("profile:choose")),
	);
	// Children cannot sign out or close the app; a guardian does that from Switch profile.
	const canExit = $derived(!nav && runtime.services.lifecycle.canExit());
	function switchProfile() {
		if (nav) nav.switchProfile();
		else runtime.router.navigate("profile:choose");
	}
</script>

<aside class="v-sidebar">
	<div class="v-sidebar-desktop">
		<div class="v-brand">
			<span class="v-brand-icon"><AppIcon size={36} rounded /></span>
		</div>
		<nav class="v-nav">
			{#each visible as item (item.id)}
				{@const Icon = item.icon}
				<a
					class="v-nav-item"
					class:active={current === item.id}
					aria-current={current === item.id ? "page" : undefined}
					href="#/{item.id}"
					onclick={(event) => onDesktopNavSelect(event, item.id)}
					title={item.label}
					aria-label={item.label}
				>
					{#if Icon}
						<Icon aria-hidden="true" />
					{/if}
					<span class="v-nav-label" aria-hidden="true">{item.label}</span>
				</a>
			{/each}
		</nav>

		<nav class="v-nav-bot">
			{#if profile}
				<a
					class="v-nav-item"
					class:active={current === profile.id}
					aria-current={current === profile.id ? "page" : undefined}
					href="#/{profile.id}"
					onclick={(event) => onDesktopNavSelect(event, profile.id)}
					title={profile.label}
					aria-label={profile.label}
				>
					{#if pictureUrl}
						<img class="v-nav-avatar" src={pictureUrl} alt="" aria-hidden="true" />
					{:else if ProfileIcon}
						<ProfileIcon aria-hidden="true" />
					{/if}
					<span class="v-nav-label" aria-hidden="true">{profile.label}</span>
				</a>
			{/if}
			<button
				type="button"
				class="v-nav-item"
				title={runtime.theme.mode === "light" ? "Dark mode" : "Light mode"}
				aria-label={runtime.theme.mode === "light" ? "Dark mode" : "Light mode"}
				onclick={() => runtime.theme.toggle()}
			>
				<ThemeIcon aria-hidden="true" />
				<span class="v-nav-label" aria-hidden="true">Theme</span>
			</button>
			<Menu.Root>
				<Menu.Trigger class="v-nav-item" title="Account" aria-label="Account menu">
					<LogOut aria-hidden="true" />
					<span class="v-nav-label" aria-hidden="true">Account</span>
				</Menu.Trigger>
				<Menu.Portal
					><Menu.Content
						class="v-account-menu"
						side="right"
						align="end"
						sideOffset={8}
						collisionPadding={8}
					>
						{#if canSwitchProfile}<Menu.Item class="v-account-menu-item" onSelect={switchProfile}
								><UsersRound size={15} aria-hidden="true" />Switch profile</Menu.Item
							>{/if}
						{#if !nav}<Menu.Item class="v-account-menu-item" onSelect={() => runtime.logout()}
								><LogOut size={15} aria-hidden="true" />Log out</Menu.Item
							>{/if}
						{#if canExit}<Menu.Item
								class="v-account-menu-item"
								onSelect={() => void runtime.services.lifecycle.exit()}
								><Power size={15} aria-hidden="true" />Exit</Menu.Item
							>{/if}
					</Menu.Content></Menu.Portal
				>
			</Menu.Root>
		</nav>
	</div>

	<MobileNavigation>
		{#snippet children(close)}
			<nav class="v-mobile-nav" aria-label="Main navigation">
				{#each visible as item (item.id)}
					{@const Icon = item.icon}
					<button
						type="button"
						class="v-mobile-nav-item"
						class:active={current === item.id}
						onclick={() => {
							go(item.id);
							close();
						}}
					>
						{#if Icon}<Icon aria-hidden="true" size={20} />{/if}<span>{item.label}</span>
					</button>
				{/each}
				{#if profile}
					<button
						type="button"
						class="v-mobile-nav-item"
						class:active={current === profile.id}
						onclick={() => {
							go(profile.id);
							close();
						}}
					>
						{#if pictureUrl}
							<img class="v-nav-avatar" src={pictureUrl} alt="" aria-hidden="true" />
						{:else if ProfileIcon}
							<ProfileIcon aria-hidden="true" size={20} />
						{/if}
						<span>{profile.label}</span>
					</button>
				{/if}
				<button type="button" class="v-mobile-nav-item" onclick={() => runtime.theme.toggle()}>
					<ThemeIcon aria-hidden="true" size={20} /><span
						>{runtime.theme.mode === "light" ? "Dark mode" : "Light mode"}</span
					>
				</button>
				{#if canSwitchProfile}<button
						type="button"
						class="v-mobile-nav-item"
						onclick={() => {
							close();
							switchProfile();
						}}
					>
						<UsersRound aria-hidden="true" size={20} /><span>Switch profile</span>
					</button>{/if}
				{#if !nav}<button
						type="button"
						class="v-mobile-nav-item"
						onclick={() => {
							close();
							runtime.logout();
						}}
					>
						<LogOut aria-hidden="true" size={20} /><span>Log out</span>
					</button>{/if}
				{#if canExit}<button
						type="button"
						class="v-mobile-nav-item"
						onclick={() => {
							close();
							void runtime.services.lifecycle.exit();
						}}
					>
						<Power aria-hidden="true" size={20} /><span>Exit</span>
					</button>{/if}
			</nav>
		{/snippet}
	</MobileNavigation>
</aside>

<style>
	.v-brand-icon {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border-radius: var(--v-radius-sm);
	}

	.v-sidebar {
		flex-shrink: 0;
		width: calc(var(--v-control-h) + var(--v-space) * 3 + 2px);
		transition: width 280ms cubic-bezier(0.22, 1, 0.36, 1);
		display: flex;
		flex-direction: column;
		background: var(--v-nav-surface, var(--v-surface));
		backdrop-filter: blur(18px);
		-webkit-backdrop-filter: blur(18px);
		position: fixed;
		left: 0;
		top: var(--v-side-panel-top);
		align-self: flex-start;
		height: var(--v-side-panel-height);
		max-height: var(--v-side-panel-height);
		margin: 0;
		border: 1px solid transparent;
		border-radius: 0 var(--v-radius) var(--v-radius) 0;
		box-shadow: var(--v-shadow);
		z-index: 20;
	}
	.v-sidebar-desktop {
		display: flex;
		flex-direction: column;
		gap: calc(var(--v-space) * 2);
		padding: calc(var(--v-space) * 1.25);
		width: calc(var(--v-control-h) + var(--v-space) * 3);
		min-height: 0;
		max-height: inherit;
		height: 100%;
		overflow-y: auto;
		scrollbar-width: none;
		-ms-overflow-style: none;
	}
	.v-sidebar-desktop::-webkit-scrollbar {
		display: none;
	}
	.v-brand {
		margin: calc(var(--v-space) * -1.25) calc(var(--v-space) * -1.25) 0;
		padding: calc(var(--v-space) * 1.25) calc(var(--v-space) * 1.25) calc(var(--v-space) * 1.5);
		border-radius: 0 var(--v-radius) 0 0;
		background: var(--v-brand-bg, transparent);
		border-bottom: 1px solid var(--v-border);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--v-fg);
	}
	.v-nav {
		border-radius: calc(var(--v-radius-sm) + 4px);
		padding: 4px;
		margin-inline: -4px;
		display: flex;
		flex-direction: column;
		gap: calc(var(--v-space) / 2);
	}
	/* Bottom nav section: pushes to the bottom of the sidebar and uses the
     same compact nav-item styling as the main navigation. */
	.v-nav-bot {
		margin-top: auto;
		display: flex;
		flex-direction: column;
		gap: calc(var(--v-space) / 2);
		padding-top: calc(var(--v-space) * 1.25);
		border-top: 1px solid var(--v-border);
	}
	.v-nav-item {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--v-space);
		min-height: 44px;
		padding: calc(var(--v-space) * 0.6);
		border: none;
		border-radius: var(--v-radius-sm);
		background: transparent;
		color: var(--v-fg);
		text-decoration: none;
		font: inherit;
		font-weight: 500;
		cursor: pointer;
		width: 100%;
		position: relative;
	}
	.v-nav-item:hover {
		background: color-mix(in srgb, var(--v-primary) 10%, transparent);
	}
	.v-nav-item.active {
		background: var(--v-nav-selected, color-mix(in srgb, var(--v-primary) 12%, transparent));
		color: var(--v-primary-text, var(--v-primary));
	}
	.v-nav-item:focus-visible {
		outline: 2px solid var(--v-ring);
		outline-offset: 2px;
	}
	.v-nav-item :global(svg) {
		width: 1.2em;
		height: 1.2em;
		flex: 0 0 auto;
	}
	.v-nav-avatar {
		width: 24px;
		height: 24px;
		flex: 0 0 auto;
		border-radius: 999px;
		object-fit: cover;
	}
	.v-nav-label {
		display: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.v-sidebar {
			transition: none;
		}
	}
	@media (max-width: 760px) {
		.v-sidebar {
			width: auto;
			position: relative;
			top: auto;
			transform: none;
			align-self: stretch;
			height: auto;
			margin: 0;
			border: 0;
			border-radius: var(--v-radius-sm);
			box-shadow: none;
			z-index: auto;
			background: transparent;
			backdrop-filter: none;
			-webkit-backdrop-filter: none;
		}
		.v-sidebar-desktop {
			display: none;
		}
		.v-mobile-nav {
			display: grid;
			gap: calc(var(--v-space) / 2);
		}
		.v-mobile-nav-item {
			display: flex;
			align-items: center;
			gap: var(--v-space);
			width: 100%;
			min-height: 48px;
			padding: calc(var(--v-space) * 1.1);
			border: none;
			border-radius: var(--v-radius-sm);
			background: transparent;
			color: var(--v-fg);
			font: inherit;
			font-weight: 600;
			text-align: left;
			justify-content: flex-start;
			cursor: pointer;
			position: relative;
		}
		.v-mobile-nav-item.active {
			background: var(--v-nav-selected);
			color: var(--v-primary-text, var(--v-primary));
		}
		.v-mobile-nav-item:hover {
			background: color-mix(in srgb, var(--v-primary) 10%, transparent);
		}
	}
	:global(.v-account-menu) {
		z-index: 120;
		min-width: 170px;
		padding: 4px;
		border: 1px solid var(--v-border);
		border-radius: 8px;
		background: color-mix(in srgb, var(--v-surface) 92%, transparent);
		backdrop-filter: blur(20px);
		color: var(--v-fg);
	}
	:global(.v-account-menu-item) {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 9px 12px;
		border-radius: 5px;
		font-size: 0.85rem;
		cursor: pointer;
		outline: none;
	}
	:global(.v-account-menu-item[data-highlighted]) {
		background: color-mix(in srgb, var(--v-fg) 7%, transparent);
	}
</style>
