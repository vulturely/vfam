<script lang="ts">
	import { setContext, untrack } from "svelte";
	import type { Runtime } from "../runtime/registry.svelte";
	import LearningProfiles from "./LearningProfiles.svelte";
	let { runtime }: { runtime: Runtime } = $props();
	setContext<Runtime>(
		"vulture:runtime",
		untrack(() => runtime),
	);
</script>

<LearningProfiles />
