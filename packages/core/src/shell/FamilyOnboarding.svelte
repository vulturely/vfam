<script lang="ts">
	import { slide, fly } from "svelte/transition";
	import { getContext, onMount, onDestroy } from "svelte";
	import { ageBandFromDob } from "../learning/ageBand";
	import { preparePhoto } from "../images/preparePhoto";
	import type { Runtime } from "../runtime/registry.svelte";
	import type { FamilyRecord } from "../family/service";
	import { ageBands, type LearningProfile, type GuardianCandidate } from "../learning/types";
	import { Button, ErrorToast, IconButton } from "../components/index";
	import { animateDetails } from "../components/animateDetails";
	import GradeSettings from "./GradeSettings.svelte";
	import ProfileTimezone from "./ProfileTimezone.svelte";
	import ParentPinSettings from "./ParentPinSettings.svelte";
	import ChildPinSettings from "./ChildPinSettings.svelte";
	import ResourceSettings from "./ResourceSettings.svelte";
	import AppIcon from "../components/display/AppIcon.svelte";
	import ArrowRight from "lucide-svelte/icons/arrow-right";
	import LogOut from "lucide-svelte/icons/log-out";
	import ArrowLeft from "lucide-svelte/icons/arrow-left";
	import Plus from "lucide-svelte/icons/plus";
	import Check from "lucide-svelte/icons/check";
	import Camera from "lucide-svelte/icons/camera";
	import UserRound from "lucide-svelte/icons/user-round";
	import GraduationCap from "lucide-svelte/icons/graduation-cap";
	import ShieldCheck from "lucide-svelte/icons/shield-check";
	import Plug from "lucide-svelte/icons/plug";
	import X from "lucide-svelte/icons/x";
	import UserMinus from "lucide-svelte/icons/user-minus";

	const runtime = getContext<Runtime>("vulture:runtime");
	const steps = ["Your profile", "Your family", "Children", "Services"];
	const titles = ["Your profile", "Name your family", "Add your children", "Make it yours"];
	let step = $state(0);
	let loading = $state(true);
	let loadFailed = $state(false);
	let busy = $state(false);
	let error = $state("");
	let notice = $state("");
	let family = $state<FamilyRecord | null>(null);
	let familyName = $state("");
	let familyPicture = $state<string | null>(null);
	let pictureDraft = $state<File | null>(null);
	let profiles = $state<LearningProfile[]>([]);
	let candidates = $state<GuardianCandidate[]>([]);
	let guardianPicker = $state(false);
	let guardianUserId = $state("");
	let guardianPage = $state(0);
	const guardianMatches = $derived(
		candidates.filter(
			(candidate) =>
				!selected?.guardianAccountIds.includes(candidate.accountId) &&
				`${candidate.displayName} ${candidate.accountId}`
					.toLocaleLowerCase()
					.includes(guardianSearch.toLocaleLowerCase()),
		),
	);
	const guardianPages = $derived(Math.max(1, Math.ceil(guardianMatches.length / 3)));
	const currentGuardianPage = $derived(Math.min(guardianPage, guardianPages - 1));
	let guardianSearch = $state("");
	let guardianIds = $state<string[]>([]);
	let guardianLoading = $state(false);
	let selectedId = $state("");
	let childExpanded = $state<Record<string, boolean>>({});
	let childSections = $state<
		Record<
			string,
			{
				personal?: boolean;
				school?: boolean;
				pin?: boolean;
				guardian?: boolean;
			}
		>
	>({});
	let adding = $state(false);
	let childIndex = $state(0);
	let childDirection = $state(1);
	let childDraft = $state({
		name: "",
		dob: "",
		grade: "",
		autoGrade: false,
		month: 9,
		day: 1,
		country: "",
		region: "",
	});
	let childName = $state("");
	let childDob = $state("");
	const today = new Date().toISOString().slice(0, 10);
	let grade = $state("");
	let autoGrade = $state(false);
	let schoolMonth = $state(9);
	let schoolDay = $state(1);
	let country = $state("");
	let region = $state("");

	let avatar = $state<string | null>(null);
	let disposed = false;
	const selected = $derived(profiles.find((profile) => profile.id === selectedId));
	const personalDirty = $derived(
		!!selected &&
			(childName !== selected.displayName ||
				childDob !== (selected.progression?.dateOfBirth ?? "")),
	);
	const pending = $derived(loading || busy || loadFailed);

	function message(cause: unknown) {
		return cause instanceof Error ? cause.message : "Could not save. Please try again.";
	}
	async function load() {
		loading = true;
		loadFailed = false;
		error = "";
		try {
			family = await runtime.services.family.getMyFamily();
			familyName = family?.name ?? "";
			if (family && !familyPicture) {
				try {
					const picture = await runtime.services.family.getFamilyAvatar(family.id);
					if (picture && !disposed)
						familyPicture = URL.createObjectURL(
							new Blob([new Uint8Array(picture.image)], { type: picture.contentType }),
						);
				} catch {
					/* Keep the default picture available. */
				}
			}
			runtime.state.familyId = family?.id ?? null;
			profiles = family ? await runtime.services.learning.listProfiles(family.id) : [];
		} catch (cause) {
			loadFailed = true;
			error = message(cause);
		} finally {
			loading = false;
		}
	}
	onMount(() => {
		void load();
		void (async () => {
			const id = runtime.state.identity?.id;
			if (!id) return;
			try {
				const picture = await runtime.services.family.getAvatar(id);
				if (picture && !avatar && !disposed)
					avatar = URL.createObjectURL(
						new Blob([new Uint8Array(picture.image)], { type: picture.contentType }),
					);
			} catch {
				/* Keep the identity-provider picture or initial available. */
			}
		})();
	});
	onDestroy(() => {
		disposed = true;
		if (avatar) URL.revokeObjectURL(avatar);
		if (familyPicture) URL.revokeObjectURL(familyPicture);
	});
	function rememberChildDraft() {
		if (adding)
			childDraft = {
				name: childName,
				dob: childDob,
				grade,
				autoGrade,
				month: schoolMonth,
				day: schoolDay,
				country,
				region,
			};
	}
	function beginAddChild() {
		if (pending || adding) return;
		childDirection = 1;
		childIndex = profiles.length;
		selectedId = "";
		closeGuardianPicker();
		adding = true;
		childName = childDraft.name;
		childDob = childDraft.dob;
		grade = childDraft.grade;
		autoGrade = childDraft.autoGrade;
		schoolMonth = childDraft.month;
		schoolDay = childDraft.day;
		country = childDraft.country;
		region = childDraft.region;
	}
	function moveChild(index: number) {
		if (pending || index < 0 || index > profiles.length || index === childIndex) return;
		rememberChildDraft();
		childDirection = index > childIndex ? 1 : -1;
		if (index === profiles.length) {
			adding = false;
			beginAddChild();
		} else {
			childIndex = index;
			loadChild(profiles[index]);
			selectedId = childExpanded[profiles[index].id] ? profiles[index].id : "";
		}
	}
	function cancelNewChild() {
		rememberChildDraft();
		if (profiles.length) moveChild(profiles.length - 1);
		else {
			childDraft = {
				name: "",
				dob: "",
				grade: "",
				autoGrade: false,
				month: 9,
				day: 1,
				country: "",
				region: "",
			};
			adding = false;
			beginAddChild();
		}
	}
	function go(index: number) {
		if (pending || (index > 1 && !family)) return;
		if (index !== 2) {
			rememberChildDraft();
			adding = false;
		}
		step = index;
		if (index === 2 && !adding && childIndex >= profiles.length) beginAddChild();
		error = "";
		notice = "";
	}
	async function next() {
		if (pending) return;
		if (step === 1) {
			if (!familyName.trim()) {
				error = "Enter a family name.";
				return;
			}
			busy = true;
			error = "";
			try {
				family = family
					? familyName.trim() === family.name
						? family
						: await runtime.services.family.renameFamily(familyName.trim())
					: await runtime.services.family.createFamily(familyName.trim());
				runtime.state.familyId = family.id;
				if (pictureDraft) {
					await runtime.services.family.setFamilyAvatar(
						new Uint8Array(await pictureDraft.arrayBuffer()),
						pictureDraft.type,
					);
					pictureDraft = null;
				}
			} catch (cause) {
				error = message(cause);
				return;
			} finally {
				busy = false;
			}
		}
		if (step === 3) runtime.router.navigate("home:parent");
		else go(step + 1);
	}
	async function upload(file?: File) {
		if (!file || pending) return;
		busy = true;
		error = "";
		try {
			const photo = await preparePhoto(file);
			await runtime.services.family.setAvatar(
				new Uint8Array(await photo.arrayBuffer()),
				photo.type,
			);
			if (avatar) URL.revokeObjectURL(avatar);
			avatar = URL.createObjectURL(photo);
			notice = "Photo updated.";
		} catch (cause) {
			error = message(cause);
		} finally {
			busy = false;
		}
	}
	async function uploadFamily(file?: File) {
		if (!file || pending) return;
		busy = true;
		error = "";
		notice = "Preparing photo…";
		try {
			const photo = await preparePhoto(file);
			if (disposed) return;
			const preview = URL.createObjectURL(photo);
			if (familyPicture) URL.revokeObjectURL(familyPicture);
			familyPicture = preview;
			pictureDraft = photo;
		} catch (cause) {
			error = message(cause);
		} finally {
			busy = false;
			notice = "";
		}
	}
	function rememberSection(
		node: globalThis.HTMLDetailsElement,
		{ id, section }: { id: string; section: "personal" | "school" | "guardian" },
	) {
		node.open = childSections[id]?.[section] ?? false;
		return animateDetails(node, (open) => {
			childSections[id] = { ...childSections[id], [section]: open };
		});
	}
	function chooseChild(profile: LearningProfile) {
		const open = selectedId !== profile.id;
		childExpanded[profile.id] = open;
		loadChild(profile);
		selectedId = open ? profile.id : "";
	}
	function loadChild(profile: LearningProfile) {
		closeGuardianPicker();
		adding = false;
		childName = profile.displayName;
		grade = profile.grade;
		const p = profile.progression;
		childDob = p?.dateOfBirth ?? "";
		autoGrade = p?.autoGrade ?? false;
		schoolMonth = p?.schoolYearMonth ?? 9;
		schoolDay = p?.schoolYearDay ?? 1;
		country = p?.country ?? "";
		region = p?.region ?? "";
	}
	function cancelPersonal() {
		if (!selected) return;
		childName = selected.displayName;
		childDob = selected.progression?.dateOfBirth ?? "";
		error = "";
	}
	async function savePersonal(event: globalThis.SubmitEvent) {
		event.preventDefault();
		if (!selected || pending || !personalDirty) return;
		const name = childName.trim();
		if (
			!name ||
			[...name].length > 80 ||
			[...name].some(
				(char) =>
					char.charCodeAt(0) < 32 || (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159),
			)
		) {
			error = "Enter a child name with 1–80 characters.";
			return;
		}
		busy = true;
		error = "";
		try {
			if (childDob) ageBandFromDob(childDob);
			const updated = await runtime.services.learning.updateProgression(
				selected.id,
				selected.grade,
				childDob
					? {
							...(selected.progression ?? {
								autoGrade: false,
								schoolYearMonth: 9,
								schoolYearDay: 1,
								country: "",
								region: "",
							}),
							dateOfBirth: childDob,
						}
					: undefined,
				name,
			);
			profiles = profiles.map((profile) => (profile.id === updated.id ? updated : profile));
			childName = updated.displayName;
			childDob = updated.progression?.dateOfBirth ?? "";
		} catch (cause) {
			error = message(cause);
		} finally {
			busy = false;
		}
	}
	async function saveProgression(event: globalThis.SubmitEvent) {
		event.preventDefault();
		if (!selected || pending) return;
		busy = true;
		error = "";
		notice = "";
		try {
			const profile = await runtime.services.learning.updateProgression(
				selected.id,
				grade,
				selected.progression?.dateOfBirth
					? {
							dateOfBirth: selected.progression.dateOfBirth,
							autoGrade,
							schoolYearMonth: schoolMonth,
							schoolYearDay: schoolDay,
							country,
							region,
						}
					: undefined,
			);
			profiles = profiles.map((p) => (p.id === profile.id ? profile : p));
			notice = "School calendar saved.";
		} catch (cause) {
			error = message(cause);
		} finally {
			busy = false;
		}
	}
	async function createChild(event: globalThis.SubmitEvent) {
		event.preventDefault();
		if (!family || pending) return;
		busy = true;
		error = "";
		notice = "";
		try {
			const profile = await runtime.services.learning.createProfile({
				familyId: family.id,
				displayName: childName,
				ageBand: ageBandFromDob(childDob),
				grade,
				progression: {
					dateOfBirth: childDob,
					autoGrade,
					schoolYearMonth: schoolMonth,
					schoolYearDay: schoolDay,
					country,
					region,
				},
			});
			profiles = [...profiles, profile];
			childIndex = profiles.length - 1;
			childDraft = {
				name: "",
				dob: "",
				grade: "",
				autoGrade: false,
				month: 9,
				day: 1,
				country: "",
				region: "",
			};
			childName = "";
			childDob = "";
			grade = "";
			autoGrade = false;
			adding = false;
			chooseChild(profile);
		} catch (cause) {
			error = message(cause);
		} finally {
			busy = false;
		}
	}
	async function loadGuardians() {
		if (!family) return;
		guardianLoading = true;
		try {
			candidates = await runtime.services.learning.listEligibleGuardians(family.id);
		} catch (cause) {
			error = message(cause);
		} finally {
			guardianLoading = false;
		}
	}
	function closeGuardianPicker() {
		guardianPicker = false;
		guardianUserId = "";
		guardianSearch = "";
		guardianPage = 0;
		guardianIds = [];
	}
	function addGuardianChip() {
		const accountId = guardianUserId.trim();
		if (
			accountId &&
			!guardianIds.includes(accountId) &&
			!selected?.guardianAccountIds.includes(accountId)
		)
			guardianIds = [...guardianIds, accountId];
		guardianUserId = "";
	}
	function openGuardianPicker() {
		if (!guardianPicker) {
			guardianPicker = true;
			void loadGuardians();
		}
	}
	function guardianReveal(node: globalThis.HTMLElement) {
		return {
			duration: node.ownerDocument.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)")
				.matches
				? 0
				: 180,
			easing: (t: number) => 1 - Math.pow(1 - t, 3),
			css: (t: number) => `opacity: ${t}; transform: scaleY(${0.96 + 0.04 * t});`,
		};
	}
	function guardianOverlay(node: globalThis.HTMLDivElement) {
		const anchor = node.closest(".guardian-editor")!.querySelector(".guardian-input-row")!;
		function position() {
			const rect = anchor.getBoundingClientRect();
			node.style.width = `${Math.min(rect.width, globalThis.innerWidth - 24)}px`;
			node.style.left = `${Math.max(12, Math.min(rect.left, globalThis.innerWidth - node.offsetWidth - 12))}px`;
			const below = globalThis.innerHeight - rect.bottom - 12;
			const above = rect.top - 12;
			const upward = node.scrollHeight > below && above > below;
			node.dataset.side = upward ? "above" : "below";
			(node.closest(".guardian-editor") as globalThis.HTMLElement).dataset.side = node.dataset.side;
			node.style.maxHeight = `${Math.max(100, upward ? above : below)}px`;
			node.style.top = `${upward ? Math.max(12, rect.top - node.offsetHeight) : rect.bottom}px`;
		}
		if (node.showPopover) node.showPopover();
		else node.removeAttribute("popover");
		position();
		const observer =
			typeof globalThis.ResizeObserver === "function"
				? new globalThis.ResizeObserver(position)
				: undefined;
		observer?.observe(anchor);
		observer?.observe(node);
		globalThis.addEventListener("resize", position);
		globalThis.addEventListener("scroll", position, true);
		return {
			destroy() {
				observer?.disconnect();
				globalThis.removeEventListener("resize", position);
				globalThis.removeEventListener("scroll", position, true);
				if (node.hidePopover && node.matches(":popover-open")) node.hidePopover();
			},
		};
	}
	async function saveGuardians() {
		if (!selected || pending || !guardianIds.length) return;
		const profileId = selected.id;
		busy = true;
		error = "";
		try {
			for (const accountId of [...guardianIds]) {
				const updated = await runtime.services.learning.addGuardian(profileId, accountId);
				profiles = profiles.map((profile) => (profile.id === updated.id ? updated : profile));
				guardianIds = guardianIds.filter((id) => id !== accountId);
			}
			closeGuardianPicker();
		} catch (cause) {
			error = message(cause);
		} finally {
			busy = false;
		}
	}
	async function guardian(accountId: string, remove = false) {
		if (!selected || pending) return;
		busy = true;
		error = "";
		try {
			const updated = remove
				? await runtime.services.learning.removeGuardian(selected.id, accountId)
				: await runtime.services.learning.addGuardian(selected.id, accountId);
			profiles = profiles.map((profile) => (profile.id === updated.id ? updated : profile));
			if (!updated.guardianAccountIds.includes(runtime.state.identity?.id ?? "")) {
				profiles = profiles.filter((profile) => profile.id !== updated.id);
				selectedId = "";
			}
			closeGuardianPicker();
		} catch (cause) {
			error = message(cause);
		} finally {
			busy = false;
		}
	}
</script>

<svelte:window
	onclick={(event) => {
		if (
			guardianPicker &&
			event.target instanceof globalThis.Element &&
			!event.target.closest(".guardian-editor")
		)
			guardianPicker = false;
	}}
	onkeydown={(event) => {
		if (event.key === "Escape") guardianPicker = false;
	}}
/>

<section class="setup" aria-labelledby="setup-title">
	<div class="masthead">
		<span class="app-mark" aria-label="Vulture"><AppIcon size={32} /></span>
		<span class="setup-label"
			><span class="wide-label">Family Setup</span><span class="small-label">Setup</span></span
		>
	</div>
	<div class="stage-content">
		<nav aria-label="Family setup steps">
			{#each steps as label, index (label)}
				<button
					type="button"
					aria-label={`${index + 1} ${label}`}
					aria-current={step === index ? "step" : undefined}
					disabled={pending || (index > 1 && !family)}
					onclick={() => go(index)}
					class:complete={index < step}
					class:active={index === step}><span class="sr-only">{label}</span></button
				>
			{/each}
		</nav>
		<header>
			<p class="sr-only" aria-live="polite">
				Stage {step + 1} of {steps.length}
			</p>
			<div class="stage-heading">
				<h1 id="setup-title">{titles[step]}</h1>
				{#if step === 2}
					<IconButton icon={Plus} label="Add a child" disabled={pending} onclick={beginAddChild} />
				{/if}
			</div>
			{#if step === 1}
				<p class="name-hint">
					Click on “{family?.name || "The Morgans"}” to change it.
				</p>
			{/if}
		</header>
		{#if error}<ErrorToast message={error} />
			{#if loadFailed}<Button variant="ghost" onclick={() => void load()}>Try again</Button
				>{/if}{/if}
		{#if notice}<p role="status">{notice}</p>{/if}
		{#if loading}<p role="status">Loading your family…</p>
		{:else}
			<div class="body">
				{#if step === 0}
					<div class="profile">
						<label class="avatar" aria-label="Change profile picture">
							{#if avatar || runtime.state.identity?.picture}<img
									src={avatar ?? runtime.state.identity?.picture}
									alt=""
								/>{:else}<span>{runtime.state.identity?.name?.charAt(0) ?? "?"}</span>{/if}
							<span class="camera"><Camera size={14} /></span>
							<input
								type="file"
								accept="image/*,.heic,.heif"
								disabled={pending}
								onchange={(event) => void upload(event.currentTarget.files?.[0])}
							/>
						</label>
						<div>
							<strong>{runtime.state.identity?.name ?? "Your profile"}</strong>
							<p>Tap your photo to change it.</p>
						</div>
					</div>
				{:else if step === 1}
					<div class="family-picture">
						{#if familyPicture}
							<img src={familyPicture} alt="Family preview" />
						{:else}
							<svg
								class="default-picture"
								viewBox="0 0 480 260"
								preserveAspectRatio="xMidYMid slice"
								role="img"
								aria-label="Default family picture"
							>
								<rect width="480" height="260" fill="#d9e9e5" />
								<circle cx="370" cy="55" r="32" fill="#f8e8bc" />
								<path d="M0 170Q100 70 240 165T480 135V260H0Z" fill="#aac8bc" />
								<path d="M0 215Q200 120 480 220V260H0Z" fill="#7da99b" />
								<path d="M162 140L240 80L318 140V220H162Z" fill="#fbf3e3" />
								<path
									d="M150 143L240 72L330 143"
									fill="none"
									stroke="#557b74"
									stroke-width="12"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
								<rect x="223" y="165" width="34" height="55" rx="5" fill="#557b74" />
								<rect x="181" y="151" width="24" height="24" rx="4" fill="#d9e9e5" />
								<rect x="275" y="151" width="24" height="24" rx="4" fill="#d9e9e5" />
							</svg>
						{/if}
						<label class="picture-upload">
							<Camera size={18} aria-hidden="true" />
							<input
								type="file"
								aria-label="Upload family picture"
								accept="image/*,.heic,.heif"
								disabled={pending}
								onchange={(event) => void uploadFamily(event.currentTarget.files?.[0])}
							/>
						</label>
						<label class="family-name">
							<input
								aria-label="Family name"
								bind:value={familyName}
								autocomplete="organization"
								placeholder="The Morgans"
								maxlength="80"
								disabled={pending}
								onkeydown={(event) => {
									if (event.key === "Enter") void next();
								}}
							/>
						</label>
					</div>
				{:else if step === 2}
					<p class="hint">A profile and a private PIN for each child.</p>
					<div class="child-carousel">
						{#key childIndex}
							<div
								class="child-pane"
								in:fly={{
									x: childDirection * 420,
									duration: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
										? 0
										: 240,
								}}
								out:fly={{
									x: -childDirection * 420,
									duration: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
										? 0
										: 240,
								}}
							>
								<ul class="children" aria-label="Child profiles">
									{#each profiles.filter((_, index) => !adding && index === childIndex) as profile (profile.id)}
										<li class="child-card">
											<button
												type="button"
												class="child"
												aria-expanded={selectedId === profile.id}
												disabled={pending}
												onclick={() => chooseChild(profile)}
												><span class="initial">{profile.displayName.charAt(0)}</span><span
													><strong>{profile.displayName}</strong><small
														>{ageBands[profile.ageBand]}</small
													></span
												></button
											>
											{#if selectedId === profile.id}<div
													class="child-settings"
													transition:slide={{
														duration: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")
															.matches
															? 0
															: 240,
													}}
												>
													<details
														class="personal"
														use:rememberSection={{
															id: profile.id,
															section: "personal",
														}}
													>
														<summary
															><UserRound
																size={15}
																strokeWidth={1.6}
																aria-hidden="true"
															/>Personal</summary
														>
														<div class="accordion-body">
															<form class="personal-form" onsubmit={savePersonal}>
																<div class="child-basics">
																	<label
																		><span class="sr-only">Child's name</span><input
																			bind:value={childName}
																			maxlength="80"
																			disabled={pending}
																			placeholder="Child full name"
																		/></label
																	>
																	<label
																		><span class="sr-only">Date of birth</span><span
																			aria-hidden="true"
																			class="dob-placeholder"
																			class:hidden={!!childDob}>DOB</span
																		><input
																			aria-label="Date of birth"
																			class:empty={!childDob}
																			type="date"
																			bind:value={childDob}
																			max={today}
																			required={!!profile.progression?.dateOfBirth}
																			disabled={pending}
																		/></label
																	>
																</div>
																{#if personalDirty}
																	<div class="personal-actions">
																		<IconButton
																			icon={X}
																			label="Cancel personal changes"
																			disabled={pending}
																			onclick={cancelPersonal}
																		/>
																		<IconButton
																			icon={Check}
																			label="Save personal changes"
																			type="submit"
																			disabled={pending}
																		/>
																	</div>
																{/if}
															</form>
															<ProfileTimezone
																service={runtime.services.timetable}
																profileId={profile.id}
																flat
															/>
														</div>
													</details>
													<details
														class="school-calendar"
														use:rememberSection={{
															id: profile.id,
															section: "school",
														}}
													>
														<summary
															><GraduationCap size={15} strokeWidth={1.6} aria-hidden="true" />Grade
															and school calendar</summary
														>
														<div class="accordion-body">
															<form id={`school-calendar-${profile.id}`} onsubmit={saveProgression}>
																<GradeSettings
																	bind:grade
																	bind:autoGrade
																	bind:schoolMonth
																	bind:schoolDay
																	bind:country
																	bind:region
																	{pending}
																/>
																<Button type="submit" disabled={pending}
																	>Save school calendar</Button
																>
															</form>
														</div>
													</details>
													{#key profile.id}<ChildPinSettings
															flat
															initialOpen={childSections[profile.id]?.pin ?? false}
															onOpenChange={(open) => {
																childSections[profile.id] = {
																	...childSections[profile.id],
																	pin: open,
																};
															}}
															auth={runtime.services.auth}
															profileId={profile.id}
															displayName={profile.displayName}
														/>{/key}
													<details
														class="guardian-access"
														use:rememberSection={{
															id: profile.id,
															section: "guardian",
														}}
													>
														<summary
															><ShieldCheck
																size={15}
																strokeWidth={1.6}
																aria-hidden="true"
															/>Guardian access</summary
														>
														<div class="accordion-body guardian-body">
															<div class="guardian-editor" class:expanded={guardianPicker}>
																<div class="guardian-input-row">
																	<div class="guardian-chips">
																		{#each guardianIds as accountId (accountId)}
																			<span class="guardian-chip">
																				<span
																					>{candidates.find(
																						(candidate) => candidate.accountId === accountId,
																					)?.displayName ?? accountId}</span
																				>
																				<IconButton
																					icon={X}
																					label={`Remove ${accountId} from selection`}
																					disabled={pending}
																					onclick={() =>
																						(guardianIds = guardianIds.filter(
																							(id) => id !== accountId,
																						))}
																				/>
																			</span>
																		{/each}
																		<input
																			aria-label="Guardian user ID"
																			placeholder="Enter user ID"
																			bind:value={guardianUserId}
																			disabled={pending}
																			onfocus={openGuardianPicker}
																			onclick={openGuardianPicker}
																			onkeydown={(event) => {
																				if (event.key === "Enter" || event.key === ",") {
																					event.preventDefault();
																					addGuardianChip();
																				}
																				if (event.key === "Escape") guardianPicker = false;
																			}}
																		/>
																	</div>
																	{#if guardianIds.length}
																		<div class="guardian-form-actions">
																			<IconButton
																				icon={Check}
																				label="Save guardians"
																				disabled={pending ||
																					(!guardianIds.length && !guardianUserId.trim())}
																				onclick={() => {
																					addGuardianChip();
																					void saveGuardians();
																				}}
																			/>
																			<IconButton
																				icon={X}
																				label="Cancel adding guardians"
																				disabled={pending}
																				onclick={closeGuardianPicker}
																			/>
																		</div>
																	{/if}
																</div>
																{#if guardianPicker}
																	<div
																		class="guardian-picker"
																		popover="manual"
																		use:guardianOverlay
																		transition:guardianReveal
																		role="group"
																		aria-label="Choose guardians"
																	>
																		<input
																			type="search"
																			aria-label="Search guardians"
																			placeholder="Type here to search"
																			bind:value={guardianSearch}
																			oninput={() => (guardianPage = 0)}
																			disabled={pending}
																		/>
																		<div class="guardian-options">
																			{#if guardianLoading}<p role="status">
																					Loading parents…
																				</p>{:else}
																				{#each guardianMatches.slice(currentGuardianPage * 3, currentGuardianPage * 3 + 3) as candidate (candidate.accountId)}
																					<label class="guardian-option"
																						><input
																							type="checkbox"
																							value={candidate.accountId}
																							bind:group={guardianIds}
																							disabled={pending}
																						/><span>{candidate.displayName}</span></label
																					>
																				{:else}<p>No matching parents.</p>{/each}
																			{/if}
																		</div>
																		<div class="guardian-pagination">
																			<IconButton
																				icon={ArrowLeft}
																				label="Previous guardian page"
																				disabled={pending || currentGuardianPage === 0}
																				onclick={() => (guardianPage = currentGuardianPage - 1)}
																			/>
																			<span>Page {currentGuardianPage + 1} of {guardianPages}</span>
																			<IconButton
																				icon={ArrowRight}
																				label="Next guardian page"
																				disabled={pending ||
																					currentGuardianPage + 1 >= guardianPages}
																				onclick={() => (guardianPage = currentGuardianPage + 1)}
																			/>
																		</div>
																	</div>
																{/if}
															</div>
															<div class="guardian-content">
																{#each profile.guardianAccountIds as accountId (accountId)}
																	<div class="guardian">
																		<span
																			>{accountId === runtime.state.identity?.id
																				? "You"
																				: (candidates.find(
																						(candidate) => candidate.accountId === accountId,
																					)?.displayName ?? "Family parent")}</span
																		><IconButton
																			icon={UserMinus}
																			label="Remove guardian"
																			disabled={pending || profile.guardianAccountIds.length <= 1}
																			onclick={() => void guardian(accountId, true)}
																		/>
																	</div>
																{/each}
															</div>
														</div>
													</details>
												</div>{/if}
										</li>
									{/each}
								</ul>
								{#if adding}
									<form class="add-child" onsubmit={createChild}>
										<div class="child-basics">
											<label
												><span class="sr-only">Child's name</span><input
													bind:value={childName}
													required
													maxlength="80"
													autocomplete="off"
													disabled={pending}
													placeholder="Child full name"
												/></label
											>
											<label
												><span class="sr-only">Date of birth</span><span
													aria-hidden="true"
													class="dob-placeholder"
													class:hidden={!!childDob}>DOB</span
												><input
													aria-label="Date of birth"
													class:empty={!childDob}
													type="date"
													bind:value={childDob}
													required
													max={today}
													disabled={pending}
												/></label
											>
										</div>
										<p class="child-help">
											Enter the full name and date of birth to keep the age group current.
										</p>
										<details class="school-calendar" use:animateDetails>
											<summary
												><GraduationCap size={15} strokeWidth={1.6} aria-hidden="true" />Grade and
												school calendar</summary
											>
											<div class="accordion-body">
												<GradeSettings
													bind:grade
													bind:autoGrade
													bind:schoolMonth
													bind:schoolDay
													bind:country
													bind:region
													{pending}
												/>
											</div>
										</details>
										<div class="actions">
											<Button type="submit" disabled={pending || !childName.trim()}
												>Add child</Button
											><Button variant="ghost" disabled={pending} onclick={cancelNewChild}
												>Cancel</Button
											>
										</div>
									</form>
								{/if}
							</div>
						{/key}
					</div>
					<div class="child-navigation" aria-label="Child profiles navigation">
						<IconButton
							icon={ArrowLeft}
							label="Previous child"
							disabled={pending || childIndex === 0}
							onclick={() => moveChild(childIndex - 1)}
						/>
						<span aria-live="polite"
							>{adding ? "New child" : `${childIndex + 1} of ${profiles.length}`}</span
						>
						<IconButton
							icon={ArrowRight}
							label="Next child"
							disabled={pending || childIndex >= profiles.length}
							onclick={() => moveChild(childIndex + 1)}
						/>
					</div>
				{:else}
					<div class="ready">
						<span class="ready-icon"><Check size={22} /></span>
						<div>
							<strong>{family?.name} is ready.</strong>
							<p>You can connect storage and AI now or later.</p>
						</div>
					</div>
					<ParentPinSettings
						auth={runtime.services.auth}
						onForgot={() => void runtime.forgotParentPin()}
					/>
					<details class="services" use:animateDetails>
						<summary
							><Plug size={15} strokeWidth={1.6} aria-hidden="true" />Connect family services</summary
						>
						<div class="accordion-body services-body">
							<ResourceSettings
								embedded
								service={runtime.services.resources}
								familyAi={runtime.services.familyAi}
							/>
						</div>
					</details>
				{/if}
			</div>
		{/if}
	</div>
	<footer>
		{#if step === 0}
			<IconButton
				label="Exit setup"
				icon={LogOut}
				disabled={busy}
				onclick={() => runtime.router.navigate("home:parent")}
			/>
		{:else}
			<IconButton label="Back" icon={ArrowLeft} disabled={pending} onclick={() => go(step - 1)} />
		{/if}
		<IconButton
			label={busy ? "Saving…" : step === 3 ? "Finish setup" : "Continue"}
			icon={ArrowRight}
			disabled={pending || adding}
			onclick={() => void next()}
		/>
	</footer>
</section>

<style>
	.setup {
		position: relative;
		width: min(100%, 480px);
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		margin: 0 auto;
		color: var(--v-fg);
		background: color-mix(in srgb, var(--v-surface) 88%, transparent);
		border: 1px solid color-mix(in srgb, var(--v-fg) 10%, transparent);
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 28%),
			0 16px 48px color-mix(in srgb, var(--v-fg) 6%, transparent);
		border-radius: 48px;
		overflow: hidden;
		/* Clip without a scroll container so focusing embedded editors cannot shift the card. */
		overflow: clip;
	}
	@supports (backdrop-filter: blur(20px)) or (-webkit-backdrop-filter: blur(20px)) {
		.setup {
			background:
				linear-gradient(135deg, rgb(255 255 255 / 12%), transparent 60%),
				color-mix(in srgb, var(--v-surface) 60%, transparent);
			-webkit-backdrop-filter: blur(24px) saturate(140%);
			backdrop-filter: blur(24px) saturate(140%);
		}
	}
	.masthead {
		display: flex;
		justify-content: space-between;
		align-items: center;
		min-height: 72px;
		padding: 0 28px;
		font-size: 0.8rem;
		color: var(--v-muted);
	}
	.stage-content {
		padding: 4px 28px 24px;
		min-height: 220px;
	}
	.app-mark {
		display: grid;
		place-items: center;
	}
	.setup-label {
		font-weight: 600;
		font-size: 0.85rem;
		color: var(--v-fg);
	}
	.small-label {
		display: none;
	}
	nav {
		display: flex;
		gap: 8px;
		margin-bottom: 1rem;
	}
	nav button {
		flex: 1;
		height: 24px;
		padding: 10px 0;
		background: transparent;
		border: 0;
		cursor: pointer;
		position: relative;
	}
	nav button::after {
		content: "";
		display: block;
		height: 4px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--v-fg) 10%, transparent);
		transition: background 160ms ease;
	}
	nav button.active::after {
		background: var(--v-primary);
	}
	nav button.complete::after {
		background: color-mix(in srgb, var(--v-primary) 55%, transparent);
	}
	nav button:disabled {
		cursor: default;
	}
	h1 {
		font-size: 1.4rem;
		font-weight: 650;
		letter-spacing: -0.04em;
		line-height: 1.2;
		margin: 0;
	}
	header {
		margin-bottom: 1rem;
	}
	.body {
		display: grid;
		align-content: start;
		gap: 1rem;
	}
	.name-hint {
		margin: 6px 0 0;
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--v-muted);
	}
	.family-picture {
		position: relative;
		isolation: isolate;
		overflow: hidden;
		border-radius: 20px;
		background: var(--v-bg);
		height: 220px;
	}
	.family-picture > img,
	.default-picture {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.family-picture::after {
		content: "";
		position: absolute;
		inset: 35% 0 0;
		background: linear-gradient(transparent, rgb(0 0 0 / 58%));
		pointer-events: none;
	}
	.picture-upload {
		position: absolute;
		top: 12px;
		right: 12px;
		z-index: 1;
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border-radius: 50%;
		background: rgb(255 255 255 / 80%);
		color: #183c35;
		cursor: pointer;
	}
	.picture-upload input {
		position: absolute;
		inset: 0;
		opacity: 0;
		width: 100%;
		height: 100%;
		cursor: pointer;
	}
	.picture-upload:focus-within {
		outline: 2px solid var(--v-primary);
		outline-offset: 3px;
	}
	.family-name {
		position: absolute;
		z-index: 1;
		bottom: 14px;
		left: 16px;
		right: 16px;
		color: white;
		gap: 4px;
	}
	.family-name input {
		color: white;
		background: transparent;
		border: 0;
		outline: none;
		font-size: 1.1rem;
		min-height: 44px;
		padding: 8px 10px;
	}
	.family-name input:focus-visible {
		outline: none;
		background: rgb(255 255 255 / 8%);
	}
	.family-name input::placeholder {
		color: rgb(255 255 255 / 75%);
	}
	.profile {
		display: flex;
		gap: 1rem;
		align-items: center;
		padding-block: 0.5rem;
	}
	.profile p,
	.ready p {
		color: var(--v-muted);
		font-size: 0.85rem;
		margin: 0.35rem 0 0;
		line-height: 1.5;
	}
	.avatar {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		background: color-mix(in srgb, var(--v-primary) 10%, var(--v-bg));
		position: relative;
		flex-shrink: 0;
		display: grid;
		place-items: center;
		cursor: pointer;
		font-size: 1.5rem;
		color: var(--v-primary);
	}
	.avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		border-radius: 50%;
	}
	.avatar input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
	}
	.camera {
		position: absolute;
		bottom: -2px;
		right: -2px;
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: var(--v-surface);
		border: 1px solid var(--v-border);
	}
	label,
	form {
		display: grid;
		gap: 0.55rem;
		font-size: 0.85rem;
	}
	form {
		gap: 1.2rem;
	}
	input {
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
		min-height: 46px;
		padding: 0.7rem 0.85rem;
		border: 1px solid var(--v-border);
		border-radius: 8px;
		background: var(--v-surface);
		color: var(--v-fg);
		font: inherit;
	}
	button:focus-visible,
	summary:focus-visible,
	.avatar:focus-within {
		outline: 2px solid var(--v-primary);
		outline-offset: 3px;
	}
	details {
		font-size: 0.85rem;
		color: var(--v-muted);
	}
	summary {
		cursor: pointer;
		padding-block: 0.5rem;
	}

	.hint {
		font-size: 0.9rem;
		color: var(--v-muted);
		margin: -0.8rem 0 0;
	}
	.child-navigation {
		display: flex;
		align-items: center;
		gap: 4px;
		justify-content: center;
		margin-top: 8px;
	}
	.child-navigation > span {
		font-size: 0.7rem;
		color: var(--v-muted);
		min-width: 72px;
		text-align: center;
	}
	.child-carousel {
		display: grid;
		overflow: hidden;
	}
	.child-pane {
		grid-area: 1 / 1;
		min-width: 0;
	}
	.children {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.children li {
		border: 1px solid color-mix(in srgb, var(--v-fg) 12%, transparent);
		border-radius: 14px;
		margin-bottom: 12px;
		padding-inline: 12px;
	}
	.child {
		display: flex;
		width: 100%;
		text-align: left;
		align-items: center;
		gap: 0.8rem;
		padding: 1rem 0;
		border: 0;
		background: transparent;
		color: var(--v-fg);
		font: inherit;
		cursor: pointer;
	}
	.initial {
		width: 36px;
		height: 36px;
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: var(--v-surface);
		font-size: 0.85rem;
	}
	.child strong {
		display: block;
		font-size: 0.9rem;
		font-weight: 600;
	}
	small {
		color: var(--v-muted);
		font-size: 0.75rem;
	}

	.child-settings {
		display: grid;
		margin-inline: -12px;
		gap: 0;
		padding: 0 0 12px;
		border-top: 1px solid color-mix(in srgb, var(--v-fg) 7%, transparent);
	}

	.child-settings > :global(*) {
		box-sizing: border-box;
		padding-inline: 12px;
	}
	.child-settings > :global(:not(:first-child)) {
		border-top: 1px solid color-mix(in srgb, var(--v-fg) 7%, transparent);
	}
	.child-settings .school-calendar,
	.child-settings .guardian-access {
		border: 0;
		border-radius: 0;
		padding-inline: 12px;
	}
	.personal > summary {
		display: flex;
		align-items: center;
		gap: 8px;
		list-style: none;
		padding: 16px 0;
		font-size: 0.75rem;
		font-weight: 500;
	}
	.personal > summary::-webkit-details-marker {
		display: none;
	}
	.personal-form {
		padding-bottom: 12px;
	}
	.personal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
	.child-settings > .school-calendar:not(:first-child) {
		border-top: 1px solid color-mix(in srgb, var(--v-fg) 7%, transparent);
	}
	.child-settings .personal > summary,
	.child-settings .school-calendar > summary,
	.child-settings .guardian-access > summary {
		margin-inline: -12px;
		padding-inline: 12px;
		background: color-mix(in srgb, var(--v-fg) 4%, transparent);
		transition: background 180ms ease;
	}
	.child-settings .personal > summary:hover,
	.child-settings .school-calendar > summary:hover,
	.child-settings .guardian-access > summary:hover {
		background: color-mix(in srgb, var(--v-fg) 7%, transparent);
	}
	.child-settings .school-calendar[open] > summary,
	.child-settings .guardian-access[open] > summary {
		margin-inline: -12px;
		padding-inline: 12px;
		border-bottom: 0;
	}
	.child-settings .guardian-access {
		border-top: 1px solid color-mix(in srgb, var(--v-fg) 7%, transparent);
	}
	.stage-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.stage-heading h1 {
		min-width: 0;
	}
	.school-calendar {
		box-sizing: border-box;
		border: 1px solid color-mix(in srgb, var(--v-fg) 12%, transparent);
		border-radius: 14px;
		box-shadow: none;
		padding: 0 12px;
	}
	.school-calendar > summary {
		display: flex;
		align-items: center;
		gap: 8px;
		list-style: none;
		font-size: 0.75rem;
		font-weight: 500;
		padding: 16px 0;
	}
	.school-calendar > summary::-webkit-details-marker {
		display: none;
	}
	.school-calendar[open] {
		padding-bottom: 12px;
	}
	.school-calendar[open] > summary {
		border-bottom: 1px solid color-mix(in srgb, var(--v-fg) 7%, transparent);
		margin-inline: -12px;
		padding-inline: 12px;
	}
	.guardian-access {
		border: 1px solid color-mix(in srgb, var(--v-fg) 12%, transparent);
		border-radius: 14px;
		padding: 0 12px;
	}
	.guardian-access > summary {
		display: flex;
		align-items: center;
		gap: 8px;
		list-style: none;
		padding: 16px 0;
		font-size: 0.75rem;
		font-weight: 500;
	}
	.guardian-access > summary::-webkit-details-marker {
		display: none;
	}
	.guardian-access[open] > summary {
		border-bottom: 1px solid color-mix(in srgb, var(--v-fg) 7%, transparent);
		margin-inline: -12px;
		padding-inline: 12px;
	}
	.guardian-body {
		padding: 12px 0;
	}
	.guardian-editor {
		position: relative;
	}
	.guardian-input-row {
		display: flex;
		align-items: center;
		border: 1px solid color-mix(in srgb, var(--v-fg) 12%, transparent);
		border-radius: 8px;
		padding: 4px 6px;
		min-height: 56px;
	}
	.guardian-editor.expanded .guardian-input-row {
		border-radius: 8px 8px 0 0;
		background: var(--v-surface);
		transition: background 180ms ease;
	}
	.guardian-editor.expanded:global([data-side="above"]) .guardian-input-row {
		border-radius: 0 0 8px 8px;
	}
	.guardian-picker:global([data-side="above"]) {
		border-radius: 8px 8px 0 0;
		border-top: 1px solid color-mix(in srgb, var(--v-fg) 12%, transparent);
		border-bottom: 0;
		transform-origin: bottom;
	}
	.guardian-chips {
		display: flex;
		flex: 1;
		min-width: 0;
		align-items: center;
		gap: 4px;
		flex-wrap: wrap;
	}
	.guardian-chips > input {
		width: 100%;
		min-width: 70px;
		flex: 1;
		border: 0;
		outline: none;
		background: transparent;
		height: 32px !important;
		min-height: 32px !important;
		padding: 4px;
		font-size: 0.75rem;
	}
	.guardian-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		max-width: 100%;
		padding-left: 8px;
		border-radius: 6px;
		background: color-mix(in srgb, var(--v-primary) 10%, transparent);
		font-size: 0.7rem;
	}
	.guardian-chip > span {
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.guardian-form-actions {
		display: grid;
	}
	.guardian-form-actions :global(.v-icon-btn),
	.guardian-chip :global(.v-icon-btn) {
		width: 28px;
		min-width: 28px;
		height: 28px;
	}
	.guardian-content {
		display: grid;
		gap: 4px;
		padding-top: 8px;
	}
	.guardian-picker {
		position: fixed;
		inset: auto;
		margin: 0;
		box-sizing: border-box;
		overflow-y: auto;
		z-index: 100;
		display: grid;
		border: 1px solid color-mix(in srgb, var(--v-fg) 12%, transparent);
		border-radius: 0 0 8px 8px;
		border-top: 0;
		transform-origin: top;
		background: var(--v-surface);
		overflow-x: hidden;
	}
	@supports (backdrop-filter: blur(20px)) or (-webkit-backdrop-filter: blur(20px)) {
		.guardian-picker,
		.guardian-editor.expanded .guardian-input-row {
			background: color-mix(in srgb, var(--v-surface) 65%, transparent);
			-webkit-backdrop-filter: blur(24px) saturate(140%);
			backdrop-filter: blur(24px) saturate(140%);
		}
		.guardian-picker {
			box-shadow: inset 1px 0 color-mix(in srgb, var(--v-fg) 3%, transparent);
		}
	}
	.guardian-picker > input {
		border: 0;
		border-bottom: 1px dotted color-mix(in srgb, var(--v-fg) 20%, transparent);
		border-radius: 0;
		outline: none;
		background: transparent;
		height: 48px !important;
		min-height: 48px !important;
		text-align: center;
		font-size: 0.75rem;
	}
	.guardian-option {
		display: flex;
		align-items: center;
		gap: 14px;
		min-height: 56px;
		box-sizing: border-box;
		padding: 12px;
		border-bottom: 1px solid color-mix(in srgb, var(--v-fg) 7%, transparent);
		font-size: 0.8rem;
		cursor: pointer;
	}
	.guardian-option input {
		appearance: auto;
		width: 22px;
		height: 22px;
		min-height: 22px;
		padding: 0;
		flex-shrink: 0;
		accent-color: var(--v-primary);
	}
	.guardian-options > p {
		padding: 16px;
		font-size: 0.75rem;
		color: var(--v-muted);
	}
	.guardian-pagination {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		font-size: 0.7rem;
		color: var(--v-muted);
	}
	.accordion-body {
		display: flow-root;
	}
	.accordion-body > form {
		padding-top: 8px;
	}
	.child-basics {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(110px, 0.45fr);
		gap: 0;
		border: 1px solid color-mix(in srgb, var(--v-fg) 12%, transparent);
		border-radius: 8px;
		overflow: hidden;
	}
	.child-basics label {
		min-width: 0;
		position: relative;
	}
	.child-basics label:last-child {
		border-left: 1px dotted color-mix(in srgb, var(--v-fg) 25%, transparent);
	}
	.dob-placeholder {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		pointer-events: none;
		color: var(--v-muted);
	}
	.dob-placeholder.hidden {
		display: none;
	}
	.child-basics input.empty:not(:focus) {
		color: transparent;
	}
	.child-basics input.empty:not(:focus)::-webkit-datetime-edit {
		opacity: 0;
	}
	.child-basics label:focus-within .dob-placeholder {
		display: none;
	}
	.child-basics input::placeholder,
	.child-basics .dob-placeholder {
		color: color-mix(in srgb, var(--v-muted) 80%, transparent);
		font-size: 0.7rem;
		font-weight: 300;
		opacity: 1;
	}
	.child-help {
		margin: calc(-1rem + 1px) 0 0;
		text-align: left;
		color: color-mix(in srgb, var(--v-muted) 80%, transparent);
		font-size: 0.7rem;
		font-weight: 300;
		line-height: 1.45;
	}
	.child-basics input {
		border: 0;
		background: transparent;
		outline: none;
		padding-inline: 10px;
		text-align: left;
		font-size: 0.8rem;
		min-height: 40px !important;
		height: 40px !important;
	}
	.child-basics label:last-child input,
	.child-basics label:last-child input::-webkit-date-and-time-value {
		text-align: right;
	}
	.child-basics .dob-placeholder {
		justify-items: end;
		padding-right: 32px;
	}
	.child-basics input:focus-visible {
		outline: none;
		background: color-mix(in srgb, var(--v-primary) 5%, transparent);
	}
	.add-child {
		padding-block: 0.5rem;
	}
	.actions,
	.guardian {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		justify-content: space-between;
	}
	.actions {
		justify-content: flex-start;
	}
	.ready {
		display: flex;
		align-items: flex-start;
		gap: 0.85rem;
	}
	.ready-icon {
		width: 40px;
		height: 40px;
		background: color-mix(in srgb, var(--v-primary) 10%, transparent);
		color: var(--v-primary);
		border-radius: 50%;
		display: grid;
		place-items: center;
		flex-shrink: 0;
	}
	.ready strong {
		font-weight: 600;
	}
	.services {
		border: 1px solid color-mix(in srgb, var(--v-fg) 12%, transparent);
		border-radius: 14px;
	}
	.services > summary {
		display: flex;
		align-items: center;
		gap: 8px;
		list-style: none;
		padding: 16px 12px;
		font-size: 0.75rem;
		font-weight: 500;
		border-radius: 13px;
		background: color-mix(in srgb, var(--v-fg) 4%, transparent);
		transition: background 180ms ease;
	}
	.services > summary::-webkit-details-marker {
		display: none;
	}
	.services > summary:hover {
		background: color-mix(in srgb, var(--v-fg) 7%, transparent);
	}
	.services[open] > summary {
		border-radius: 13px 13px 0 0;
		border-bottom: 1px solid color-mix(in srgb, var(--v-fg) 7%, transparent);
	}
	.services-body {
		display: flow-root;
		padding: 12px;
	}
	footer {
		display: flex;
		align-items: stretch;
		justify-content: space-between;
		border-top: 1px solid color-mix(in srgb, var(--v-fg) 12%, var(--v-surface));
	}
	footer :global(.v-icon-btn) {
		width: 22%;
		height: 56px;
		border: 0;
		border-radius: 0;
		color: var(--v-fg);
		background: transparent;
	}
	footer :global(.v-icon-btn:first-child) {
		border-right: 1px solid color-mix(in srgb, var(--v-fg) 12%, var(--v-surface));
	}
	footer :global(.v-icon-btn:last-child) {
		border-left: 1px solid color-mix(in srgb, var(--v-fg) 12%, var(--v-surface));
	}
	footer :global(.v-icon-btn::after) {
		top: auto;
		bottom: calc(100% + 8px);
	}
	[role="status"] {
		color: var(--v-muted);
		font-size: 0.85rem;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	@media (max-width: 540px) {
		.setup {
			border-radius: 36px;
		}
		.masthead {
			min-height: 64px;
			padding-inline: 24px;
		}
		.stage-content {
			padding: 4px 24px 20px;
		}
		.wide-label {
			display: none;
		}
		.small-label {
			display: inline;
		}
	}
</style>
