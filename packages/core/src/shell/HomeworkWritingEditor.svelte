<script lang="ts">
	let {
		title = $bindable(""),
		subject = $bindable(""),
		text = $bindable(""),
	}: { title?: string; subject?: string; text?: string } = $props();
</script>

<div class="writing-editor">
	<div class="document-header">
		<input
			class="document-title"
			aria-label="Homework title"
			placeholder="Untitled homework"
			maxlength="160"
			required
			bind:value={title}
		/>
		<input
			class="document-subject"
			aria-label="Homework subject"
			placeholder="Subject"
			maxlength="80"
			required
			bind:value={subject}
		/>
	</div>
	<label class="instructions"
		>Instructions <span>optional</span><textarea
			aria-label="Homework instructions"
			rows="4"
			maxlength="45000"
			placeholder="e.g. Read page 4 first, then answer the questions."
			bind:value={text}></textarea></label
	>
</div>

<style>
	.writing-editor {
		display: grid;
		min-width: 0;
	}
	.document-header {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 12px 20px;
		border-bottom: 1px solid var(--v-border);
	}
	.document-header input {
		min-width: 0;
		border: 0;
		outline: none;
		background: transparent;
		color: var(--v-fg);
		font: inherit;
		border-radius: 0;
		padding: 4px 0;
	}
	.document-header input::placeholder {
		color: var(--v-muted);
		font-weight: 300;
	}
	.document-title {
		flex: 1;
		font-size: 1.1rem !important;
		font-weight: 500 !important;
	}
	.document-subject {
		width: 160px;
		text-align: right;
		font-size: 0.8rem !important;
		color: var(--v-muted) !important;
	}
	.instructions {
		display: grid;
		gap: 0.35rem;
		padding: 16px 20px 0;
		font-size: 0.85rem;
	}
	.instructions span {
		color: var(--v-muted);
		font-size: 0.78rem;
	}
	textarea {
		box-sizing: border-box;
		width: 100%;
		min-width: 0;
		padding: 0.6rem 0.7rem;
		border: 1px solid var(--v-border);
		border-radius: 8px;
		background: transparent;
		color: var(--v-fg);
		font: inherit;
		font-size: 0.95rem;
		line-height: 1.5;
		resize: vertical;
	}
	@media (max-width: 600px) {
		.document-header {
			flex-direction: column;
			align-items: stretch;
			gap: 4px;
			padding: 10px 12px;
		}
		.document-subject {
			width: 100%;
			text-align: left;
		}
		.instructions {
			padding: 12px 12px 0;
		}
	}
</style>
