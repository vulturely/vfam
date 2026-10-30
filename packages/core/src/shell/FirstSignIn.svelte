<script lang="ts">
	import { getContext, onDestroy, onMount, tick } from "svelte";
	import { cubicOut } from "svelte/easing";
	import type { Runtime } from "../runtime/registry.svelte";
	import type { FamilyAiConfig } from "../family-ai/service";
	import ArrowLeft from "lucide-svelte/icons/arrow-left";
	import ArrowRight from "lucide-svelte/icons/arrow-right";
	import UserRound from "lucide-svelte/icons/user-round";
	import Baby from "lucide-svelte/icons/baby";
	import Check from "lucide-svelte/icons/check";
	import LogOut from "lucide-svelte/icons/log-out";
	import { ErrorToast, IconButton } from "../components/index";

	type Stage = "role" | "kid" | "dob" | "ai-choice" | "ai-provider" | "ai-key";
	const runtime = getContext<Runtime>("vulture:runtime");
	let stage = $state<Stage>(
		runtime.state.accountSetup?.role === "kid"
			? "kid"
			: runtime.state.accountSetup?.dobConfirmed
				? "ai-choice"
				: "role",
	);
	let busy = $state(false);
	let animating = $state(false);
	let error = $state("");
	let copied = $state(false);
	let birthDate = $state("");
	let focusTarget = $state<globalThis.HTMLElement>();
	let animationTimer: ReturnType<typeof setTimeout> | undefined;
	let ai = $state<FamilyAiConfig>({
		provider: "openai",
		model: "",
		apiKey: "",
		endpoint: "",
	});
	const providers = [
		{ id: "openai", label: "OpenAI" },
		{ id: "claude", label: "Anthropic Claude" },
		{ id: "gemini", label: "Google Gemini" },
		{ id: "grok", label: "xAI Grok" },
		{ id: "openai_compatible", label: "OpenAI-compatible" },
	] as const;
	const providerName = $derived(
		providers.find((provider) => provider.id === ai.provider)?.label ?? "AI provider",
	);
	const pending = $derived(busy || animating);
	const maximumBirthDate = (() => {
		const today = new Date();
		const year = today.getUTCFullYear() - 18;
		const lastDay = new Date(Date.UTC(year, today.getUTCMonth() + 1, 0)).getUTCDate();
		return `${year}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(today.getUTCDate(), lastDay)).padStart(2, "0")}`;
	})();
	function reducedMotion() {
		return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
	}
	function turn(_node: globalThis.Element, { out = false } = {}) {
		return {
			duration: reducedMotion() ? 0 : out ? 160 : 240,
			delay: reducedMotion() || out ? 0 : 160,
			easing: cubicOut,
			css: (t: number) =>
				`transform: perspective(1000px) rotateY(${(1 - t) * (out ? 90 : -90)}deg); opacity: ${t};`,
		};
	}
	async function move(next: Stage) {
		if (animating) return;
		if (stage === "ai-key") ai.apiKey = "";
		error = "";
		animating = true;
		stage = next;
		await tick();
		animationTimer = setTimeout(
			() => {
				animating = false;
				focusTarget?.querySelector<globalThis.HTMLElement>(".question")?.focus();
			},
			reducedMotion() ? 0 : 410,
		);
	}
	function failure(cause: unknown) {
		error = cause instanceof Error ? cause.message : "Could not save. Please try again.";
	}
	async function kid() {
		if (pending) return;
		busy = true;
		error = "";
		try {
			runtime.state.accountSetup = await runtime.services.accountSetup.update({
				role: "kid",
			});
			await move("kid");
		} catch (cause) {
			failure(cause);
		} finally {
			busy = false;
		}
	}
	async function confirmBirth(event: globalThis.SubmitEvent) {
		event.preventDefault();
		if (pending) return;
		busy = true;
		error = "";
		try {
			runtime.state.accountSetup = await runtime.services.accountSetup.update({
				role: "parent",
				dateOfBirth: birthDate,
			});
			birthDate = "";
			await move("ai-choice");
		} catch (cause) {
			failure(cause);
		} finally {
			busy = false;
		}
	}
	async function finish(ownAi = false) {
		if (pending) return;
		busy = true;
		error = "";
		try {
			// Resource settings require a family. Create the workspace once, then reuse it on retries.
			let family = await runtime.services.family.getMyFamily();
			if (!family)
				family = await runtime.services.family.createFamily(
					`${runtime.state.identity?.name || "My"}'s family`,
				);
			runtime.state.familyId = family.id;
			// The key goes to this device's OS key store only; Vulture never receives it.
			if (ownAi)
				await runtime.services.familyAi.save({
					...ai,
					endpoint: ai.provider === "openai_compatible" ? ai.endpoint : "",
				});
			runtime.state.accountSetup = await runtime.services.accountSetup.update({
				role: "parent",
				complete: true,
			});
			runtime.router.navigate("profile:choose");
		} catch (cause) {
			failure(cause);
		} finally {
			ai.apiKey = "";
			busy = false;
		}
	}
	async function copyAccount() {
		try {
			await globalThis.navigator.clipboard.writeText(runtime.state.identity?.id ?? "");
			copied = true;
		} catch {
			error = `Your account ID: ${runtime.state.identity?.id ?? ""}`;
		}
	}
	onMount(() => {
		if (runtime.state.accountSetup?.completed && runtime.state.accountSetup.role !== "kid")
			runtime.router.navigate("profile:choose");
	});
	onDestroy(() => {
		clearTimeout(animationTimer);
		ai.apiKey = "";
		birthDate = "";
	});
</script>

<section class="first-sign-in" aria-label="Account setup">
	<div class="card-stage" bind:this={focusTarget}>
		{#key stage}
			<div class="qa-card" in:turn out:turn={{ out: true }}>
				<div class="card-top">
					<span class="mark">Vulture</span><span class="progress" aria-hidden="true"
						><i class:active={stage === "role" || stage === "kid"}></i><i
							class:active={stage === "dob"}
						></i><i class:active={stage.startsWith("ai-")}></i></span
					>
				</div>
				<div class="question" tabindex="-1">
					{#if stage === "role"}
						<h1>Who is this account for?</h1>
						<div class="choices">
							<button type="button" disabled={pending} onclick={() => void move("dob")}
								><UserRound size={22} /><span>I'm a parent</span><ArrowRight size={18} /></button
							>
							<button type="button" disabled={pending} onclick={() => void kid()}
								><Baby size={22} /><span>I'm a kid</span><ArrowRight size={18} /></button
							>
						</div>
					{:else if stage === "kid"}
						<span class="illustration"><Baby size={34} /></span>
						<h1>Ask your parent to add you.</h1>
						<p>They can add you as a family member from their account.</p>
						<button
							type="button"
							class="primary"
							disabled={pending}
							onclick={() => void copyAccount()}
							>{copied ? "Account ID copied" : "Copy my account ID"}{#if copied}<Check
									size={17}
								/>{/if}</button
						>
						<button type="button" class="subtle" disabled={pending} onclick={() => runtime.logout()}
							>Sign out</button
						>
					{:else if stage === "dob"}
						<h1>Confirm your date of birth.</h1>
						<p>Parents must be 18 or older.</p>
						<form onsubmit={confirmBirth}>
							<label
								>Date of birth<input
									type="date"
									bind:value={birthDate}
									max={maximumBirthDate}
									required
									disabled={pending}
									autocomplete="bday"
								/></label
							>
							<div class="actions">
								<button
									type="button"
									class="back"
									aria-label="Back"
									disabled={pending}
									onclick={() => void move("role")}><ArrowLeft size={18} /></button
								><button class="primary" type="submit" disabled={pending}
									>{busy ? "Confirming…" : "Continue"}<ArrowRight size={17} /></button
								>
							</div>
						</form>
					{:else if stage === "ai-choice"}
						<h1>Bring your own AI provider?</h1>
						<div class="choices">
							<button type="button" disabled={pending} onclick={() => void move("ai-provider")}
								><span>Yes, connect my provider</span><ArrowRight size={18} /></button
							>
							<button type="button" disabled={pending} onclick={() => void finish()}
								><span>{busy ? "Finishing…" : "Not now"}</span><ArrowRight size={18} /></button
							>
						</div>
					{:else if stage === "ai-provider"}
						<h1>Choose your AI provider.</h1>
						<form
							onsubmit={(event) => {
								event.preventDefault();
								void move("ai-key");
							}}
						>
							<label
								>Provider<select bind:value={ai.provider} disabled={pending}
									>{#each providers as provider (provider.id)}<option value={provider.id}
											>{provider.label}</option
										>{/each}</select
								></label
							>
							<label
								>Model<input
									bind:value={ai.model}
									required
									disabled={pending}
									placeholder="Your model ID"
									autocomplete="off"
								/></label
							>
							<div class="actions">
								<button
									type="button"
									class="back"
									aria-label="Back"
									disabled={pending}
									onclick={() => void move("ai-choice")}><ArrowLeft size={18} /></button
								><button type="submit" class="primary" disabled={pending}
									>Next<ArrowRight size={17} /></button
								>
							</div>
						</form>
					{:else}
						<h1>Connect {providerName}.</h1>
						<form
							onsubmit={(event) => {
								event.preventDefault();
								void finish(true);
							}}
						>
							{#if ai.provider === "openai_compatible"}<label
									>Provider URL<input
										type="url"
										bind:value={ai.endpoint}
										required
										disabled={pending}
										placeholder="https://provider.example/v1/chat/completions"
									/></label
								>
								<p class="note">Use HTTPS, or http://localhost for a model on this device.</p>{/if}
							<label
								>API key<input
									type="password"
									bind:value={ai.apiKey}
									required={ai.provider !== "openai_compatible"}
									disabled={pending}
									autocomplete="new-password"
									placeholder="Paste your API key"
								/></label
							>
							<p class="note">
								Your API key stays in this device's secure key store and is never sent to Vulture.
								Set a spending limit in your provider's account.
							</p>
							<div class="actions">
								<button
									type="button"
									class="back"
									aria-label="Back"
									disabled={pending}
									onclick={() => void move("ai-provider")}><ArrowLeft size={18} /></button
								><button type="submit" class="primary" disabled={pending}
									>{busy ? "Connecting…" : "Connect & continue"}<ArrowRight size={17} /></button
								>
							</div>
						</form>
					{/if}
					<ErrorToast message={error} />
				</div>
				{#if stage !== "kid"}
					<div class="card-footer">
						<IconButton
							label="Sign out"
							icon={LogOut}
							disabled={pending}
							onclick={() => runtime.logout()}
						/>
					</div>
				{/if}
			</div>
		{/key}
	</div>
</section>

<style>
	.note {
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.5;
		color: var(--v-muted);
	}
	.first-sign-in {
		display: grid;
		place-items: center;
		min-height: calc(100dvh - 100px);
		width: 100%;
		perspective: 1000px;
	}
	.card-stage {
		display: grid;
		width: min(100%, 460px);
	}
	.qa-card {
		grid-area: 1 / 1;
		align-self: center;
		background: var(--v-surface);
		border: 1px solid var(--v-border);
		border-radius: 22px;
		padding: clamp(24px, 5vw, 40px);
		box-shadow: 0 24px 80px color-mix(in srgb, var(--v-fg) 7%, transparent);
		backface-visibility: hidden;
		transform-style: preserve-3d;
		transform-origin: center;
	}
	.card-footer {
		display: flex;
		justify-content: center;
		margin-top: 24px;
	}
	.card-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 3rem;
	}
	.mark {
		font-weight: 750;
		font-size: 0.85rem;
		letter-spacing: -0.02em;
	}
	.progress {
		display: flex;
		gap: 4px;
	}
	.progress i {
		width: 16px;
		height: 3px;
		background: var(--v-border);
		border-radius: 4px;
	}
	.progress i.active {
		background: var(--v-primary);
	}
	.question {
		display: grid;
		gap: 1.5rem;
		outline: none;
	}
	h1 {
		margin: 0;
		font-size: clamp(1.65rem, 5vw, 2rem);
		line-height: 1.2;
		letter-spacing: -0.04em;
		font-weight: 650;
		text-wrap: balance;
	}
	p {
		color: var(--v-muted);
		font-size: 0.9rem;
		line-height: 1.6;
		margin: -0.5rem 0 0;
	}
	.choices {
		display: grid;
		gap: 0.75rem;
		margin-top: 0.25rem;
	}
	.choices button {
		display: flex;
		gap: 0.9rem;
		align-items: center;
		width: 100%;
		padding: 1.1rem;
		min-height: 60px;
		border: 1px solid var(--v-border);
		border-radius: 12px;
		background: transparent;
		color: var(--v-fg);
		font: inherit;
		font-size: 0.9rem;
		cursor: pointer;
		transition:
			background 140ms,
			border-color 140ms;
	}
	.choices button span {
		flex: 1;
		text-align: left;
	}
	.choices button:hover {
		border-color: var(--v-primary);
		background: color-mix(in srgb, var(--v-primary) 5%, transparent);
	}
	button:disabled {
		opacity: 0.55;
		cursor: wait;
	}
	form {
		display: grid;
		gap: 1.25rem;
	}
	label {
		display: grid;
		gap: 0.6rem;
		font-size: 0.8rem;
		color: var(--v-muted);
	}
	input,
	select {
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
		min-height: 48px;
		padding: 0.75rem;
		border: 1px solid var(--v-border);
		border-radius: 9px;
		background: var(--v-bg);
		color: var(--v-fg);
		font: inherit;
		font-size: 0.9rem;
	}
	select:focus-visible,
	button:focus-visible {
		outline: 2px solid var(--v-primary);
		outline-offset: 3px;
	}
	.actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-top: 0.5rem;
	}
	.primary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.7rem;
		min-height: 46px;
		padding: 0.75rem 1.1rem;
		background: var(--v-primary);
		color: var(--v-primary-fg);
		border: 0;
		border-radius: 9px;
		font: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
	}
	.back,
	.subtle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		min-width: 44px;
		border: 0;
		background: transparent;
		color: var(--v-muted);
		cursor: pointer;
		font: inherit;
		font-size: 0.8rem;
	}
	.illustration {
		display: grid;
		place-items: center;
		width: 64px;
		height: 64px;
		border-radius: 20px;
		color: var(--v-primary);
		background: color-mix(in srgb, var(--v-primary) 9%, transparent);
	}
	@media (prefers-reduced-motion: reduce) {
		.choices button {
			transition: none;
		}
	}
	@media (max-width: 540px) {
		.first-sign-in {
			min-height: calc(100dvh - 60px);
		}
	}
</style>
