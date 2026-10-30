<script lang="ts">
	import { setContext } from "svelte";
	import type { Runtime } from "../runtime/registry.svelte";
	import FamilyOnboarding from "./FamilyOnboarding.svelte";
	let { runtime }: { runtime: Runtime } = $props();
	// Context is intentionally set once when the test provider mounts.
	// svelte-ignore state_referenced_locally
	setContext("vulture:runtime", runtime);
</script>

<FamilyOnboarding />
