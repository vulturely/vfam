<script lang="ts">
	import Bot from "lucide-svelte/icons/bot";
	import LearningDevices from "./LearningDevices.svelte";
	import School from "lucide-svelte/icons/school";
	import SchoolSettings from "./SchoolSettings.svelte";
	import ChevronDown from "lucide-svelte/icons/chevron-down";
	import Globe from "lucide-svelte/icons/globe";
	import AudioLines from "lucide-svelte/icons/audio-lines";
	import { animateDetails } from "../components/animateDetails";
	import BookOpen from "lucide-svelte/icons/book-open";
	import History from "lucide-svelte/icons/history";
	import ClipboardCheck from "lucide-svelte/icons/clipboard-check";
	import ArrowLeft from "lucide-svelte/icons/arrow-left";
	import ArrowRight from "lucide-svelte/icons/arrow-right";
	import UiUsers from "lucide-svelte/icons/users";
	import UiRefreshCw from "lucide-svelte/icons/refresh-cw";
	import UiUserMinus from "lucide-svelte/icons/user-minus";
	import UiUserPlus from "lucide-svelte/icons/user-plus";
	import LoaderCircle from "lucide-svelte/icons/loader-circle";
	import ChildPinSettings from "./ChildPinSettings.svelte";
	import VoiceSettings from "./VoiceSettings.svelte";
	import ParentLearningDashboard from "./ParentLearningDashboard.svelte";
	import ProfileTimezone from "./ProfileTimezone.svelte";
	import TimetableEditor from "./TimetableEditor.svelte";
	import HomeworkHistory from "./HomeworkHistory.svelte";
	import LearningAttempts from "./LearningAttempts.svelte";
	import HomeworkWorkspace from "./HomeworkWorkspace.svelte";
	import { getContext, onMount, untrack } from "svelte";
	import type { Runtime } from "../runtime/registry.svelte";
	import { type LearningProfile, type GuardianCandidate } from "../learning/types";
	import { Button, Card, ErrorToast, IconButton } from "../components/index";

	let { setup = false }: { setup?: boolean } = $props();
	const runtime = getContext<Runtime>("vulture:runtime");
	let devicesProfile = $state("");
	const tabs = ["Assignment", "Time Table", "Notification", "Setting"] as const;
	type Tab = (typeof tabs)[number];
	let activeTab = $state<Tab>(untrack(() => (setup ? "Setting" : "Assignment")));
	function moveChild(offset: number) {
		const profile = profiles[childIndex + offset];
		if (profile && !sharing) select(profile);
	}
	function tabKey(event: globalThis.KeyboardEvent) {
		const index = tabs.indexOf(activeTab);
		let next: number;
		if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
		else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
		else if (event.key === "Home") next = 0;
		else if (event.key === "End") next = tabs.length - 1;
		else return;
		if (!selected && tabs[next] !== "Setting") return;
		event.preventDefault();
		changeTab(tabs[next]);
		(event.currentTarget as globalThis.HTMLButtonElement).parentElement
			?.querySelector<globalThis.HTMLButtonElement>(`[data-tab="${next}"]`)
			?.focus();
	}
	type HomeworkView = "homework" | "history" | "attempts";
	let homeworkView = $state<HomeworkView>("homework");
	function changeHomeworkView(view: HomeworkView) {
		homeworkView = view;
		if (contentPanel) contentPanel.scrollTop = 0;
	}
	let contentPanel: globalThis.HTMLDivElement;
	function changeTab(tab: Tab) {
		activeTab = tab;
		if (contentPanel) contentPanel.scrollTop = 0;
	}
	let familyId = $state<string | null>(null);
	let profiles = $state<LearningProfile[]>([]);
	let guardianCandidates = $state<GuardianCandidate[]>([]);
	let selectedId = $state("");
	let guardianId = $state("");
	let loading = $state(true);
	let sharing = $state(false);
	let error = $state("");
	let notice = $state("");
	const childIndex = $derived(profiles.findIndex((profile) => profile.id === selectedId));
	const selected = $derived(profiles.find((profile) => profile.id === selectedId));

	async function load() {
		loading = true;
		error = "";
		try {
			const family = await runtime.services.family.getMyFamily();
			const [loadedProfiles, candidates] = family
				? await Promise.all([
						runtime.services.learning.listProfiles(family.id),
						runtime.services.learning.listEligibleGuardians(family.id),
					])
				: [[], []];
			familyId = family?.id ?? null;
			profiles = loadedProfiles;
			selectedId = profiles.some((profile) => profile.id === selectedId)
				? selectedId
				: (profiles[0]?.id ?? "");
			if (!profiles.length) activeTab = "Setting";
			guardianCandidates = candidates;
		} catch (cause) {
			error = message(cause);
		} finally {
			loading = false;
		}
	}
	onMount(() => {
		void load();
	});

	function select(profile: LearningProfile) {
		selectedId = profile.id;
		if (contentPanel) contentPanel.scrollTop = 0;
		guardianId = "";
		error = "";
		notice = "";
	}
	async function share(event: { preventDefault(): void }) {
		event.preventDefault();
		if (!selected || sharing) return;
		const profileId = selected.id;
		sharing = true;
		error = "";
		notice = "";
		try {
			const updated = await runtime.services.learning.addGuardian(profileId, guardianId);
			profiles = profiles.map((profile) => (profile.id === updated.id ? updated : profile));
			guardianId = "";
			notice = "Guardian access updated.";
		} catch (cause) {
			error = message(cause);
		} finally {
			sharing = false;
		}
	}
	async function removeGuardian(accountId: string) {
		if (!selected || sharing) return;
		const profileId = selected.id;
		sharing = true;
		error = "";
		notice = "";
		try {
			const updated = await runtime.services.learning.removeGuardian(profileId, accountId);
			if (accountId === runtime.state.identity?.id) {
				profiles = profiles.filter((profile) => profile.id !== profileId);
				selectedId = profiles[0]?.id ?? "";
				if (!selectedId) activeTab = "Setting";
			} else {
				profiles = profiles.map((profile) => (profile.id === updated.id ? updated : profile));
			}
			notice = "Guardian access removed.";
		} catch (cause) {
			error = message(cause);
		} finally {
			sharing = false;
		}
	}
	function message(cause: unknown) {
		return cause instanceof Error
			? cause.message
			: "Could not update learning profiles. Please try again.";
	}
</script>

<section class="learning" aria-labelledby="learning-title">
	<header class="learning-header">
		<div>
			<h1 id="learning-title">Children's learning</h1>
			{#if selected}<p class="selected-child">
					<span>{selected.displayName}</span><span>{childIndex + 1} of {profiles.length}</span>
				</p>{/if}
		</div>
		<div class="child-controls" aria-label="Switch child">
			<IconButton
				icon={ArrowLeft}
				label="Previous child"
				disabled={loading || sharing || childIndex <= 0}
				onclick={() => moveChild(-1)}
			/>
			<IconButton
				icon={ArrowRight}
				label="Next child"
				disabled={loading || sharing || childIndex < 0 || childIndex >= profiles.length - 1}
				onclick={() => moveChild(1)}
			/>
		</div>
	</header>
	<div class="learning-tabs" role="tablist" aria-label="Children's learning sections">
		{#each tabs as tab, index (tab)}
			<button
				type="button"
				role="tab"
				id={`learning-tab-${index}`}
				data-tab={index}
				aria-selected={activeTab === tab}
				aria-controls="learning-panel"
				tabindex={activeTab === tab ? 0 : -1}
				disabled={!familyId || (!selected && tab !== "Setting")}
				onclick={() => changeTab(tab)}
				onkeydown={tabKey}>{tab}</button
			>
		{/each}
	</div>
	<div
		class="learning-content"
		class:calendar-panel={activeTab === "Time Table"}
		class:homework-split={activeTab === "Assignment" && homeworkView === "homework"}
		bind:this={contentPanel}
		id="learning-panel"
		role="tabpanel"
		aria-labelledby={`learning-tab-${tabs.indexOf(activeTab)}`}
		tabindex="0"
	>
		<ErrorToast message={error} />
		{#if notice}<p role="status">{notice}</p>{/if}
		{#if loading}<div class="learning-loading" role="status" aria-label="Loading learning profiles">
				<LoaderCircle size={32} aria-hidden="true" />
			</div>
		{:else if !familyId}
			<Card
				><p>Create or join your family before adding a child profile.</p>
				<Button icon={UiUsers} onclick={() => runtime.router.navigate("family:manage")}
					>Open family</Button
				>{#if error}<Button icon={UiRefreshCw} variant="ghost" onclick={() => void load()}
						>Try again</Button
					>{/if}</Card
			>
		{:else if activeTab === "Setting"}
			<div class="settings-columns">
				<section class="profile-settings" class:empty={!selected}>
					{#if selected}
						{#key selected.id}
							<details class="setting-section" use:animateDetails>
								<summary
									><span class="setting-icon"
										><Globe size={22} strokeWidth={1.5} aria-hidden="true" /></span
									><span class="setting-copy"
										><span>Timezone</span><small>Keep calendar and learning times in sync.</small
										></span
									><ChevronDown class="setting-chevron" size={17} aria-hidden="true" /></summary
								>
								<div class="accordion-body">
									<ProfileTimezone
										flat
										service={runtime.services.timetable}
										profileId={selected.id}
									/>
								</div>
							</details>
							<details class="setting-section" use:animateDetails>
								<summary
									><span class="setting-icon"
										><School size={22} strokeWidth={1.5} aria-hidden="true" /></span
									><span class="setting-copy"
										><span>School</span><small>School details and teacher contacts.</small></span
									><ChevronDown class="setting-chevron" size={17} aria-hidden="true" /></summary
								>
								<div class="accordion-body">
									<SchoolSettings service={runtime.services.learning} profileId={selected.id} />
								</div>
							</details>
							<ChildPinSettings
								grouped
								auth={runtime.services.auth}
								profileId={selected.id}
								displayName={selected.displayName}
							/>
							{#if !setup}<details class="setting-section" use:animateDetails>
									<summary
										><span class="setting-icon"
											><AudioLines size={22} strokeWidth={1.5} aria-hidden="true" /></span
										><span class="setting-copy"
											><span>Voice privacy</span><small
												>Manage microphone and speech permissions.</small
											></span
										><ChevronDown class="setting-chevron" size={17} aria-hidden="true" /></summary
									>
									<div class="accordion-body">
										<VoiceSettings service={runtime.services.voice} profileId={selected.id} />
									</div>
								</details>{/if}
							<details class="setting-section" use:animateDetails>
								<summary
									><span class="setting-icon"
										><UiUsers size={22} strokeWidth={1.5} aria-hidden="true" /></span
									><span class="setting-copy"
										><span>Guardian access</span><small>Choose who can manage this profile.</small
										></span
									><ChevronDown class="setting-chevron" size={17} aria-hidden="true" /></summary
								>
								<div class="accordion-body selection">
									<p>
										{selected.guardianAccountIds.length} guardian(s) can manage this profile.
									</p>
									<ul aria-label="Profile guardians">
										{#each selected.guardianAccountIds as accountId (accountId)}
											<li class="guardian">
												<span
													>{accountId === runtime.state.identity?.id
														? "You"
														: (guardianCandidates.find(
																(candidate) => candidate.accountId === accountId,
															)?.displayName ?? "Family parent")}</span
												>
												<IconButton
													label="Remove guardian"
													icon={UiUserMinus}
													disabled={sharing || selected.guardianAccountIds.length <= 1}
													onclick={() => void removeGuardian(accountId)}
												/>
											</li>
										{/each}
									</ul>
									<p>At least one guardian must remain.</p>
									<form onsubmit={share}>
										<label class="field"
											>Share with a parent
											<select bind:value={guardianId} required disabled={sharing}>
												<option value="">Choose a parent</option>
												{#each guardianCandidates.filter((candidate) => !selected?.guardianAccountIds.includes(candidate.accountId)) as candidate (candidate.accountId)}
													<option value={candidate.accountId}>{candidate.displayName}</option>
												{/each}
											</select>
										</label>
										<p>Share this child’s profile with an existing family parent.</p>
										<IconButton
											label="Add guardian"
											icon={UiUserPlus}
											type="submit"
											disabled={sharing || !guardianId.trim()}
										/>
									</form>
								</div>
							</details>
							<details
								class="setting-section"
								use:animateDetails
								ontoggle={(event) => {
									devicesProfile = event.currentTarget.open ? selected!.id : "";
								}}
							>
								<summary
									><span class="setting-icon"
										><Bot size={22} strokeWidth={1.5} aria-hidden="true" /></span
									><span class="setting-copy"
										><span>FamBud devices</span><small
											>Manage paired learning devices and quizzes.</small
										></span
									><ChevronDown class="setting-chevron" size={17} aria-hidden="true" /></summary
								>
								<div class="accordion-body">
									{#if devicesProfile === selected.id}<LearningDevices
											services={runtime.services}
											profileId={selected.id}
										/>{/if}
								</div>
							</details>
						{/key}
					{:else}<p>No learning profiles yet. Add children in Family Setup.</p>{/if}
				</section>
			</div>
		{:else if selected}
			<div class="profile-workspace">
				{#key `${selected.id}-${activeTab}-${homeworkView}`}
					{#if activeTab === "Assignment"}
						{#if homeworkView === "attempts"}<LearningAttempts
								service={runtime.services.childLearning}
								profileId={selected.id}
							/>
						{:else if homeworkView === "history"}<HomeworkHistory
								service={runtime.services.childLearning}
								profileId={selected.id}
							/>
						{:else}<HomeworkWorkspace
								profileId={selected.id}
								view={homeworkView}
								creatorNames={Object.fromEntries(
									guardianCandidates.map((candidate) => [
										candidate.accountId,
										candidate.displayName,
									]),
								)}
							/>{/if}
					{:else if activeTab === "Time Table"}<TimetableEditor
							service={runtime.services.timetable}
							homework={runtime.services.homework}
							profileId={selected.id}
							signIn={() => runtime.services.auth.signIn()}
						/>
					{:else if activeTab === "Notification"}<ParentLearningDashboard
							services={runtime.services}
							profileId={selected.id}
						/>{/if}
				{/key}
			</div>
		{/if}
	</div>
	{#if selected && activeTab === "Assignment"}
		<nav class="homework-navigation" aria-label="Homework sections">
			<IconButton
				icon={BookOpen}
				label="Homework"
				ariaPressed={homeworkView === "homework"}
				class={homeworkView === "homework" ? "current" : ""}
				onclick={() => changeHomeworkView("homework")}
			/>
			<IconButton
				icon={History}
				label="History"
				ariaPressed={homeworkView === "history"}
				class={homeworkView === "history" ? "current" : ""}
				onclick={() => changeHomeworkView("history")}
			/>
			<IconButton
				icon={ClipboardCheck}
				label="Attempts"
				ariaPressed={homeworkView === "attempts"}
				class={homeworkView === "attempts" ? "current" : ""}
				onclick={() => changeHomeworkView("attempts")}
			/>
		</nav>
	{/if}
</section>

<style>
	.learning {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
		box-sizing: border-box;
		margin: auto;
		border: 1px solid color-mix(in srgb, var(--v-fg) 12%, transparent);
		border-radius: 24px;
		background: color-mix(in srgb, var(--v-surface) 85%, transparent);
		backdrop-filter: blur(24px) saturate(140%);
		-webkit-backdrop-filter: blur(24px) saturate(140%);
		overflow: hidden;
	}
	.learning-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 12px 18px;
		border-bottom: 1px solid var(--v-border);
		flex-shrink: 0;
	}
	h1 {
		font-size: clamp(1rem, 1.5vw, 1.35rem);
		margin: 0;
		overflow-wrap: anywhere;
	}
	.selected-child {
		display: flex;
		gap: 8px;
		margin: 3px 0 0;
		font-size: 0.68rem;
		color: var(--v-muted);
	}
	.child-controls {
		display: flex;
		flex-shrink: 0;
		gap: 4px;
	}
	.learning-tabs {
		display: flex;
		flex-shrink: 0;
		border-bottom: 1px solid var(--v-border);
	}
	.learning-tabs button {
		min-height: 36px;
		padding: 7px 16px;
		border: 0;
		border-right: 1px solid var(--v-border);
		background: transparent;
		color: var(--v-muted);
		font: inherit;
		font-size: 0.78rem;
		cursor: pointer;
	}
	.learning-tabs button[aria-selected="true"] {
		color: var(--v-fg);
		background: color-mix(in srgb, var(--v-fg) 4%, transparent);
		box-shadow: inset 0 -2px var(--v-primary);
	}
	.learning-tabs button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.learning-content {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 24px;
		overscroll-behavior: contain;
	}
	.learning-loading {
		display: grid;
		height: 100%;
		place-items: center;
	}
	.learning-loading :global(svg) {
		color: var(--v-primary);
		animation: learning-loading-spin 900ms linear infinite;
	}
	@keyframes learning-loading-spin {
		to {
			transform: rotate(360deg);
		}
	}
	.learning-content.calendar-panel {
		overflow: hidden;
		padding: 16px;
	}
	.calendar-panel .profile-workspace {
		display: block;
		height: 100%;
		min-height: 0;
	}
	.learning-content.homework-split {
		padding: 0;
		overflow: hidden;
	}
	.homework-split .profile-workspace {
		height: 100%;
		min-height: 0;
		display: block;
	}
	.learning-content:focus {
		outline: none;
	}
	.homework-navigation {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		flex-shrink: 0;
		min-height: 48px;
		padding: 4px 12px;
		border-top: 1px solid var(--v-border);
	}
	.homework-navigation :global(.v-icon-btn) {
		background: transparent;
		color: var(--v-muted);
		border-radius: 0;
	}
	.homework-navigation :global(.v-icon-btn::after) {
		top: auto;
		bottom: calc(100% + 8px);
	}
	.homework-navigation :global(.current) {
		color: var(--v-primary-text, var(--v-primary));
		box-shadow: inset 0 -2px var(--v-primary);
	}
	.settings-columns {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 12px;
		width: 100%;
		max-width: 760px;
		margin-inline: auto;
	}
	.profile-settings {
		border: 1px solid var(--v-border);
		border-radius: 14px;
		overflow: clip;
		background: color-mix(in srgb, var(--v-fg) 2%, transparent);
	}
	.profile-settings.empty {
		display: grid;
		place-items: center;
		min-height: 160px;
		border: 0;
		background: transparent;
		text-align: center;
	}
	.profile-settings > :global(* + *) {
		border-top: 1px solid var(--v-border);
	}
	.setting-section {
		min-width: 0;
	}
	.setting-section > summary {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1rem;
		list-style: none;
		cursor: pointer;
		font-size: 0.85rem;
		font-weight: 500;
	}
	.setting-section > summary::-webkit-details-marker {
		display: none;
	}
	.setting-icon {
		flex: 0 0 38px;
		width: 38px;
		height: 38px;
		display: grid;
		place-items: center;
		color: var(--v-muted);
	}
	.setting-copy {
		display: grid;
		gap: 0.25rem;
		flex: 1;
		min-width: 0;
	}
	.setting-copy small {
		color: var(--v-muted);
		font-size: 0.72rem;
		font-weight: 400;
		line-height: 1.4;
	}
	.setting-section :global(.setting-chevron) {
		flex-shrink: 0;
		color: var(--v-muted);
		transition: transform 200ms ease;
	}
	.setting-section[open] :global(.setting-chevron) {
		transform: rotate(180deg);
	}
	.accordion-body {
		padding: 0.75rem;
		border-top: 1px solid var(--v-border);
	}
	.profile-settings p {
		font-size: 0.75rem;
	}
	.profile-settings,
	.profile-workspace,
	.selection,
	form {
		display: grid;
		align-content: start;
		gap: 16px;
		min-width: 0;
	}
	.profile-settings {
		gap: 0;
	}
	.profile-workspace :global(.v-card) {
		background: transparent;
		box-shadow: none;
		border: 0;
	}

	p {
		margin: 0;
	}
	p {
		line-height: 1.5;
		color: var(--v-muted);
	}
	.field {
		display: grid;
		gap: 8px;
		min-width: 0;
		font-size: 0.75rem;
		font-weight: 400;
		color: var(--v-muted);
	}
	select {
		width: 100%;
		min-width: 0;
		min-height: 44px;
		padding: var(--v-space);
		font: inherit;
		color: var(--v-fg);
		background: transparent;
		border: 0;
		outline: none;
		border-radius: var(--v-radius-sm);
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}

	.guardian {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
		overflow-wrap: anywhere;
	}
	.selection {
		gap: 0.65rem;
	}
	.guardian {
		justify-content: space-between;
		font-size: 0.8rem;
	}
	.selection form {
		gap: 0.4rem;
	}
	.selection form :global(.v-icon-btn) {
		justify-self: end;
	}
	.profile-settings :global(.v-icon-btn::after) {
		right: 0;
		left: auto;
		transform: none;
	}
	@media (min-width: 761px) {
		.learning {
			flex: none;
			width: 100%;
			height: 100%;
		}
	}
	@media (max-width: 760px) {
		.learning {
			border-radius: 0;
		}
		.learning-header {
			padding: 10px 12px;
			gap: 8px;
		}
		.child-controls {
			gap: 0;
		}
		.learning-tabs {
			display: grid;
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
		.learning-tabs button {
			padding: 7px 4px;
			font-size: 0.68rem;
			overflow-wrap: anywhere;
		}
		.learning-content {
			padding: 16px 12px;
		}
		.homework-navigation {
			margin-bottom: calc(
				max(var(--v-control-h), 44px) + var(--v-space) * 3 + env(safe-area-inset-bottom)
			);
		}
		.settings-columns {
			grid-template-columns: 1fr;
		}
	}
</style>
