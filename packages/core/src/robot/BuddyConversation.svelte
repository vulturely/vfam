<script lang="ts">
	import { getContext, onMount, tick } from "svelte";
	import Bot from "lucide-svelte/icons/bot";
	import Send from "lucide-svelte/icons/send";
	import type { Runtime } from "../runtime/registry.svelte";
	import type { BuddyTurn } from "./buddy";
	import { answeredBy, askedBy, cloudUnavailable, isFixedReply } from "./turnSource";
	import { Button, ErrorToast, IconButton } from "../components/index";
	import BuddyTalk from "./BuddyTalk.svelte";
	import Mic from "lucide-svelte/icons/mic";
	import MicOff from "lucide-svelte/icons/mic-off";
	import Video from "lucide-svelte/icons/video";
	import VideoOff from "lucide-svelte/icons/video-off";
	import { deviceOf } from "./directory.svelte";
	import { commandSuggestions, completeCommand, type BuddyCommandHint } from "./buddyCommands";

	let { id }: { id: string } = $props();
	const runtime = getContext<Runtime>("vulture:runtime");
	const directory = runtime.services.fambuddy;
	const session = $derived(directory.session(id));
	const deviceId = $derived(session ? deviceOf(session) : "");
	const device = $derived(session?.output.settings.find((item) => item.device === deviceId));
	let text = $state("");
	let error = $state("");
	let notice = $state("");
	let localMessages = $state<
		{ id: string; text: string; kind: "say" | "ask" | "broadcast" | "heard" }[]
	>([]);
	/** Say speaks the text on the device; Ask sends it to the device's AI for an answer. */
	let mode = $state<"say" | "ask">("say");
	const caption = $derived(session?.output.captions?.find((item) => item.device === deviceId));
	// What the device says joins the conversation once, while captions are on.
	$effect(() => {
		const heard = caption;
		if (heard && !localMessages.some((message) => message.id === heard.turn))
			localMessages.push({ id: heard.turn, text: heard.text, kind: "heard" });
	});
	let edits = $state<Record<string, string>>({});
	let camera = $state<{ start(): Promise<boolean>; end(): Promise<void> }>();
	/** The live view is shown only after the parent opens it. */
	let cameraOpen = $state(false);
	let input = $state<HTMLInputElement>();
	let highlighted = $state(0);
	let hintsDismissed = $state(false);
	const hints = $derived(hintsDismissed ? [] : commandSuggestions(text));

	function failure(cause: unknown, fallback: string) {
		error = cause instanceof Error ? cause.message : fallback;
	}

	async function send() {
		const value = text.trim();
		if (!value || !session?.service || session.busy) return;
		error = "";
		notice = "";
		try {
			if (value === "/camera") await openCamera();
			else if (value === "/stop") await closeCamera();
			else if (value.startsWith("/broadcast")) {
				const message = value.slice("/broadcast".length).trim();
				if (!message) {
					error = "Write a message after /broadcast.";
					return;
				}
				await directory.broadcast(message);
				localMessages.push({ id: crypto.randomUUID(), text: message, kind: "broadcast" });
				notice = "Broadcast sent to every paired FamBuddy.";
			} else {
				const asked = value.startsWith("/ask") ? value.slice("/ask".length).trim() : undefined;
				const kind = asked !== undefined || mode === "ask" ? "ask" : "say";
				const message = asked ?? value;
				if (!message) {
					error = "Write a question after /ask.";
					return;
				}
				await directory.command(id, {
					action: kind === "ask" ? "ask" : "announce",
					device: deviceId,
					text: message,
				});
				localMessages.push({ id: crypto.randomUUID(), text: message, kind });
				if (kind === "ask") notice = "Asked. Approve the answer here before it is spoken.";
			}
			text = "";
		} catch (cause) {
			failure(cause, "FamBuddy command failed.");
		}
	}

	async function openCamera() {
		if (device && !device.camera_enabled) {
			await directory.command(id, {
				action: "configure_camera",
				device: device.device,
				enabled: true,
			});
		}
		cameraOpen = true;
		await tick();
		notice = (await camera?.start())
			? "Live camera started."
			: "The live camera did not start. Check the FamBuddy is online and retry.";
	}

	async function closeCamera() {
		await camera?.end();
		cameraOpen = false;
		notice = "Live camera stopped.";
	}

	async function toggleCamera() {
		error = "";
		notice = "";
		try {
			await (cameraOpen ? closeCamera() : openCamera());
		} catch (cause) {
			failure(cause, "Could not change the live camera.");
		}
	}

	function choose(hint: BuddyCommandHint) {
		text = completeCommand(hint);
		highlighted = 0;
		input?.focus();
	}

	function onKeydown(event: KeyboardEvent) {
		if (!hints.length) return;
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const step = event.key === "ArrowDown" ? 1 : -1;
			highlighted = (highlighted + step + hints.length) % hints.length;
		} else if (event.key === "Enter" || event.key === "Tab") {
			event.preventDefault();
			choose(hints[Math.min(highlighted, hints.length - 1)]);
		} else if (event.key === "Escape") {
			event.preventDefault();
			hintsDismissed = true;
		}
	}

	async function toggleListening() {
		if (!device) return;
		try {
			await directory.command(id, {
				action: "configure",
				device: device.device,
				wake_word: device.wake_word,
				muted: !device.muted,
			});
		} catch (cause) {
			failure(cause, "Could not change listening.");
		}
	}

	async function approve(turn: BuddyTurn) {
		if (!turn.review) return;
		try {
			await directory.command(id, {
				action: "approve",
				device: turn.scope.device,
				turn: turn.scope.turn,
				review: turn.review,
			});
		} catch (cause) {
			failure(cause, "Approval failed.");
		}
	}

	async function edit(turn: BuddyTurn) {
		const value = edits[turn.scope.turn]?.trim();
		if (!value) return;
		try {
			await directory.command(id, {
				action: "edit",
				device: turn.scope.device,
				turn: turn.scope.turn,
				text: value,
			});
		} catch (cause) {
			failure(cause, "Could not save the reviewed text.");
		}
	}

	let revisions = $state<Record<string, string>>({});

	/** Sends the pending answer back to its AI with the parent's instruction. */
	async function revise(turn: BuddyTurn) {
		const instruction = revisions[turn.scope.turn]?.trim();
		if (!instruction) return;
		try {
			await directory.command(id, {
				action: "revise",
				device: turn.scope.device,
				turn: turn.scope.turn,
				instruction,
			});
			revisions[turn.scope.turn] = "";
		} catch (cause) {
			failure(cause, "Could not revise this answer.");
		}
	}

	/** A parent chose to send a question the FamBuddy could not answer to its cloud AI. */
	async function askCloud(turn: BuddyTurn) {
		try {
			await directory.command(id, {
				action: "ask_cloud",
				device: turn.scope.device,
				turn: turn.scope.turn,
			});
			notice = "Sent to the cloud AI. Approve its answer here before it is spoken.";
		} catch (cause) {
			failure(cause, "Could not ask the cloud AI.");
		}
	}

	async function cancel(turn: BuddyTurn) {
		try {
			await directory.command(id, {
				action: "cancel",
				device: turn.scope.device,
				turn: turn.scope.turn,
			});
		} catch (cause) {
			failure(cause, "Could not cancel this request.");
		}
	}

	/** Paired: watching it can start. The lease is shared, e.g. with the approval watch. */
	const ready = $derived(!!session?.service && !!(session.pair || session.home));
	$effect(() => {
		if (!ready) return;
		void directory.acquire(id).catch((cause) => failure(cause, "Could not connect to FamBuddy."));
		// Only a lease this conversation took is given back, never another holder's.
		return () => directory.release(id);
	});

	onMount(() => () => void camera?.end());
</script>

{#if session}
	<section class="buddy-conversation" aria-label={`Chat with ${session.registration.name}`}>
		<header class="buddy-conversation-header">
			<div class="buddy-title-icon" aria-hidden="true"><Bot size={21} /></div>
			<div>
				<h2>{session.registration.name}</h2>
				<p>Direct FamBuddy conversation · approvals stay on this device</p>
			</div>
			{#if session.service && deviceId}
				<IconButton
					icon={cameraOpen ? VideoOff : Video}
					label={cameraOpen ? "Close live camera" : "Open live camera"}
					ariaPressed={cameraOpen}
					disabled={session.busy}
					onclick={() => void toggleCamera()}
				/>
			{/if}
			{#if device}
				<IconButton
					icon={device.muted ? Mic : MicOff}
					label={device.muted ? "Turn listening on" : "Mute"}
					disabled={session.busy}
					onclick={() => void toggleListening()}
				/>
			{/if}
		</header>
		<ErrorToast message={error || session.error} />
		{#if notice}<p class="buddy-notice" role="status">{notice}</p>{/if}
		<div class="buddy-messages">
			{#if !localMessages.length && !session.output.turns.length}
				<div class="buddy-empty">
					<Bot size={30} strokeWidth={1.4} aria-hidden="true" />
					<p>
						Say something on {session.registration.name}, ask its AI, or open the live camera from
						the top bar.
					</p>
				</div>
			{/if}
			{#each localMessages as message (message.id)}
				<article class="buddy-message" class:own={message.kind !== "heard"}>
					<strong
						>{message.kind === "heard"
							? `${session.registration.name} said`
							: message.kind === "broadcast"
								? "You · broadcast"
								: message.kind === "ask"
									? "You asked"
									: "You · spoken on the device"}</strong
					>
					<p>{message.text}</p>
				</article>
			{/each}
			{#each session.output.turns as turn (turn.scope.turn)}
				{#if isFixedReply(turn)}
					<article class="buddy-message approval info">
						<div class="approval-heading">
							<strong>{session.registration.name} replied</strong>
							<small>{new Date(turn.expires_at).toLocaleTimeString()}</small>
						</div>
						{#if turn.origin}<p class="approval-source">
								{askedBy(turn)} · {answeredBy("local")}
							</p>{/if}
						<p>{turn.text}</p>
						<p class="approval-source">No action needed.</p>
					</article>
				{:else if turn.stage === "NeedsParent"}
					{@const reason = cloudUnavailable(turn)}
					<article class="buddy-message approval needs-parent">
						<div class="approval-heading">
							<strong>Needs you — FamBuddy couldn't answer this</strong>
							<small>{new Date(turn.expires_at).toLocaleTimeString()}</small>
						</div>
						{#if turn.origin}<p class="approval-source">{askedBy(turn)}</p>{/if}
						<p>{turn.text}</p>
						<textarea
							aria-label="Your answer"
							placeholder="Write the answer FamBuddy should say"
							value={edits[turn.scope.turn] ?? ""}
							oninput={(event) => (edits[turn.scope.turn] = event.currentTarget.value)}
							maxlength="8000"></textarea>
						<div class="approval-actions">
							<Button disabled={session.busy || !!reason} onclick={() => void askCloud(turn)}
								>Ask cloud AI</Button
							>
							<Button
								variant="ghost"
								disabled={session.busy || !edits[turn.scope.turn]?.trim()}
								onclick={() => void edit(turn)}>Answer it yourself</Button
							>
							<Button variant="ghost" disabled={session.busy} onclick={() => void cancel(turn)}
								>Dismiss</Button
							>
						</div>
						<p class="approval-source">
							{reason ||
								"Only you can send it to the cloud AI; its answer still needs your approval."}
						</p>
					</article>
				{:else}
					<article class="buddy-message approval">
						<div class="approval-heading">
							<strong
								>{turn.stage === "QuestionPending"
									? "Question approval"
									: "Answer approval"}</strong
							>
							<small>{new Date(turn.expires_at).toLocaleTimeString()}</small>
						</div>
						{#if turn.origin}<p class="approval-source">
								{askedBy(turn)}{turn.stage === "AnswerPending" && turn.answered_by
									? ` · ${answeredBy(turn.answered_by)}`
									: ""}
							</p>{/if}
						<p>{turn.text}</p>
						{#if turn.review}
							<textarea
								aria-label="Edit reviewed text"
								value={edits[turn.scope.turn] ?? turn.text}
								oninput={(event) => (edits[turn.scope.turn] = event.currentTarget.value)}
								maxlength="8000"></textarea>
						{/if}
						<div class="approval-actions">
							{#if turn.review}
								<Button disabled={session.busy} onclick={() => void approve(turn)}
									>{turn.stage === "QuestionPending"
										? "Approve question"
										: "Approve answer"}</Button
								>
								<Button variant="ghost" disabled={session.busy} onclick={() => void edit(turn)}
									>Save edit</Button
								>
							{/if}
							<Button variant="ghost" disabled={session.busy} onclick={() => void cancel(turn)}
								>Reject / cancel</Button
							>
						</div>
						{#if turn.stage === "AnswerPending" && turn.review}
							<div class="approval-revise">
								<input
									aria-label="How should the answer change?"
									placeholder="Revise: e.g. make it simpler, or use a story about planets"
									maxlength="500"
									value={revisions[turn.scope.turn] ?? ""}
									oninput={(event) => (revisions[turn.scope.turn] = event.currentTarget.value)}
								/>
								<Button
									variant="ghost"
									disabled={session.busy || !revisions[turn.scope.turn]?.trim()}
									onclick={() => void revise(turn)}>Revise</Button
								>
							</div>
						{/if}
					</article>
				{/if}
			{/each}
		</div>
		{#if cameraOpen && session.service && deviceId}
			<div class="buddy-camera">
				<BuddyTalk
					bind:this={camera}
					service={session.service}
					device={deviceId}
					video={true}
					disabled={!device?.camera_enabled || session.busy}
				/>
			</div>
		{/if}
		<form
			class="buddy-composer"
			onsubmit={(event) => {
				event.preventDefault();
				void send();
			}}
		>
			{#if hints.length}
				<ul class="buddy-hints" id="buddy-command-hints" role="listbox" aria-label="Commands">
					{#each hints as hint, index (hint.name)}
						<li
							id={`buddy-hint-${index}`}
							role="option"
							aria-selected={index === highlighted}
							class:active={index === highlighted}
							onmousedown={(event) => {
								event.preventDefault();
								choose(hint);
							}}
						>
							<strong>{hint.name}</strong><span>{hint.description}</span>
						</li>
					{/each}
				</ul>
			{/if}
			<input
				bind:this={input}
				bind:value={text}
				oninput={() => {
					highlighted = 0;
					hintsDismissed = false;
				}}
				onkeydown={onKeydown}
				role="combobox"
				aria-label="Message FamBuddy"
				aria-autocomplete="list"
				aria-expanded={hints.length > 0}
				aria-controls="buddy-command-hints"
				aria-activedescendant={hints.length ? `buddy-hint-${highlighted}` : undefined}
				autocomplete="off"
				placeholder={mode === "ask"
					? "Ask its AI a question…"
					: "Say it on the device, or type / for commands"}
				disabled={session.busy || !session.service}
			/>
			<div class="buddy-composer-actions">
				<div class="buddy-mode" role="radiogroup" aria-label="What to do with the message">
					<button
						type="button"
						role="radio"
						aria-checked={mode === "say"}
						onclick={() => (mode = "say")}>Say it</button
					>
					<button
						type="button"
						role="radio"
						aria-checked={mode === "ask"}
						onclick={() => (mode = "ask")}>Ask AI</button
					>
				</div>
				<IconButton
					icon={Send}
					label="Send to FamBuddy"
					type="submit"
					disabled={session.busy || !text.trim() || !session.service}
				/>
			</div>
		</form>
	</section>
{:else}
	<p class="buddy-missing">This FamBuddy is no longer registered.</p>
{/if}

<style>
	.buddy-conversation-header > div:nth-child(2) {
		flex: 1;
		min-width: 0;
	}
	.buddy-mode {
		display: inline-flex;
		flex: 0 0 auto;
		padding: 2px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--v-fg) 8%, transparent);
	}
	.buddy-mode button {
		padding: 0.35rem 0.75rem;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: var(--v-muted);
		font: inherit;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
	}
	.buddy-mode button[aria-checked="true"] {
		background: var(--v-surface);
		color: var(--v-fg);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
	}
	.buddy-mode button:focus-visible {
		outline: 2px solid var(--v-ring);
		outline-offset: 2px;
	}
	.buddy-conversation {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		height: 100%;
	}
	.buddy-conversation-header {
		display: flex;
		align-items: center;
		gap: var(--v-space);
		padding: 0.9rem 1.1rem;
		border-bottom: 1px solid var(--v-border);
	}
	.buddy-title-icon {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--v-primary) 12%, transparent);
		color: var(--v-primary-text, var(--v-primary));
	}
	h2,
	p {
		margin: 0;
	}
	.buddy-conversation-header h2 {
		font-size: 1rem;
	}
	.buddy-conversation-header p,
	.buddy-empty p,
	.buddy-missing {
		color: var(--v-muted);
		font-size: 0.75rem;
	}
	.buddy-notice {
		padding: 0.5rem 1rem;
		border-bottom: 1px solid var(--v-border);
		color: var(--v-primary-text, var(--v-primary));
		font-size: 0.75rem;
	}
	.buddy-messages {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.75rem;
		min-height: 0;
		overflow-y: auto;
		padding: 1rem;
	}
	.buddy-empty {
		display: grid;
		place-items: center;
		align-content: center;
		gap: var(--v-space);
		height: 100%;
		min-height: 120px;
		color: var(--v-muted);
		text-align: center;
	}
	.buddy-message {
		max-width: min(85%, 42rem);
		padding: 0.75rem;
		border-radius: var(--v-radius-sm);
		background: var(--v-surface);
	}
	.buddy-message.own {
		align-self: flex-end;
		background: color-mix(in srgb, var(--v-primary) 13%, var(--v-surface));
	}
	.buddy-message.approval {
		display: grid;
		gap: 0.65rem;
		align-self: flex-start;
		border: 1px solid var(--v-border);
	}
	.buddy-message strong {
		font-size: 0.75rem;
	}
	.buddy-message p {
		margin-top: 0.25rem;
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}
	.buddy-message.needs-parent {
		border-color: color-mix(in srgb, var(--v-primary) 55%, var(--v-border));
	}
	.buddy-message.info {
		border-style: dashed;
	}
	.approval-source {
		color: var(--v-muted);
		font-size: 0.75rem;
	}
	.approval-revise {
		display: flex;
		gap: 0.5rem;
	}
	.approval-revise input {
		flex: 1;
		min-width: 0;
		min-height: 36px;
		padding: 0 0.6rem;
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius-sm);
		background: var(--v-bg);
		color: var(--v-fg);
		font: inherit;
	}
	.approval-heading {
		display: flex;
		justify-content: space-between;
		gap: var(--v-space);
	}
	.approval-heading small {
		color: var(--v-muted);
	}
	textarea {
		min-height: 80px;
		resize: vertical;
		padding: 0.6rem;
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius-sm);
		background: var(--v-bg);
		color: var(--v-fg);
		font: inherit;
	}
	.approval-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.buddy-camera {
		padding: 0 1rem 0.75rem;
	}
	/* Two rows in one box: the message on top, mode and send underneath. */
	.buddy-composer {
		position: relative;
		display: grid;
		gap: 0.35rem;
		margin: 0.75rem 1rem;
		padding: 0.5rem 0.5rem 0.4rem;
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius);
		background: var(--v-bg);
	}
	.buddy-composer:focus-within {
		border-color: var(--v-primary);
	}
	.buddy-composer input {
		width: 100%;
		min-height: 36px;
		padding: 0 0.35rem;
		border: 0;
		outline: none;
		background: transparent;
		color: var(--v-fg);
		font: inherit;
	}
	.buddy-composer-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.buddy-hints {
		position: absolute;
		right: 0;
		bottom: calc(100% + 0.35rem);
		left: 0;
		z-index: 2;
		display: grid;
		margin: 0;
		padding: 0.3rem;
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius-sm);
		background: var(--v-surface);
		box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);
		list-style: none;
	}
	.buddy-hints li {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		padding: 0.45rem 0.6rem;
		border-radius: var(--v-radius-sm);
		cursor: pointer;
	}
	.buddy-hints li.active {
		background: color-mix(in srgb, var(--v-primary) 14%, transparent);
	}
	.buddy-hints strong {
		font-size: 0.85rem;
	}
	.buddy-hints span {
		color: var(--v-muted);
		font-size: 0.75rem;
	}
	.buddy-missing {
		padding: 2rem;
	}
</style>
