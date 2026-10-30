<script lang="ts">
	import UiCalendarCheck from "lucide-svelte/icons/calendar-check";
	import UiCircleHelp from "lucide-svelte/icons/circle-help";
	import { onMount, type Snippet } from "svelte";
	import { Button, ErrorToast } from "../components/index";
	import type { TimetableService } from "../timetable/service";
	import { policyLease } from "../timetable/service";
	import type { GetChildPolicyResponse } from "../api/protocol";
	let { service, children }: { service: TimetableService; children: Snippet } = $props();
	let policy = $state<GetChildPolicyResponse | null>(null);
	let valid = $state(false);
	let error = $state("");
	let help = $state(false);
	let refresh = async () => {};
	onMount(() => {
		let disposed = false,
			generation = 0,
			deadline = 0,
			pending = false;
		refresh = async () => {
			if (pending || !navigator.onLine) return;
			pending = true;
			const current = ++generation;
			const started = window.performance.now();
			try {
				const result = await service.policy("learning");
				if (disposed || current !== generation) return;
				deadline =
					window.performance.now() + policyLease(result, window.performance.now() - started);
				policy = result;
				valid = deadline > window.performance.now();
				error = "";
			} catch {
				if (!disposed && current === generation) {
					policy = null;
					valid = false;
					error = "Timetable unavailable. Reconnect to check allowed time.";
				}
			} finally {
				if (current === generation) pending = false;
			}
		};
		const invalidate = () => {
			++generation;
			pending = false;
			valid = false;
			policy = null;
		};
		const offline = () => {
			invalidate();
			error = "You are offline. Activities are paused until your timetable can be checked.";
		};
		const resume = () => {
			invalidate();
			void refresh();
		};
		const visibility = () => {
			if (document.hidden) invalidate();
			else resume();
		};
		window.addEventListener("offline", offline);
		window.addEventListener("online", resume);
		document.addEventListener("visibilitychange", visibility);
		void refresh();
		const poll = setInterval(() => void refresh(), 10000);
		const expiry = setInterval(() => {
			if (window.performance.now() >= deadline) valid = false;
		}, 100);
		return () => {
			disposed = true;
			clearInterval(poll);
			clearInterval(expiry);
			window.removeEventListener("offline", offline);
			window.removeEventListener("online", resume);
			document.removeEventListener("visibilitychange", visibility);
		};
	});
</script>

<section class="child-policy" class:open={valid && policy?.allowed} aria-label="Vulture timetable">
	<!-- While learning is allowed, the child sees only the activity itself. -->
	{#if valid && policy && !policy.allowed}<p role="status">
			Right now: {policy.currentActivity}
		</p>{/if}
	{#if valid && policy?.allowed}
		{@render children()}
	{:else}
		<h2>Time for a pause</h2>
		<ErrorToast message={error} />
		{#if valid && policy?.nextAllowedAt}
			<p>
				Learning opens again {new Intl.DateTimeFormat(undefined, {
					weekday: "short",
					hour: "numeric",
					minute: "2-digit",
					timeZone: policy.timezone || "UTC",
				}).format(new Date(policy.nextAllowedAt))}
			</p>
		{:else if valid && policy}<p>
				Your guardian hasn't set learning time yet. Ask them to add some.
			</p>
		{:else}<p>We can't check your learning time right now. Try again in a moment.</p>{/if}
		<Button icon={UiCalendarCheck} variant="ghost" onclick={() => void refresh()}>Try again</Button>
	{/if}
	{#if !(valid && policy?.allowed)}<Button
			icon={UiCircleHelp}
			variant="ghost"
			onclick={() => {
				help = !help;
			}}>Help</Button
		>{/if}
	{#if help}<p>
			Ask your guardian for help. They can unlock from Switch profile. Your answers are saved on the
			server. Closing Vulture still lets you use other apps; this timetable only controls Vulture.
		</p>{/if}
</section>

<style>
	.child-policy.open {
		display: contents;
	}
</style>
