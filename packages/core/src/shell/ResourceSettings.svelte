<script lang="ts">
	import { tick } from "svelte";
	import ArrowLeft from "lucide-svelte/icons/arrow-left";
	import ArrowRight from "lucide-svelte/icons/arrow-right";
	import Database from "lucide-svelte/icons/database";
	import Sparkles from "lucide-svelte/icons/sparkles";
	import SideForm from "../components/forms/SideForm.svelte";
	import UiSettings from "lucide-svelte/icons/settings";
	import UiSave from "lucide-svelte/icons/save";
	import { Button, ErrorToast } from "../components/index";
	import type { ResourceService, ResourceSettings, StorageConfig } from "../resources/service";
	import type { FamilyAiConfig, FamilyAiService, FamilyAiStatus } from "../family-ai/service";
	let {
		service,
		familyAi,
		embedded = false,
	}: { service: ResourceService; familyAi: FamilyAiService; embedded?: boolean } = $props();
	let editing = $state<"storage" | "ai" | null>(null);
	let step = $state(1);
	let editor = $state<globalThis.HTMLFormElement>();
	function closeEditor() {
		editing = null;
		storage.access_key_id = "";
		storage.secret_access_key = "";
		ai.apiKey = "";
		if (settings) apply(settings);
		if (aiStatus) applyAi(aiStatus);
		error = "";
		notice = "";
	}
	async function openEditor(section: "storage" | "ai") {
		if (editing) closeEditor();
		editing = section;
		step = 1;
		if (section === "ai" && aiError) error = aiError;
		if (!settings) void run("load");
		await tick();
		editor?.closest<globalThis.HTMLElement>('[role="dialog"], [role="region"]')?.focus();
	}
	function next() {
		const fields = editor?.querySelectorAll<
			globalThis.HTMLInputElement | globalThis.HTMLSelectElement
		>("[data-stage='1'] input, [data-stage='1'] select");
		if (fields && [...fields].every((field) => field.reportValidity())) step = 2;
	}
	let settings = $state<ResourceSettings | null>(null);
	let busy = $state(false),
		error = $state(""),
		notice = $state("");
	let storageMode = $state("own"),
		aiMode = $state("own");
	let storage = $state<StorageConfig>({
		endpoint: "",
		bucket: "",
		region: "auto",
		access_key_id: "",
		secret_access_key: "",
	});
	// Family AI settings live in this device's OS key store, never on the server.
	let aiStatus = $state<FamilyAiStatus | null>(null);
	let aiError = $state("");
	const emptyAi = (): FamilyAiConfig => ({
		provider: "openai",
		model: "",
		endpoint: "",
		apiKey: "",
	});
	let ai = $state<FamilyAiConfig>(emptyAi());
	const dirty = $derived.by(() => {
		if (!settings || !editing) return false;
		if (editing === "storage") {
			if (storageMode === "platform") return settings.storage !== null;
			const saved = settings.storage;
			return (
				!saved ||
				storage.endpoint !== saved.endpoint ||
				storage.bucket !== saved.bucket ||
				storage.region !== saved.region ||
				!!storage.access_key_id ||
				!!storage.secret_access_key
			);
		}
		if (!aiStatus) return false;
		if (aiMode === "platform") return aiStatus.configured;
		return (
			!aiStatus.configured ||
			ai.provider !== aiStatus.provider ||
			ai.model !== aiStatus.model ||
			(ai.provider === "openai_compatible" ? ai.endpoint : "") !== (aiStatus.endpoint ?? "") ||
			!!ai.apiKey
		);
	});
	function apply(value: ResourceSettings) {
		settings = value;
		storageMode = value.storage ? "own" : "platform";
		storage = {
			...(value.storage ?? {
				endpoint: "",
				bucket: "",
				region: "auto",
				access_key_id: "",
				secret_access_key: "",
			}),
		};
	}
	function applyAi(status: FamilyAiStatus) {
		aiStatus = status;
		aiMode = status.configured ? "own" : "platform";
		ai = status.configured
			? {
					provider: status.provider ?? "openai",
					model: status.model ?? "",
					endpoint: status.endpoint ?? "",
					apiKey: "",
				}
			: emptyAi();
	}
	async function run(action: "load" | "storage" | "ai") {
		if (busy) return;
		busy = true;
		error = "";
		notice = "";
		try {
			if (action === "load") {
				// Storage must stay usable even when this device's AI settings are unavailable.
				const [result, status] = await Promise.all([
					service.get(),
					familyAi
						.status()
						.catch((cause: unknown) =>
							cause instanceof Error ? cause : new Error("Family AI settings are unavailable."),
						),
				]);
				apply(result);
				aiError = status instanceof Error ? status.message : "";
				applyAi(status instanceof Error ? { configured: false } : status);
				if (editing === "ai") error = aiError;
			} else if (action === "storage") {
				// Clear submitted secrets immediately and refresh only the saved section.
				const result = await service.saveStorage(storageMode === "own" ? { ...storage } : null);
				settings = result;
				storage = {
					...(result.storage ?? {
						endpoint: "",
						bucket: "",
						region: "auto",
						access_key_id: "",
						secret_access_key: "",
					}),
				};
				storageMode = result.storage ? "own" : "platform";
				notice = "Settings saved. Credentials are stored encrypted.";
			} else {
				applyAi(
					aiMode === "own"
						? await familyAi.save({
								...ai,
								endpoint: ai.provider === "openai_compatible" ? ai.endpoint : "",
							})
						: await familyAi.clear(),
				);
				notice = "Saved on this device. Your API key stays in this device's secure key store.";
			}
		} catch (e) {
			error = e instanceof Error ? e.message : "Resource settings unavailable.";
		} finally {
			storage.access_key_id = "";
			storage.secret_access_key = "";
			ai.apiKey = "";
			busy = false;
		}
	}
</script>

<section class="resource-accordions" aria-label="Storage and AI settings">
	{#each [{ id: "storage", label: "Storage", icon: Database, help: "Keep your family’s files and learning materials together, using your own storage or the platform’s storage." }, { id: "ai", label: "AI", icon: Sparkles, help: "Choose the AI that supports your children’s learning, using your own provider or the platform’s AI." }] as item (item.id)}
		<div class="resource-row">
			<item.icon size={18} aria-hidden="true" />
			<div class="resource-copy">
				<strong>{item.label}</strong>
				<p class="resource-help">{item.help}</p>
			</div>
			<button
				class="resource-gear"
				type="button"
				aria-label={`Configure ${item.label}`}
				title={`Configure ${item.label}`}
				onclick={(event) => {
					event.currentTarget.focus();
					openEditor(item.id as "storage" | "ai");
				}}><UiSettings size={18} aria-hidden="true" /></button
			>
		</div>
	{/each}
	{#if settings}<p role="status">
			Platform services: {settings.platform_paid ? "Available" : "Not available for this family"}
		</p>{/if}
</section>

{#if editing}
	<SideForm
		{embedded}
		title={editing === "storage" ? "Storage settings" : "AI settings"}
		subtitle={`Step ${step} of 2 · ${step === 1 ? "Service" : "Configuration"}`}
		onclose={closeEditor}
	>
		{#snippet navigation()}
			{#if settings}
				{#if step === 1}<Button icon={ArrowRight} disabled={busy} onclick={next}>Next</Button
					>{:else}<Button
						icon={ArrowLeft}
						variant="ghost"
						disabled={busy}
						onclick={() => (step = 1)}>Back</Button
					>{/if}
			{/if}
		{/snippet}
		{#snippet actions()}
			{#if step === 2 && dirty}<Button
					icon={UiSave}
					type="submit"
					form={`resource-${editing}`}
					disabled={busy ||
						!settings ||
						step !== 2 ||
						((editing === "storage" ? storageMode === "platform" : aiMode === "platform") &&
							!settings.platform_paid)}
					>{editing === "storage" ? "Save storage" : "Save AI provider"}</Button
				>{/if}
		{/snippet}
		<nav class="stages" aria-label="Configuration stages">
			<span aria-current={step === 1 ? "step" : undefined}>1. Service</span><span
				aria-current={step === 2 ? "step" : undefined}>2. Configuration</span
			>
		</nav>
		{#if !settings}<p role="status">
				{busy ? "Loading settings…" : "Could not load settings."}
			</p>
			{#if !busy}<Button icon={UiSettings} onclick={() => void run("load")}>Retry</Button>{/if}{/if}
		{#if settings}
			{#if editing === "storage"}
				<form
					bind:this={editor}
					id={`resource-${editing}`}
					onsubmit={(event) => {
						event.preventDefault();
						if (step === 1) next();
						else void run("storage");
					}}
				>
					<div data-stage="1" hidden={step !== 1}>
						<label
							>Storage service<select bind:value={storageMode} disabled={busy}
								><option value="own">Family-owned S3 storage</option><option
									value="platform"
									disabled={!settings.platform_paid}>Platform storage</option
								></select
							></label
						>
					</div>
					<div data-stage="2" hidden={step !== 2}>
						{#if storageMode === "own"}
							<p>
								Works with Cloudflare R2, AWS S3 and approved S3-compatible hosts. Files are
								encrypted before upload. Existing files keep their original storage location.
							</p>
							{#if settings.storage_secret_set}<p>
									Credentials saved. Re-enter both keys to replace the configuration.
								</p>{/if}
							<label
								>HTTPS storage endpoint<input
									type="url"
									bind:value={storage.endpoint}
									required
									disabled={busy}
									placeholder="https://ACCOUNT.r2.cloudflarestorage.com"
								/></label
							>
							<label
								>Bucket<input
									bind:value={storage.bucket}
									placeholder="e.g. family-files"
									required
									disabled={busy}
								/></label
							>
							<label
								>Region<input
									bind:value={storage.region}
									placeholder="e.g. auto or us-east-1"
									required
									disabled={busy}
								/></label
							>
							<label
								>Access key ID<input
									type="password"
									autocomplete="off"
									bind:value={storage.access_key_id}
									placeholder="Enter your storage access key ID"
									required
									disabled={busy}
								/></label
							>
							<label
								>Secret access key<input
									type="password"
									autocomplete="new-password"
									bind:value={storage.secret_access_key}
									placeholder="Enter your storage secret key"
									required
									disabled={busy}
								/></label
							>
						{/if}
					</div>
				</form>
			{:else}
				<form
					bind:this={editor}
					id={`resource-${editing}`}
					onsubmit={(event) => {
						event.preventDefault();
						if (step === 1) next();
						else void run("ai");
					}}
				>
					<div data-stage="1" hidden={step !== 1}>
						<label
							>AI service<select bind:value={aiMode} disabled={busy}
								><option value="own">Family-owned AI provider</option><option
									value="platform"
									disabled={!settings.platform_paid}>Platform AI</option
								></select
							></label
						>
					</div>
					<div data-stage="2" hidden={step !== 2}>
						{#if aiMode === "own"}
							<p>
								AI runs on this device with your own provider. It receives approved worksheet text
								only after generation consent and charges your account, so set a spending limit with
								your provider. Your API key never leaves this device.
							</p>
							{#if aiStatus?.configured}<p>
									API key saved. Re-enter it to replace the configuration.
								</p>{/if}
							<label
								>Provider<select bind:value={ai.provider} disabled={busy}
									><option value="openai">OpenAI</option><option value="claude"
										>Anthropic Claude</option
									><option value="openai_compatible">OpenAI-compatible</option><option value="grok"
										>xAI Grok</option
									><option value="gemini">Google Gemini</option></select
								></label
							>
							<label
								>Model ID<input
									bind:value={ai.model}
									placeholder="Enter your provider’s model ID"
									required
									disabled={busy}
								/></label
							>
							{#if ai.provider === "openai_compatible"}<label
									>Provider URL (HTTPS, or http://localhost for a model on this device)<input
										type="url"
										bind:value={ai.endpoint}
										required
										disabled={busy}
										placeholder="https://provider.example/v1/chat/completions"
									/></label
								>{/if}
							<label
								>API key<input
									type="password"
									autocomplete="new-password"
									bind:value={ai.apiKey}
									placeholder="Enter your provider API key"
									required={ai.provider !== "openai_compatible"}
									disabled={busy}
								/></label
							>
						{/if}
					</div>
				</form>
			{/if}
		{/if}
		<ErrorToast message={error} />
		{#if notice}<p role="status">{notice}</p>{/if}
	</SideForm>
{/if}

<style>
	.resource-accordions {
		gap: 12px;
	}
	.resource-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 16px;
		min-height: 56px;
	}
	.resource-copy {
		flex: 1;
		min-width: 0;
	}
	.resource-help {
		margin-top: 4px;
		font-size: 0.72rem;
		font-weight: 300;
		line-height: 1.5;
		color: color-mix(in srgb, var(--v-muted) 85%, transparent);
	}
	.resource-gear {
		margin-left: auto;
	}
	.resource-gear {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 44px;
		padding: 8px;
		border: 0;
		border-radius: var(--v-radius-sm);
		background: transparent;
		color: var(--v-primary-text, var(--v-primary));
		font: inherit;
		cursor: pointer;
	}
	.resource-gear:hover {
		background: color-mix(in srgb, var(--v-primary) 12%, transparent);
	}
	.resource-gear:focus-visible {
		outline: 2px solid var(--v-ring);
	}
	.stages {
		display: flex;
		gap: 16px;
		font-size: 0.8rem;
		color: var(--v-muted);
	}
	.stages [aria-current] {
		color: var(--v-primary-text, var(--v-primary));
		font-weight: 700;
	}
	[data-stage] {
		display: grid;
		gap: 20px;
	}
	[hidden] {
		display: none;
	}
	p {
		margin: 0;
		line-height: 1.5;
	}

	p {
		font-size: max(13px, 0.85rem);
		line-height: 1.65;
		color: var(--v-muted);
	}

	section,
	form {
		display: grid;
		gap: 20px;
	}
	form {
		padding: 0;
	}
	label {
		display: grid;
		gap: 8px;
		font-size: max(14px, 0.9rem);
		font-weight: 500;
		color: var(--v-muted);
	}
	input,
	select {
		padding: 0.65rem;
		color: var(--v-fg);
		background: var(--v-surface);
		border: 1px solid var(--v-border);
		border-radius: 0.4rem;
		max-width: 100%;
	}
</style>
