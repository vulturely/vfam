<script lang="ts">
	import { untrack } from "svelte";
	import { toastService } from "../../services/toast.svelte";

	let { message }: { message: string | null | undefined } = $props();

	$effect(() => {
		const currentMessage = message;
		if (currentMessage) untrack(() => toastService.error(currentMessage));
	});
</script>
