<script lang="ts">
	import ParentHome from "./ParentHome.svelte";
	import { Badge, Card } from "../components/index";

	let { screen = "home:parent" }: { screen?: string } = $props();

	const isParentHome = $derived(screen === "home:parent");

	const roleCopy = $derived.by(() => {
		if (screen.includes("home:kid")) {
			return {
				eyebrow: "Kids screen",
				title: "Ready for today's missions?",
				body: "Your dashboard keeps chores playful, simple, and easy to celebrate.",
				items: ["Check your next chore", "See family messages", "Ask for help"],
			};
		}

		if (screen.includes("home:grandparent")) {
			return {
				eyebrow: "Grandparent screen",
				title: "Everything important, easy to reach.",
				body: "Large controls and calm reminders help you stay connected with the family.",
				items: ["Family updates", "Health notes", "Quick check-ins"],
			};
		}

		return {
			eyebrow: "Parent screen",
			title: "Your household command center is ready.",
			body: "Coordinate chores, support kids and grandparents, and keep family logistics in one place.",
			items: ["Manage chore plans", "Review family activity", "Invite household members"],
		};
	});
</script>

{#if isParentHome}
	<ParentHome />
{:else}
	<section class="v-role-home" class:parent-home={isParentHome} aria-labelledby="role-home-title">
		<Card>
			<div class="v-role-home-head">
				<Badge>{roleCopy.eyebrow}</Badge>
				<span>Welcome</span>
			</div>
			<h2 id="role-home-title">{roleCopy.title}</h2>
			<p>{roleCopy.body}</p>
			<div class="v-role-grid">
				{#each roleCopy.items as item (item)}
					<div class="v-role-tile">{item}</div>
				{/each}
			</div>
		</Card>
	</section>
{/if}

<style>
	.v-role-home {
		width: min(100%, 960px);
		margin-inline: auto;
	}
	.v-role-home :global(.v-card) {
		display: grid;
		gap: calc(var(--v-space) * 2);
	}
	/* The Parent home is a cardless, centered hero: no background/border/shadow,
     and the content sits vertically centered in the viewport. */
	.v-role-home.parent-home {
		display: grid;
		min-height: calc(100dvh - var(--v-control-h) - var(--v-space) * 8);
		align-content: center;
		justify-items: center;
	}
	.v-role-home.parent-home :global(.v-card) {
		background: transparent;
		border: 0;
		box-shadow: none;
		width: min(100%, 960px);
		text-align: center;
		justify-items: center;
	}
	.v-role-home-head {
		display: flex;
		justify-content: space-between;
		gap: var(--v-space);
		color: var(--v-muted);
		flex-wrap: wrap;
		width: 100%;
	}
	h2,
	p {
		margin: 0;
	}
	h2 {
		color: var(--v-fg);
		font-size: clamp(1.8rem, 6vw, 3.4rem);
		line-height: 1.05;
	}
	p {
		max-width: 64ch;
		color: var(--v-muted);
		line-height: 1.6;
	}
	.v-role-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--v-space);
		width: 100%;
	}
	.v-role-tile {
		min-height: max(96px, var(--v-control-h));
		border: 1px solid var(--v-border);
		border-radius: var(--v-radius-sm);
		padding: calc(var(--v-space) * 1.5);
		background: transparent;
		color: var(--v-fg);
		font-weight: 700;
	}

	@media (max-width: 720px) {
		.v-role-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
