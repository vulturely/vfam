<script lang="ts">
	import type { Runtime } from "../runtime/registry.svelte";
	import Sidebar from "./Sidebar.svelte";
	import ScreenOutlet from "./ScreenOutlet.svelte";
	import type { Snippet } from "svelte";
	import type { ShellNav } from "./shellNav";

	// A child session passes its own navigation and content instead of the parent router.
	let { runtime, nav, children }: { runtime: Runtime; nav?: ShellNav; children?: Snippet } =
		$props();

	const screen = $derived(nav ? nav.current : runtime.router.current.screen);
	const isSetup = $derived(["family:setup", "profile:choose", "account:setup"].includes(screen));

	$effect(() => {
		if (!nav && !runtime.canAccessScreen(runtime.router.current.screen)) {
			runtime.router.navigate(runtime.homeScreenForCurrentRole());
		}
	});
</script>

<div
	class="v-shell"
	class:v-shell-setup={isSetup}
	class:v-shell-learning={screen === "learning:profiles"}
	class:v-shell-chat={["chat", "calls", "fambuddy"].includes(screen)}
>
	{#if !isSetup}<Sidebar {runtime} {nav} />{/if}
	<div class="v-main">
		<main
			class="v-content"
			class:v-content-setup={isSetup}
			class:v-content-learning={screen === "learning:profiles"}
			class:v-content-centered={[
				"profile:choose",
				"family:setup",
				"home:parent",
				"calls",
				"chat",
				"fambuddy",
				"child:home",
				"child:learning",
			].includes(screen)}
		>
			{#if nav}{@render children?.()}{:else}<ScreenOutlet
					screens={runtime.screens}
					current={runtime.router.current}
				/>{/if}
		</main>
	</div>
</div>

<style>
	.v-shell {
		display: flex;
		min-height: 100vh;
		min-height: 100dvh;
		background: transparent;
	}
	.v-main {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.v-content {
		flex: 1;
		overflow: auto;
		scrollbar-width: thin;
		scrollbar-color: var(--v-border) transparent;
		padding: clamp(calc(var(--v-space) * 1.5), 3vw, calc(var(--v-space) * 3));
		padding-bottom: calc(
			clamp(calc(var(--v-space) * 1.5), 3vw, calc(var(--v-space) * 3)) + env(safe-area-inset-bottom)
		);
	}
	.v-content::-webkit-scrollbar {
		width: 2px;
		height: 2px;
	}
	.v-content::-webkit-scrollbar-track {
		background: transparent;
	}
	.v-content::-webkit-scrollbar-thumb {
		border-radius: 999px;
		background: var(--v-border);
	}
	.v-shell-learning .v-main {
		height: 100dvh;
		min-height: 0;
	}
	.v-content-learning {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 0;
		padding: clamp(calc(var(--v-space) * 1.5), 3vw, calc(var(--v-space) * 3));
		overflow: hidden;
	}
	.v-content-centered {
		display: flex;
		flex-direction: column;
		justify-content: safe center;
	}
	.v-content-centered > :global(*) {
		flex-shrink: 0;
	}
	.v-shell-chat .v-main {
		height: 100dvh;
		min-height: 0;
	}
	.v-shell.v-shell-chat .v-content {
		min-height: 0;
		overflow: hidden;
		align-items: center;
		padding: clamp(calc(var(--v-space) * 1.5), 3vw, calc(var(--v-space) * 3));
	}
	@media (max-width: 760px) {
		.v-shell.v-shell-learning .v-content,
		.v-shell.v-shell-chat .v-content {
			padding: 0;
		}
	}
	@media (min-width: 761px) {
		.v-shell:not(.v-shell-setup) {
			padding-left: calc(var(--v-control-h) + var(--v-space) * 3 + 2px);
		}
	}
	@media (max-width: 760px) {
		.v-content:not(.v-content-setup) {
			padding-bottom: calc(
				max(var(--v-control-h), 44px) + var(--v-space) * 5 + env(safe-area-inset-bottom)
			);
		}
	}
</style>
