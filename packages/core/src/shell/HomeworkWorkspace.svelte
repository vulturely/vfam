<script lang="ts">
	import { DropdownMenu as Menu, AlertDialog } from "bits-ui";
	import MoreHorizontal from "lucide-svelte/icons/ellipsis";
	import HomeworkSourceReview from "./HomeworkSourceReview.svelte";
	import HomeworkEdit from "./HomeworkEdit.svelte";
	import HomeworkDocumentPreview from "./HomeworkDocumentPreview.svelte";
	import HomeworkCreator from "./HomeworkCreator.svelte";
	import Plus from "lucide-svelte/icons/plus";
	import Search from "lucide-svelte/icons/search";
	import ArrowLeft from "lucide-svelte/icons/arrow-left";
	import UiRefreshCw from "lucide-svelte/icons/refresh-cw";
	import UiUpload from "lucide-svelte/icons/upload";
	import UiEye from "lucide-svelte/icons/eye";
	import UiTrash2 from "lucide-svelte/icons/trash-2";
	import UiFilePenLine from "lucide-svelte/icons/file-pen-line";
	import UiBookOpen from "lucide-svelte/icons/book-open";
	import UiX from "lucide-svelte/icons/x";
	import PracticeWorkspace from "./PracticeWorkspace.svelte";
	import AssignedQuestions from "./AssignedQuestions.svelte";
	import UiListChecks from "lucide-svelte/icons/list-checks";
	import UiPencil from "lucide-svelte/icons/pencil";
	import UiSend from "lucide-svelte/icons/send";
	import { toastService } from "../services/toast.svelte";
	import { answerSummary, questionsReady } from "../homework/questionTypes";
	import ExtractionReview from "./ExtractionReview.svelte";
	import { getContext, onMount, onDestroy } from "svelte";
	import type { Runtime } from "../runtime/registry.svelte";
	import { HomeworkMediaType } from "../api/protocol";
	import type { Homework } from "../homework/service";
	import { Button, Card, ErrorToast, Input, IconButton } from "../components/index";
	let {
		profileId,
		view = "all",
		creatorNames = {},
	}: {
		profileId: string;
		view?: "all" | "homework" | "history";
		creatorNames?: Record<string, string>;
	} = $props();
	const runtime = getContext<Runtime>("vulture:runtime");
	let items = $state<Homework[]>([]);
	let selectedId = $state("");
	let creating = $state(false);
	let detailOpen = $state(false);
	let editing = $state(false);
	let deleteOpen = $state(false);
	let deleteTarget = $state<Homework>();
	let deleteError = $state("");
	let editContent = $state("");
	let previewLoaded = $state(false);
	let search = $state("");
	let browserPanel = $state<globalThis.HTMLElement>();
	let leftWidth = $state(20);
	let resizing = $state(false);
	function creatorName(item: Homework) {
		return creatorNames[item.homework!.uploadedBy] || "Family member";
	}
	function byline(item: Homework) {
		return `${item.homework!.subject || "No subject"}${item.homework!.uploadedBy ? ` · by ${creatorName(item)}` : ""}`;
	}
	function creationTime(item: Homework, compact = false) {
		const value = item.homework!.createdAt;
		const date = new Date(value);
		if (!value || Number.isNaN(date.getTime())) return "";
		return new Intl.DateTimeFormat(
			undefined,
			compact
				? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
				: { dateStyle: "medium", timeStyle: "short" },
		).format(date);
	}
	function resizeTo(value: number) {
		leftWidth = Math.min(65, Math.max(20, value));
	}
	function dragSplitter(event: globalThis.PointerEvent) {
		if (!resizing || !browserPanel) return;
		const bounds = browserPanel.getBoundingClientRect();
		if (bounds.width) resizeTo(((event.clientX - bounds.left) / bounds.width) * 100);
	}
	function resizeWithKeyboard(event: globalThis.KeyboardEvent) {
		const step = event.shiftKey ? 10 : 2;
		if (event.key === "ArrowLeft") resizeTo(leftWidth - step);
		else if (event.key === "ArrowRight") resizeTo(leftWidth + step);
		else if (event.key === "Home") resizeTo(20);
		else if (event.key === "End") resizeTo(65);
		else return;
		event.preventDefault();
	}
	const selected = $derived(items.find((item) => item.homework?.id === selectedId));
	const filtered = $derived(
		items.filter((item) => {
			const terms = search.match(/(?:[^\s"]|"[^"]*")+/g) ?? [];
			return terms.every((term) => {
				const match = /^(title|subject):(.*)$/i.exec(term);
				const value = (match ? match[2] : term).replaceAll('"', "").toLocaleLowerCase();
				const text =
					match?.[1].toLowerCase() === "title"
						? item.homework?.title
						: match?.[1].toLowerCase() === "subject"
							? item.homework?.subject
							: `${item.homework?.title ?? ""} ${item.homework?.subject ?? ""}`;
				return (text ?? "").toLocaleLowerCase().includes(value);
			});
		}),
	);
	function replaceItem(updated: Homework) {
		items = items.map((item) => (item.homework!.id === updated.homework!.id ? updated : item));
	}
	async function choose(item: Homework) {
		clearPreview();
		selectedId = item.homework!.id;
		creating = false;
		editing = false;
		detailOpen = true;
		reviewId = "";
		practiceId = "";
		questionsId = "";
		await show(item);
	}
	// The Questions view lists the questions; Edit and Assign sit in the toolbar.
	let questionsId = $state("");
	// Return to the Questions view after editing from it.
	let editFromQuestions = false;
	function openQuestions(item: Homework) {
		clearPreview();
		selectedId = item.homework!.id;
		creating = false;
		editing = false;
		detailOpen = true;
		reviewId = "";
		practiceId = "";
		questionsId = item.homework!.id;
	}
	async function assignQuestions(item: Homework) {
		await run(async () => {
			const source = item.sources[0]?.source;
			if (!source) throw new Error("Reload homework before assigning.");
			const sets = await runtime.services.practice.list(source);
			const current = sets.some(
				(set) =>
					set.practice?.origin === "assigned" &&
					set.practice.approved &&
					set.practice.source?.version === source.version,
			);
			if (current) {
				toastService.success("Already assigned. Your child can answer these questions now.");
				return;
			}
			await runtime.services.homework.assign(item.homework!.id);
			toastService.success("Assigned. Your child can answer these questions in the app now.");
		});
	}
	async function openEdit(item: Homework) {
		editFromQuestions = questionsId === item.homework!.id;
		await run(async () => {
			clearPreview();
			selectedId = item.homework!.id;
			creating = false;
			editing = false;
			detailOpen = true;
			reviewId = "";
			practiceId = "";
			questionsId = "";
			editContent =
				item.sources[0]?.mediaType === HomeworkMediaType.TEXT && !item.textFromQuestions
					? await (await runtime.services.homework.download(item.homework!.id)).text()
					: "";
			editing = true;
		});
	}
	function cancelNew() {
		creating = false;
		detailOpen = false;
		title = "";
		subject = "";
		files = undefined;
	}
	let reviewId = $state("");
	let practiceId = $state("");
	let title = $state("");
	let subject = $state("");
	let files = $state<globalThis.FileList>();
	let busy = $state(false);
	let error = $state("");
	let preview = $state("");
	let previewType = $state("");
	let previewTitle = $state("");
	let previewText = $state("");
	async function run(action: () => Promise<void>) {
		if (busy) return;
		busy = true;
		error = "";
		try {
			await action();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Homework request failed. Please retry.";
		} finally {
			busy = false;
		}
	}
	async function load() {
		items = await runtime.services.homework.list(profileId);
		if (!items.some((item) => item.homework?.id === selectedId))
			selectedId = items[0]?.homework?.id ?? "";
	}
	onMount(() => {
		void run(load);
	});
	function clearPreview() {
		if (preview) URL.revokeObjectURL(preview);
		preview = "";
		previewText = "";
		previewLoaded = false;
	}
	onDestroy(clearPreview);
	async function upload(event: { preventDefault(): void }) {
		event.preventDefault();
		await run(async () => {
			if (!files?.[0]) throw new Error("Choose a file.");
			const previousIds = new Set(items.map((item) => item.homework?.id));
			await runtime.services.homework.upload(profileId, title, subject, files[0]);
			title = "";
			subject = "";
			files = undefined;
			await load();
			if (view === "homework") {
				selectedId =
					items.find((item) => !previousIds.has(item.homework?.id))?.homework?.id ?? selectedId;
				creating = false;
				detailOpen = !!selectedId;
			}
		});
	}
	async function fetchPreview(item: Homework) {
		const blob = await runtime.services.homework.download(item.homework!.id);
		clearPreview();
		// Text generated from the questions is not instructions; show none.
		if (blob.type === "text/plain") previewText = item.textFromQuestions ? "" : await blob.text();
		else preview = URL.createObjectURL(blob);
		previewType = blob.type;
		previewTitle = item.homework!.title;
		previewLoaded = true;
	}
	async function show(item: Homework) {
		await run(() => fetchPreview(item));
	}
	function remove(item: Homework) {
		if (busy) return;
		deleteTarget = item;
		deleteError = "";
		deleteOpen = true;
	}
	async function confirmDelete() {
		const item = deleteTarget;
		if (!item || busy) return;
		await run(async () => {
			try {
				await runtime.services.homework.delete(item.homework!.id);
			} catch (cause) {
				deleteError =
					cause instanceof Error ? cause.message : "Could not delete homework. Please retry.";
				return;
			}
			deleteOpen = false;
			clearPreview();
			await load();
			editing = false;
			if (!selectedId) detailOpen = false;
			else if (view === "homework" && selected) await fetchPreview(selected);
		});
	}
</script>

{#snippet errors()}
	{#if error}<ErrorToast message={error} />
		<Button icon={UiRefreshCw} variant="ghost" disabled={busy} onclick={() => run(load)}
			>Reload homework</Button
		>{/if}
{/snippet}
{#snippet composeForm()}
	<p>Upload a photographed worksheet or PDF. JPEG, PNG or PDF, up to 10 MiB and 20 pages.</p>
	<form onsubmit={upload}>
		<Input label="Homework title" bind:value={title} />
		<Input label="Homework subject" bind:value={subject} />
		<label class="file-label"
			>Worksheet file<input
				type="file"
				accept="image/jpeg,image/png,application/pdf"
				bind:files
				disabled={busy}
			/></label
		>
		<Button icon={UiUpload} type="submit" disabled={busy}
			>{busy ? "Working…" : "Upload homework"}</Button
		>
	</form>
{/snippet}
{#snippet answerKey(item: Homework)}
	{#if item.answerKey.length}<details class="answer-key">
			<summary>Answer key and explanations · Guardians only</summary
			>{#each item.answerKey as entry, i (i)}<div>
					<strong>{i + 1}. {entry.question}</strong>
					<p>Answer: {answerSummary(entry)}</p>
					<p>{entry.explanation}</p>
				</div>{/each}
		</details>{/if}
{/snippet}
{#snippet itemDetails(item: Homework)}
	<div class="homework-row">
		<span
			>{item.homework!.title} · {item.homework!.subject} · {item.sources[0]?.pageCount} page(s)</span
		>
		{@render answerKey(item)}
		{#if item.sources[0]?.emailProvenance}
			{@const provenance = item.sources[0].emailProvenance!}
			<span
				>Email: {provenance.sender || "Sender not provided"} · {provenance.sentAt ||
					"Date not provided"} · {provenance.partName}</span
			>
		{/if}
		<Button icon={UiEye} variant="ghost" disabled={busy} onclick={() => show(item)}
			>Preview {item.homework!.title}</Button
		>
		<Button icon={UiTrash2} variant="ghost" disabled={busy} onclick={() => remove(item)}
			>Delete {item.homework!.title}</Button
		>
		<Button
			icon={UiFilePenLine}
			variant="ghost"
			disabled={busy}
			onclick={() => {
				reviewId = reviewId === item.homework!.id ? "" : item.homework!.id;
			}}>Review text {item.homework!.title}</Button
		>
		<Button
			icon={UiBookOpen}
			variant="ghost"
			disabled={busy}
			onclick={() => {
				practiceId = practiceId === item.homework!.id ? "" : item.homework!.id;
			}}>Practice {item.homework!.title}</Button
		>
	</div>
	{#if reviewId === item.homework!.id && item.sources[0]?.source}
		{#key item.sources[0].source!.version}<ExtractionReview
				source={item.sources[0].source!}
				onconfirmed={load}
			/>{/key}
	{/if}
	{#if practiceId === item.homework!.id && item.sources[0]?.source}
		{#key item.sources[0].source!.version}<PracticeWorkspace
				source={item.sources[0].source!}
				subject={item.homework!.subject}
				onsourcechanged={load}
			/>{/key}
	{/if}
{/snippet}
{#snippet filePreview()}
	{#if previewLoaded}
		<section aria-label="Homework preview">
			{#if view !== "homework"}<h3>{previewTitle}</h3>{/if}
			{#if previewType === "text/plain"}{#if view === "homework"}<HomeworkDocumentPreview
						text={previewText}
					/>{:else}<pre>{previewText}</pre>{/if}{:else if previewType === "application/pdf"}<iframe
					title="PDF page preview"
					src={preview}
				></iframe>{:else}<img src={preview} alt={`Worksheet preview: ${previewTitle}`} />{/if}
			{#if view !== "homework"}<Button icon={UiX} variant="ghost" onclick={clearPreview}
					>Close preview</Button
				>{/if}
		</section>
	{/if}
{/snippet}

{#if view === "homework"}
	<section
		bind:this={browserPanel}
		style:--list-width={`${leftWidth}%`}
		class="homework-browser"
		class:detail-open={detailOpen}
		aria-label="Homework workspace"
	>
		<aside class="homework-list" aria-label="Homework list">
			<div class="list-toolbar">
				<div class="search-field">
					<Search size={16} aria-hidden="true" /><input
						type="search"
						aria-label="Search homework"
						placeholder="Search… title: or subject:"
						bind:value={search}
						onkeydown={(event) => {
							if (event.key === "Escape") search = "";
						}}
					/>
				</div>
				<IconButton
					icon={Plus}
					label="Add homework"
					disabled={busy}
					onclick={() => {
						creating = true;
						editing = false;
						detailOpen = true;
						clearPreview();
					}}
				/>
			</div>
			{#if !detailOpen}{@render errors()}{/if}
			<ul aria-label="Homework assignments">
				{#each filtered as item (item.homework!.id)}
					<li class="assignment-row" class:current={selectedId === item.homework!.id && !creating}>
						<button
							class="assignment"
							aria-label={`${item.homework!.title} ${item.homework!.subject || "No subject"}`}
							aria-describedby={`homework-meta-${item.homework!.id}`}
							aria-pressed={selectedId === item.homework!.id && !creating}
							disabled={busy}
							onclick={() => choose(item)}
							><strong title={item.homework!.title}>{item.homework!.title}</strong>
							<span class="assignment-meta" id={`homework-meta-${item.homework!.id}`}>
								<span class="assignment-byline" title={byline(item)}>{byline(item)}</span>
								{#if creationTime(item)}<time
										datetime={item.homework!.createdAt}
										title={creationTime(item)}>{creationTime(item, true)}</time
									>{/if}
							</span>
						</button>
						<Menu.Root>
							<Menu.Trigger
								class="homework-menu-trigger"
								aria-label={`Actions for ${item.homework!.title}`}
								disabled={busy}><MoreHorizontal size={18} aria-hidden="true" /></Menu.Trigger
							>
							<Menu.Portal
								><Menu.Content
									class="homework-row-menu"
									sideOffset={4}
									align="end"
									collisionPadding={8}
									onCloseAutoFocus={(event) => {
										if (deleteOpen) event.preventDefault();
									}}
								>
									<Menu.Item class="homework-menu-item" onSelect={() => openEdit(item)}
										><UiFilePenLine size={15} aria-hidden="true" />Edit</Menu.Item
									>
									<Menu.Item class="homework-menu-item" onSelect={() => openQuestions(item)}
										><UiListChecks size={15} aria-hidden="true" />Questions</Menu.Item
									>
									<Menu.Item class="homework-menu-item" onSelect={() => remove(item)}
										><UiTrash2 size={15} aria-hidden="true" />Delete</Menu.Item
									>
								</Menu.Content></Menu.Portal
							>
						</Menu.Root>
					</li>
				{:else}<li class="empty-list">
						{busy
							? "Loading homework…"
							: search
								? "No homework matches your search."
								: "No homework yet. Use + to add one."}
					</li>{/each}
			</ul>
		</aside>
		<!-- A focusable separator is the ARIA window splitter pattern. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
		<div
			class="splitter"
			class:resizing
			role="separator"
			aria-label="Resize homework list"
			aria-orientation="vertical"
			aria-valuemin={20}
			aria-valuemax={65}
			aria-valuenow={Math.round(leftWidth)}
			tabindex="0"
			onkeydown={resizeWithKeyboard}
			onpointerdown={(event) => {
				if (event.button !== 0) return;
				event.preventDefault();
				resizing = true;
				event.currentTarget.setPointerCapture(event.pointerId);
			}}
			onpointermove={dragSplitter}
			onpointerup={() => (resizing = false)}
			onpointercancel={() => (resizing = false)}
			onlostpointercapture={() => (resizing = false)}
		></div>
		<section class="homework-detail" aria-label="Homework details">
			{#if creating || selected}
				<div class="detail-toolbar">
					<span class="mobile-back"
						><IconButton
							icon={ArrowLeft}
							label="Back to homework list"
							onclick={() => (detailOpen = false)}
						/></span
					>
					<div class="detail-title">
						<h3>
							{creating ? "New homework" : editing ? "Edit homework" : selected?.homework?.title}
						</h3>
						{#if selected && !creating && (creationTime(selected) || selected.homework!.uploadedBy)}<p
								class="creation-meta"
							>
								{#if creationTime(selected)}Created <time datetime={selected.homework!.createdAt}
										>{creationTime(selected)}</time
									>{/if}{#if selected.homework!.uploadedBy}{creationTime(selected) ? " · " : ""}by {creatorName(
										selected,
									)}{/if}
							</p>{/if}
					</div>
					{#if creating}<IconButton
							icon={UiX}
							label="Cancel new homework"
							disabled={busy}
							onclick={cancelNew}
						/>{/if}
					{#if selected && !creating && !editing && questionsId}
						<IconButton
							icon={UiPencil}
							label="Edit questions"
							disabled={busy}
							onclick={() => void openEdit(selected!)}
						/>
						<IconButton
							icon={UiSend}
							label="Assign to child"
							disabled={busy || !questionsReady(selected.answerKey)}
							onclick={() => void assignQuestions(selected!)}
						/>
					{:else if selected && !creating && !editing}
						<IconButton
							icon={UiBookOpen}
							label="Prepare practice"
							disabled={busy}
							onclick={() => {
								practiceId = practiceId ? "" : selected!.homework!.id;
								reviewId = "";
							}}
						/>
					{/if}
				</div>
				<div
					class="detail-body"
					class:creating
					class:editing
					class:document-preview={!creating &&
						!editing &&
						!practiceId &&
						!reviewId &&
						!questionsId &&
						previewLoaded}
				>
					{#if detailOpen}{@render errors()}{/if}
					{#if creating}<HomeworkCreator
							{profileId}
							oncreated={async () => {
								const previous = new Set(items.map((item) => item.homework?.id));
								await load();
								selectedId =
									items.find((item) => !previous.has(item.homework?.id))?.homework?.id ??
									selectedId;
								creating = false;
								detailOpen = !!selectedId;
								if (selected) await choose(selected);
							}}
						/>{:else if editing && selected}
						{#key selected.homework!.id}<HomeworkEdit
								item={selected}
								content={editContent}
								onsaved={(updated) => {
									items = items.map((item) =>
										item.homework!.id === updated.homework!.id ? updated : item,
									);
									editing = false;
									if (editFromQuestions) openQuestions(updated);
									else void choose(updated);
								}}
								oncancel={() => {
									editing = false;
									if (selected && editFromQuestions) openQuestions(selected);
									else if (selected) void choose(selected);
								}}
							/>{/key}
					{:else if selected}
						{#if questionsId}<AssignedQuestions item={selected} />
						{:else if reviewId && selected.sources[0]?.source}<ExtractionReview
								source={selected.sources[0].source!}
								onconfirmed={load}
							/>
						{:else if practiceId && selected.sources[0]?.source}{#key selected.sources[0].source!.version}<PracticeWorkspace
									source={selected.sources[0].source!}
									subject={selected.homework!.subject}
									onsourcechanged={load}
								/>{/key}
						{:else if previewLoaded}
							{#if previewType !== "text/plain"}
								{#key selected.homework!.id}<HomeworkSourceReview
										item={selected}
										rawUrl={preview}
										rawType={previewType}
										rawText={previewText}
										onsaved={replaceItem}
									/>{/key}
							{:else}{@render filePreview()}{/if}
						{:else if !busy}<Button icon={UiEye} variant="ghost" onclick={() => show(selected!)}
								>Open preview</Button
							>{/if}
					{/if}
				</div>
			{:else}<div class="detail-empty">
					<p>Select homework to view its details, or use + to add a new assignment.</p>
				</div>{/if}
		</section>
	</section>
{:else}
	<Card>
		<h3>{view === "history" ? "Homework history" : "Homework"}</h3>
		{#if view === "history"}<p>
				Review your child's saved homework, preview files, and prepare learning activities.
			</p>{/if}
		{@render errors()}
		{#if view !== "history"}{@render composeForm()}{/if}
		{#if view === "history" && !busy && !error && !items.length}<p>No homework yet.</p>{/if}
		{#each items as item (item.homework!.id)}{@render itemDetails(item)}{/each}
		{@render filePreview()}
	</Card>
{/if}

<AlertDialog.Root bind:open={deleteOpen}>
	<AlertDialog.Portal>
		<AlertDialog.Overlay class="homework-delete-overlay" />
		<AlertDialog.Content
			class="homework-delete-dialog"
			onCloseAutoFocus={(event) => {
				if (!browserPanel) return;
				event.preventDefault();
				const trigger = Array.from(
					browserPanel?.querySelectorAll<globalThis.HTMLButtonElement>(".homework-menu-trigger") ??
						[],
				).find(
					(button) =>
						button.getAttribute("aria-label") === `Actions for ${deleteTarget?.homework?.title}`,
				);
				if (trigger && !trigger.disabled) trigger.focus();
				else
					browserPanel?.querySelector<globalThis.HTMLInputElement>('input[type="search"]')?.focus();
			}}
			onOpenAutoFocus={(event) => {
				event.preventDefault();
				document.querySelector<globalThis.HTMLButtonElement>(".homework-delete-cancel")?.focus();
			}}
			onEscapeKeydown={(event) => {
				if (busy) event.preventDefault();
			}}
		>
			<div class="delete-symbol">
				<UiTrash2 size={24} strokeWidth={1.5} aria-hidden="true" />
			</div>
			<AlertDialog.Title class="homework-delete-title">Delete homework?</AlertDialog.Title>
			<AlertDialog.Description class="homework-delete-description"
				>Delete “{deleteTarget?.homework?.title}”? Its practice and learning history will also be
				removed. This cannot be undone.</AlertDialog.Description
			>
			<ErrorToast message={deleteError} />
			<div class="delete-actions">
				<AlertDialog.Cancel class="homework-delete-cancel" disabled={busy}
					>Cancel</AlertDialog.Cancel
				>
				<button
					class="homework-delete-confirm"
					type="button"
					disabled={busy}
					onclick={confirmDelete}>{busy ? "Deleting…" : "Delete"}</button
				>
			</div>
		</AlertDialog.Content>
	</AlertDialog.Portal>
</AlertDialog.Root>

<style>
	:global(.homework-delete-overlay) {
		position: fixed;
		inset: 0;
		z-index: 200;
		background: rgb(0 0 0 / 35%);
		backdrop-filter: blur(4px);
	}
	:global(.homework-delete-dialog) {
		position: fixed;
		top: 50%;
		left: 50%;
		z-index: 201;
		transform: translate(-50%, -50%);
		box-sizing: border-box;
		width: min(390px, calc(100vw - 32px));
		padding: 24px;
		border: 1px solid var(--v-border);
		border-radius: 16px;
		background: var(--v-glass, var(--v-surface));
		backdrop-filter: blur(24px) saturate(120%);
		color: var(--v-fg);
		outline: none;
		animation: delete-dialog-in 150ms ease-out;
	}
	.delete-symbol {
		color: var(--v-danger);
		margin-bottom: 16px;
	}
	:global(.homework-delete-title) {
		margin: 0 0 10px;
		font-size: 1.1rem;
		font-weight: 600;
	}
	:global(.homework-delete-description) {
		margin: 0;
		color: var(--v-muted);
		font-size: 0.8rem;
		line-height: 1.6;
		overflow-wrap: anywhere;
	}
	.delete-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 24px;
	}
	:global(.homework-delete-cancel),
	.homework-delete-confirm {
		padding: 8px 16px;
		min-height: 36px;
		border: 1px solid var(--v-border);
		border-radius: 8px;
		background: transparent;
		color: var(--v-fg);
		font: inherit;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.homework-delete-confirm {
		background: var(--v-danger);
		border-color: var(--v-danger);
		color: white;
	}
	.homework-delete-confirm:disabled {
		opacity: 0.6;
		cursor: wait;
	}
	@keyframes delete-dialog-in {
		from {
			opacity: 0;
			transform: translate(-50%, calc(-50% + 8px));
		}
		to {
			opacity: 1;
			transform: translate(-50%, -50%);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.homework-delete-dialog) {
			animation: none;
		}
	}

	.homework-browser {
		display: grid;
		grid-template-columns: minmax(0, var(--list-width, 20%)) 1px minmax(0, 1fr);
		height: 100%;
		min-height: 0;
		min-width: 0;
	}
	.homework-list {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
	}
	.splitter {
		position: relative;
		background: var(--v-border);
		cursor: col-resize;
		touch-action: none;
		z-index: 2;
	}
	.splitter::before {
		content: "";
		position: absolute;
		inset: 0 -5px;
	}
	.splitter:hover,
	.splitter:focus-visible,
	.splitter.resizing {
		background: var(--v-accent, #8dccf4);
		outline: none;
	}
	.list-toolbar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 12px;
		border-bottom: 1px solid var(--v-border);
		flex-shrink: 0;
	}
	.search-field {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-width: 0;
		padding-inline: 8px;
		color: var(--v-muted);
	}
	.search-field input {
		width: 100%;
		min-width: 0;
		border: 0;
		outline: none;
		background: transparent;
		height: 28px !important;
		min-height: 28px !important;
		padding: 4px 0;
		font-size: 0.8rem;
	}
	.homework-list ul {
		overflow-y: auto;
		min-height: 0;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.assignment-row {
		display: flex;
		align-items: center;
		min-width: 0;
		border-bottom: 1px solid var(--v-border);
	}
	.assignment-row.current {
		background: color-mix(in srgb, var(--v-fg) 4%, transparent);
	}
	.assignment-row .assignment {
		flex: 1;
		min-width: 0;
	}
	:global(.homework-menu-trigger) {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 28px;
		height: 32px;
		margin-right: 6px;
		padding: 0;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: var(--v-muted);
		cursor: pointer;
	}
	:global(.homework-menu-trigger:hover) {
		background: transparent;
		color: var(--v-fg);
	}
	:global(.homework-row-menu) {
		z-index: 120;
		min-width: 140px;
		padding: 4px;
		border: 1px solid var(--v-border);
		border-radius: 8px;
		background: color-mix(in srgb, var(--v-surface) 88%, transparent);
		backdrop-filter: blur(20px);
		color: var(--v-fg);
	}
	:global(.homework-menu-item) {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 9px 12px;
		border-radius: 5px;
		font-size: 0.8rem;
		cursor: pointer;
		outline: none;
	}
	:global(.homework-menu-item[data-highlighted]) {
		background: color-mix(in srgb, var(--v-fg) 7%, transparent);
	}
	.assignment {
		display: grid;
		width: 100%;
		gap: 3px;
		min-height: 56px;
		padding: 7px 12px;
		text-align: left;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--v-fg);
		font: inherit;
		cursor: pointer;
	}
	.assignment strong {
		line-height: 1.3;
		font-size: 0.8rem;
		font-weight: 500;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.assignment-meta {
		display: grid;
		gap: 2px;
		min-width: 0;
		color: var(--v-muted);
		font-size: 0.65rem;
		line-height: 1.3;
		font-weight: 300;
	}
	.assignment-byline,
	.assignment-meta time {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.detail-title {
		flex: 1;
		min-width: 0;
	}
	.creation-meta {
		margin: 4px 0 0;
		font-size: 0.68rem;
		font-weight: 300;
		line-height: 1.4;
		color: var(--v-muted);
	}
	.empty-list {
		padding: 16px;
		color: var(--v-muted);
		font-size: 0.8rem;
	}
	.homework-detail {
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.detail-toolbar {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 12px 4px 20px;
		border-bottom: 1px solid var(--v-border);
		flex-shrink: 0;
	}
	@media (pointer: fine) {
		.detail-toolbar :global(.v-icon-btn) {
			width: 32px;
			min-width: 32px;
			height: 32px;
		}
	}
	.detail-toolbar > :global(.v-icon-btn::after) {
		left: auto;
		right: 0;
		transform: none;
	}
	.detail-toolbar h3 {
		flex: 1;
		margin: 0;
		font-size: 1rem;
		overflow-wrap: anywhere;
	}
	.detail-body {
		display: grid;
		align-content: start;
		gap: 16px;
		overflow-y: auto;
		min-height: 0;
		padding: 20px;
	}
	.detail-body.creating {
		flex: 1;
		display: flex;
		flex-direction: column;
	}
	/* clip, not hidden: WebKit still scrolls hidden boxes to reveal the caret,
	   which slides the document header out of view while typing. */
	.detail-body.creating:has(:global(.editor-mode)) {
		padding: 0;
		overflow: clip;
	}
	.detail-body.editing,
	.detail-body.document-preview {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		padding: 0;
		overflow: clip;
	}
	.document-preview > .answer-key {
		flex-shrink: 0;
		max-height: 40%;
		overflow: auto;
		padding: 8px 16px;
	}
	.document-preview > section {
		overflow: auto;
		flex: 1;
		min-height: 0;
		min-width: 0;
	}
	.detail-empty {
		display: grid;
		place-content: center;
		height: 100%;
		padding: 24px;
		text-align: center;
	}
	.mobile-back {
		display: none;
	}
	@media (max-width: 760px) {
		.homework-browser {
			grid-template-columns: minmax(0, 1fr);
		}
		.splitter {
			display: none;
		}
		.homework-detail {
			display: none;
		}
		.homework-browser.detail-open .homework-list {
			display: none;
		}
		.homework-browser.detail-open .homework-detail {
			display: flex;
		}
		.mobile-back {
			display: inline-flex;
		}
		.detail-toolbar {
			padding: 8px 12px;
		}
		.detail-body {
			padding: 16px 12px;
		}
	}
	form {
		display: grid;
		gap: var(--v-space);
	}
	p {
		color: var(--v-muted);
	}
	.file-label {
		display: grid;
		gap: var(--v-space);
		font-weight: 600;
	}
	input {
		color: var(--v-fg);
		max-width: 100%;
	}
	.homework-row {
		display: flex;
		gap: var(--v-space);
		flex-wrap: wrap;
		align-items: center;
		padding-block: var(--v-space);
		border-bottom: 1px solid var(--v-border);
	}
	pre {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font: inherit;
	}
	img,
	iframe {
		width: 100%;
		max-width: 100%;
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius-sm);
	}
	img {
		object-fit: contain;
		max-height: 70vh;
	}
	iframe {
		height: 65vh;
		background: var(--v-bg);
	}
</style>
