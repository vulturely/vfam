<script lang="ts">
	import { relationshipLabels, reciprocalRelationship } from "../family/relationships";
	import Sparkles from "lucide-svelte/icons/sparkles";
	import { ageBands, type LearningProfile } from "../learning/types";
	import { animateDetails } from "../components/animateDetails";
	import SideForm from "../components/forms/SideForm.svelte";
	import RefreshCw from "lucide-svelte/icons/refresh-cw";
	import UiCrop from "lucide-svelte/icons/crop";
	import UiMaximize from "lucide-svelte/icons/maximize";
	import UiSave from "lucide-svelte/icons/save";
	import UiX from "lucide-svelte/icons/x";
	import UiPencil from "lucide-svelte/icons/pencil";
	import UiUserPlus from "lucide-svelte/icons/user-plus";
	import { getContext, untrack } from "svelte";
	import type { Runtime } from "../runtime/registry.svelte";
	import type { AccountLookup, FamilyMemberRecord } from "../family/service";
	import Camera from "lucide-svelte/icons/camera";
	import Crop from "lucide-svelte/icons/crop";
	import ListTodo from "lucide-svelte/icons/list-todo";
	import Network from "lucide-svelte/icons/network";
	import Users from "lucide-svelte/icons/users";
	import Search from "lucide-svelte/icons/search";
	import Loader2 from "lucide-svelte/icons/loader-2";
	import ChevronDown from "lucide-svelte/icons/chevron-down";
	import { Badge, ErrorToast, IconButton, Input } from "../components/index";
	import { toastService } from "../services/toast.svelte";
	import ResourceSettings from "./ResourceSettings.svelte";
	import FamilyAiChildren from "./FamilyAiChildren.svelte";
	import FamilyAiRequests from "./FamilyAiRequests.svelte";
	import TaskWorkspace from "./TaskWorkspace.svelte";
	import { FAMILY_BANNER_WIDTH, FAMILY_BANNER_HEIGHT, bannerGeometry } from "./banner";

	const runtime = getContext<Runtime>("vulture:runtime");
	let { tab = "tasks", filter = "all" }: { tab?: string; filter?: string } = $props();

	let activeFamilyName = $state("");
	let members = $state<FamilyMemberRecord[]>([]);
	let familyStale = $state(false);
	const showingStale = $derived(familyStale || members.some((member) => member.stale));
	let memberAccounts = $state<Record<string, AccountLookup | null>>({});
	let relationshipMember = $state<FamilyMemberRecord>();
	let relationship = $state("");
	let reciprocal = $state("");
	let relationshipSaving = $state(false);
	let relationshipError = $state("");
	function editRelationship(member: FamilyMemberRecord) {
		relationshipMember = member;
		relationship = member.relationship ?? "";
		reciprocal = member.reciprocalRelationship ?? "";
		relationshipError = "";
	}
	async function saveRelationship() {
		if (!familyId || !relationshipMember || relationshipSaving) return;
		relationshipSaving = true;
		relationshipError = "";
		try {
			await runtime.services.family.setRelationship(
				familyId,
				relationshipMember.accountId,
				relationship,
				reciprocal,
			);
			await loadMembers();
			relationshipMember = undefined;
			notice = "Relationship saved.";
		} catch (caught) {
			relationshipError = caught instanceof Error ? caught.message : "Could not save relationship.";
		} finally {
			relationshipSaving = false;
		}
	}

	let familyId = $state<string | null>(null);
	let error = $state("");
	let notice = $state("");
	let familyImageUrl = $state<string | null>(null);
	let familyImageContentType = $state("image/jpeg");
	let familyImageDraftUrl = $state<string | null>(null);
	let familyImageDraftType = $state("image/jpeg");
	let familyImageUploading = $state(false);
	let familyImageError = $state("");
	let familyImageInput = $state<{ click: () => void }>();
	let familyImageFit = $state<"crop" | "fit">("crop");
	let framingOpen = $state(false);
	/** Minimal node refs for click-outside detection; avoids relying on DOM globals. */
	let framingToggle = $state<{ contains: (node: Node) => boolean }>();
	let framingControls = $state<{ contains: (node: Node) => boolean }>();
	let familyImagePositionX = $state(50);
	let familyImagePositionY = $state(50);
	let familyImageDirty = $state(false);
	let editingName = $state(false);
	let nameDraft = $state("");
	let renaming = $state(false);
	let familyDescription = $state("");
	let editingDescription = $state(false);
	let descriptionDraft = $state("");
	let savingDescription = $state(false);
	let addModalOpen = $state(false);
	const familyTabs = [
		{ id: "tasks", label: "Tasks", icon: ListTodo },
		{ id: "chart", label: "Chart", icon: Network },
		{ id: "manage", label: "Manage", icon: Users },
	] as const;
	function tabKey(event: globalThis.KeyboardEvent, index: number) {
		let next: number;
		if (event.key === "ArrowRight") next = (index + 1) % familyTabs.length;
		else if (event.key === "ArrowLeft") next = (index + familyTabs.length - 1) % familyTabs.length;
		else if (event.key === "Home") next = 0;
		else if (event.key === "End") next = familyTabs.length - 1;
		else return;
		event.preventDefault();
		activeTab = familyTabs[next].id;
		(event.currentTarget as globalThis.HTMLButtonElement).parentElement
			?.querySelector<globalThis.HTMLButtonElement>(`[data-family-tab="${next}"]`)
			?.focus();
	}
	let activeTab = $state<"tasks" | "chart" | "manage">("tasks");
	$effect(() => {
		if (tab === "tasks" || tab === "chart" || tab === "manage") activeTab = tab;
	});
	let accountId = $state("");
	let preview: AccountLookup | null = $state(null);
	let previewLoading = $state(false);
	let previewError = $state("");
	let previewTimer: ReturnType<typeof setTimeout> | undefined;
	let role = $state<"admin" | "member">("member");
	let adding = $state(false);
	let childProfiles = $state<LearningProfile[]>([]);
	let childrenLoading = $state(false),
		childrenError = $state("");
	let chartRequest = 0;
	async function loadChartChildren(id: string) {
		const request = ++chartRequest;
		childrenLoading = true;
		childrenError = "";
		childProfiles = [];
		try {
			const result = await runtime.services.learning.listProfiles(id);
			if (request === chartRequest && id === familyId) childProfiles = result;
		} catch {
			if (request === chartRequest) childrenError = "Could not load child profiles. Please retry.";
		} finally {
			if (request === chartRequest) childrenLoading = false;
		}
	}
	$effect(() => {
		const id = familyId;
		if ((activeTab !== "chart" && activeTab !== "tasks") || !id) return;
		untrack(() => void loadChartChildren(id));
		return () => {
			chartRequest += 1;
			childProfiles = [];
		};
	});
	const displayedFamilyImageUrl = $derived(familyImageDraftUrl ?? familyImageUrl);

	async function loadFamilyImage() {
		if (!familyId) return;
		const image = await runtime.services.family.getFamilyAvatar(familyId);
		if (image && image.image.length > 0) {
			familyImageContentType = image.contentType;
			familyImageUrl = URL.createObjectURL(
				new Blob([new Uint8Array(image.image)], { type: image.contentType }),
			);
		} else {
			familyImageUrl = null;
		}
	}

	function openFamilyImagePicker() {
		familyImageInput?.click();
	}

	function onFamilyImageSelected(file: File) {
		familyImageError = "";
		if (!file.type.startsWith("image/")) {
			familyImageError = "Please choose an image file.";
			return;
		}
		if (familyImageDraftUrl) URL.revokeObjectURL(familyImageDraftUrl);
		familyImageDraftUrl = URL.createObjectURL(file);
		familyImageDraftType = file.type;
		familyImageFit = "crop";
		familyImagePositionX = 50;
		familyImagePositionY = 50;
		familyImageDirty = true;
		framingOpen = true;
		notice = "";
	}

	async function renderFamilyImageBlob(sourceUrl: string, contentType: string) {
		const image = document.createElement("img");
		image.decoding = "async";
		await new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error("Could not load picture."));
			image.src = sourceUrl;
		});

		const canvas = document.createElement("canvas");
		canvas.width = FAMILY_BANNER_WIDTH;
		canvas.height = FAMILY_BANNER_HEIGHT;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Could not prepare picture crop.");

		context.clearRect(0, 0, FAMILY_BANNER_WIDTH, FAMILY_BANNER_HEIGHT);

		const g = bannerGeometry(
			familyImageFit,
			image.naturalWidth,
			image.naturalHeight,
			familyImagePositionX,
			familyImagePositionY,
		);

		if (familyImageFit === "fit") {
			context.fillStyle = "#111827";
			context.fillRect(0, 0, FAMILY_BANNER_WIDTH, FAMILY_BANNER_HEIGHT);
		}

		context.drawImage(image, g.sx, g.sy, g.sWidth, g.sHeight, g.dx, g.dy, g.dWidth, g.dHeight);

		return await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob(
				(blob) => (blob ? resolve(blob) : reject(new Error("Crop failed."))),
				contentType,
				0.9,
			);
		});
	}

	async function saveFamilyImageFraming() {
		const source = familyImageDraftUrl ?? familyImageUrl;
		if (!source) return;
		familyImageUploading = true;
		familyImageError = "";
		try {
			const contentType = familyImageDraftType || familyImageContentType;
			const blob = await renderFamilyImageBlob(source, contentType);
			const bytes = new Uint8Array(await blob.arrayBuffer());
			await runtime.services.family.setFamilyAvatar(bytes, contentType);
			if (familyImageDraftUrl) URL.revokeObjectURL(familyImageDraftUrl);
			familyImageDraftUrl = null;
			await loadFamilyImage();
			familyImageDirty = false;
			framingOpen = false;
			toastService.success("Family picture updated.");
		} catch (caught) {
			familyImageError = caught instanceof Error ? caught.message : "Could not update picture.";
		} finally {
			familyImageUploading = false;
		}
	}

	function resetFamilyImageFraming() {
		if (familyImageDraftUrl) URL.revokeObjectURL(familyImageDraftUrl);
		familyImageDraftUrl = null;
		familyImageFit = "crop";
		familyImagePositionX = 50;
		familyImagePositionY = 50;
		familyImageDirty = false;
		familyImageError = "";
	}

	function setFamilyImageFit(fit: "crop" | "fit") {
		familyImageFit = fit;
		familyImageDirty = true;
	}

	function updateFamilyImagePosition(axis: "x" | "y", value: string) {
		const number = Number.parseInt(value, 10);
		if (Number.isNaN(number)) return;
		if (axis === "x") familyImagePositionX = number;
		else familyImagePositionY = number;
		familyImageDirty = true;
	}

	// Re-load the caller's existing family on mount so a refresh doesn't show
	// the "create family" form again for a family that already exists.
	$effect(() => {
		if (familyId) return;
		void (async () => {
			try {
				const family = await runtime.services.family.getMyFamily();
				if (family) {
					familyId = family.id;
					familyStale = family.stale === true;
					activeFamilyName = family.name;
					familyDescription = family.description;
					descriptionDraft = family.description;
					await loadMembers();
					await loadFamilyImage();
				}
			} catch (caught) {
				error = caught instanceof Error ? caught.message : "Could not load family.";
			}
		})();
	});

	// Close the crop/fit panel when clicking anywhere outside it (or its toggle).
	$effect(() => {
		if (!framingOpen) return;
		function onDocClick(e: MouseEvent) {
			const node = e.target as Node;
			if (framingToggle && framingToggle.contains(node)) {
				return;
			}
			if (framingControls && framingControls.contains(node)) {
				return;
			}
			framingOpen = false;
		}
		document.addEventListener("pointerdown", onDocClick);
		return () => document.removeEventListener("pointerdown", onDocClick);
	});

	async function loadMembers() {
		if (!familyId) return;
		members = await runtime.services.family.listMembers(familyId);
		const lookups = await Promise.allSettled(
			members.map(async (member) => {
				if (member.accountId === runtime.state.identity?.id) {
					const identity = runtime.state.identity;
					return [
						member.accountId,
						{
							id: identity.id,
							displayName: identity.name,
							role:
								identity.role === "manager"
									? "parent"
									: identity.role === "kid"
										? "kid"
										: "grandparent",
						},
					] as const;
				}
				return [
					member.accountId,
					await runtime.services.family.getAccount(member.accountId),
				] as const;
			}),
		);
		memberAccounts = Object.fromEntries(
			lookups.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])),
		);
	}

	function startEditingName() {
		if (showingStale) return;
		nameDraft = activeFamilyName;
		editingName = true;
	}

	async function saveName() {
		const name = nameDraft.trim();
		if (!name || showingStale) return;
		renaming = true;
		error = "";
		notice = "";
		try {
			if (!familyId) {
				// No family yet — creating it with the typed name.
				const family = await runtime.services.family.createFamily(name);
				familyId = family.id;
				activeFamilyName = family.name;
				familyDescription = family.description;
				descriptionDraft = family.description;
				await loadMembers();
				await loadFamilyImage();
				notice = `Family "${family.name}" created.`;
			} else {
				const family = await runtime.services.family.renameFamily(name);
				activeFamilyName = family.name;
				notice = "Family name updated.";
			}
			editingName = false;
		} catch (caught) {
			error = caught instanceof Error ? caught.message : "Could not rename family.";
		} finally {
			renaming = false;
		}
	}

	function startEditingDescription() {
		if (showingStale) return;
		descriptionDraft = familyDescription;
		editingDescription = true;
	}

	async function saveDescription() {
		if (!familyId || showingStale) return;
		savingDescription = true;
		error = "";
		notice = "";
		try {
			const family = await runtime.services.family.updateFamilyDescription(descriptionDraft);
			familyDescription = family.description;
			editingDescription = false;
			notice = "Family description updated.";
		} catch (caught) {
			error = caught instanceof Error ? caught.message : "Could not update description.";
		} finally {
			savingDescription = false;
		}
	}

	function openAddModal() {
		if (showingStale) return;
		accountId = "";
		preview = null;
		previewError = "";
		role = "member";
		addModalOpen = true;
	}

	function closeAddModal() {
		addModalOpen = false;
		if (previewTimer) clearTimeout(previewTimer);
	}

	async function lookupAccount() {
		const id = accountId.trim();
		if (!familyId || !id || previewLoading) return;
		if (previewTimer) clearTimeout(previewTimer);
		previewLoading = true;
		preview = null;
		previewError = "";
		try {
			const account = await runtime.services.family.getAccount(id);
			if (accountId.trim() !== id) return; // ignore a stale result
			preview = account;
		} catch (caught) {
			if (accountId.trim() !== id) return; // ignore a stale result
			previewError =
				caught instanceof Error
					? `Could not look up account: ${caught.message}`
					: "Could not look up account.";
		} finally {
			previewLoading = false;
		}
	}

	// Debounce the account-id lookup so a name preview can be shown without
	// firing a request per keystroke.
	$effect(() => {
		const id = accountId.trim();
		if (previewTimer) clearTimeout(previewTimer);
		preview = null;
		previewError = "";
		if (!familyId || !id) {
			previewLoading = false;
			return;
		}
		previewLoading = true;
		previewTimer = setTimeout(async () => {
			let account: AccountLookup | null;
			try {
				account = await runtime.services.family.getAccount(id);
			} catch (caught) {
				previewLoading = false;
				if (accountId.trim() !== id) return; // ignore a stale result
				previewError =
					caught instanceof Error
						? `Could not look up account: ${caught.message}`
						: "Could not look up account.";
				return;
			}
			previewLoading = false;
			if (accountId.trim() !== id) return; // ignore a stale result
			preview = account;
		}, 300);
	});

	async function addMember() {
		if (!familyId || !preview) return;
		adding = true;
		error = "";
		notice = "";
		try {
			const member = await runtime.services.family.addMember(familyId, preview.id, role);
			await loadMembers();
			closeAddModal();
			notice = "Relative added.";
			editRelationship(member);
		} catch (caught) {
			error = caught instanceof Error ? caught.message : "Could not add relative.";
		} finally {
			adding = false;
		}
	}
</script>

{#snippet memberDetails(member: FamilyMemberRecord)}
	{@const account = memberAccounts[member.accountId]}
	<span class="v-member-avatar" aria-hidden="true"
		>{account?.displayName?.trim().slice(0, 1).toUpperCase() || "?"}</span
	>
	<span class="v-member-info">
		<strong
			>{account?.displayName || "Name unavailable"}{member.accountId === runtime.state.identity?.id
				? " (you)"
				: ""}</strong
		>
		<span class="v-member-meta">
			{#if member.relationship}<span
					>{relationshipLabels[member.relationship] ?? member.relationship}</span
				>{:else if account}<span
					>{account.role === "parent"
						? "Parent"
						: account.role === "kid"
							? "Child"
							: "Grandparent"}</span
				>{/if}
			<span class="v-member-id" title={member.accountId}>{member.accountId}</span>
		</span>
	</span>
	<Badge>{member.role}</Badge>
	{#if member.accountId !== runtime.state.identity?.id}
		<IconButton
			icon={UiPencil}
			label={`Edit relationship with ${account?.displayName || member.accountId}`}
			disabled={showingStale || relationshipSaving}
			onclick={() => editRelationship(member)}
		/>
	{/if}
{/snippet}

<section class="v-family" aria-labelledby="family-title">
	{#if showingStale}
		<p role="status">
			Showing saved family data while offline. Changes still require a connection.
		</p>
	{/if}
	<div class="v-family-banner-wrap">
		<div class="v-family-banner" class:has-image={!!displayedFamilyImageUrl}>
			{#if displayedFamilyImageUrl}
				<img
					src={displayedFamilyImageUrl}
					alt={activeFamilyName || "Family"}
					class="v-family-banner-img"
					class:fit={familyImageFit === "fit"}
					style={`object-position: ${familyImagePositionX}% ${familyImagePositionY}%`}
				/>
				<div class="v-family-banner-scrim" aria-hidden="true"></div>
			{:else}
				<div class="v-family-banner-placeholder">
					<span>This is where Family picture will go</span>
				</div>
			{/if}
			<button
				type="button"
				class="v-family-image-change"
				disabled={showingStale || familyImageUploading}
				onclick={openFamilyImagePicker}
				aria-label="Change family picture"
				title="Change family picture"
			>
				<Camera aria-hidden="true" size={20} strokeWidth={2.4} />
			</button>
			<input
				bind:this={familyImageInput}
				class="v-family-image-input"
				type="file"
				accept="image/*"
				disabled={showingStale || familyImageUploading}
				onchange={(event) => {
					const file = event.currentTarget.files?.[0];
					event.currentTarget.value = "";
					if (file) void onFamilyImageSelected(file);
				}}
			/>
			{#if displayedFamilyImageUrl}
				<button
					type="button"
					class="v-family-image-framing-toggle"
					bind:this={framingToggle}
					class:open={framingOpen}
					onclick={() => (framingOpen = !framingOpen)}
					aria-label={framingOpen ? "Close image framing" : "Open image crop and fit"}
					title={framingOpen ? "Close image framing" : "Crop or fit image"}
					aria-expanded={framingOpen}
				>
					<Crop aria-hidden="true" size={20} strokeWidth={2.4} />
				</button>
			{/if}

			<div class="v-family-banner-copy">
				<div class="v-family-banner-details">
					<div class="v-family-name-row">
						<h2
							id="family-title"
							class="v-family-name"
							ondblclick={startEditingName}
							title="Double-click to edit"
						>
							{#if familyId && activeFamilyName}
								{activeFamilyName}
							{:else}
								Your family
							{/if}
						</h2>
					</div>
					<!-- Family note shares the standard side editor. -->
					<button
						type="button"
						class="v-family-note"
						disabled={showingStale}
						onclick={startEditingDescription}
						aria-label={familyDescription ? "Edit Who we are" : "Add a family note"}
						title={familyDescription ? "Edit Who we are" : "Add a family note"}
						><UiPencil aria-hidden="true" size={18} strokeWidth={1.8} />
						{familyDescription ? familyDescription : "Add a family note"}
					</button>

					<ErrorToast message={familyImageError} />
				</div>
			</div>
		</div>
		{#if displayedFamilyImageUrl && framingOpen}
			<div
				class="v-family-image-controls"
				bind:this={framingControls}
				aria-label="Family picture framing"
			>
				<div class="v-family-image-fit" role="group" aria-label="Image fit">
					<button
						type="button"
						class:active={familyImageFit === "crop"}
						onclick={() => setFamilyImageFit("crop")}
						><UiCrop aria-hidden="true" size={18} strokeWidth={1.8} />
						Crop
					</button>
					<button
						type="button"
						class:active={familyImageFit === "fit"}
						onclick={() => setFamilyImageFit("fit")}
						><UiMaximize aria-hidden="true" size={18} strokeWidth={1.8} />
						Fit
					</button>
				</div>
				{#if familyImageFit === "crop"}
					<label>
						<span>Horizontal</span>
						<input
							type="range"
							min="0"
							max="100"
							value={familyImagePositionX}
							oninput={(event) => updateFamilyImagePosition("x", event.currentTarget.value)}
						/>
					</label>
					<label>
						<span>Vertical</span>
						<input
							type="range"
							min="0"
							max="100"
							value={familyImagePositionY}
							oninput={(event) => updateFamilyImagePosition("y", event.currentTarget.value)}
						/>
					</label>
				{/if}
				{#if familyImageDirty}
					<div class="v-family-image-actions">
						<button
							type="button"
							disabled={showingStale || familyImageUploading}
							onclick={() => void saveFamilyImageFraming()}
							><UiSave aria-hidden="true" size={18} strokeWidth={1.8} />
							{familyImageUploading ? "Saving…" : "Save picture"}
						</button>
						<button
							type="button"
							disabled={showingStale || familyImageUploading}
							onclick={resetFamilyImageFraming}
							><UiX aria-hidden="true" size={18} strokeWidth={1.8} />
							Cancel
						</button>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	{#if familyImageDirty}
		<p class="v-notice" role="status">
			Picture not saved yet. Adjust the framing and choose Save picture.
		</p>
	{/if}

	{#if editingName}
		<SideForm
			title={familyId ? "Edit family name" : "Create family"}
			onclose={() => (editingName = false)}
			onsave={() => void saveName()}
			disabled={renaming || !nameDraft.trim()}
			saveLabel="Save family name"
		>
			<Input bind:value={nameDraft} label="Family name" placeholder="Family name" />
		</SideForm>
	{/if}
	{#if editingDescription}
		<SideForm
			title="Who we are"
			onclose={() => (editingDescription = false)}
			onsave={() => void saveDescription()}
			disabled={savingDescription}
			saveLabel="Save description"
		>
			<label class="v-role-select"
				>Family note<textarea
					bind:value={descriptionDraft}
					class="v-family-description-input"
					placeholder="Tell us about your family…"
					rows={6}></textarea></label
			>
		</SideForm>
	{/if}

	<div class="v-family-panel">
		<div class="v-family-tabs" role="tablist" aria-label="Family sections">
			{#each familyTabs as item, index (item.id)}
				{@const Icon = item.icon}
				<button
					type="button"
					role="tab"
					id={`family-tab-${item.id}`}
					aria-controls="family-tab-panel"
					data-family-tab={index}
					class="v-family-tab"
					class:active={activeTab === item.id}
					aria-selected={activeTab === item.id}
					tabindex={activeTab === item.id ? 0 : -1}
					onclick={() => (activeTab = item.id)}
					onkeydown={(event) => tabKey(event, index)}
				>
					<Icon size={16} strokeWidth={1.6} aria-hidden="true" />
					<span>{item.label}</span>
				</button>
			{/each}
		</div>

		<div
			class="v-family-content"
			id="family-tab-panel"
			role="tabpanel"
			aria-labelledby={`family-tab-${activeTab}`}
			tabindex="0"
		>
			{#if activeTab === "tasks"}
				{#if childrenError}<div class="chart-error">
						<IconButton
							label="Retry child profiles"
							icon={RefreshCw}
							onclick={() => familyId && void loadChartChildren(familyId)}
						/>
					</div>{/if}
				<TaskWorkspace
					initialFilter={filter}
					readOnly={showingStale}
					{familyId}
					{members}
					{childProfiles}
					service={runtime.services.tasks}
					familyService={runtime.services.family}
					currentAccountId={runtime.state.identity?.id ?? null}
				/>
			{:else if activeTab === "chart"}
				<div class="v-family-section">
					<div class="section-intro">
						<h3>Family members</h3>
						<p>
							{members.length}
							{members.length === 1 ? "relative" : "relatives"} · {childProfiles.length}
							{childProfiles.length === 1 ? "child profile" : "child profiles"}
						</p>
					</div>
					<div class="v-family-section-head">
						{#if members.length > 0 || childProfiles.length > 0}
							<ul class="v-member-list" aria-label="Family chart">
								{#each members as member (member.id)}
									<li class="v-member">
										{@render memberDetails(member)}
									</li>
								{/each}
								{#each childProfiles as child (child.id)}
									<li class="v-member">
										<span class="v-member-avatar" aria-hidden="true"
											>{child.displayName.trim().slice(0, 1).toUpperCase()}</span
										>
										<span class="v-member-info"
											><strong>{child.displayName}</strong><span class="v-member-meta"
												>{child.grade || ageBands[child.ageBand]}</span
											></span
										>
										<Badge>Child</Badge>
									</li>
								{/each}
							</ul>
						{:else}
							<p>Add relatives in the Manage tab to start building your tree.</p>
						{/if}
						{#if childrenLoading}<p role="status">Loading child profiles…</p>{/if}
						{#if childrenError}<div class="chart-error">
								<IconButton
									label="Retry child profiles"
									icon={RefreshCw}
									onclick={() => familyId && void loadChartChildren(familyId)}
								/>
							</div>{/if}
					</div>
				</div>
			{:else}
				<div class="v-manage-accordion">
					<div class="member-group">
						<details open use:animateDetails>
							<summary
								><span class="group-icon"
									><Users size={22} strokeWidth={1.5} aria-hidden="true" /></span
								><span class="group-copy"
									><span>Members</span><small>People and roles in your family.</small></span
								><ChevronDown size={16} aria-hidden="true" /></summary
							>
							<div class="accordion-body v-manage-body">
								{#if members.length > 0}
									<ul class="v-member-list">
										{#each members as member (member.id)}
											<li class="v-member">
												{@render memberDetails(member)}
											</li>
										{/each}
									</ul>
								{:else}<p>No relatives yet. Add someone to your family.</p>{/if}
							</div>
						</details>
						<div class="v-manage-action">
							<IconButton
								label="Add relative"
								icon={UiUserPlus}
								disabled={showingStale}
								onclick={openAddModal}
							/>
						</div>
					</div>
					{#if members.some((member) => member.accountId === runtime.state.identity?.id && member.role === "admin") && runtime.state.identity?.role === "manager"}
						<details class="services-section" use:animateDetails>
							<summary
								><span class="group-icon"
									><Sparkles size={22} strokeWidth={1.5} aria-hidden="true" /></span
								><span class="group-copy"
									><span>Family services</span><small>Storage and AI for your family.</small></span
								><ChevronDown size={16} aria-hidden="true" /></summary
							>
							<div class="accordion-body service-body">
								<ResourceSettings
									service={runtime.services.resources}
									familyAi={runtime.services.familyAi}
								/>
								<FamilyAiRequests service={runtime.services.familyAi} />
								<FamilyAiChildren service={runtime.services.familyAi} children={childProfiles} />
							</div>
						</details>
					{/if}
				</div>
			{/if}

			{#if notice}
				<p class="v-notice" role="status">{notice}</p>
			{/if}
			<ErrorToast message={error} />
			<ErrorToast message={childrenError} />
			<ErrorToast message={previewError} />
			<ErrorToast message={relationshipError} />
		</div>
	</div>
</section>

{#if addModalOpen}
	<SideForm
		title="Add relatives"
		subtitle="Find an account and choose a role"
		onclose={closeAddModal}
		onsave={addMember}
		disabled={adding || !preview}
		saveLabel={adding ? "Adding…" : "Add relative"}
	>
		<Input bind:value={accountId} label="Relative account id" placeholder="Paste the account id">
			{#snippet trailing()}
				<button
					type="button"
					class="v-search"
					disabled={!accountId.trim() || previewLoading}
					onclick={lookupAccount}
					title="Search account id"
					aria-label="Search account id"
				>
					{#if previewLoading}
						<span class="v-spin" aria-hidden="true">
							<Loader2 size={18} strokeWidth={2.2} />
						</span>
					{:else}
						<Search aria-hidden="true" size={18} strokeWidth={2.2} />
					{/if}
				</button>
			{/snippet}
		</Input>
		{#if preview}
			<p class="v-preview" role="status">
				<span class="v-avatar">{preview.displayName?.[0] ?? "?"}</span>
				<span class="v-preview-text">
					<strong>{preview.displayName}</strong>
					<Badge>{preview.role}</Badge>
				</span>
			</p>
		{:else if accountId.trim() && !previewLoading}
			<p class="v-preview v-preview-empty" role="status">No account found for that id.</p>
		{/if}
		<label class="v-role-select">
			<span>Role</span>
			<select bind:value={role}>
				<option value="member">Member</option>
				<option value="admin">Admin</option>
			</select>
		</label>
	</SideForm>
{/if}

{#if relationshipMember}
	<SideForm
		title="Relationship"
		subtitle={`How you and ${memberAccounts[relationshipMember.accountId]?.displayName || "your relative"} are related`}
		onclose={() => (relationshipMember = undefined)}
		onsave={saveRelationship}
		disabled={relationshipSaving || Boolean(relationship) !== Boolean(reciprocal)}
		saveLabel={relationshipSaving ? "Saving…" : "Save"}
	>
		<label class="v-role-select"
			><span>Their relationship to you</span>
			<select
				bind:value={relationship}
				onchange={(event) => {
					reciprocal = reciprocalRelationship(event.currentTarget.value);
				}}
			>
				<option value="">Not specified</option>
				{#each Object.entries(relationshipLabels) as [value, label] (value)}<option {value}
						>{label}</option
					>{/each}
			</select>
		</label>
		<label class="v-role-select"
			><span>Your relationship to them</span>
			<select bind:value={reciprocal} disabled={!relationship}>
				<option value="">Not specified</option>
				{#each Object.entries(relationshipLabels) as [value, label] (value)}<option {value}
						>{label}</option
					>{/each}
			</select>
		</label>
		<small
			>These labels are personal to your accounts. Admin and Member access stays the same.</small
		>
	</SideForm>
{/if}

<style>
	.v-manage-accordion {
		border: 1px solid var(--v-border);
		border-radius: 12px;
		overflow: clip;
		background: color-mix(in srgb, var(--v-fg) 2%, transparent);
	}
	.member-group {
		position: relative;
	}
	.v-manage-accordion > details {
		border-top: 1px solid var(--v-border);
	}
	.v-manage-accordion summary {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-height: 66px;
		box-sizing: border-box;
		padding: 0.8rem;
		list-style: none;
		cursor: pointer;
		font-size: 0.82rem;
		font-weight: 500;
	}
	.member-group summary {
		padding-right: 3rem;
	}
	.group-icon {
		display: grid;
		place-items: center;
		width: 32px;
		flex: 0 0 32px;
		color: var(--v-muted);
	}
	.group-copy {
		display: grid;
		gap: 0.2rem;
		flex: 1;
		min-width: 0;
	}
	.group-copy small {
		color: var(--v-muted);
		font-size: 0.72rem;
		font-weight: 400;
	}
	.v-manage-accordion summary::-webkit-details-marker {
		display: none;
	}
	.v-manage-accordion summary:focus-visible {
		outline: 2px solid var(--v-ring);
		outline-offset: -2px;
	}
	.v-manage-accordion summary > :global(svg:last-child) {
		flex-shrink: 0;
		color: var(--v-muted);
		transition: transform 200ms ease;
	}
	.v-manage-accordion details[open] > summary > :global(svg:last-child) {
		transform: rotate(180deg);
	}
	.v-manage-action {
		position: absolute;
		top: 33px;
		transform: translateY(-50%);
		right: 8px;
	}
	.v-manage-action :global(.v-icon-btn::after) {
		right: 0;
		left: auto;
		transform: none;
	}
	.v-manage-body,
	.service-body {
		border-top: 1px solid var(--v-border);
	}
	.v-manage-body > p {
		margin: 0;
		padding: 0.85rem;
		font-size: 0.75rem;
		color: var(--v-muted);
	}
	.service-body {
		padding: 0.25rem;
	}
	.chart-error {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.services-section .group-copy > span,
	.service-body :global(.resource-copy strong) {
		font-size: 0.8rem;
		font-weight: 500;
		line-height: 1.4;
	}
	.services-section .group-copy small,
	.service-body :global(.resource-help) {
		font-size: 0.7rem;
		font-weight: 400;
		line-height: 1.5;
		color: var(--v-muted);
	}
	.section-intro {
		display: grid;
		gap: 0.25rem;
	}
	.section-intro h3 {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 550;
	}
	.section-intro p {
		margin: 0;
		color: var(--v-muted);
		font-size: 0.75rem;
	}

	.v-family {
		width: 100%;
		margin: 0 auto;
		display: grid;
		gap: calc(var(--v-space) * 1.5);
		align-content: start;
	}
	h2,
	p {
		margin: 0;
	}
	.v-notice {
		color: var(--v-primary);
		font-weight: 600;
	}

	/* Banner */
	.v-family-banner-wrap {
		position: relative;
	}
	.v-family-banner {
		position: relative;
		height: clamp(220px, 30vw, 360px);
		max-height: 360px;
		overflow: hidden;
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius);
		background: var(--v-glass, var(--v-surface));
		backdrop-filter: blur(18px);
	}
	.v-family-banner:not(.has-image) {
		display: flex;
		flex-direction: column;
		height: auto;
		min-height: 240px;
		gap: calc(var(--v-space) * 3);
		padding: calc(var(--v-space) * 3);
	}
	.v-family-banner:not(.has-image) .v-family-banner-placeholder {
		height: auto;
		min-height: 96px;
		padding: calc(var(--v-space) * 4) calc(var(--v-space) * 5) var(--v-space);
	}
	.v-family-banner:not(.has-image) .v-family-banner-copy {
		position: relative;
		inset: auto;
		width: 100%;
	}
	.v-family-banner-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.v-family-banner-img.fit {
		object-fit: contain;
		background: var(--v-bg);
	}
	/* Dark, bottom-heavy gradient behind the name/note so the banner text stays
     legible over any image. Non-interactive; sits under the chrome controls. */
	.v-family-banner-scrim {
		position: absolute;
		inset: 0;
		background: linear-gradient(180deg, rgba(0, 0, 0, 0) 40%, rgba(0, 0, 0, 0.55) 100%);
		pointer-events: none;
		z-index: 0;
	}
	.v-family-banner-placeholder {
		display: grid;
		place-items: center;
		height: 100%;
		padding: calc(var(--v-space) * 2);
		background: transparent;
		color: var(--v-muted);
		font-weight: 700;
		text-align: center;
	}
	.v-family-image-change {
		position: absolute;
		top: calc(var(--v-space) * 2);
		right: calc(var(--v-space) * 2);
		display: inline-grid;
		place-items: center;
		width: max(var(--v-control-h), 44px);
		height: max(var(--v-control-h), 44px);
		border: 1px solid color-mix(in srgb, var(--v-border) 70%, transparent);
		border-radius: 999px;
		background: color-mix(in srgb, var(--v-surface) 88%, transparent);
		color: var(--v-fg);
		cursor: pointer;
		box-shadow: none;
	}
	.v-family-image-change:hover {
		background: var(--v-surface);
	}
	.v-family-image-change:disabled {
		opacity: 0.6;
		cursor: wait;
	}
	.v-family-image-framing-toggle {
		position: absolute;
		bottom: var(--v-space);
		right: var(--v-space);
		z-index: 3;
		display: inline-grid;
		place-items: center;
		width: max(var(--v-control-h), 44px);
		height: max(var(--v-control-h), 44px);
		border: 1px solid color-mix(in srgb, var(--v-border) 70%, transparent);
		border-radius: 999px;
		background: color-mix(in srgb, var(--v-surface) 88%, transparent);
		color: var(--v-fg);
		cursor: pointer;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
	}
	.v-family-image-framing-toggle:hover {
		background: var(--v-surface);
	}
	.v-family-image-framing-toggle.open {
		background: var(--v-primary);
		color: var(--v-primary-fg);
	}
	.v-family-image-input {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
	.v-family-image-controls {
		position: absolute;
		bottom: calc(var(--v-space) * 5 + max(var(--v-control-h), 44px));
		right: var(--v-space);
		z-index: 4;
		display: grid;
		gap: calc(var(--v-space) * 0.8);
		width: min(16rem, calc(100% - var(--v-space) * 2));
		padding: var(--v-space);
		border: 1px solid color-mix(in srgb, var(--v-border) 70%, transparent);
		border-radius: var(--v-radius-sm);
		background: color-mix(in srgb, var(--v-surface) 90%, transparent);
		color: var(--v-fg);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
	}
	@media (max-width: 640px) {
		.v-family-image-controls {
			position: relative;
			inset: auto;
			width: 100%;
			margin-top: var(--v-space);
		}
	}
	.v-family-image-fit {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: calc(var(--v-space) / 2);
	}
	.v-family-image-fit button {
		min-height: 34px;
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius-sm);
		background: transparent;
		color: var(--v-fg);
		font: inherit;
		font-size: 0.85rem;
		font-weight: 700;
		cursor: pointer;
	}
	.v-family-image-fit button.active,
	.v-family-image-fit button:hover {
		background: var(--v-primary);
		color: var(--v-primary-fg);
	}
	.v-family-image-controls label {
		display: grid;
		gap: calc(var(--v-space) / 3);
		font-size: 0.78rem;
		font-weight: 700;
	}
	.v-family-image-controls input[type="range"] {
		width: 100%;
	}
	.v-family-image-actions {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: calc(var(--v-space) / 2);
	}
	.v-family-image-actions button {
		min-height: 34px;
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius-sm);
		background: var(--v-bg);
		color: var(--v-fg);
		font: inherit;
		font-size: 0.85rem;
		font-weight: 700;
		cursor: pointer;
	}
	.v-family-image-actions button:first-child {
		background: var(--v-primary);
		color: var(--v-primary-fg);
	}
	.v-family-image-actions button:disabled {
		opacity: 0.6;
		cursor: wait;
	}

	/* Banner copy: family name + Who we are chip. */
	.v-family-banner-copy {
		position: absolute;
		left: calc(var(--v-space) * 2);
		right: calc(var(--v-space) * 2);
		bottom: calc(var(--v-space) * 2);
		z-index: 2;
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--v-space);
		flex-wrap: wrap;
		pointer-events: none;
	}
	.v-family-banner-details {
		pointer-events: auto;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: calc(var(--v-space) * 1.5);
		width: 100%;
	}
	.v-family-name-row {
		display: flex;
		align-items: center;
		gap: var(--v-space);
		flex-wrap: wrap;
		width: 100%;
	}
	.v-family-name {
		margin: 0;
		color: var(--v-fg);
		font-size: clamp(1.6rem, 5vw, 2.6rem);
		font-weight: 800;
		line-height: 1.1;
		cursor: text;
		text-shadow: none;
	}
	.v-family-banner.has-image .v-family-name {
		color: #fff;
		text-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
	}

	.v-family-note {
		display: inline-flex;
		align-items: center;
		gap: calc(var(--v-space) / 2);
		max-width: 26rem;
		min-height: max(var(--v-control-h) * 0.8, 34px);
		padding: 0 calc(var(--v-space) * 1.1);
		border: 1px solid color-mix(in srgb, var(--v-border) 80%, transparent);
		border-radius: 999px;
		background: color-mix(in srgb, var(--v-surface) 85%, transparent);
		color: var(--v-fg);
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
		box-shadow: none;
		text-shadow: none;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.v-family-note:hover {
		background: var(--v-surface);
	}
	.v-family-banner.has-image .v-family-note {
		border-color: rgba(255, 255, 255, 0.28);
		background: rgba(0, 0, 0, 0.45);
		color: #fff;
	}
	.v-family-banner.has-image .v-family-note:hover {
		background: rgba(0, 0, 0, 0.65);
	}

	.v-family-panel {
		width: 100%;
		background: var(--v-glass, var(--v-surface));
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius);
		box-shadow: none;
		overflow: hidden;
	}
	.v-family-tabs {
		display: flex;
		width: 100%;
		border-bottom: 1px solid var(--v-border);
		background: color-mix(in srgb, var(--v-fg) 2%, transparent);
	}
	.v-family-tab {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		min-width: 100px;
		min-height: 42px;
		padding: 0.65rem 1rem;
		border: 0;
		border-right: 1px solid var(--v-border);
		border-radius: 0;
		background: transparent;
		color: var(--v-muted);
		font: inherit;
		font-size: 0.78rem;
		font-weight: 450;
		cursor: pointer;
		box-shadow: inset 0 -2px transparent;
		transition:
			background 140ms ease,
			color 140ms ease,
			box-shadow 140ms ease;
	}
	.v-family-tab:hover {
		background: color-mix(in srgb, var(--v-fg) 4%, transparent);
	}
	.v-family-tab.active {
		color: var(--v-fg);
		background: color-mix(in srgb, var(--v-fg) 4%, transparent);
		box-shadow: inset 0 -2px var(--v-primary);
	}
	.v-family-tab:focus-visible {
		outline: 2px solid var(--v-primary);
		outline-offset: -3px;
	}
	/* Panel */
	.v-family-content {
		display: grid;
		gap: 1rem;
		padding: clamp(0.75rem, 2vw, 1.25rem);
	}
	.v-family-section {
		display: grid;
		gap: calc(var(--v-space) * 1.5);
	}
	.v-family-section-head {
		display: grid;
		gap: var(--v-space);
	}
	.v-family-section-head p {
		color: var(--v-muted);
		line-height: 1.6;
		max-width: 64ch;
	}

	/* Member list */
	.v-member-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0;
		border: 1px solid var(--v-border);
		border-radius: 10px;
		overflow: hidden;
	}
	.v-manage-body .v-member-list {
		border: 0;
		border-radius: 0;
	}
	.v-member + .v-member {
		border-top: 1px solid var(--v-border);
	}
	.v-member-avatar {
		display: grid;
		place-items: center;
		flex: 0 0 32px;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		color: var(--v-primary-text, var(--v-primary));
		background: color-mix(in srgb, var(--v-primary) 12%, transparent);
		font-weight: 700;
	}
	.v-member-info {
		display: grid;
		gap: 4px;
		min-width: 0;
		flex: 1;
	}
	.v-member-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 10px;
		font-size: 0.7rem;
		color: var(--v-muted);
	}
	.v-member-id {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
		max-width: 14rem;
		font-size: 0.65rem;
		opacity: 0.8;
	}
	.v-member-info strong {
		overflow-wrap: anywhere;
		font-size: 0.8rem;
		font-weight: 550;
	}
	.v-member {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--v-space);
		padding: 0.75rem;
		min-width: 0;
		background: transparent;
		color: var(--v-fg);
	}

	/* Popover */

	/* Droplet tip pointing up toward the note chip. */

	.v-family-description-input {
		width: 100%;
		border-radius: var(--v-radius-sm);
		border: 1px solid var(--v-border);
		background: transparent;
		color: var(--v-fg);
		padding: calc(var(--v-space) * 1.2);
		font: inherit;
		line-height: 1.5;
		resize: vertical;
	}

	/* Modal (add relatives) */

	.v-search {
		display: inline-grid;
		place-items: center;
		width: max(var(--v-control-h) * 0.78, 34px);
		height: max(var(--v-control-h) * 0.78, 34px);
		border: none;
		border-radius: var(--v-radius-sm);
		background: transparent;
		color: var(--v-fg);
		cursor: pointer;
	}
	.v-search:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.v-search:not(:disabled):hover {
		background: color-mix(in srgb, var(--v-primary) 10%, transparent);
	}
	.v-spin {
		animation: v-spin 0.8s linear infinite;
	}
	@keyframes v-spin {
		to {
			transform: rotate(360deg);
		}
	}
	.v-preview {
		display: flex;
		align-items: center;
		gap: var(--v-space);
		margin: 0;
		padding: calc(var(--v-space) * 1.2);
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius-sm);
		background: var(--v-bg);
		color: var(--v-fg);
	}
	.v-preview-empty {
		color: var(--v-muted);
	}
	.v-avatar {
		flex: 0 0 auto;
		width: 40px;
		height: 40px;
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: color-mix(in srgb, var(--v-primary) 18%, var(--v-bg));
		color: var(--v-primary);
		font-weight: 700;
	}
	.v-preview-text {
		display: flex;
		align-items: center;
		gap: var(--v-space);
		min-width: 0;
	}
	.v-role-select {
		display: flex;
		flex-direction: column;
		gap: calc(var(--v-space) / 2);
		font-weight: 600;
		color: var(--v-fg);
	}
	.v-role-select select {
		min-height: max(var(--v-control-h), 44px);
		border-radius: var(--v-radius-sm);
		border: 1px solid var(--v-border);
		background: var(--v-bg);
		color: var(--v-fg);
		padding: 0 calc(var(--v-space) * 1.5);
		font: inherit;
	}

	@media (prefers-reduced-motion: reduce) {
		.v-family-tab {
			transition: none;
		}
	}
	@media (max-width: 760px) {
		.v-family-tab {
			flex: 1 1 0;
			min-width: 0;
			padding: 0.65rem 0.4rem;
			gap: 0.35rem;
			font-size: 0.72rem;
		}
		.v-family-tab:last-child {
			border-right: 0;
		}
	}
</style>
