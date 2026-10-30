<script lang="ts">
	let {
		yaml = $bindable(""),
		appliedYaml = $bindable<string>(),
	}: {
		yaml: string;
		appliedYaml?: string;
	} = $props();
</script>

<input aria-label="Parser YAML" bind:value={yaml} />
<button type="button" onclick={() => (appliedYaml = yaml)}>Apply parser</button>
<output>{appliedYaml}</output>
