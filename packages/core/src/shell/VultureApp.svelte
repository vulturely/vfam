<script lang="ts">
	import UiRefreshCw from "lucide-svelte/icons/refresh-cw";
	import LoaderCircle from "lucide-svelte/icons/loader-circle";
	import { onMount, setContext } from "svelte";
	import type { AppConfig } from "../runtime/defineApp";
	import { createAppRuntime } from "../runtime/registry.svelte";
	import type { Runtime } from "../runtime/registry.svelte";
	import ThemeProvider from "../theme/ThemeProvider.svelte";
	import ErrorToast from "../components/feedback/ErrorToast.svelte";
	import ToastStack from "../components/feedback/ToastStack.svelte";
	import Shell from "./Shell.svelte";
	import Onboarding from "./Onboarding.svelte";
	import ChildMode from "./ChildMode.svelte";

	let { config }: { config: AppConfig } = $props();
	const runtime = $derived(createAppRuntime(config));

	// Provide the runtime to feature screens via context (screens are rendered
	// with only their screen id + params, so they read services from context).
	$effect(() => {
		setContext<Runtime>("vulture:runtime", runtime);
	});

	onMount(() => runtime.services.auth.watchSessionBoundary(() => window.location.reload()));

	// Restore a previously stored Swavan OIDC session on app load.
	$effect(() => {
		void runtime.restoreSession();
	});
</script>

<ThemeProvider profile={runtime.config.profile}>
	{#if runtime.state.restoring}
		<div class="session-loading" role="status" aria-label="Checking your session">
			<LoaderCircle size={32} aria-hidden="true" />
		</div>
	{:else if runtime.state.childSession}
		<ChildMode {runtime} />
	{:else if runtime.state.sessionError}
		<ErrorToast message={runtime.state.sessionError} />
		<button type="button" onclick={() => void runtime.restoreSession()}
			><UiRefreshCw aria-hidden="true" size={18} strokeWidth={1.8} /> Try again</button
		>
	{:else if runtime.hasIdentity}
		<Shell {runtime} />
	{:else}
		<Onboarding {runtime} />
	{/if}
	<ToastStack />
</ThemeProvider>

<style>
	.session-loading {
		display: grid;
		min-height: 100vh;
		min-height: 100dvh;
		place-items: center;
	}

	.session-loading :global(svg) {
		color: var(--v-primary);
		animation: session-loading-spin 900ms linear infinite;
	}

	@keyframes session-loading-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
