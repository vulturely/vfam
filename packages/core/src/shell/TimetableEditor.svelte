<script lang="ts">
	import { onMount } from "svelte";
	import CalendarDays from "lucide-svelte/icons/calendar-days";
	import Clock from "lucide-svelte/icons/clock";
	import ArrowLeft from "lucide-svelte/icons/arrow-left";
	import ArrowRight from "lucide-svelte/icons/arrow-right";
	import Plus from "lucide-svelte/icons/plus";
	import X from "lucide-svelte/icons/x";
	import Check from "lucide-svelte/icons/check";
	import Trash from "lucide-svelte/icons/trash-2";
	import RefreshCw from "lucide-svelte/icons/refresh-cw";
	import CalendarCheck from "lucide-svelte/icons/calendar-check";
	import Settings from "lucide-svelte/icons/settings-2";
	import { AlertDialog } from "bits-ui";
	import { IconButton, Button, ErrorToast } from "../components/index";
	import type { TimetableService } from "../timetable/service";
	import type { HomeworkService, Homework } from "../homework/service";
	import { CalendarEntry, type Timetable, type TimetableWindow } from "../api/protocol";
	import {
		activityNames,
		localToday,
		shiftDate,
		shiftMonth,
		monthDays,
		dayBlocks,
		layoutBlocks,
		clock,
		parseTime,
		type CalendarBlock,
	} from "../timetable/calendar";
	import WeeklySchedule from "./WeeklySchedule.svelte";
	let {
		service,
		profileId,
		signIn,
		homework,
	}: {
		service: TimetableService;
		profileId: string;
		signIn: () => Promise<void>;
		homework?: HomeworkService;
	} = $props();
	let timezone = $state("UTC"),
		entries = $state<CalendarEntry[]>([]),
		windows = $state<TimetableWindow[]>([]),
		items = $state<Homework[]>([]);
	let selectedDate = $state(""),
		month = $state(""),
		view = $state<"month" | "day">("month");
	let loading = $state(true),
		busy = $state(false),
		error = $state(""),
		notice = $state(""),
		showWeekly = $state(false),
		editor = $state(false);
	let editId = $state(""),
		entryDate = $state(""),
		start = $state("16:00"),
		end = $state("17:00"),
		kind = $state("study"),
		title = $state(""),
		homeworkId = $state("");
	let deleteOpen = $state(false),
		request = 0;
	const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
	const cells = $derived(month ? monthDays(month) : []);
	const needsHomework = $derived(kind === "homework" || kind === "test");
	function accept(t: Timetable) {
		timezone = t.timezone;
		entries = t.entries ?? [];
		windows = t.windows ?? [];
		if (!selectedDate) {
			selectedDate = localToday(timezone);
			month = selectedDate.slice(0, 7);
		}
	}
	async function load() {
		const id = ++request;
		loading = true;
		error = "";
		try {
			const t = await service.get(profileId);
			if (id === request) accept(t);
		} catch {
			if (id === request) error = "Could not load the calendar. Please try again.";
		} finally {
			if (id === request) loading = false;
		}
	}
	onMount(() => {
		void load();
		return () => {
			request++;
		};
	});
	function dateLabel(value: string, monthly = false) {
		if (!value) return "Calendar";
		return new Intl.DateTimeFormat(
			undefined,
			monthly
				? { month: "long", year: "numeric", timeZone: "UTC" }
				: {
						weekday: "long",
						month: "short",
						day: "numeric",
						year: "numeric",
						timeZone: "UTC",
					},
		).format(new Date(`${value.length === 7 ? value + "-01" : value}T12:00:00Z`));
	}
	function move(delta: number) {
		if (view === "month") month = shiftMonth(month, delta);
		else {
			selectedDate = shiftDate(selectedDate, delta);
			month = selectedDate.slice(0, 7);
		}
	}
	function today() {
		selectedDate = localToday(timezone);
		month = selectedDate.slice(0, 7);
	}
	async function openEditor(
		date = view === "month" && !selectedDate.startsWith(month) ? `${month}-01` : selectedDate,
		hour = 16,
		block?: CalendarBlock,
	) {
		if (busy) return;
		error = "";
		notice = "";
		if (block?.recurring) {
			showWeekly = true;
			return;
		}
		const e = block ? entries.find((e) => e.id === block.sourceId) : undefined;
		editId = e?.id ?? "";
		entryDate = e?.date ?? date;
		start = clock(e?.start ?? hour * 60);
		end = clock(e?.end === 1440 ? 0 : (e?.end ?? ((hour + 1) % 24) * 60));
		kind = e?.kind ?? "study";
		title = e?.title ?? "";
		homeworkId = e?.homeworkId ?? "";
		editor = true;
		if (homework) {
			try {
				items = await homework.list(profileId);
			} catch {
				error = "Could not load homework. You can still schedule time blocks.";
			}
		}
	}
	async function save(event: globalThis.SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		error = "";
		notice = "";
		busy = true;
		try {
			const startMinute = parseTime(start),
				endMinute = parseTime(end);
			if (startMinute === endMinute) throw new Error("Choose different start and end times.");
			const selected = items.find((i) => i.homework?.id === homeworkId)?.homework;
			if (needsHomework && !selected) throw new Error("Choose homework for this activity.");
			const entry = new CalendarEntry({
				id: editId || crypto.randomUUID(),
				date: entryDate,
				start: startMinute,
				end: endMinute,
				kind,
				title: title.trim() || selected?.title || activityNames[kind],
				homeworkId: needsHomework ? homeworkId : undefined,
			});
			const result = await service.saveCalendar(profileId, [
				...entries.filter((e) => e.id !== entry.id),
				entry,
			]);
			accept(result);
			selectedDate = entryDate;
			month = entryDate.slice(0, 7);
			editor = false;
			notice = "Calendar saved.";
		} catch (e) {
			error = e instanceof Error ? e.message : "Could not save the calendar.";
		} finally {
			busy = false;
		}
	}
	async function remove() {
		if (busy || !editId) return;
		busy = true;
		error = "";
		try {
			accept(
				await service.saveCalendar(
					profileId,
					entries.filter((e) => e.id !== editId),
				),
			);
			deleteOpen = false;
			editor = false;
			notice = "Activity removed.";
		} catch {
			deleteOpen = false;
			error = "Could not remove the activity. Please try again.";
		} finally {
			busy = false;
		}
	}
</script>

<section class="calendar" aria-label="Timetable calendar" aria-busy={loading}>
	<header class="toolbar">
		<div class="heading">
			<h3>
				{dateLabel(view === "month" ? month : selectedDate, view === "month")}
			</h3>
			<p>{timezone} · Set in profile settings</p>
		</div>
		<div class="controls">
			<IconButton
				icon={ArrowLeft}
				label={view === "month" ? "Previous month" : "Previous day"}
				disabled={loading || busy || !month}
				onclick={() => move(-1)}
			/><IconButton
				icon={CalendarCheck}
				label="Today"
				disabled={loading || busy || !month}
				onclick={today}
			/><IconButton
				icon={ArrowRight}
				label={view === "month" ? "Next month" : "Next day"}
				disabled={loading || busy || !month}
				onclick={() => move(1)}
			/>
		</div>
		<div class="controls views" aria-label="Calendar views">
			<IconButton
				icon={CalendarDays}
				label="Month view"
				ariaPressed={view === "month"}
				active={view === "month"}
				onclick={() => {
					view = "month";
				}}
			/><IconButton
				icon={Clock}
				label="Day view"
				ariaPressed={view === "day"}
				active={view === "day"}
				onclick={() => {
					view = "day";
				}}
			/><IconButton
				icon={Settings}
				label="Weekly rules and override"
				ariaPressed={showWeekly}
				onclick={() => {
					showWeekly = !showWeekly;
				}}
			/><IconButton
				icon={RefreshCw}
				label="Refresh calendar"
				disabled={loading || busy}
				onclick={() => void load()}
			/><IconButton
				icon={Plus}
				label="Add calendar activity"
				disabled={loading || busy || !month}
				onclick={() => void openEditor()}
			/>
		</div>
	</header>
	<ErrorToast message={error} />
	{#if notice}<p class="message" role="status">
			{notice}
		</p>{/if}
	{#if loading}<p class="loading" role="status">Loading calendar…</p>
	{:else if month}
		<div class="content" class:editing={editor}>
			<div class="calendar-view">
				{#if view === "month"}
					<div class="month" role="group" aria-label={dateLabel(month, true)}>
						{#each weekdays as day (day)}<div class="weekday">{day}</div>{/each}
						{#each cells as date (date)}
							{@const events = dayBlocks(date, entries, windows)}
							<button
								type="button"
								class="day"
								disabled={busy}
								class:outside={!date.startsWith(month)}
								class:today={date === localToday(timezone)}
								class:selected={date === selectedDate}
								aria-label={`${dateLabel(date)}, ${events.length} activities`}
								onclick={() => {
									selectedDate = date;
									month = date.slice(0, 7);
									view = "day";
									editor = false;
								}}
							>
								<span class="day-number">{Number(date.slice(-2))}</span>
								{#each events.slice(0, 2) as event (event.id)}<span
										class="month-event"
										data-kind={event.kind}
										><i></i><span>{clock(event.start)} {event.title}</span></span
									>{/each}
								{#if events.length > 2}<small>+{events.length - 2} more</small>{/if}
							</button>
						{/each}
					</div>
				{:else}
					<div class="day-view" aria-label="Hourly schedule">
						{#each [0, 720] as offset (offset)}
							<div class="half-day">
								<div class="half-heading">
									{offset === 0 ? "AM · 00:00–12:00" : "PM · 12:00–24:00"}
								</div>
								<div class="timeline">
									{#each Array.from({ length: 12 }, (_, hour) => hour + offset / 60) as hour (hour)}
										<button
											class="hour"
											type="button"
											disabled={busy}
											style:top={`${((hour - offset / 60) / 12) * 100}%`}
											aria-label={`Add activity at ${clock(hour * 60)}`}
											onclick={() => void openEditor(selectedDate, hour)}
											><span>{clock(hour * 60)}</span><i></i></button
										>
									{/each}
									<div class="events">
										{#each layoutBlocks(dayBlocks(selectedDate, entries, windows)
												.filter((b) => b.start < offset + 720 && b.end > offset)
												.map( (b) => ({ ...b, start: Math.max(offset, b.start), end: Math.min(offset + 720, b.end) }) )) as block (block.id)}
											<button
												type="button"
												class="event"
												data-kind={block.kind}
												disabled={busy}
												style:top={`${((block.start - offset) / 720) * 100}%`}
												style:height={`${((block.end - block.start) / 720) * 100}%`}
												style:left={`calc(${(block.lane / block.lanes) * 100}% + 2px)`}
												style:width={`calc(${100 / block.lanes}% - 4px)`}
												aria-label={`${block.title}, ${clock(block.start)} to ${clock(block.end)}${block.recurring ? ", weekly" : ""}`}
												title={`${block.title} · ${clock(block.start)} – ${clock(block.end)}`}
												onclick={() => void openEditor(selectedDate, 16, block)}
												><strong>{block.title}</strong>{#if block.end - block.start >= 120}<span
														>{clock(block.start)} – {clock(block.end)}{block.recurring
															? " · Weekly"
															: ""}</span
													>{/if}</button
											>
										{/each}
									</div>
								</div>
							</div>
						{/each}
					</div>
				{/if}
				<div class="legend">
					{#each Object.entries(activityNames) as [key, label] (key)}<span data-kind={key}
							><i></i>{label}</span
						>{/each}
				</div>
			</div>
			{#if editor}
				<aside
					class="editor"
					aria-label={editId ? "Edit calendar activity" : "New calendar activity"}
				>
					<header>
						<h4>{editId ? "Edit activity" : "New activity"}</h4>
						<IconButton
							icon={X}
							label="Close activity editor"
							disabled={busy}
							onclick={() => {
								editor = false;
								error = "";
							}}
						/>
					</header>
					<form onsubmit={save}>
						<label
							>Date<input
								aria-label="Activity date"
								type="date"
								bind:value={entryDate}
								required
								disabled={busy}
							/></label
						>
						<label
							>Activity<select aria-label="Calendar activity" bind:value={kind} disabled={busy}
								>{#each Object.entries(activityNames) as [key, label] (key)}<option value={key}
										>{label}</option
									>{/each}</select
							></label
						>
						{#if needsHomework}<label
								>Homework<select
									aria-label="Scheduled homework"
									bind:value={homeworkId}
									required
									disabled={busy}
									><option value="">Choose homework</option
									>{#each items as item (item.homework!.id)}<option value={item.homework!.id}
											>{item.homework!.title}</option
										>{/each}</select
								></label
							>{#if !items.length}<p class="help">
									Add homework in Assignment before scheduling it here.
								</p>{/if}{/if}
						<label
							>Title<input
								aria-label="Activity title"
								bind:value={title}
								maxlength="160"
								placeholder={activityNames[kind]}
								disabled={busy}
							/></label
						>
						<div class="time-pair">
							<label
								>Start<input
									aria-label="Activity start"
									type="time"
									bind:value={start}
									required
									disabled={busy}
								/></label
							><label
								>End<input
									aria-label="Activity end"
									type="time"
									bind:value={end}
									required
									disabled={busy}
								/></label
							>
						</div>
						<p class="help">
							{timezone}. An earlier end time continues into the next day.
						</p>
						<div class="actions">
							{#if editId}<IconButton
									icon={Trash}
									label="Delete calendar activity"
									disabled={busy}
									onclick={() => {
										deleteOpen = true;
									}}
								/>{:else}<IconButton
									icon={X}
									label="Cancel activity"
									disabled={busy}
									onclick={() => {
										editor = false;
										error = "";
									}}
								/>{/if}<IconButton
								icon={Check}
								label="Save calendar activity"
								type="submit"
								disabled={busy}
							/>
						</div>
					</form>
				</aside>
			{/if}
		</div>
		{#if !editor && !entries.length && !windows.length}<p class="empty">
				Choose a date or hour to schedule time blocks, homework, or tests.
			</p>{/if}
	{/if}
	{#if showWeekly}<div class="weekly">
			<div class="weekly-toolbar">
				<strong>Weekly rules and override</strong><IconButton
					icon={X}
					label="Close weekly rules"
					onclick={() => {
						showWeekly = false;
					}}
				/>
			</div>
			<WeeklySchedule {service} {profileId} {signIn} onChange={() => void load()} />
		</div>{/if}
</section>

<AlertDialog.Root bind:open={deleteOpen}
	><AlertDialog.Portal
		><AlertDialog.Overlay class="calendar-delete-overlay" /><AlertDialog.Content
			class="calendar-delete-dialog"
			><AlertDialog.Title>Delete this activity?</AlertDialog.Title><AlertDialog.Description
				>This removes the scheduled activity. Your homework and test results will be kept.</AlertDialog.Description
			>
			<div class="delete-actions">
				<Button
					variant="ghost"
					disabled={busy}
					onclick={() => {
						deleteOpen = false;
					}}>Cancel</Button
				><Button variant="danger" disabled={busy} onclick={() => void remove()}
					>Delete activity</Button
				>
			</div></AlertDialog.Content
		></AlertDialog.Portal
	></AlertDialog.Root
>

<style>
	.calendar {
		min-width: 0;
		min-height: 0;
		height: 100%;
		display: flex;
		flex-direction: column;
		position: relative;
	}
	.toolbar {
		flex-shrink: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}
	.heading {
		flex: 1;
		min-width: 170px;
	}
	h3 {
		font-size: 1.05rem;
		margin: 0;
	}
	.heading p {
		margin: 0.35rem 0 0;
		font-size: 0.72rem;
		color: var(--v-muted);
	}
	.controls {
		display: flex;
		align-items: center;
		gap: 2px;
	}
	.views {
		border-left: 1px solid var(--v-border);
		padding-left: 0.5rem;
	}
	.content {
		flex: 1;
		min-height: 0;
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		border: 1px solid var(--v-border);
		border-radius: 14px;
		overflow: hidden;
		background: color-mix(in srgb, var(--v-surface) 40%, transparent);
	}
	.content.editing {
		grid-template-columns: minmax(0, 1fr) 280px;
	}
	.calendar-view {
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.month {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-rows: 28px repeat(6, minmax(0, 1fr));
		grid-template-columns: repeat(7, minmax(0, 1fr));
	}
	.weekday {
		padding: 0.35rem 0;
		text-align: center;
		font-size: 0.7rem;
		color: var(--v-muted);
		border-bottom: 1px solid var(--v-border);
	}
	.day {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.35rem;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		padding: 0.6rem;
		border: 0;
		border-right: 1px solid var(--v-border);
		border-bottom: 1px solid var(--v-border);
		background: transparent;
		color: var(--v-fg);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.day:nth-child(7n) {
		border-right: 0;
	}
	.day.outside {
		opacity: 0.4;
	}
	.day:hover,
	.day.selected {
		background: color-mix(in srgb, var(--v-primary) 7%, transparent);
	}
	.day-number {
		font-size: 0.75rem;
		line-height: 24px;
		width: 24px;
		text-align: center;
	}
	.day.today .day-number {
		border-radius: 50%;
		background: var(--v-primary);
		color: var(--v-on-primary, #fff);
	}
	.month-event {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 0.65rem;
		min-width: 0;
	}
	.month-event > span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.day small {
		font-size: 0.6rem;
		color: var(--v-muted);
	}
	i {
		display: inline-block;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--v-primary);
		flex-shrink: 0;
	}
	[data-kind="break"] {
		--entry-color: var(--v-danger);
	}
	[data-kind="allowed"] {
		--entry-color: #2b9279;
	}
	[data-kind="study"] {
		--entry-color: var(--v-primary);
	}
	[data-kind="homework"] {
		--entry-color: #9a75d7;
	}
	[data-kind="test"] {
		--entry-color: #bf8d36;
	}
	[data-kind] i {
		background: var(--entry-color);
	}
	.day-view {
		flex: 1;
		min-height: 0;
		overflow: hidden;
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
	}
	.half-day {
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.half-day + .half-day {
		border-left: 1px solid var(--v-border);
		padding-left: 8px;
	}
	.half-heading {
		flex-shrink: 0;
		padding: 6px;
		color: var(--v-muted);
		font-size: 0.65rem;
	}
	.timeline {
		flex: 1;
		min-height: 0;
		position: relative;
	}
	.hour {
		position: absolute;
		left: 0;
		width: 100%;
		height: calc(100% / 12);
		background: transparent;
		border: 0;
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 0;
		color: var(--v-muted);
		cursor: pointer;
	}
	.hour span {
		width: 44px;
		flex-shrink: 0;
		font-size: 0.65rem;
		transform: translateY(-0.2em);
		padding-top: 6px;
	}
	.hour i {
		border-top: 1px solid var(--v-border);
		border-radius: 0;
		background: transparent;
		width: 100%;
		height: 0;
	}
	.hour:hover {
		background: color-mix(in srgb, var(--v-primary) 4%, transparent);
	}
	.events {
		position: absolute;
		inset: 0 6px 0 52px;
		pointer-events: none;
	}
	.event {
		position: absolute;
		pointer-events: auto;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
		overflow: hidden;
		padding: 2px 6px;
		min-height: 8px;
		border: 0;
		border-left: 2px solid var(--entry-color);
		border-radius: 5px;
		background: color-mix(in srgb, var(--entry-color) 14%, var(--v-surface));
		color: var(--v-fg);
		text-align: left;
		cursor: pointer;
	}
	.event strong {
		width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.75rem;
		font-weight: 550;
	}
	.event span {
		font-size: 0.65rem;
		color: var(--v-muted);
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.7rem;
		padding: 0.7rem 1rem;
		font-size: 0.65rem;
		color: var(--v-muted);
	}
	.legend span {
		display: flex;
		align-items: center;
		gap: 5px;
	}
	.editor {
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		border-left: 1px solid var(--v-border);
		padding: 1rem;
		background: color-mix(in srgb, var(--v-surface) 55%, transparent);
	}
	.editor header :global(.v-icon-btn::after),
	.editor .actions :global(.v-icon-btn:last-child::after) {
		left: auto;
		right: 0;
		transform: none;
	}
	.editor .actions :global(.v-icon-btn::after) {
		top: auto;
		bottom: calc(100% + 8px);
	}
	.editor .actions :global(.v-icon-btn:first-child::after) {
		left: 0;
		right: auto;
		transform: none;
	}
	.editor header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.5rem;
	}
	h4 {
		font-size: 0.9rem;
		margin: 0;
	}
	.editor form {
		display: grid;
		gap: 0.6rem;
	}
	.editor label {
		display: grid;
		gap: 0.25rem;
		font-size: 0.72rem;
		color: var(--v-muted);
	}
	.editor input,
	.editor select {
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
		font: inherit;
		font-size: 0.85rem;
		color: var(--v-fg);
		background: transparent;
		border: 0;
		border-bottom: 1px solid var(--v-border);
		border-radius: 0;
		padding: 0.3rem 0;
		outline: none;
	}
	.editor option {
		background: var(--v-surface);
	}
	.time-pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}
	.help,
	.message,
	.empty {
		font-size: 0.75rem;
		color: var(--v-muted);
		line-height: 1.5;
	}
	.help {
		margin: 0;
	}
	.actions {
		display: flex;
		justify-content: space-between;
	}
	.message {
		margin: 0 0 1rem;
	}
	.loading {
		font-size: 0.8rem;
		color: var(--v-muted);
		padding: 2rem;
		text-align: center;
	}
	.weekly-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		position: sticky;
		top: -1rem;
		background: var(--v-surface);
		z-index: 1;
		font-size: 0.8rem;
		margin-bottom: 0.5rem;
	}
	.controls :global(.v-icon-btn:last-child::after),
	.views :global(.v-icon-btn:nth-last-child(-n + 2)::after) {
		left: auto;
		right: 0;
		transform: none;
	}
	.weekly {
		position: absolute;
		inset: 0;
		z-index: 2;
		overflow: auto;
		padding: 1rem;
		border: 1px solid var(--v-border);
		border-radius: 12px;
		background: var(--v-surface);
	}
	.empty {
		margin: 0.75rem 0;
	}
	:global(.calendar-delete-overlay) {
		position: fixed;
		inset: 0;
		background: rgb(0 0 0 / 40%);
		backdrop-filter: blur(8px);
		z-index: 100;
	}
	:global(.calendar-delete-dialog) {
		position: fixed;
		z-index: 101;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: min(400px, calc(100vw - 48px));
		box-sizing: border-box;
		padding: 1.5rem;
		border: 1px solid var(--v-border);
		border-radius: 18px;
		background: var(--v-surface);
		color: var(--v-fg);
	}
	.delete-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 1rem;
	}
	@media (max-width: 950px) {
		.content.editing {
			grid-template-columns: 1fr;
			position: static;
		}
		.editor {
			position: absolute;
			inset: 0;
			z-index: 1;
			border: 0;
			background: color-mix(in srgb, var(--v-surface) 94%, transparent);
			backdrop-filter: blur(20px);
		}
		.editor form {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.editor .time-pair,
		.editor .help,
		.editor .actions {
			grid-column: 1 / -1;
		}
		.editor header {
			margin-bottom: 0.5rem;
		}
		.editor .time-pair {
			gap: 1rem;
		}
		.editor input,
		.editor select {
			padding: 0.35rem 0;
		}
		.views {
			border: 0;
			padding-left: 0;
		}
		.heading {
			min-width: 140px;
		}
		.day {
			min-height: 0;
			padding: 0.4rem 0.2rem;
		}
		.month-event {
			font-size: 0.6rem;
		}
		.month-event > span {
			max-width: 100%;
		}
		.legend {
			gap: 0.5rem;
			padding: 0.5rem;
		}
		.day {
			gap: 0.15rem;
		}
		.events {
			left: 32px;
			right: 2px;
		}
		.hour span {
			width: 28px;
			font-size: 0.55rem;
		}
		.hour {
			gap: 4px;
		}
		.event {
			padding: 1px 3px;
			gap: 1px;
			line-height: 1.1;
		}
		.event strong {
			font-size: 0.65rem;
		}
		.half-day + .half-day {
			padding-left: 4px;
		}
		.day-number {
			line-height: 20px;
		}
		.month-event {
			line-height: 1.1;
		}
	}
	@media (max-width: 400px) {
		.toolbar {
			gap: 0.5rem;
		}
		.controls :global(.v-icon-btn) {
			width: 32px;
			min-width: 32px;
			height: 32px;
		}
		.editor {
			padding: 0.75rem;
		}
		.editor form {
			gap: 0.4rem;
		}
		.editor label {
			font-size: 0.65rem;
			gap: 0.25rem;
		}
		.editor .help {
			font-size: 0.65rem;
			line-height: 1.25;
		}
		.editor input,
		.editor select {
			padding: 0.2rem 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		* {
			scroll-behavior: auto;
		}
	}
</style>
