<script lang="ts">
	let {
		grade = $bindable(""),
		autoGrade = $bindable(false),
		schoolMonth = $bindable(9),
		schoolDay = $bindable(1),
		country = $bindable(""),
		region = $bindable(""),
		pending = false,
	} = $props();
	const hintId = $props.id();
	const months = [
		"January",
		"February",
		"March",
		"April",
		"May",
		"June",
		"July",
		"August",
		"September",
		"October",
		"November",
		"December",
	];
</script>

<div class="grade-settings">
	<div class="grade-row">
		<label class="grade-field"
			><span class="sr-only"
				>{autoGrade ? "Current grade" : "Grade or learning stage (optional)"}</span
			><input
				aria-describedby={`${hintId}-grade`}
				bind:value={grade}
				required={autoGrade}
				maxlength="40"
				placeholder={autoGrade ? "Current grade" : "Grade (optional)"}
				disabled={pending}
			/></label
		>
		<label class="calendar-field"
			><span class="sr-only">Grade updates</span>
			<select
				aria-label="Grade updates"
				aria-describedby={`${hintId}-grade`}
				bind:value={autoGrade}
				disabled={pending}
			>
				<option value={false}>Manual</option>
				<option value={true}>Automatic</option>
			</select>
		</label>
	</div>
	<p class="row-help" id={`${hintId}-grade`}>
		Enter the current grade. Choose Manual or Automatic updates.
	</p>
	{#if autoGrade}
		<div class="calendar-fields">
			<div class="grade-row location-row">
				<label
					><span class="sr-only">Country</span><input
						aria-describedby={`${hintId}-location`}
						bind:value={country}
						placeholder="Country"
						maxlength="80"
						required
						disabled={pending}
						autocomplete="country-name"
					/></label
				>
				<label
					><span class="sr-only">State or region</span><input
						aria-describedby={`${hintId}-location`}
						bind:value={region}
						placeholder="State or region"
						maxlength="80"
						disabled={pending}
						autocomplete="address-level1"
					/></label
				>
			</div>
			<p class="row-help" id={`${hintId}-location`}>
				Enter the country and region of your child’s school.
			</p>
			<div class="grade-row">
				<label
					><span class="sr-only">School-year start month</span><select
						aria-label="School-year start month"
						aria-describedby={`${hintId}-date`}
						bind:value={schoolMonth}
						disabled={pending}
					>
						{#each months as month, i (month)}<option value={i + 1}>{month}</option>{/each}
					</select></label
				>
				<label
					><span class="sr-only">Day</span><input
						type="number"
						aria-describedby={`${hintId}-date`}
						placeholder="Day"
						min="1"
						max="31"
						required
						bind:value={schoolDay}
						disabled={pending}
					/></label
				>
			</div>
		</div>
		<p class="row-help" id={`${hintId}-date`}>Choose when the grade advances each year.</p>
	{/if}
</div>

<style>
	.grade-settings {
		display: grid;
		gap: 12px;
		padding-top: 12px;
	}
	label {
		display: grid;
		gap: 6px;
		min-width: 0;
		font-size: 0.8rem;
	}
	input,
	select {
		min-width: 0;
		width: 100%;
		box-sizing: border-box;
		min-height: 44px;
		padding: 8px 10px;
		border: 1px solid var(--v-border);
		border-radius: 8px;
		background: var(--v-surface);
		color: var(--v-fg);
		font: inherit;
	}
	select:focus-visible {
		outline: 2px solid var(--v-primary);
		outline-offset: 2px;
	}
	.grade-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(100px, 0.6fr);
		border: 1px solid color-mix(in srgb, var(--v-fg) 12%, transparent);
		border-radius: 8px;
		overflow: hidden;
	}
	.grade-row > label + label {
		border-left: 1px dotted color-mix(in srgb, var(--v-fg) 25%, transparent);
	}
	.grade-row input,
	.grade-row select {
		border: 0;
		border-radius: 0;
		outline: none;
		background: transparent;
		min-height: 40px !important;
		height: 40px !important;
		padding-block: 4px;
		text-align: left;
	}
	.grade-row > label:last-child input,
	.grade-row > label:last-child select {
		text-align: right;
		text-align-last: right;
	}
	.grade-row input:focus-visible,
	.grade-row select:focus-visible {
		outline: none;
		background: color-mix(in srgb, var(--v-primary) 5%, transparent);
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.calendar-fields {
		display: grid;
		gap: 12px;
	}
	.location-row {
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
	}
	input::placeholder {
		color: color-mix(in srgb, var(--v-muted) 80%, transparent);
		font-size: 0.7rem;
		font-weight: 300;
		opacity: 1;
	}
	.row-help {
		margin: -11px 0 0;
		font-size: 0.7rem;
		font-weight: 300;
		line-height: 1.45;
		text-align: left;
		color: color-mix(in srgb, var(--v-muted) 80%, transparent);
	}
</style>
