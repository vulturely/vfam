<script lang="ts">
	import UiRefreshCw from "lucide-svelte/icons/refresh-cw";
	import UiTrash2 from "lucide-svelte/icons/trash-2";
	import UiPlus from "lucide-svelte/icons/plus";
	import UiCalendarCheck from "lucide-svelte/icons/calendar-check";
	import UiLogIn from "lucide-svelte/icons/log-in";
	import UiX from "lucide-svelte/icons/x";
	import UiChevronDown from "lucide-svelte/icons/chevron-down";
	import { Dialog } from "bits-ui";
	import { onMount } from "svelte";
	import { Button, ErrorToast, IconButton } from "../components/index";
	import type { TimetableService } from "../timetable/service";
	import { Timetable, TimetableWindow } from "../api/protocol";
	let {
		service,
		profileId,
		signIn,
		onChange,
	}: {
		service: TimetableService;
		profileId: string;
		signIn: () => Promise<void>;
		onChange?: () => void;
	} = $props();
	const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
	let timezone = $state("UTC");
	let windows = $state<ScheduleWindow[]>([]);
	type ScheduleWindow = { day: number; start: string; end: string; kind: string };
	const kinds: Record<string, string> = { study: "Study", allowed: "Allowed", break: "Break" };
	// Cards are listed by day and start time; each keeps its index for editing and removal.
	const ordered = $derived(
		windows
			.map((w, i) => ({ w, i }))
			.sort((a, b) => a.w.day - b.w.day || a.w.start.localeCompare(b.w.start)),
	);
	let editorOpen = $state(false);
	let editing = $state<number | null>(null);
	let draft = $state<ScheduleWindow>({ day: 0, start: "16:00", end: "17:00", kind: "study" });
	let draftError = $state("");
	function describe(w: ScheduleWindow) {
		return `${days[w.day]} ${kinds[w.kind] ?? w.kind} ${w.start}–${w.end}`;
	}
	function openWindow(index: number | null) {
		editing = index;
		draft =
			index === null
				? { day: 0, start: "16:00", end: "17:00", kind: "study" }
				: { ...windows[index]! };
		draftError = "";
		editorOpen = true;
	}
	// Every change saves the whole timetable straight away.
	async function commit(event: { preventDefault(): void }) {
		event.preventDefault();
		if (busy) return;
		try {
			minute(draft.start);
			minute(draft.end);
		} catch (e) {
			draftError = e instanceof Error ? e.message : "Check the times.";
			return;
		}
		draftError = "";
		const next = { ...draft, day: Number(draft.day) };
		const saved = await persist(
			editing === null ? [...windows, next] : windows.map((w, i) => (i === editing ? next : w)),
		);
		if (saved) editorOpen = false;
		else draftError = error;
	}
	let minutes = $state("15");
	let reason = $state("");
	let overrideUntil = $state<string | undefined>();
	let busy = $state(true),
		loaded = $state(false),
		error = $state(""),
		notice = $state("");
	function clock(n: number) {
		return `${Math.floor(n / 60)
			.toString()
			.padStart(2, "0")}:${(n % 60).toString().padStart(2, "0")}`;
	}
	function accept(t: Timetable) {
		timezone = t.timezone;
		overrideUntil = t.overrideUntil;
		windows = t.windows.map((w) => ({
			day: w.day,
			start: clock(w.start),
			end: w.end === 1440 ? "24:00" : clock(w.end),
			kind: w.kind,
		}));
		loaded = true;
	}
	async function run(action: () => Promise<Timetable>, success = "") {
		busy = true;
		error = "";
		notice = "";
		try {
			accept(await action());
			notice = success;
			if (success) onChange?.();
			return true;
		} catch (e) {
			error = e instanceof Error ? e.message : "Could not update timetable.";
			return false;
		} finally {
			busy = false;
		}
	}
	onMount(() => {
		void run(() => service.get(profileId));
	});
	async function reauthenticate() {
		busy = true;
		error = "";
		try {
			await signIn();
		} catch {
			error = "Could not start guardian sign-in. Please try again.";
		} finally {
			busy = false;
		}
	}
	function minute(v: string) {
		if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v) && v !== "24:00")
			throw new Error("Use HH:MM times (24:00 is midnight at the end of a day).");
		const [h, m] = v.split(":").map(Number);
		return h * 60 + m;
	}
	function persist(next: ScheduleWindow[]) {
		return run(async () => {
			const t = new Timetable({
				timezone,
				windows: next.map(
					(w) =>
						new TimetableWindow({
							day: Number(w.day),
							start: minute(w.start),
							end: minute(w.end),
							kind: w.kind,
						}),
				),
			});
			return service.save(profileId, t);
		}, "Timetable saved. Any temporary override has ended.");
	}
</script>

<section aria-label="Weekly rules and parent override">
	<p class="help">
		Weekly rules repeat in the profile timezone: {timezone}. Breaks take priority.
	</p>
	<ErrorToast message={error} />
	{#if notice}<p role="status">{notice}</p>{/if}
	{#if !loaded && !busy}
		<IconButton
			icon={UiRefreshCw}
			label="Retry timetable"
			onclick={() => void run(() => service.get(profileId))}
		/>
	{/if}
	<div class="schedule">
		<fieldset disabled={busy || !loaded}>
			<div class="section-heading">
				<h3>Weekly schedule</h3>
				<div class="actions">
					<IconButton
						icon={UiPlus}
						label="Add window"
						disabled={windows.length >= 100}
						onclick={() => openWindow(null)}
					/>
				</div>
			</div>
			{#if windows.length}<ul class="rules" aria-label="Weekly windows">
					{#each ordered as { w, i } (i)}
						<li class="window {w.kind}">
							<button
								type="button"
								class="window-open"
								aria-label={`Edit ${describe(w)}`}
								onclick={() => openWindow(i)}
								><strong>{days[w.day]}</strong><span class="kind">{kinds[w.kind] ?? w.kind}</span
								><span class="range">{w.start}–{w.end}</span></button
							>
							<span class="window-delete"
								><IconButton
									icon={UiTrash2}
									label={`Delete ${describe(w)}`}
									onclick={() => void persist(windows.filter((_, j) => j !== i))}
								/></span
							>
						</li>
					{/each}
				</ul>
			{:else}<p class="empty">No weekly windows. Add one to allow scheduled activities.</p>{/if}
			<p class="help">
				Without windows, activities are blocked. Help and parent unlock stay available. Changes save
				straight away and end any override.
			</p>
		</fieldset>
	</div>
	<form
		class="override"
		onsubmit={(e) => {
			e.preventDefault();
			void run(
				() => service.override(profileId, Number(minutes), reason),
				"Temporary override granted and audited.",
			);
		}}
	>
		<fieldset disabled={busy || !loaded}>
			<div class="section-heading">
				<h3>Temporary parent override</h3>
				<div class="actions">
					<IconButton
						icon={UiLogIn}
						label="Fresh guardian sign-in"
						onclick={() => void reauthenticate()}
					/>
					<IconButton
						icon={UiCalendarCheck}
						label="Grant override"
						type="submit"
						disabled={!reason.trim()}
					/>
				</div>
			</div>
			{#if overrideUntil}<p class="help">
					Override ends: {new Date(overrideUntil).toLocaleString()}
				</p>{/if}
			<div class="joined override-fields">
				<label
					>Minutes<input
						aria-label="Override minutes (1–60)"
						type="number"
						min="1"
						max="60"
						required
						bind:value={minutes}
					/></label
				>
				<label
					>Reason<input
						aria-label="Override reason"
						placeholder="Why is extra time needed?"
						required
						bind:value={reason}
					/></label
				>
			</div>
			<p class="help">
				Allow 1–60 extra minutes. Requires a guardian sign-in within the last five minutes; sign in
				again if prompted, then grant access here.
			</p>
		</fieldset>
	</form>
</section>

<Dialog.Root bind:open={editorOpen}>
	<Dialog.Portal>
		<Dialog.Overlay class="window-dialog-overlay" />
		<Dialog.Content class="window-dialog">
			<Dialog.Close class="window-dialog-close" aria-label="Close"
				><UiX size={18} aria-hidden="true" /></Dialog.Close
			>
			<Dialog.Title class="window-dialog-title"
				>{editing === null ? "Add window" : "Edit window"}</Dialog.Title
			>
			<Dialog.Description class="window-dialog-description"
				>Choose the day, the activity and its time range. Times repeat every week in {timezone}.</Dialog.Description
			>
			<form class="window-form" onsubmit={commit}>
				<div class="form-group">
					<div class="form-row">
						<span class="row-label" id="window-day-label">Day</span>
						<div class="day-pills" role="radiogroup" aria-labelledby="window-day-label">
							{#each days as day, i (day)}<button
									type="button"
									role="radio"
									aria-checked={Number(draft.day) === i}
									aria-label={day}
									class:selected={Number(draft.day) === i}
									onclick={() => (draft.day = i)}>{day.charAt(0)}</button
								>{/each}
						</div>
					</div>
					<div class="form-row">
						<span class="row-label" id="window-kind-label">Activity</span>
						<span class="select-wrap"
							><select aria-labelledby="window-kind-label" bind:value={draft.kind}>
								{#each Object.entries(kinds) as [value, label] (value)}<option {value}
										>{label}</option
									>{/each}
							</select><UiChevronDown size={14} aria-hidden="true" /></span
						>
					</div>
					<div class="form-row">
						<span class="row-label">Time</span>
						<div class="time-range">
							<input
								aria-label="Start"
								bind:value={draft.start}
								placeholder="16:00"
								inputmode="numeric"
								maxlength="5"
							/><span aria-hidden="true">–</span><input
								aria-label="End"
								bind:value={draft.end}
								placeholder="17:00"
								inputmode="numeric"
								maxlength="5"
							/>
						</div>
					</div>
				</div>

				{#if draftError}<p class="draft-error" role="alert">{draftError}</p>{/if}
				<div class="sheet-actions">
					<p class="help">Use 24-hour HH:MM times; 24:00 ends a day at midnight.</p>
					<Button variant="ghost" type="submit" disabled={busy}>Save</Button>
				</div>
			</form>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	section,
	fieldset {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
	}
	fieldset {
		border: 0;
		margin: 0;
		padding: 0;
	}
	.section-heading,
	.actions {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		min-width: 0;
	}
	.section-heading {
		justify-content: space-between;
	}
	h3 {
		margin: 0;
		font-size: 0.85rem;
		font-weight: 600;
	}
	p {
		margin: 0;
		color: var(--v-muted);
	}
	.help,
	.empty {
		font-size: 0.72rem;
		line-height: 1.5;
		font-weight: 400;
	}
	.empty {
		padding: 0.75rem 0;
	}
	.rules {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 0.5rem;
		max-height: 36vh;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		list-style: none;
	}
	.window {
		position: relative;
		display: flex;
		min-width: 0;
		padding: 0.5rem 2rem 0.5rem 0.65rem;
		border: 1px solid var(--v-border);
		border-left: 3px solid var(--v-primary);
		border-radius: 8px;
	}
	.window.break {
		border-left-color: var(--v-danger, #d14343);
	}
	.window.allowed {
		border-left-color: var(--v-success, #2f9e6b);
	}
	.window-open {
		display: grid;
		flex: 1;
		gap: 0.1rem;
		min-width: 0;
		padding: 0;
		border: 0;
		background: none;
		color: var(--v-fg);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.window-delete {
		position: absolute;
		top: 2px;
		right: 2px;
	}
	.window-open strong {
		font-size: 0.8rem;
	}
	.window-open .kind,
	.window-open .range {
		color: var(--v-muted);
		font-size: 0.72rem;
	}
	.window-open .range {
		font-variant-numeric: tabular-nums;
	}
	.joined {
		display: grid;
		grid-template-columns: 1fr 1fr;
		min-width: 0;
		border: 1px solid var(--v-border);
		border-radius: 7px;
		background: color-mix(in srgb, var(--v-fg) 3%, transparent);
	}
	label {
		display: grid;
		min-width: 0;
		padding: 0.35rem 0.6rem;
		gap: 0.1rem;
		color: var(--v-muted);
		font-size: 0.65rem;
	}
	label + label {
		border-left: 1px solid var(--v-border);
	}
	input {
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
		padding: 0.15rem 0;
		border: 0;
		outline: none;
		border-radius: 0;
		font: inherit;
		font-size: 0.8rem;
		color: var(--v-fg);
		background: transparent;
	}
	input:focus-visible {
		box-shadow: 0 1px 0 var(--v-primary);
	}
	.override {
		border-top: 1px solid var(--v-border);
		padding-top: 0.75rem;
	}
	.override-fields {
		grid-template-columns: minmax(70px, 1fr) 3fr;
	}
	[role="status"] {
		font-size: 0.8rem;
	}
	.actions :global(.v-icon-btn::after),
	.window :global(.v-icon-btn::after) {
		left: auto;
		right: 0;
		transform: none;
	}
	/* Matches the FamBuddy settings sheet. */
	:global(.window-dialog-overlay) {
		position: fixed;
		inset: 0;
		z-index: 100;
		background: rgba(8, 13, 24, 0.48);
		backdrop-filter: blur(8px);
	}
	:global(.window-dialog) {
		position: fixed;
		top: 50%;
		left: 50%;
		z-index: 101;
		display: grid;
		gap: calc(var(--v-space) * 1.5);
		box-sizing: border-box;
		width: min(640px, calc(100vw - 32px));
		max-height: calc(100dvh - 32px);
		overflow-y: auto;
		transform: translate(-50%, -50%);
		padding: 28px;
		border: 1px solid color-mix(in srgb, var(--v-fg) 10%, transparent);
		border-radius: 22px;
		background: color-mix(in srgb, var(--v-surface) 92%, transparent);
		backdrop-filter: blur(28px) saturate(150%);
		box-shadow: 0 24px 80px rgba(0, 0, 0, 0.28);
		color: var(--v-fg);
		outline: none;
	}
	:global(.window-dialog-title) {
		margin: 0;
		padding-right: 32px;
		font-size: 1.1rem;
		font-weight: 650;
	}
	:global(.window-dialog-description) {
		margin: 0;
		color: var(--v-muted);
		font-size: 0.875rem;
		line-height: 1.55;
	}
	:global(.window-dialog-close) {
		position: absolute;
		top: 12px;
		right: 12px;
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		padding: 0;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: var(--v-muted);
		cursor: pointer;
	}
	.window-form {
		display: grid;
		gap: 0.5rem;
	}
	.form-group {
		border-radius: 12px;
		background: color-mix(in srgb, var(--v-fg) 4%, transparent);
		overflow: hidden;
	}
	.form-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		min-height: 52px;
		padding: 0.5rem 0.75rem 0.5rem 1rem;
	}
	.form-row + .form-row {
		border-top: 1px solid color-mix(in srgb, var(--v-fg) 8%, transparent);
	}
	.row-label {
		color: var(--v-fg);
		font-size: 0.95rem;
	}
	.day-pills {
		display: grid;
		grid-template-columns: repeat(7, 32px);
		gap: 0.3rem;
	}
	.day-pills button {
		width: 100%;
		aspect-ratio: 1;
		padding: 0;
		border: 0;
		border-radius: 999px;
		background: color-mix(in srgb, var(--v-fg) 7%, transparent);
		color: var(--v-fg);
		font: inherit;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
	}
	.select-wrap {
		position: relative;
		display: inline-flex;
		align-items: center;
		color: var(--v-muted);
	}
	.select-wrap select {
		width: auto;
		min-width: 8rem;
		padding: 0.4rem 2rem 0.4rem 0.75rem;
		border: 0;
		border-radius: 8px;
		appearance: none;
		background: color-mix(in srgb, var(--v-fg) 7%, transparent);
		color: var(--v-fg);
		font: inherit;
		font-size: 0.95rem;
		cursor: pointer;
	}
	.select-wrap select:focus,
	.select-wrap select:focus-visible {
		outline: none;
		box-shadow: none;
		background: color-mix(in srgb, var(--v-fg) 12%, transparent);
	}
	.select-wrap select option {
		background: var(--v-surface, var(--v-bg));
		color: var(--v-fg);
	}
	.select-wrap :global(svg) {
		position: absolute;
		right: 0.65rem;
		pointer-events: none;
	}
	.day-pills button.selected {
		background: var(--v-primary);
		color: var(--v-primary-fg, #fff);
	}
	.day-pills button:focus-visible {
		outline: 2px solid var(--v-ring, var(--v-primary));
		outline-offset: 2px;
	}
	.time-range {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--v-muted);
	}
	.time-range input {
		width: 4.75rem;
		padding: 0.4rem 0.5rem;
		border: 0;
		border-radius: 8px;
		background: color-mix(in srgb, var(--v-fg) 7%, transparent);
		color: var(--v-fg);
		font: inherit;
		font-size: 0.95rem;
		font-variant-numeric: tabular-nums;
		text-align: center;
	}
	/* Focus shows as a stronger fill, without an outline ring. */
	.time-range input:focus,
	.time-range input:focus-visible {
		outline: none;
		box-shadow: none;
		background: color-mix(in srgb, var(--v-fg) 12%, transparent);
	}
	.sheet-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	.sheet-actions :global(.v-btn) {
		flex-shrink: 0;
		white-space: nowrap;
	}
	@media (max-width: 520px) {
		:global(.window-dialog) {
			padding: 20px 16px;
		}
		.form-row {
			flex-direction: column;
			align-items: stretch;
			gap: 0.5rem;
			padding: 0.65rem 0.75rem;
		}
		/* Seven pills and three segments share the row width instead of overflowing. */
		.day-pills {
			grid-template-columns: repeat(7, minmax(0, 1fr));
			gap: 0.25rem;
		}
		.day-pills button {
			max-width: 36px;
			justify-self: center;
		}
		.select-wrap select {
			width: 100%;
		}
		.time-range input {
			flex: 1;
			width: auto;
			min-width: 0;
		}
	}
	.draft-error {
		color: var(--v-danger, #d14343);
		font-size: 0.75rem;
	}
</style>
