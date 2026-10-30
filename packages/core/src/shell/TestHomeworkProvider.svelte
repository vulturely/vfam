<script lang="ts">
	import { setContext, untrack } from "svelte";
	import type { HomeworkService } from "../homework/service";
	import type { PracticeService } from "../practice/service";
	import HomeworkWorkspace from "./HomeworkWorkspace.svelte";
	let {
		service,
		practice,
		view = "all",
	}: {
		service: Partial<HomeworkService>;
		practice?: Partial<PracticeService>;
		view?: "all" | "homework" | "history";
	} = $props();
	setContext(
		"vulture:runtime",
		untrack(() => ({ services: { homework: service as HomeworkService, practice } })),
	);
</script>

<HomeworkWorkspace profileId="child" {view} />
