<script lang="ts">
	import Upload from "lucide-svelte/icons/upload";
	import FileCheck from "lucide-svelte/icons/file-check";
	import { ErrorToast } from "../components/index";
	let {
		files = $bindable(),
		label,
		accept,
		hint,
		required = false,
	}: {
		files?: globalThis.FileList;
		label: string;
		accept: string;
		hint: string;
		required?: boolean;
	} = $props();
	let dragging = $state(false);
	let error = $state("");
	const file = $derived(files?.[0]);
	function drop(event: globalThis.DragEvent) {
		event.preventDefault();
		dragging = false;
		const dropped = event.dataTransfer?.files;
		if (!dropped?.length) return;
		if (dropped.length !== 1 || !accept.split(",").includes(dropped[0].type)) {
			error = "Choose one supported file.";
			return;
		}
		if (!dropped[0].size || dropped[0].size > 10 * 1024 * 1024) {
			error = "Choose a file between 1 byte and 10 MiB.";
			return;
		}
		error = "";
		files = dropped;
	}
</script>

<div class="file-field">
	<span class="field-label">{label}</span>
	<label
		class="dropzone"
		class:dragging
		class:selected={Boolean(file)}
		ondragover={(event) => {
			event.preventDefault();
			dragging = true;
		}}
		ondragleave={() => (dragging = false)}
		ondrop={drop}
	>
		<input
			type="file"
			aria-label={label}
			{accept}
			{required}
			bind:files
			onchange={() => (error = "")}
		/>
		<span class="upload-icon" aria-hidden="true">
			{#if file}<FileCheck size={24} strokeWidth={1.4} />{:else}<Upload
					size={24}
					strokeWidth={1.4}
				/>{/if}
		</span>
		<strong>{file ? file.name : "Choose a file or drop it here"}</strong>
		<span class="hint"
			>{file ? `${(file.size / 1024 / 1024).toFixed(2)} MiB · Click to change` : hint}</span
		>
	</label>
	<ErrorToast message={error} />
</div>

<style>
	.file-field {
		display: grid;
		gap: 6px;
		min-width: 0;
	}
	.field-label {
		font-size: 0.8rem;
		color: var(--v-muted);
	}
	.dropzone {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		min-height: 144px;
		padding: 20px;
		box-sizing: border-box;
		text-align: center;
		border: 1px dashed color-mix(in srgb, var(--v-fg) 18%, transparent);
		border-radius: 10px;
		background: linear-gradient(
			135deg,
			color-mix(in srgb, var(--v-fg) 4%, transparent),
			color-mix(in srgb, var(--v-fg) 1%, transparent)
		);
		cursor: pointer;
		transition:
			background 160ms ease,
			border-color 160ms ease;
	}
	.dropzone:hover,
	.dropzone:focus-within,
	.dropzone.dragging {
		border-color: var(--v-primary);
		background: color-mix(in srgb, var(--v-primary) 7%, transparent);
	}
	.dropzone.selected {
		border-style: solid;
	}
	input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
	}
	.upload-icon {
		display: grid;
		place-items: center;
		color: var(--v-primary-text, var(--v-primary));
		pointer-events: none;
	}
	strong {
		max-width: 100%;
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--v-fg);
		overflow-wrap: anywhere;
		pointer-events: none;
	}
	.hint {
		font-size: 0.7rem;
		font-weight: 300;
		color: var(--v-muted);
		line-height: 1.5;
		pointer-events: none;
	}
	@media (prefers-reduced-motion: reduce) {
		.dropzone {
			transition: none;
		}
	}
</style>
