<script lang="ts">
	import { onMount } from "svelte";
	import { createAppRuntime, ErrorToast, ToastStack } from "@vulture/core";
	import { appConfig } from "$lib/app.config";

	const runtime = createAppRuntime(appConfig);

	let error = $state("");

	onMount(async () => {
		try {
			const url = new URL(window.location.href);
			const state = url.searchParams.get("state") ?? "";
			const desktop = /^vulture-desktop:(\d+):([0-9a-f-]{36}):/.exec(state);
			if (desktop) {
				const callback = new URL(`http://127.0.0.1:${desktop[1]}/login/callback`);
				for (const key of ["code", "state", "error", "error_description"]) {
					const value = url.searchParams.get(key);
					if (value) callback.searchParams.set(key, value);
				}
				window.location.replace(callback.href);
				return;
			}
			// Exchange the nonce-bound fresh login for a revocable Vulture session.
			const unlockingChild = (await runtime.services.auth.getChildAccessToken()) !== null;
			await runtime.services.auth.handleCallback();
			window.location.replace(unlockingChild ? "/#/home:parent" : "/#/profile:choose");
		} catch (caught) {
			error = caught instanceof Error ? caught.message : "Sign-in failed.";
		}
	});
</script>

<svelte:head>
	<title>Signing in…</title>
</svelte:head>

<main class="v-callback">
	{#if error}
		<ErrorToast message={error} />
		<button type="button" onclick={() => window.location.assign("/")}> Back to sign in </button>
	{:else}
		<p>Signing you in…</p>
	{/if}
</main>
<ToastStack />

<style>
	.v-callback {
		min-height: 100vh;
		min-height: 100dvh;
		display: grid;
		place-items: center;
		background: var(--v-bg);
		color: var(--v-fg);
	}
</style>
