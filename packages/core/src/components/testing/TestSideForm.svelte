<script lang="ts">
	import SideForm from "../forms/SideForm.svelte";
	let first = $state(false);
	let second = $state(false);
	let replacement = $state(false);
	let replacementVersion = $state(0);
</script>

{#key replacementVersion}
	<button
		aria-label="Open replacement"
		onclick={(event) => {
			event.currentTarget.focus();
			replacement = true;
		}}>Open replacement</button
	>
{/key}
{#if replacement}
	<SideForm
		title="Replacement editor"
		onclose={() => {
			replacementVersion += 1;
			replacement = false;
		}}
	>
		<input aria-label="Replacement value" />
	</SideForm>
{/if}

<button
	onclick={(event) => {
		event.currentTarget.focus();
		first = true;
	}}>Open first</button
>
<button
	onclick={(event) => {
		event.currentTarget.focus();
		second = true;
	}}>Open second</button
>
{#if first}
	<SideForm title="First editor" onclose={() => (first = false)}>
		<input aria-label="First value" />
	</SideForm>
{/if}
{#if second}
	<SideForm title="Second editor" onclose={() => (second = false)}>
		<input aria-label="Second value" />
	</SideForm>
{/if}
