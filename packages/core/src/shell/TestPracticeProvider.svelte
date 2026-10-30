<script lang="ts">
	import { setContext, untrack } from "svelte";
	import type { PracticeService } from "../practice/service";
	import type { ExtractionService } from "../extraction/service";
	import { SourceVersion } from "../api/protocol";
	import PracticeWorkspace from "./PracticeWorkspace.svelte";
	let {
		practice,
		extraction,
		subject = "Maths",
	}: {
		practice: PracticeService;
		extraction: ExtractionService;
		subject?: string;
	} = $props();
	setContext(
		"vulture:runtime",
		untrack(() => ({ services: { practice, extraction } })),
	);
</script>

<PracticeWorkspace source={new SourceVersion({ id: "source", version: 2 })} {subject} />
