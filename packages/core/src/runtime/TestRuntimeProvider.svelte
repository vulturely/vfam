<script lang="ts">
	import { createAppRuntime, type Runtime } from "./registry.svelte";
	import { untrack } from "svelte";
	import type { AppConfig } from "./defineApp";

	let { config, onruntime }: { config: AppConfig; onruntime: (runtime: Runtime) => void } =
		$props();
	untrack(() => {
		const runtime = createAppRuntime(config);
		onruntime(runtime);
	});
</script>
