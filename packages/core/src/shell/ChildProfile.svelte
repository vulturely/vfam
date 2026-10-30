<script lang="ts">
	import { getContext } from "svelte";
	import Camera from "lucide-svelte/icons/camera";
	import UserRound from "lucide-svelte/icons/user-round";
	import { ErrorToast } from "../components/index";
	import type { Runtime } from "../runtime/registry.svelte";
	import { profilePicture } from "../images/profilePicture";
	// The shell owns the picture URL because the navigation shows it too.
	let {
		name,
		picture,
		onpicture,
	}: { name: string; picture: string | null; onpicture: (url: string | null) => void } = $props();
	const runtime = getContext<Runtime>("vulture:runtime");
	let busy = $state(false);
	let error = $state("");
	let notice = $state("");
	let input = $state<globalThis.HTMLInputElement>();
	async function run(action: () => Promise<void>) {
		if (busy) return;
		busy = true;
		error = "";
		notice = "";
		try {
			await action();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Could not update your picture.";
		} finally {
			busy = false;
		}
	}
	async function choose(event: Event) {
		const target = event.currentTarget as globalThis.HTMLInputElement;
		const file = target.files?.[0];
		target.value = "";
		if (!file) return;
		await run(async () => {
			const avatar = await profilePicture(file);
			await runtime.services.childHome.setAvatar(avatar);
			onpicture(
				URL.createObjectURL(new Blob([new Uint8Array(avatar.image)], { type: avatar.contentType })),
			);
			notice = "Picture updated.";
		});
	}
</script>

<section class="child-profile" aria-labelledby="child-profile-title">
	<button
		type="button"
		class="picture"
		aria-label={picture ? "Change your picture" : "Add your picture"}
		disabled={busy}
		onclick={() => input?.click()}
	>
		<span class="frame"
			>{#if picture}<img src={picture} alt="" />{:else}<UserRound
					size={56}
					aria-hidden="true"
				/>{/if}</span
		>
		<span class="camera" aria-hidden="true"><Camera size={16} /></span>
	</button>
	<h2 id="child-profile-title">{name}</h2>
	<p>Tap your picture to change it.</p>
	<input
		bind:this={input}
		class="file"
		type="file"
		accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
		aria-label="Choose a profile picture"
		onchange={(event) => void choose(event)}
	/>
	{#if notice}<p role="status">{notice}</p>{/if}
	<ErrorToast message={error} />
</section>

<style>
	.child-profile {
		display: grid;
		justify-items: center;
		gap: 16px;
		width: min(100%, 420px);
		margin: auto;
		padding-block: 32px;
		text-align: center;
	}
	.picture {
		position: relative;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: none;
		cursor: pointer;
		font: inherit;
	}
	.frame {
		display: grid;
		place-items: center;
		width: 128px;
		height: 128px;
		border: 1px solid var(--v-border);
		border-radius: 50%;
		overflow: hidden;
		color: var(--v-muted);
		background: var(--v-glass, var(--v-surface));
	}
	.picture:hover .frame,
	.picture:focus-visible .frame {
		border-color: var(--v-primary);
	}
	.picture:disabled {
		cursor: progress;
		opacity: 0.7;
	}
	.camera {
		position: absolute;
		right: 4px;
		bottom: 4px;
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: var(--v-primary);
		color: var(--v-primary-fg, #fff);
	}
	.frame img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	h2 {
		margin: 0;
		font-size: 1.6rem;
		overflow-wrap: anywhere;
	}
	.file {
		display: none;
	}
	p {
		margin: 0;
		color: var(--v-muted);
	}
</style>
