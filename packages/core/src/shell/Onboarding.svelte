<script lang="ts">
	import MobileNavigation from "../components/navigation/MobileNavigation.svelte";
	import House from "lucide-svelte/icons/house";
	import Info from "lucide-svelte/icons/info";
	import Mail from "lucide-svelte/icons/mail";
	import Shield from "lucide-svelte/icons/shield";
	import FileText from "lucide-svelte/icons/file-text";
	import ArrowLeft from "lucide-svelte/icons/arrow-left";
	import ArrowRight from "lucide-svelte/icons/arrow-right";
	import LogIn from "lucide-svelte/icons/log-in";
	import Moon from "lucide-svelte/icons/moon";
	import Sun from "lucide-svelte/icons/sun";
	import type { Runtime } from "../runtime/registry.svelte";
	import { Card, ErrorToast, IconButton } from "../components/index";
	import AppIcon from "../components/display/AppIcon.svelte";
	import InfoPage from "./InfoPage.svelte";

	let { runtime }: { runtime: Runtime } = $props();

	let error = $state("");

	const ThemeIcon = $derived(runtime.theme.mode === "light" ? Sun : Moon);

	const infoTitles: Record<string, string> = {
		about: "About Vulture",
		contact: "Contact",
		privacy: "Privacy Policy",
		terms: "Terms and Conditions",
	};
	const infoScreens = Object.keys(infoTitles);
	const currentScreen = $derived(runtime.router.current.screen);
	const isInfoPage = $derived(infoScreens.includes(currentScreen));

	async function signIn() {
		error = "";
		try {
			await runtime.services.auth.signIn();
			if (runtime.services.auth.isNative()) await runtime.restoreSession();
		} catch (caught) {
			error = caught instanceof Error ? caught.message : "Could not start sign-in.";
		}
	}
</script>

<main class="v-landing" class:terms-page={currentScreen === "terms"} class:login-page={!isInfoPage}>
	{#if isInfoPage}
		<aside class="v-landing-sidebar" aria-label="Landing navigation">
			<div
				class="v-brand-lockup"
				aria-label={`${runtime.config.name} home`}
				title={`${runtime.config.name} home`}
				role="button"
				tabindex="0"
				onclick={() => runtime.router.navigate("")}
				onkeydown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						runtime.router.navigate("");
					}
				}}
			>
				<span class="v-brand-icon"><AppIcon size={36} /></span>
			</div>
			<div class="v-actions">
				{#if isInfoPage}
					<IconButton label="Back" icon={ArrowLeft} onclick={() => runtime.router.navigate("")} />
				{/if}
				<IconButton label="Login" icon={LogIn} onclick={() => void signIn()} />
				<IconButton
					label={`Switch to ${runtime.theme.mode === "light" ? "dark" : "light"} theme`}
					icon={ThemeIcon}
					onclick={() => runtime.theme.toggle()}
				/>
			</div>
		</aside>

		<MobileNavigation>
			{#snippet children(close)}
				<nav class="v-landing-mobile-nav" aria-label="Landing navigation">
					{#each [{ id: "", label: "Home", icon: House }, { id: "about", label: "About", icon: Info }, { id: "contact", label: "Contact", icon: Mail }, { id: "privacy", label: "Privacy", icon: Shield }, { id: "terms", label: "Terms", icon: FileText }] as item (item.id)}
						<button
							type="button"
							onclick={() => {
								runtime.router.navigate(item.id);
								close();
							}}
						>
							<item.icon aria-hidden="true" size={20} /><span>{item.label}</span>
						</button>
					{/each}
					<button
						type="button"
						onclick={() => {
							close();
							void signIn();
						}}><LogIn aria-hidden="true" size={20} /><span>Login</span></button
					>
					<button type="button" onclick={() => runtime.theme.toggle()}
						><ThemeIcon aria-hidden="true" size={20} /><span
							>{runtime.theme.mode === "light" ? "Dark mode" : "Light mode"}</span
						></button
					>
				</nav>
			{/snippet}
		</MobileNavigation>
	{/if}
	<div class="v-landing-content">
		<!-- Landing content -->
		{#if isInfoPage}
			<header class="v-info-topbar">
				<IconButton
					label="Back to home"
					icon={ArrowLeft}
					onclick={() => runtime.router.navigate("")}
				/>
				<h1>{infoTitles[currentScreen]}</h1>
			</header>
			<section class="v-info-wrap">
				<InfoPage screen={currentScreen} />
			</section>
		{:else}
			<section class="v-hero" aria-labelledby="landing-title">
				<Card>
					<div class="v-login-logo"><AppIcon size={72} /></div>
					<div class="v-login-body">
						<h1 class="v-eyebrow" id="landing-title">Welcome to {runtime.config.name}</h1>
						<button type="button" class="v-login-button" onclick={() => void signIn()}>
							<LogIn aria-hidden="true" size={18} strokeWidth={2.2} />
							<span>Login</span>
							<ArrowRight aria-hidden="true" size={17} strokeWidth={2.2} />
						</button>
					</div>
				</Card>
			</section>
		{/if}

		<ErrorToast message={error} />

		{#if isInfoPage}
			<footer class="v-footer">
				<a href="#/about">About</a>
				<a href="#/contact">Contact</a>
				<a href="#/privacy">Privacy</a>
				<a href="#/terms">Terms and Condition</a>
			</footer>
		{/if}
	</div>
</main>

<style>
	.v-brand-icon {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border-radius: var(--v-radius-sm);
	}

	.v-landing {
		min-height: 100vh;
		min-height: 100dvh;
		display: grid;
		grid-template-columns:
			calc(max(var(--v-control-h), 44px) + var(--v-space) * 5)
			minmax(0, 1fr);
		background: var(--v-bg);
		background-image: var(--v-bg-gradient, none);
		background-attachment: fixed;
		color: var(--v-fg);
	}
	.login-page {
		grid-template-columns: minmax(0, 1fr);
	}
	.login-page .v-landing-content {
		grid-column: 1;
		padding-bottom: 0;
	}
	.v-landing-sidebar {
		position: fixed;
		left: 0;
		top: 50dvh;
		transform: translateY(-50%);
		width: calc(var(--v-control-h) + var(--v-space) * 3 + 2px);
		overflow-y: auto;
		align-self: start;
		height: calc(
			100dvh - var(--v-space) * 4 - env(safe-area-inset-top) - env(safe-area-inset-bottom)
		);
		max-height: calc(
			100dvh - var(--v-space) * 4 - env(safe-area-inset-top) - env(safe-area-inset-bottom)
		);
		margin: 0;
		border: 1px solid var(--v-border);
		border-radius: 0 var(--v-radius) var(--v-radius) 0;
		box-shadow: var(--v-shadow);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: calc(var(--v-space) * 2);
		padding: calc(env(safe-area-inset-top) + var(--v-space) * 1.25) var(--v-space)
			calc(env(safe-area-inset-bottom) + var(--v-space) * 1.25);
		background: var(--v-nav-surface, var(--v-surface));
		backdrop-filter: blur(18px);
		z-index: 10;
	}
	.v-brand-lockup {
		width: calc(100% + var(--v-space) * 2);
		margin: calc(-1 * (env(safe-area-inset-top) + var(--v-space) * 1.25)) calc(var(--v-space) * -1)
			0;
		padding: calc(env(safe-area-inset-top) + var(--v-space) * 1.25) var(--v-space)
			calc(var(--v-space) * 1.5);
		background: var(--v-brand-bg, transparent);
		border-bottom: 1px solid var(--v-border);
		display: grid;
		place-items: center;
		min-height: 44px;
		cursor: pointer;
		border-radius: 0 var(--v-radius) 0 0;
	}
	.v-brand-lockup:focus-visible {
		outline: 2px solid var(--v-ring);
		outline-offset: 3px;
	}
	.v-actions {
		border-radius: calc(var(--v-radius-sm) + 4px);
		padding: 4px;
		margin-inline: -4px;
		margin-top: auto;
		display: flex;
		flex-direction: column;
		gap: var(--v-space);
	}
	.v-landing-sidebar :global(.v-icon-btn::after) {
		top: 50%;
		left: calc(100% + 8px);
		transform: translateY(-50%);
	}
	.terms-page {
		height: 100dvh;
		min-height: 0;
		overflow: hidden;
	}
	.terms-page .v-landing-content {
		min-height: 0;
		height: 100%;
	}
	.terms-page .v-info-wrap {
		min-height: 0;
		display: flex;
		align-items: center;
		padding-block: 24px;
		overflow: hidden;
	}
	.terms-page .v-footer,
	.terms-page .v-info-topbar {
		flex-shrink: 0;
	}
	.v-landing-content {
		grid-column: 2;
		min-width: 0;
		display: flex;
		flex-direction: column;
		padding-bottom: calc(var(--v-space) * 3 + env(safe-area-inset-bottom));
	}
	.v-hero {
		flex: 1;
		display: grid;
		place-items: center;
		padding: clamp(calc(var(--v-space) * 3), 6vw, calc(var(--v-space) * 8))
			clamp(calc(var(--v-space) * 2), 4vw, calc(var(--v-space) * 4));
	}
	.v-hero :global(.v-card) {
		width: min(100%, 28rem);
		padding: 0;
		overflow: hidden;
		text-align: center;
		border-radius: calc(var(--v-radius) + 6px);
		box-shadow: 0 24px 64px color-mix(in srgb, var(--v-fg) 10%, transparent);
	}
	.v-login-logo {
		display: grid;
		place-items: center;
		min-height: 150px;
		padding: calc(var(--v-space) * 3);
		border-bottom: 1px solid var(--v-border);
		background: linear-gradient(
			145deg,
			color-mix(in srgb, var(--v-primary) 16%, var(--v-surface)),
			color-mix(in srgb, var(--v-primary) 5%, var(--v-surface))
		);
	}
	.v-login-body {
		display: grid;
		justify-items: center;
		gap: calc(var(--v-space) * 1.5);
		padding: clamp(calc(var(--v-space) * 2), 5vw, calc(var(--v-space) * 3));
	}
	.v-info-topbar {
		display: none;
	}
	.v-info-wrap {
		flex: 1;
		display: grid;
		align-content: center;
		padding: clamp(calc(var(--v-space) * 3), 6vw, calc(var(--v-space) * 8))
			clamp(calc(var(--v-space) * 2), 4vw, calc(var(--v-space) * 4));
	}
	.v-eyebrow {
		margin: 0;
		color: var(--v-primary-text, var(--v-primary));
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 0.78rem;
	}
	h1 {
		margin: 0;
	}
	.v-login-button {
		display: grid;
		grid-template-columns: auto auto auto;
		align-items: center;
		gap: calc(var(--v-space) * 1.25);
		width: auto;
		min-width: 160px;
		min-height: 44px;
		margin: calc(var(--v-space) * 1.5) 0 calc(var(--v-space) * 0.5);
		padding: 0 calc(var(--v-space) * 2);
		border: 1px solid color-mix(in srgb, var(--v-primary) 80%, var(--v-border));
		border-radius: 14px;
		background: linear-gradient(
			135deg,
			var(--v-primary),
			color-mix(in srgb, var(--v-primary) 82%, var(--v-fg))
		);
		color: var(--v-primary-fg);
		box-shadow: 0 8px 24px color-mix(in srgb, var(--v-primary) 26%, transparent);
		font: inherit;
		font-weight: 750;
		cursor: pointer;
		transition:
			transform 160ms ease,
			filter 160ms ease,
			box-shadow 160ms ease;
	}
	.v-login-button:hover {
		transform: translateY(-2px);
		filter: brightness(1.06);
		box-shadow: 0 12px 28px color-mix(in srgb, var(--v-primary) 32%, transparent);
	}
	.v-login-button:active {
		transform: translateY(0);
	}
	.v-login-button:focus-visible {
		outline: 3px solid var(--v-ring);
		outline-offset: 3px;
	}
	.v-footer {
		display: flex;
		gap: calc(var(--v-space) * 2);
		flex-wrap: wrap;
		justify-content: center;
		padding: calc(var(--v-space) * 2) calc(var(--v-space) * 2) 0;
		border-top: 1px solid var(--v-border);
	}
	.v-footer a {
		color: var(--v-muted);
		text-decoration: none;
		font-size: 0.9rem;
	}
	.v-footer a:hover {
		color: var(--v-fg);
		text-decoration: underline;
	}

	@media (max-width: 860px) {
		.v-hero {
			grid-template-columns: minmax(0, 1fr);
			align-content: center;
		}
	}
	.v-landing-mobile-nav {
		display: grid;
		gap: var(--v-space);
	}
	.v-landing-mobile-nav button {
		display: flex;
		align-items: center;
		justify-content: flex-start;
		gap: var(--v-space);
		width: 100%;
		min-height: 44px;
		padding: var(--v-space);
		border: 0;
		border-radius: var(--v-radius-sm);
		background: transparent;
		color: var(--v-fg);
		cursor: pointer;
		text-align: left;
	}
	.v-landing-mobile-nav button:hover {
		background: color-mix(in srgb, var(--v-primary) 12%, transparent);
	}
	@media (max-width: 760px) {
		.v-info-topbar {
			position: sticky;
			top: 0;
			z-index: 5;
			display: flex;
			align-items: center;
			gap: var(--v-space);
			min-height: calc(56px + env(safe-area-inset-top));
			padding: calc(var(--v-space) + env(safe-area-inset-top)) calc(var(--v-space) * 2)
				var(--v-space);
			background: var(--v-glass, var(--v-surface));
			backdrop-filter: blur(18px);
		}
		.v-info-topbar h1 {
			max-width: none;
			font-size: clamp(1.1rem, 3vw, 1.4rem);
			line-height: 1.3;
			letter-spacing: -0.02em;
		}
		.v-info-wrap {
			padding-top: calc(var(--v-space) * 2);
		}

		.v-hero {
			gap: 24px;
			padding: calc(24px + env(safe-area-inset-top)) calc(16px + env(safe-area-inset-right)) 24px
				calc(16px + env(safe-area-inset-left));
		}
		.v-login-logo {
			min-height: 120px;
		}
		.v-footer {
			display: none;
		}
		.v-landing {
			grid-template-columns: minmax(0, 1fr);
		}
		.v-landing-sidebar {
			display: none;
		}
		.v-landing-content {
			grid-column: 1;
			padding-bottom: calc(80px + env(safe-area-inset-bottom));
		}
	}
	@media (max-width: 540px) {
		.v-footer {
			justify-content: flex-start;
		}
	}
</style>
