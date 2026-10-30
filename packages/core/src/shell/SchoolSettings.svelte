<script lang="ts">
	import { onMount } from "svelte";
	import Plus from "lucide-svelte/icons/plus";
	import Minus from "lucide-svelte/icons/minus";
	import Check from "lucide-svelte/icons/check";
	import X from "lucide-svelte/icons/x";
	import RefreshCw from "lucide-svelte/icons/refresh-cw";
	import { Button, ErrorToast, IconButton } from "../components/index";
	import type { LearningService } from "../learning/service";
	import type { SchoolDetails, TeacherContact } from "../learning/types";
	let { service, profileId }: { service: LearningService; profileId: string } = $props();
	const empty = (): SchoolDetails => ({
		name: "",
		address: "",
		email: "",
		phones: [],
		teachers: [],
	});
	let draft = $state<SchoolDetails>(empty());
	let saved = $state<SchoolDetails>(empty());
	let loaded = $state(false),
		busy = $state(false),
		error = $state(""),
		notice = $state("");
	type TeacherRow = {
		key: number;
		value: TeacherContact;
		saved?: TeacherContact;
		removed: boolean;
	};
	type PhoneRow = {
		key: number;
		value: string;
		saved?: string;
		removed: boolean;
	};
	let phones = $state<PhoneRow[]>([]);
	let teachers = $state<TeacherRow[]>([]);
	let nextKey = 0;
	const clone = <T,>(value: T): T => globalThis.structuredClone($state.snapshot(value)) as T;
	const schoolFields = (value: SchoolDetails) => ({
		name: value.name,
		email: value.email,
		address: value.address,
	});
	const dirty = $derived(
		JSON.stringify(schoolFields(draft)) !== JSON.stringify(schoolFields(saved)),
	);
	function teacherDirty(row: TeacherRow) {
		return row.removed || !row.saved || JSON.stringify(row.value) !== JSON.stringify(row.saved);
	}
	function accept(value: SchoolDetails) {
		saved = clone({
			...schoolFields(value),
			phones: [...value.phones],
			teachers: value.teachers.map((t) => ({
				name: t.name,
				role: t.role,
				email: t.email,
				phone: t.phone,
			})),
		});
		draft = clone(saved);
		phones = saved.phones.map((value) => ({
			key: nextKey++,
			value,
			saved: value,
			removed: false,
		}));
		teachers = saved.teachers.map((value) => ({
			key: nextKey++,
			value: clone(value),
			saved: clone(value),
			removed: false,
		}));
		loaded = true;
	}
	function cancelTeacher(row: TeacherRow) {
		if (!row.saved) teachers = teachers.filter((t) => t.key !== row.key);
		else {
			row.value = clone(row.saved);
			row.removed = false;
		}
		error = "";
		notice = "";
	}
	function phoneDirty(row: PhoneRow) {
		return row.removed || row.saved === undefined || row.value !== row.saved;
	}
	function cancelPhone(row: PhoneRow) {
		if (row.saved === undefined) phones = phones.filter((p) => p.key !== row.key);
		else {
			row.value = row.saved;
			row.removed = false;
		}
		error = "";
		notice = "";
	}
	async function load() {
		busy = true;
		error = "";
		try {
			accept(await service.getSchool(profileId));
		} catch {
			error = "Could not load school details. Please try again.";
		} finally {
			busy = false;
		}
	}
	onMount(() => {
		void load();
	});
	async function save(
		event?: { preventDefault(): void },
		target?: TeacherRow,
		phoneTarget?: PhoneRow,
	) {
		event?.preventDefault();
		if (busy || (target ? !teacherDirty(target) : phoneTarget ? !phoneDirty(phoneTarget) : !dirty))
			return;
		if (
			phoneTarget &&
			!phoneTarget.removed &&
			(!phoneTarget.value.trim() || phoneTarget.value.length > 50)
		) {
			error = "Enter a phone number with 1–50 characters.";
			return;
		}
		busy = true;
		error = "";
		notice = "";
		const persistedTeachers = teachers.flatMap((row) => {
			if (row === target) return row.removed ? [] : [clone(row.value)];
			return row.saved ? [clone(row.saved)] : [];
		});
		const payload = {
			...(target || phoneTarget ? schoolFields(saved) : schoolFields(draft)),
			phones: phones.flatMap((row) =>
				row === phoneTarget
					? row.removed
						? []
						: [row.value.trim()]
					: row.saved === undefined
						? []
						: [row.saved],
			),
			teachers: persistedTeachers,
		};
		try {
			const result = await service.saveSchool(profileId, payload);
			saved = clone({
				...schoolFields(result),
				phones: [...result.phones],
				teachers: result.teachers.map((t) => ({
					name: t.name,
					role: t.role,
					email: t.email,
					phone: t.phone,
				})),
			});
			if (phoneTarget) {
				if (phoneTarget.removed) phones = phones.filter((row) => row.key !== phoneTarget.key);
				else {
					const index = phones
						.filter((row) => row.key === phoneTarget.key || row.saved !== undefined)
						.findIndex((row) => row.key === phoneTarget.key);
					phoneTarget.value = saved.phones[index];
					phoneTarget.saved = phoneTarget.value;
				}
				notice = "Phone number saved.";
			} else if (target) {
				if (target.removed) teachers = teachers.filter((row) => row.key !== target.key);
				else {
					const index = teachers
						.filter((row) => row.key === target.key || row.saved)
						.findIndex((row) => row.key === target.key);
					target.value = clone(saved.teachers[index]);
					target.saved = clone(target.value);
				}
				notice = "Teacher contact saved.";
			} else {
				draft = clone(saved);
				notice = "School details saved.";
			}
		} catch {
			error = `Could not save ${target ? "teacher contact" : phoneTarget ? "phone number" : "school details"}. Your changes are still here; please try again.`;
		} finally {
			busy = false;
		}
	}
</script>

<section aria-label="School details">
	<ErrorToast message={error} />
	{#if notice}<p role="status">{notice}</p>{/if}
	{#if !loaded}
		{#if busy}<p role="status">Loading school details…</p>{:else}<IconButton
				icon={RefreshCw}
				label="Retry school details"
				onclick={() => void load()}
			/>{/if}
	{:else}
		<form aria-label="School information" onsubmit={(event) => void save(event)}>
			<fieldset disabled={busy}>
				<div class="joined">
					<label
						>School name<input
							aria-label="School name"
							maxlength={160}
							placeholder="School name"
							bind:value={draft.name}
						/></label
					>
					<label
						>School email<input
							aria-label="School email"
							type="email"
							maxlength={254}
							placeholder="office@school.edu"
							bind:value={draft.email}
						/></label
					>
				</div>
				<label class="address"
					>Address<textarea
						aria-label="School address"
						maxlength={1000}
						rows={2}
						placeholder="Street, city, state or region, postal code"
						bind:value={draft.address}></textarea></label
				>
				{#if dirty}<div class="actions">
						<Button
							icon={X}
							variant="ghost"
							onclick={() => {
								draft = clone(saved);
								error = "";
								notice = "";
							}}>Cancel</Button
						><Button icon={Check} type="submit">Save</Button>
					</div>{/if}
				<div class="heading">
					<h4>School phone numbers</h4>
					<IconButton
						icon={Plus}
						label="Add school phone"
						disabled={phones.length >= 10}
						onclick={() => phones.push({ key: nextKey++, value: "", removed: false })}
					/>
				</div>
				{#each phones as phone, i (phone.key)}
					<div class="phone-row">
						<label
							>Phone {i + 1}{phone.removed ? " · Remove?" : ""}<input
								aria-label={`School phone ${i + 1}`}
								title={phone.value}
								type="tel"
								maxlength={50}
								placeholder="Include country or area code"
								bind:value={phone.value}
								disabled={phone.removed}
							/></label
						>
						{#if phoneDirty(phone)}
							<IconButton
								icon={X}
								label={`Cancel school phone ${i + 1}`}
								onclick={() => cancelPhone(phone)}
							/>
							<IconButton
								icon={Check}
								label={`Save school phone ${i + 1}`}
								onclick={() => void save(undefined, undefined, phone)}
							/>
						{:else}
							<IconButton
								icon={Minus}
								label={`Remove school phone ${i + 1}`}
								onclick={() => (phone.removed = true)}
							/>
						{/if}
					</div>
				{/each}
			</fieldset>
		</form>
		<div class="heading">
			<div>
				<h4>Teachers</h4>
				<p>Classroom, music, PE / PT, math, substitute, or any other role.</p>
			</div>
			<IconButton
				icon={Plus}
				label="Add teacher"
				disabled={busy || teachers.length >= 50}
				onclick={() =>
					teachers.push({
						key: nextKey++,
						value: { name: "", role: "", email: "", phone: "" },
						removed: false,
					})}
			/>
		</div>
		{#each teachers as row, i (row.key)}
			{@const teacher = row.value}
			<form
				class="teacher"
				aria-label={`Teacher ${i + 1}`}
				onsubmit={(event) => void save(event, row)}
			>
				<fieldset disabled={busy || row.removed}>
					<div class="heading">
						<h4>{teacher.name || `Teacher ${i + 1}`}</h4>
						<IconButton
							icon={Minus}
							label={`Remove teacher ${i + 1}`}
							onclick={() => {
								if (!row.saved) cancelTeacher(row);
								else row.removed = true;
							}}
						/>
					</div>
					<div class="joined">
						<label
							>Name<input
								aria-label={`Teacher ${i + 1} name`}
								maxlength={160}
								placeholder="Teacher name"
								bind:value={teacher.name}
							/></label
						><label
							>Role or subject<input
								aria-label={`Teacher ${i + 1} role`}
								maxlength={100}
								placeholder="e.g. Classroom, Music, Math"
								bind:value={teacher.role}
							/></label
						>
					</div>
					<div class="joined">
						<label
							>Email<input
								aria-label={`Teacher ${i + 1} email`}
								type="email"
								maxlength={254}
								placeholder="teacher@school.edu"
								bind:value={teacher.email}
							/></label
						><label
							>Phone<input
								aria-label={`Teacher ${i + 1} phone`}
								type="tel"
								maxlength={50}
								placeholder="Phone number"
								bind:value={teacher.phone}
							/></label
						>
					</div>
				</fieldset>
				{#if teacherDirty(row)}
					{#if row.removed}<p>
							This teacher will be removed when you save. Cancel to keep them.
						</p>{/if}
					<div class="actions">
						<Button icon={X} variant="ghost" disabled={busy} onclick={() => cancelTeacher(row)}
							>Cancel</Button
						><Button icon={Check} type="submit" disabled={busy}>Save</Button>
					</div>
				{/if}
			</form>
		{:else}<p>No teacher contacts yet. Add them as you learn their details.</p>{/each}
	{/if}
</section>

<style>
	section,
	fieldset {
		display: grid;
		gap: 0.65rem;
		min-width: 0;
	}
	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
	}
	.joined {
		display: grid;
		grid-template-columns: 1fr 1fr;
		border: 1px solid var(--v-border);
		border-radius: 7px;
		min-width: 0;
	}
	label {
		display: grid;
		gap: 0.2rem;
		padding: 0.45rem 0.6rem;
		min-width: 0;
		font-size: 0.68rem;
		color: var(--v-muted);
	}
	.joined label + label {
		border-left: 1px solid var(--v-border);
	}
	input,
	textarea {
		box-sizing: border-box;
		width: 100%;
		min-width: 0;
		border: 0;
		outline: none;
		border-radius: 0;
		padding: 0.25rem 0;
		background: transparent;
		color: var(--v-fg);
		font: inherit;
		font-size: 0.8rem;
	}
	input:focus-visible,
	textarea:focus-visible {
		box-shadow: 0 1px 0 var(--v-primary);
	}
	textarea {
		resize: vertical;
	}
	.address,
	.phone-row {
		border: 1px solid var(--v-border);
		border-radius: 7px;
	}
	.heading,
	.phone-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.phone-row label {
		flex: 1;
	}
	.teacher {
		border-top: 1px solid var(--v-border);
		padding-top: 0.5rem;
	}
	h4,
	p {
		margin: 0;
	}
	h4 {
		font-size: 0.78rem;
		font-weight: 500;
		overflow-wrap: anywhere;
	}
	p {
		font-size: 0.72rem;
		color: var(--v-muted);
		line-height: 1.5;
	}
	.actions :global(.v-btn) {
		min-height: 32px;
		height: 32px;
		padding: 0.35rem 0.55rem;
		font-size: 0.75rem;
		border-radius: 6px;
	}
	.actions {
		display: flex;
		justify-content: end;
		gap: 0.3rem;
	}
	.teacher > .actions {
		padding: 0.65rem 0.25rem;
		margin-top: 0.25rem;
		gap: 0.75rem;
	}
	section :global(.v-icon-btn::after) {
		right: 0;
		left: auto;
		transform: none;
	}
	@media (max-width: 400px) {
		.joined {
			grid-template-columns: 1fr;
		}
		.joined label + label {
			border-left: 0;
			border-top: 1px solid var(--v-border);
		}
	}
</style>
