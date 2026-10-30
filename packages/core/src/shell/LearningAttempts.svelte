<script lang="ts">
	import type { ChildLearningService } from "../child-learning/service";
	import HomeworkHistory from "./HomeworkHistory.svelte";
	let { service, profileId }: { service: ChildLearningService; profileId: string } = $props();
</script>

<HomeworkHistory {service} {profileId} mode="attempts" />
