<script lang="ts">
	import { Card } from "../components/index";
	import ContactForm from "./ContactForm.svelte";
	import vultureImage from "../components/assets/vulture.svg?url";

	let { screen }: { screen: string } = $props();

	interface Section {
		heading?: string;
		paragraphs: string[];
	}

	interface Page {
		title: string;
		intro?: string;
		sections: Section[];
	}

	const content: Record<string, Page> = {
		about: {
			title: "About Vulture",
			intro:
				"Vulture is a warm landing place for parents, kids, and grandparents — one shared space where every generation stays connected.",
			sections: [
				{
					heading: "About the project",
					paragraphs: [
						"Vulture began with a simple idea: families shouldn't have to juggle separate apps to stay in touch. We built one shared space where every generation can connect, share, and help each other.",
						"Each person gets a screen shaped for how they use it, and the whole family shares chores, updates, and moments in real time.",
					],
				},
				{
					heading: "About us",
					paragraphs: [
						"We're a small team who believe technology should bring families closer, not push them apart. We design Vulture to be warm, simple, and welcoming for every generation.",
						"We're always learning from the families who use Vulture, and we'd love to hear from you.",
					],
				},
			],
		},
		contact: {
			title: "Contact",
			intro: "We'd love to hear from you. Send us a message and we'll get back to you.",
			sections: [],
		},
		privacy: {
			title: "Privacy Policy",
			intro:
				"Your family's data stays yours. This policy explains what Vulture collects, why, and the choices you have.",
			sections: [
				{
					heading: "What we collect",
					paragraphs: [
						"Account information you provide when you sign up, such as your name, email address, and the family you belong to.",
						"Family data you create, including family members, chores, and other content you add while using Vulture.",
						"Basic technical data needed to run the service, such as device identifiers and sign-in records.",
					],
				},
				{
					heading: "How we use it",
					paragraphs: [
						"We use your information to provide and improve Vulture — to keep you signed in, show you your family's content, and keep the service secure.",
						"We do not sell your personal information, and we do not use it for advertising.",
					],
				},
				{
					heading: "Who can see it",
					paragraphs: [
						"Your family data is visible only to the members of your family. We do not share it with third parties except as needed to operate the service or as required by law.",
					],
				},
				{
					heading: "How long we keep it",
					paragraphs: [
						"We keep your data for as long as your account is active. When you delete your account, we remove your personal data from the service.",
					],
				},
				{
					heading: "Your choices",
					paragraphs: [
						"You can update or delete your account and data at any time. You can also contact us with privacy questions or requests.",
					],
				},
				{
					heading: "Contact",
					paragraphs: ["For any privacy questions, reach us at hello@vulture.app."],
				},
			],
		},
		terms: {
			title: "Terms and Conditions",
			intro:
				"These terms govern your use of Vulture. By creating an account or using the service, you agree to them.",
			sections: [
				{
					heading: "Acceptance of terms",
					paragraphs: [
						"By accessing or using Vulture, you agree to be bound by these Terms and Conditions. If you do not agree, please do not use the service.",
					],
				},
				{
					heading: "Your account",
					paragraphs: [
						"You are responsible for the accounts you create and for keeping your sign-in details secure.",
						"You must be at least 13 years old to use Vulture. If you are under 18, you should use the service with a parent or guardian's involvement.",
					],
				},
				{
					heading: "Acceptable use",
					paragraphs: [
						"You agree to use Vulture for its intended purpose: keeping your family connected.",
						"You may not misuse the service, attempt to access other users' data, or use Vulture for any unlawful purpose.",
					],
				},
				{
					heading: "Family content",
					paragraphs: [
						"You are responsible for the content you add and the people you add to your family.",
						"Family data is shared only within your family. You should only add people who agree to be part of your family.",
					],
				},
				{
					heading: "Service availability",
					paragraphs: [
						"We work to keep Vulture available and reliable, but we do not guarantee uninterrupted access. The service may change or be discontinued at any time.",
					],
				},
				{
					heading: "Limitation of liability",
					paragraphs: [
						"To the fullest extent permitted by law, Vulture is provided 'as is' without warranties of any kind. We are not liable for any indirect or consequential damages arising from your use of the service.",
					],
				},
				{
					heading: "Termination",
					paragraphs: [
						"You can stop using Vulture and delete your account at any time. We may suspend or terminate access if you violate these terms.",
					],
				},
				{
					heading: "Changes to these terms",
					paragraphs: [
						"We may update these terms from time to time. Continued use of Vulture after changes take effect means you accept the updated terms.",
					],
				},
				{
					heading: "Contact",
					paragraphs: ["Questions about these terms? Reach us at hello@vulture.app."],
				},
			],
		},
	};

	const page = $derived(content[screen] ?? content.about);
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex (The scrollable terms region must support keyboard scrolling.) -->
<div
	class="v-info"
	class:terms={screen === "terms"}
	role={screen === "terms" ? "region" : undefined}
	aria-label={screen === "terms" ? "Terms and Conditions content" : undefined}
	tabindex={screen === "terms" ? 0 : undefined}
	class:small={screen === "about" || screen === "contact"}
	class:legal={screen === "privacy" || screen === "terms"}
>
	<Card>
		{#if screen === "about" || screen === "contact"}
			{#if screen === "about"}
				<img class="v-about-logo" src={vultureImage} alt="Vulture" />
			{/if}
		{:else}
			<h1>{page.title}</h1>
		{/if}
		{#if page.intro}
			<p class="v-intro">{page.intro}</p>
		{/if}
		{#if screen === "contact"}
			<ContactForm />
		{:else}
			{#each page.sections as section (section.heading ?? section.paragraphs[0])}
				{#if section.heading}
					<h2>{section.heading}</h2>
				{/if}
				{#each section.paragraphs as paragraph (paragraph)}
					<p>{paragraph}</p>
				{/each}
			{/each}
		{/if}
		{#if screen === "about"}
			<p class="v-logo-credit">
				Vulture icon adapted from an illustration by
				<a href="https://pedropsmachado.com/">Pedro Machado</a>, provided under CC Attribution.
				Colors and details modified.
			</p>
		{/if}
	</Card>
</div>

<style>
	.v-info {
		width: 100%;
		max-width: 76ch;
		min-width: 0;
		margin-inline: auto;
		overflow-wrap: anywhere;
	}
	.v-info.terms {
		max-height: 100%;
		overflow-y: auto;
		overscroll-behavior: contain;
		border-radius: var(--v-radius);
		scrollbar-gutter: stable;
	}
	.v-info.terms:focus-visible {
		outline: 2px solid var(--v-ring);
		outline-offset: 2px;
	}
	.v-info.small {
		max-width: 40rem;
		margin: 0 auto;
	}
	.v-info :global(.v-card) {
		display: grid;
		gap: calc(var(--v-space) * 1.5);
	}
	.v-about-logo {
		justify-self: center;
		width: 7rem;
		height: 7rem;
		object-fit: contain;
		padding: 8px;
		border-radius: var(--v-radius);
		filter: drop-shadow(0 0 4px rgba(212, 175, 55, 0.65))
			drop-shadow(0 0 12px rgba(212, 175, 55, 0.35));
	}
	.v-logo-credit {
		color: var(--v-muted);
		font-size: 0.8rem;
	}
	.v-logo-credit a {
		color: var(--v-primary-text, var(--v-primary));
	}
	h1 {
		margin: 0;
		font-size: clamp(1.8rem, 5vw, 2.6rem);
		line-height: 1.1;
		letter-spacing: -0.02em;
	}
	h2 {
		margin: calc(var(--v-space) * 1.5) 0 0;
		font-size: 1.1rem;
		line-height: 1.2;
	}
	p {
		margin: 0;
		color: var(--v-muted);
		line-height: 1.6;
	}
	.v-intro {
		color: var(--v-fg);
	}
	@media (max-width: 760px) {
		.v-info.legal :global(.v-card) {
			border: 0;
			box-shadow: none;
		}
		h1 {
			display: none;
		}
	}
</style>
