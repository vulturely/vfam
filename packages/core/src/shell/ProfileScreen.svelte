<script lang="ts">
	import { getContext, onMount } from "svelte";
	import type { Runtime } from "../runtime/registry.svelte";
	import type { IdentityService } from "../identity/service";
	import QRCode from "qrcode";
	import Copy from "lucide-svelte/icons/copy";
	import Check from "lucide-svelte/icons/check";
	import QrCode from "lucide-svelte/icons/qr-code";
	import Users from "lucide-svelte/icons/users";
	import Smartphone from "lucide-svelte/icons/smartphone";
	import Calendar from "lucide-svelte/icons/calendar";
	import IdCard from "lucide-svelte/icons/id-card";
	import Shield from "lucide-svelte/icons/shield";
	import Camera from "lucide-svelte/icons/camera";
	import Loader2 from "lucide-svelte/icons/loader-2";
	import { Card, ErrorToast } from "../components/index";

	const runtime = getContext<Runtime>("vulture:runtime");
	const identity = $derived(runtime.state.identity);

	/**
	 * The profile-avatar service, registered by the identity plugin. Falls back
	 * to the core family service when the plugin isn't present so the screen
	 * keeps working in minimal/test runtimes.
	 */
	const identityService = $derived<IdentityService>(
		(runtime.pluginServices?.["identity"]?.["identity"] as IdentityService | undefined) ??
			runtime.services.family,
	);

	const idpPictureUrl = $derived(identity?.picture ?? null);
	let avatarUrl = $state<string | null>(null);
	let qrDataUrl = $state<string | null>(null);
	let showQr = $state(false);
	let copied = $state(false);
	let avatarInput = $state<{ click: () => void }>();
	let uploading = $state(false);
	let uploadError = $state("");

	async function loadAvatar() {
		const sub = identity?.id;
		if (!sub) return;
		const avatar = await identityService.getAvatar(sub);
		if (avatar && avatar.image.length > 0) {
			avatarUrl = URL.createObjectURL(
				new Blob([new Uint8Array(avatar.image)], { type: avatar.contentType }),
			);
		} else {
			avatarUrl = null;
		}
	}

	onMount(() => {
		void loadAvatar();
	});

	function openAvatarPicker() {
		avatarInput?.click();
	}

	async function onAvatarSelected(file: File) {
		if (!file.type.startsWith("image/")) {
			uploadError = "Please choose an image file.";
			return;
		}
		uploadError = "";
		uploading = true;
		try {
			const bytes = new Uint8Array(await file.arrayBuffer());
			await identityService.setAvatar(bytes, file.type);
			if (avatarUrl) URL.revokeObjectURL(avatarUrl);
			avatarUrl = null;
			await loadAvatar();
		} catch (caught) {
			uploadError = caught instanceof Error ? caught.message : "Could not upload picture.";
		} finally {
			uploading = false;
		}
	}

	// Generate the QR lazily once the user reveals it.
	$effect(() => {
		const id = identity?.id;
		if (showQr && id && !qrDataUrl) {
			void QRCode.toDataURL(id, { width: 180, margin: 1 }).then((url) => {
				qrDataUrl = url;
			});
		}
	});

	async function copyAccountId() {
		const id = identity?.id;
		if (!id) return;
		try {
			await navigator.clipboard.writeText(id);
			copied = true;
			setTimeout(() => {
				copied = false;
			}, 1500);
		} catch {
			// Clipboard unavailable; ignore.
		}
	}

	const avatarSrc = $derived(idpPictureUrl ?? avatarUrl);

	const memberSince = $derived(
		identity?.createdAt
			? new Date(identity.createdAt).toLocaleDateString(undefined, {
					year: "numeric",
					month: "long",
					day: "numeric",
				})
			: "",
	);
</script>

<section class="v-profile" aria-labelledby="profile-title">
	<Card>
		<div class="v-profile-avatar">
			{#if avatarSrc}
				<img src={avatarSrc} alt={identity?.name ?? "Profile"} />
			{:else}
				<span>{(identity?.name ?? "?").charAt(0).toUpperCase()}</span>
			{/if}
			<button
				type="button"
				class="v-profile-avatar-edit"
				disabled={uploading}
				onclick={openAvatarPicker}
				aria-label="Change profile picture"
				title="Change profile picture"
			>
				{#if uploading}
					<Loader2 class="v-spin" aria-hidden="true" size={18} strokeWidth={2.4} />
				{:else}
					<Camera aria-hidden="true" size={18} strokeWidth={2.4} />
				{/if}
			</button>
			<input
				bind:this={avatarInput}
				class="v-profile-avatar-input"
				type="file"
				accept="image/*"
				disabled={uploading}
				onchange={(event) => {
					const file = event.currentTarget.files?.[0];
					event.currentTarget.value = "";
					if (file) void onAvatarSelected(file);
				}}
			/>
		</div>
		<ErrorToast message={uploadError} />
		<h2 id="profile-title">{identity?.name ?? "Profile"}</h2>

		<div class="v-profile-info">
			{#if identity}
				<div class="v-profile-info-row">
					<div class="v-profile-info-head">
						<Shield aria-hidden="true" size={18} strokeWidth={2.2} />
						<span class="v-profile-info-label">Role</span>
					</div>
					<span class="v-profile-info-value">{identity.role}</span>
				</div>
				<div class="v-profile-info-row">
					<div class="v-profile-info-head">
						<IdCard aria-hidden="true" size={18} strokeWidth={2.2} />
						<span class="v-profile-info-label">Account id</span>
					</div>
					<button
						type="button"
						class="v-profile-account-id"
						title="Copy account id"
						aria-label="Copy account id"
						onclick={() => void copyAccountId()}
					>
						{#if copied}
							<Check aria-hidden="true" size={16} strokeWidth={2.4} />
							<span>Copied!</span>
						{:else}
							<Copy aria-hidden="true" size={16} strokeWidth={2.4} />
							<span>{identity.id}</span>
						{/if}
					</button>
				</div>
			{/if}
			{#if identity?.familyId}
				<div class="v-profile-info-row">
					<div class="v-profile-info-head">
						<Users aria-hidden="true" size={18} strokeWidth={2.2} />
						<span class="v-profile-info-label">Family</span>
					</div>
					<span class="v-profile-info-value">{identity.familyId}</span>
				</div>
			{/if}
			{#if identity?.deviceId}
				<div class="v-profile-info-row">
					<div class="v-profile-info-head">
						<Smartphone aria-hidden="true" size={18} strokeWidth={2.2} />
						<span class="v-profile-info-label">Device</span>
					</div>
					<span class="v-profile-info-value">{identity.deviceId}</span>
				</div>
			{/if}
			{#if memberSince}
				<div class="v-profile-info-row">
					<div class="v-profile-info-head">
						<Calendar aria-hidden="true" size={18} strokeWidth={2.2} />
						<span class="v-profile-info-label">Member since</span>
					</div>
					<span class="v-profile-info-value">{memberSince}</span>
				</div>
			{/if}
		</div>

		{#if identity}
			<button
				type="button"
				class="v-profile-qr-toggle"
				class:open={showQr}
				aria-expanded={showQr}
				aria-label={showQr ? "Hide QR code" : "Show QR code"}
				title={showQr ? "Hide QR code" : "Show QR code"}
				onclick={() => (showQr = !showQr)}
			>
				<QrCode aria-hidden="true" size={18} strokeWidth={2.2} />
				<span>{showQr ? "Hide QR code" : "Show QR code"}</span>
			</button>
		{/if}

		{#if showQr && qrDataUrl}
			<div class="v-profile-qr-wrap">
				<span class="v-profile-qr-label">Scan to share your account id</span>
				<img
					class="v-profile-qr"
					src={qrDataUrl}
					alt={`QR code for ${identity?.name ?? "account"}`}
				/>
			</div>
		{/if}
	</Card>
</section>

<style>
	.v-profile {
		display: grid;
		place-items: center;
		min-height: calc(100dvh - var(--v-control-h) - var(--v-space) * 8);
		min-width: 0;
		padding: clamp(var(--v-space), 2vw, calc(var(--v-space) * 2));
	}
	.v-profile :global(.v-card) {
		display: grid;
		justify-items: center;
		gap: calc(var(--v-space) * 1.25);
		width: min(100%, 36rem);
		min-width: 0;
		text-align: center;
	}
	.v-profile-avatar {
		position: relative;
		display: grid;
		place-items: center;
		width: 140px;
		height: 140px;
		border-radius: var(--v-radius);
		background: color-mix(in srgb, var(--v-primary) 14%, transparent);
		color: var(--v-primary-text, var(--v-primary));
		font-size: 3.4rem;
		font-weight: 700;
		overflow: hidden;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
	}
	.v-profile-avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.v-profile-avatar-edit {
		position: absolute;
		right: calc(var(--v-space) * 0.6);
		bottom: calc(var(--v-space) * 0.6);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		padding: 0;
		border: none;
		border-radius: 999px;
		background: color-mix(in srgb, var(--v-bg) 88%, transparent);
		color: var(--v-fg);
		cursor: pointer;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
	}
	.v-profile-avatar-edit:hover {
		color: var(--v-primary-text, var(--v-primary));
	}
	.v-profile-avatar-edit:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.v-profile-avatar-input {
		display: none;
	}
	h2 {
		max-width: 100%;
		overflow-wrap: anywhere;
		margin: 0;
		color: var(--v-fg);
		font-size: clamp(1.6rem, 4vw, 2.2rem);
	}
	.v-profile-account-id {
		display: inline-flex;
		align-items: center;
		gap: calc(var(--v-space) / 2);
		min-width: 0;
		width: 100%;
		max-width: 100%;
		justify-content: flex-start;
		padding: calc(var(--v-space) * 0.6) calc(var(--v-space) * 1);
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius-sm);
		background: var(--v-bg);
		color: var(--v-muted);
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
		text-align: left;
		white-space: normal;
	}
	.v-profile-account-id span {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.v-profile-account-id:hover {
		color: var(--v-primary-text, var(--v-primary));
		border-color: var(--v-primary);
	}
	.v-profile-info {
		display: grid;
		gap: calc(var(--v-space) * 2.5);
		width: 100%;
		min-width: 0;
		padding: var(--v-space) 0;
		text-align: left;
	}
	.v-profile-info-row {
		display: grid;
		grid-template-columns: 8.5rem minmax(0, 1fr);
		min-width: 0;
		align-items: center;
		gap: var(--v-space);
		color: var(--v-fg);
	}
	.v-profile-info-head {
		display: flex;
		align-items: center;
		gap: var(--v-space);
	}
	.v-profile-info-head :global(svg) {
		flex: 0 0 auto;
		color: var(--v-primary-text, var(--v-primary));
	}
	.v-profile-info-label {
		min-width: 0;
		font-size: 0.8rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--v-muted);
	}
	.v-profile-info-value {
		flex: 1;
		min-width: 0;
		font-size: 0.85rem;
		font-weight: 300;
		overflow-wrap: anywhere;
		line-height: 1.5;
	}
	@media (max-width: 760px) {
		.v-profile-avatar,
		.v-profile-avatar-edit {
			background: transparent;
			box-shadow: none;
		}
	}
	@media (max-width: 480px) {
		.v-profile-info-row {
			grid-template-columns: minmax(0, 1fr);
			align-items: start;
			gap: calc(var(--v-space) / 3);
		}
		.v-profile-info-label {
			width: auto;
		}
		.v-profile-info-value {
			width: 100%;
		}
	}
	.v-profile-qr-toggle {
		display: inline-flex;
		align-items: center;
		gap: calc(var(--v-space) / 2);
		min-height: max(var(--v-control-h) * 0.8, 36px);
		padding: 0 calc(var(--v-space) * 1.1);
		border: 1px solid var(--v-border);
		border-radius: 999px;
		background: var(--v-bg);
		color: var(--v-muted);
		font: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
	}
	.v-profile-qr-toggle:hover,
	.v-profile-qr-toggle.open {
		color: var(--v-primary-text, var(--v-primary));
		border-color: var(--v-primary);
	}
	.v-profile-qr-wrap {
		display: grid;
		justify-items: center;
		gap: calc(var(--v-space) / 2);
	}
	.v-profile-qr-label {
		font-size: 0.78rem;
		color: var(--v-muted);
	}
	.v-profile-qr {
		width: 180px;
		height: 180px;
		border-radius: var(--v-radius-sm);
	}
</style>
