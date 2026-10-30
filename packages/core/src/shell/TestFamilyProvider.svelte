<script lang="ts">
	import { setContext, untrack } from "svelte";
	import type { Runtime } from "../runtime/registry.svelte";
	import FamilyScreen from "./FamilyScreen.svelte";

	let { runtime }: { runtime: Runtime } = $props();

	// setContext must run synchronously during component init.
	setContext<Runtime>(
		"vulture:runtime",
		untrack(() => runtime),
	);
</script>

<FamilyScreen />
