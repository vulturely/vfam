<script lang="ts">
	import UiSend from "lucide-svelte/icons/send";
	import { Button, ErrorToast, Input } from "../components/index";

	let name = $state("");
	let email = $state("");
	let message = $state("");
	let error = $state("");
	let sent = $state(false);

	function submit() {
		error = "";
		const trimmedName = name.trim();
		const trimmedEmail = email.trim();
		const trimmedMessage = message.trim();

		if (!trimmedName) {
			error = "Please enter your name.";
			return;
		}
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
			error = "Please enter a valid email address.";
			return;
		}
		if (trimmedMessage.length < 10) {
			error = "Please write a message of at least 10 characters.";
			return;
		}

		// No backend endpoint for contact yet — open the user's mail client with
		// the message pre-filled so it actually gets sent.
		const subject = encodeURIComponent(`Vulture contact from ${trimmedName}`);
		const body = encodeURIComponent(
			`Name: ${trimmedName}\nEmail: ${trimmedEmail}\n\n${trimmedMessage}`,
		);
		window.location.href = `mailto:hello@vulture.app?subject=${subject}&body=${body}`;
		sent = true;
	}
</script>

<div class="v-contact">
	{#if sent}
		<p class="v-contact-success" role="status">
			Thanks! Your message has been opened in your email app, ready to send to hello@vulture.app.
		</p>
	{:else}
		<form
			class="v-contact-form"
			onsubmit={(e) => {
				e.preventDefault();
				submit();
			}}
		>
			<Input bind:value={name} label="Name" placeholder="Your name" />
			<Input bind:value={email} label="Email" type="email" placeholder="you@example.com" />
			<label class="v-field">
				<span class="v-field-label">Message</span>
				<textarea bind:value={message} rows={5} placeholder="How can we help?"></textarea>
			</label>
			<ErrorToast message={error} />
			<div class="v-contact-actions">
				<Button icon={UiSend} type="submit">Send message</Button>
			</div>
		</form>
	{/if}
</div>

<style>
	.v-contact-form {
		display: grid;
		gap: calc(var(--v-space) * 1.5);
	}
	.v-contact-actions {
		display: flex;
		justify-content: flex-end;
	}
	.v-field {
		display: flex;
		flex-direction: column;
		gap: calc(var(--v-space) / 2);
	}
	.v-field-label {
		font-weight: 600;
		color: var(--v-fg);
	}
	textarea {
		width: 100%;
		min-height: 7rem;
		border-radius: var(--v-radius-sm);
		border: 1px solid var(--v-border);
		background: var(--v-bg);
		color: var(--v-fg);
		padding: calc(var(--v-space) * 1.2) calc(var(--v-space) * 1.5);
		font: inherit;
		resize: vertical;
	}
	textarea::placeholder {
		color: var(--v-muted);
	}
	textarea:focus-visible {
		border-color: var(--v-primary);
	}
	.v-contact-success {
		margin: 0;
		color: var(--v-primary);
		font-weight: 600;
		line-height: 1.6;
	}
</style>
