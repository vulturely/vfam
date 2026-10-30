<script lang="ts">
	import { setContext, untrack } from "svelte";
	import type { ExtractionService } from "../extraction/service";
	import type { SourceVersion } from "../api/protocol";
	import ExtractionReview from "./ExtractionReview.svelte";
	let {
		service,
		source,
		onconfirmed,
	}: {
		service: ExtractionService;
		source: SourceVersion;
		onconfirmed: () => Promise<void>;
	} = $props();
	setContext("vulture:runtime", {
		services: { extraction: untrack(() => service) },
	});
</script>

<ExtractionReview {source} {onconfirmed} />
