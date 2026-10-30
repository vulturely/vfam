<script lang="ts">
	import UiRefreshCw from "lucide-svelte/icons/refresh-cw";
	import UiPlay from "lucide-svelte/icons/play";
	import UiSquare from "lucide-svelte/icons/square";
	import UiShieldOff from "lucide-svelte/icons/shield-off";
	import UiCircleSlash from "lucide-svelte/icons/circle-slash";
	import { onMount } from "svelte";
	import { Button, ErrorToast, IconButton } from "../components/index";
	import {
		loadDashboard,
		live,
		type Dashboard,
		type DashboardServices,
	} from "../parent-learning/dashboard";
	import { RobotCapabilityValue as Capability, type FamBudDevice } from "../api/protocol";
	let { services, profileId }: { services: DashboardServices; profileId: string } = $props();
	let data = $state<Dashboard>();
	let busy = $state(false),
		error = $state(""),
		notice = $state("");
	let selected = $state("");
	let now = $state(Date.now());
	let failed = $state(false);
	function fresh(device: FamBudDevice) {
		const seen = Date.parse(device.lastSeenAt ?? "");
		return (
			!failed && !device.revoked && device.connected && Number.isFinite(seen) && now - seen < 30000
		);
	}
	async function refresh() {
		data = await loadDashboard(services, profileId);
		failed = false;
		if (!data.spelling.some((set) => set.practice?.practice?.id === selected))
			selected = data.spelling[0]?.practice?.practice?.id ?? "";
	}
	async function run(action: () => Promise<void>, success = "") {
		if (busy) return;
		busy = true;
		error = "";
		try {
			await action();
			notice = success;
		} catch (cause) {
			failed = true;
			error = cause instanceof Error ? cause.message : "Dashboard request failed. Please retry.";
		} finally {
			busy = false;
		}
	}
	onMount(() => {
		let active = true;
		void run(refresh);
		const timer = setInterval(() => {
			now = Date.now();
			if (active && !busy) void run(refresh);
		}, 5000);
		return () => {
			active = false;
			clearInterval(timer);
		};
	});
	async function start(device: FamBudDevice) {
		await run(async () => {
			const practice = data?.spelling.find((set) => set.practice?.practice?.id === selected)
				?.practice?.practice;
			if (!practice || !fresh(device))
				throw new Error("Refresh and choose an online device and approved spelling practice.");
			await services.robot.issue({
				commandId: crypto.randomUUID(),
				target: device.id,
				nonce: crypto.randomUUID(),
				expiresAt: new Date(Date.now() + 120000).toISOString(),
				practiceId: practice.id,
				practiceVersion: practice.version,
			});
			await refresh();
		}, "Quiz queued. Waiting for device acknowledgement.");
	}
	async function stop(device: FamBudDevice) {
		await run(async () => {
			// Read the authoritative queue first, including commands from another parent/browser.
			const snapshot = await services.robot.dashboard(profileId);
			for (const command of snapshot.commands.filter(
				(c) => c.target === device.id && live(c.state),
			))
				await services.robot.cancel(command.commandId);
			await refresh();
		}, "Quiz stopped. Queued learning commands cancelled.");
	}
</script>

<section class="learning-dashboard" aria-label="FamBud controls">
	<div class="dashboard-intro">
		<p>Manage paired learning devices for this child.</p>
		<IconButton
			icon={UiRefreshCw}
			label="Refresh devices"
			disabled={busy}
			onclick={() => void run(refresh)}
		/>
	</div>
	<ErrorToast
		message={error ? `${error} Data may be stale; refresh before starting a quiz.` : ""}
	/>
	{#if notice}<p role="status">{notice}</p>{/if}
	{#if !data}<p role="status">
			{busy ? "Loading devices…" : "Devices unavailable."}
		</p>{:else}
		<section class="dashboard-block" aria-label="FamBud devices">
			<label
				>Approved spelling practice
				<select bind:value={selected} disabled={busy || !data.spelling.length}>
					<option value="">Choose approved spelling practice</option>
					{#each data.spelling as set (set.practice!.practice!.id)}<option
							value={set.practice!.practice!.id}
							>{set.practice!.title} · v{set.practice!.practice!.version}</option
						>{/each}
				</select>
			</label>
			{#if !data.spelling.length}<p>
					Approve an all-spelling practice set in Homework before starting a quiz.
				</p>{/if}
			{#if !data.devices.length}<p>
					No paired devices. Pair the FamBud simulator using the device setup instructions.
				</p>{/if}
			{#each data.devices as device (device.id)}
				<article aria-label={device.displayName}>
					<h4>{device.displayName}</h4>
					<p>
						{device.revoked
							? "Revoked — reconnect denied"
							: fresh(device)
								? "Online"
								: "Disconnected · telemetry stale"}
					</p>
					<p>
						Last seen: {device.lastSeenAt ?? "Never"} · Battery: {device.batteryPercent ===
						undefined
							? "Unknown"
							: `${device.batteryPercent}%`} · Firmware: {device.firmware}
					</p>
					<p>
						Supported controls: {device.capabilities.includes(Capability.START_QUIZ)
							? "Start quiz"
							: "Start quiz unavailable"}, {device.capabilities.includes(Capability.STOP_QUIZ)
							? "Stop quiz"
							: "Stop quiz unavailable"}.
					</p>
					<div class="v-button-row">
						<Button
							icon={UiPlay}
							disabled={busy ||
								!fresh(device) ||
								!selected ||
								!device.capabilities.includes(Capability.START_QUIZ) ||
								data.commands.some((c) => c.target === device.id && live(c.state))}
							onclick={() => void start(device)}>Start quiz</Button
						>
						<Button
							icon={UiSquare}
							variant="ghost"
							disabled={busy ||
								device.revoked ||
								!device.capabilities.includes(Capability.STOP_QUIZ) ||
								!data.commands.some((c) => c.target === device.id && live(c.state))}
							onclick={() => void stop(device)}>Stop quiz</Button
						>
						<Button
							icon={UiShieldOff}
							variant="ghost"
							disabled={busy || device.revoked}
							onclick={() =>
								void run(async () => {
									await services.robot.revoke(device.id);
									await refresh();
								}, "Device revoked. It cannot reconnect.")}>Revoke device</Button
						>
					</div>
					<p>
						Speech, camera, sensors, mobility and flight are unsupported by the pilot simulator.
					</p>
					{#each ["Speak prompt", "Camera", "Sensors", "Move", "Fly"] as action (action)}<Button
							icon={UiCircleSlash}
							variant="ghost"
							disabled>{action} · unsupported</Button
						>{/each}
					<ul aria-label="Command history">
						{#each data.commands.filter((c) => c.target === device.id) as command (command.commandId)}<li
							>
								Command {command.commandId} · {command.state === "accepted"
									? "Acknowledged"
									: command.state} · Session {command.sessionId} · Expires {command.expiresAt}
							</li>{/each}
					</ul>
				</article>
			{/each}
		</section>
	{/if}
</section>

<style>
	.learning-dashboard {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
	}
	.dashboard-intro {
		display: grid;
		gap: 12px;
	}
	.dashboard-block {
		display: grid;
		gap: 14px;
		padding: 0;
		border: 0;
		border-radius: var(--v-radius-sm);
		background: transparent;
		min-width: 0;
	}
	label {
		display: grid;
		gap: 8px;
		min-width: 0;
	}
	ul {
		padding-left: 20px;
	}
	li + li {
		margin-top: 8px;
	}
	@media (max-width: 540px) {
		.dashboard-block {
			padding: 0;
		}
	}
	h4,
	p,
	ul {
		margin: 0;
	}
	ul:empty {
		display: none;
	}
	p {
		line-height: 1.5;
		color: var(--v-muted);
	}
	p,
	li,
	h4 {
		overflow-wrap: anywhere;
	}
	article {
		border-top: 1px solid var(--v-border);
		padding-top: 20px;
		display: grid;
		gap: 12px;
	}
	select {
		width: 100%;
		min-width: 0;
		min-height: max(44px, var(--v-control-h));
		padding: var(--v-space);
		font: inherit;
		color: var(--v-fg);
		background: var(--v-bg);
		border: 0;
		border-radius: var(--v-radius-sm);
	}
</style>
