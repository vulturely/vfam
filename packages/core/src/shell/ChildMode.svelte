<script lang="ts">
	import UiCircleHelp from "lucide-svelte/icons/circle-help";
	import House from "lucide-svelte/icons/house";
	import MessageCircle from "lucide-svelte/icons/message-circle";
	import BookOpen from "lucide-svelte/icons/book-open";
	import UserRound from "lucide-svelte/icons/user-round";
	import ChildPolicy from "./ChildPolicy.svelte";
	import ChildLearning from "./ChildLearning.svelte";
	import ChildAiSetup from "./ChildAiSetup.svelte";
	import ChildHome from "./ChildHome.svelte";
	import ChildProfile from "./ChildProfile.svelte";
	import ProfileChooser from "./ProfileChooser.svelte";
	import UiLockKeyholeOpen from "lucide-svelte/icons/lock-keyhole-open";
	import UiLogOut from "lucide-svelte/icons/log-out";
	import ChatScreen from "./ChatScreen.svelte";
	import Shell from "./Shell.svelte";
	import type { ShellNav } from "./shellNav";
	import { onMount } from "svelte";
	import type { Runtime } from "../runtime/registry.svelte";
	import { Button, Card, ErrorToast } from "../components/index";
	let { runtime }: { runtime: Runtime } = $props();
	let help = $state(false);
	let busy = $state(false);
	let error = $state("");
	const guardian = () => runtime.services.auth.signIn();
	// Both actions leave this page on success, so only failures re-enable the buttons.
	async function run(action: () => Promise<void>) {
		if (busy) return;
		busy = true;
		error = "";
		try {
			await action();
		} catch {
			error = "Could not reach the server. Please check the connection and try again.";
			busy = false;
		}
	}
	const pages = ["child:home", "chat", "child:learning", "profile"];
	// Reloads keep the child's page; Switch profile always starts from Home again.
	const fromHash = window.location.hash.replace(/^#\/?/, "");
	let screen = $state(pages.includes(fromHash) ? fromHash : "child:home");
	function go(id: string) {
		screen = id;
		if (pages.includes(id)) window.history.replaceState(window.history.state, "", `#/${id}`);
	}
	let picture = $state<string | null>(null);
	const child = $derived(
		runtime.state.childSession?.status === "active" ? runtime.state.childSession : null,
	);
	const nav = $derived<ShellNav>({
		items: [
			{ id: "child:home", label: "Home", icon: House },
			{ id: "chat", label: "Chat & calls", icon: MessageCircle },
			{ id: "child:learning", label: "Learning", icon: BookOpen },
			{ id: "profile", label: "Profile", icon: UserRound },
		],
		current: screen,
		navigate: go,
		picture,
		switchProfile: () => (screen = "child:switch"),
	});
	function setPicture(url: string | null) {
		if (picture) URL.revokeObjectURL(picture);
		picture = url;
	}
	onMount(() => {
		const timer = setInterval(() => void runtime.refreshChildSession(), 30000);
		return () => {
			clearInterval(timer);
			if (picture) URL.revokeObjectURL(picture);
		};
	});
	$effect(() => {
		const profileId = child?.profileId;
		if (!profileId) return;
		void runtime.services.childHome
			.avatar(profileId)
			.then((avatar) => {
				if (avatar)
					setPicture(
						URL.createObjectURL(
							new Blob([new Uint8Array(avatar.image)], { type: avatar.contentType }),
						),
					);
			})
			.catch(() => {});
	});
</script>

{#if child}
	<Shell {runtime} {nav}>
		{#if screen === "chat"}<!-- Family chat and calls are open at any time. --><ChatScreen />
		{:else if screen === "child:learning"}<section class="child-learning-page">
				<Card>
					<ChildAiSetup service={runtime.services.childFamilyAi} />
					<ChildPolicy service={runtime.services.timetable}
						><ChildLearning
							service={runtime.services.childLearning}
							voice={runtime.services.voice}
							familyAi={runtime.services.childFamilyAi}
						/></ChildPolicy
					>
				</Card>
			</section>
		{:else if screen === "profile"}<ChildProfile
				name={child.displayName}
				{picture}
				onpicture={setPicture}
			/>
		{:else if screen === "child:switch"}<ProfileChooser />
		{:else}<ChildHome name={child.displayName} onlearn={() => go("child:learning")} />{/if}
	</Shell>
{:else}
	<main class="child-mode">
		<Card>
			<h1>Learning session paused</h1>
			<p>Ask a guardian to sign in again.</p>
			<Button
				icon={UiCircleHelp}
				variant="ghost"
				onclick={() => {
					help = !help;
				}}>Help</Button
			>
			{#if help}<p>
					Ask your guardian to sign in. Closing Vulture still permits other apps; this timetable
					only controls Vulture.
				</p>{/if}
			<ErrorToast message={error} />
			<div class="actions">
				<Button icon={UiLockKeyholeOpen} disabled={busy} onclick={() => void run(guardian)}
					>Guardian sign-in</Button
				>
				<Button
					icon={UiLogOut}
					variant="ghost"
					disabled={busy}
					onclick={() => void run(() => runtime.services.auth.signOut())}>End child session</Button
				>
			</div>
		</Card>
	</main>
{/if}

<style>
	.child-mode {
		min-height: 100dvh;
		display: grid;
		align-items: center;
		max-width: 48rem;
		margin: 0 auto;
		padding: max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right))
			max(1rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
	}
	.child-learning-page {
		width: min(100%, 48rem);
		margin: auto;
		display: grid;
		gap: 1rem;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--v-space);
	}
	h1 {
		font-size: clamp(1.6rem, 5vw, 2.4rem);
		margin: 0;
		overflow-wrap: anywhere;
	}
</style>
