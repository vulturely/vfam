<script lang="ts">
	import MobileNavigation from "./MobileNavigation.svelte";
</script>

<MobileNavigation>
	{#snippet children(close)}
		<button type="button" onclick={close}>Done</button>
	{/snippet}
</MobileNavigation>
