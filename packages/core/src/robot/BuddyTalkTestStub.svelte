<script lang="ts">
	import { cameraStart, cameraEnd } from "./BuddyTalkTestMocks";
	export async function start() {
		return await cameraStart();
	}
	export async function end() {
		await cameraEnd();
	}
</script>

<p>Live camera</p>
