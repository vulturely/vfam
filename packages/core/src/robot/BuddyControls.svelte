<script lang="ts">
	import { onMount } from "svelte";
	import BuddyDevice from "./BuddyDevice.svelte";
	import { Button, Card, ErrorToast } from "../components/index";
	import CheckCheck from "lucide-svelte/icons/check-check";
	import RefreshCw from "lucide-svelte/icons/refresh-cw";
	import type { ParentAuth } from "./remote/client";
	import type { BuddyService, BuddyOutput, BuddyTurn, BuddyCommand } from "./buddy";
	import type { FamilyAiService } from "../family-ai/service";
	import { answerIfParentDevice } from "./family-answer";
	let {
		service,
		familyId,
		server,
		auth,
		familyAi,
		local,
	}: {
		service: BuddyService;
		familyId: string;
		server?: string;
		auth?: ParentAuth;
		familyAi?: FamilyAiService;
		/** Present only on a direct home-network connection to the device. */
		local?: { gateway: string; token: string };
	} = $props();
	let data = $state<BuddyOutput>({ settings: [], turns: [] });
	let error = $state("");
	let pending = $state(0);
	const busy = $derived(pending > 0);
	let generation = 0;
	let snapshot = 0;
	let edits = $state<Record<string, string>>({});
	let currentTime = $state(Date.now());
	let alive = true;
	let updates: globalThis.AbortController | undefined;
	let listener: Promise<void> = Promise.resolve();
	async function refresh(operation: number) {
		const previous = snapshot;
		const response = await service.command({
			action: "list",
			family: familyId,
		});
		if (operation === generation && previous === snapshot) apply(response);
	}
	function apply(response: BuddyOutput) {
		if (alive) {
			snapshot++;
			for (const turn of response.turns) {
				const previous = data.turns.find((item) => item.scope.turn === turn.scope.turn);
				if (previous && JSON.stringify(previous.review) !== JSON.stringify(turn.review))
					delete edits[turn.scope.turn];
			}
			data = response;
		}
	}
	function listen() {
		if (!alive) return;
		updates?.abort();
		const controller = new globalThis.AbortController();
		updates = controller;
		error = "";
		const previous = listener;
		listener = (async () => {
			// A remote watch owns an exclusive MLS lease until teardown completes.
			await previous;
			if (!alive || controller.signal.aborted || updates !== controller) return;
			await watch(controller);
		})();
	}
	async function watch(controller: globalThis.AbortController) {
		try {
			for await (const response of service.watch(familyId, controller.signal)) {
				if (!controller.signal.aborted) apply(response);
			}
			if (!controller.signal.aborted)
				throw new Error("Device connection ended. Reconnect to continue.");
		} catch (cause) {
			if (alive && !controller.signal.aborted)
				error = cause instanceof Error ? cause.message : "Device disconnected.";
		}
	}
	/** Whether the device took the command; failures are shown here as `error`. */
	async function run(command?: BuddyCommand): Promise<boolean> {
		if (!command) {
			void listen();
			return true;
		}
		const emergency =
			command.action === "cancel" ||
			command.action === "revoke" ||
			(command.action === "configure_camera" && !command.enabled) ||
			(command.action === "configure" && command.muted);
		if (busy && !emergency) return false;
		const operation = ++generation;
		pending++;
		error = "";
		let sent = false;
		try {
			const output = await service.command(command);
			sent = true;
			if (command.action === "approve" || command.action === "revise")
				await answerIfParentDevice(output, command, familyAi, (next) => service.command(next));
			if (!alive || operation !== generation) return sent;
			if (command.action === "revoke") {
				apply({
					...data,
					settings: data.settings.filter((device) => device.device !== command.device),
					turns: data.turns.filter((turn) => turn.scope.device !== command.device),
				});
			} else {
				if (command.action === "configure" && command.muted) {
					apply({
						...data,
						settings: data.settings.map((device) =>
							device.device === command.device ? { ...device, muted: true } : device,
						),
						turns: data.turns.filter((turn) => turn.scope.device !== command.device),
					});
				}
				await refresh(operation);
			}
		} catch (cause) {
			if (alive && operation === generation)
				error = cause instanceof Error ? cause.message : "FamBuddy unavailable.";
		} finally {
			pending--;
		}
		return sent;
	}
	function approve(turn: BuddyTurn) {
		if (!turn.review || Date.parse(turn.expires_at) <= Date.now()) return;
		void run({
			action: "approve",
			device: turn.scope.device,
			turn: turn.scope.turn,
			review: turn.review,
		});
	}
	onMount(() => {
		alive = true;
		void listen();
		const timer = setInterval(() => {
			currentTime = Date.now();
		}, 1000);
		return () => {
			alive = false;
			updates?.abort();
			clearInterval(timer);
		};
	});
</script>

<section class="buddy-controls" aria-label="FamBuddy parent approvals">
	<div class="section-heading device-heading">
		<div>
			<h2>Your FamBuddy</h2>
			<p>Listening, messages and settings.</p>
		</div>
		<div class="heading-actions">
			<span class="device-count">{data.settings.length} connected</span>
			<Button icon={RefreshCw} variant="ghost" disabled={busy} onclick={() => void run()}
				>Reconnect device</Button
			>
		</div>
	</div>
	<ErrorToast message={error} />
	<div class="devices">
		{#each data.settings as device (device.device)}
			<BuddyDevice
				{device}
				caption={data.captions?.find((item) => item.device === device.device)}
				connection={{ service, server, auth, familyAi, local }}
				{busy}
				oncommand={run}
			/>
		{/each}
	</div>
	<div class="section-heading">
		<div>
			<h2>Waiting for your approval</h2>
			<p>Review each question before AI, then its answer before speech.</p>
		</div>
	</div>
	{#if !data.turns.length}
		<Card>
			<div class="empty-state">
				<CheckCheck size={28} strokeWidth={1.5} aria-hidden="true" />
				<div>
					<h3>No pending requests.</h3>
					<p>Questions and answers will appear here for your review.</p>
				</div>
			</div>
		</Card>
	{/if}
	<div class="requests">
		{#each data.turns as turn (turn.scope.turn)}
			<article
				aria-label={turn.stage === "QuestionPending" ? "Question approval" : "Answer approval"}
			>
				<Card>
					<div class="review-content">
						<header class="section-heading">
							<div>
								<span class="eyebrow">Device {turn.scope.device.slice(0, 8)}</span>
								<h3>
									{turn.stage === "QuestionPending"
										? "Review question"
										: turn.stage === "AnswerPending"
											? "Review answer"
											: turn.stage}
								</h3>
							</div>
							<span class="status-badge">
								{turn.stage === "QuestionPending"
									? "1 · Question"
									: turn.stage === "AnswerPending"
										? "2 · Answer"
										: "In progress"}
							</span>
						</header>
						<dl class="review-details">
							<div>
								<dt>Destination</dt>
								<dd>{turn.destination}</dd>
							</div>
							<div>
								<dt>Expires</dt>
								<dd>{new Date(turn.expires_at).toLocaleTimeString()}</dd>
							</div>
						</dl>
						{#if turn.review}
							<blockquote class="review-text">{turn.text}</blockquote>
							<label
								>Edit reviewed text
								<textarea
									value={edits[turn.scope.turn] ?? turn.text}
									oninput={(e) => (edits[turn.scope.turn] = e.currentTarget.value)}
									maxlength="8000"></textarea>
							</label>
							<div class="actions">
								<Button
									disabled={busy ||
										!!error ||
										Date.parse(turn.expires_at) <= currentTime ||
										(edits[turn.scope.turn] !== undefined && edits[turn.scope.turn] !== turn.text)}
									onclick={() => approve(turn)}
									>{turn.stage === "QuestionPending"
										? "Approve question and send to AI"
										: "Approve answer for speech"}</Button
								>
								<Button
									variant="ghost"
									disabled={busy || !edits[turn.scope.turn]?.trim()}
									onclick={() =>
										void run({
											action: "edit",
											device: turn.scope.device,
											turn: turn.scope.turn,
											text: edits[turn.scope.turn],
										})}>Save edit for review</Button
								>
								<Button
									variant="ghost"
									onclick={() =>
										void run({
											action: "cancel",
											device: turn.scope.device,
											turn: turn.scope.turn,
										})}>Reject / cancel</Button
								>
							</div>
						{:else}
							<Button
								variant="ghost"
								onclick={() =>
									void run({
										action: "cancel",
										device: turn.scope.device,
										turn: turn.scope.turn,
									})}>Reject / cancel</Button
							>
						{/if}
					</div>
				</Card>
			</article>
		{/each}
	</div>
</section>

<style>
	.buddy-controls,
	.requests,
	.review-content {
		display: grid;
		gap: calc(var(--v-space) * 2);
		min-width: 0;
	}
	.section-heading,
	.actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: calc(var(--v-space) * 1.5);
	}
	.actions {
		justify-content: flex-start;
	}
	h2,
	h3,
	p,
	dl,
	dd {
		margin: 0;
	}
	h2 {
		font-size: 1rem;
		font-weight: 600;
	}
	h3 {
		font-size: 0.95rem;
		font-weight: 600;
	}
	p,
	.device-count,
	.eyebrow,
	dt {
		color: var(--v-muted);
		font-size: 0.8125rem;
		line-height: 1.6;
	}
	.section-heading p {
		margin-top: calc(var(--v-space) / 2);
	}
	.empty-state {
		display: flex;
		align-items: center;
		gap: calc(var(--v-space) * 2);
		padding: calc(var(--v-space) * 2) 0;
	}
	.empty-state > :global(svg) {
		color: var(--v-muted);
		flex-shrink: 0;
	}
	.empty-state p {
		margin-top: calc(var(--v-space) / 2);
	}
	.eyebrow {
		display: block;
		margin-bottom: calc(var(--v-space) / 2);
	}
	.status-badge {
		display: inline-flex;
		align-items: center;
		gap: calc(var(--v-space) * 0.75);
		padding: calc(var(--v-space) / 2) var(--v-space);
		border-radius: 999px;
		background: color-mix(in srgb, var(--v-primary) 10%, transparent);
		color: var(--v-primary-text, var(--v-primary));
		font-size: 0.75rem;
		font-weight: 600;
	}
	.review-details {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: calc(var(--v-space) * 2);
	}
	dd {
		font-size: 0.8125rem;
		overflow-wrap: anywhere;
	}
	.review-text {
		margin: 0;
		padding: calc(var(--v-space) * 2);
		border-left: 3px solid var(--v-primary);
		border-radius: var(--v-radius-sm);
		background: var(--v-bg);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		line-height: 1.7;
	}
	.heading-actions {
		display: flex;
		align-items: center;
		gap: calc(var(--v-space) * 1.5);
	}
	.devices {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 25rem), 1fr));
		gap: calc(var(--v-space) * 2);
		min-width: 0;
	}
	label {
		display: grid;
		gap: calc(var(--v-space) / 2);
		font-size: 0.8125rem;
		font-weight: 600;
	}
	textarea {
		width: 100%;
		min-width: 0;
		min-height: 6rem;
		box-sizing: border-box;
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius-sm);
		padding: var(--v-space) calc(var(--v-space) * 1.5);
		background: var(--v-bg);
		color: var(--v-fg);
		font: inherit;
		font-weight: 400;
		resize: vertical;
	}
	textarea:focus-visible {
		outline: 2px solid var(--v-ring);
		outline-offset: 1px;
	}
	p {
		overflow-wrap: anywhere;
	}
	@media (max-width: 600px) {
		.review-details {
			grid-template-columns: minmax(0, 1fr);
		}
		.section-heading {
			align-items: flex-start;
		}
	}
</style>
