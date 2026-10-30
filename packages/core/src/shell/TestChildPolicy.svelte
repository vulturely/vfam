<script lang="ts">
	import ChildPolicy from "./ChildPolicy.svelte";
	import type { TimetableService } from "../timetable/service";
	let { service }: { service: TimetableService } = $props();
</script>

<ChildPolicy {service}><h2>Restricted learning content</h2></ChildPolicy>
