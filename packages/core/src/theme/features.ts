import type { ComponentType } from "svelte";
import type { Profile } from "../runtime/defineApp";
import Users from "lucide-svelte/icons/users";
import CheckCheck from "lucide-svelte/icons/check-check";
import ListChecks from "lucide-svelte/icons/list-checks";
import Baby from "lucide-svelte/icons/baby";
import HeartHandshake from "lucide-svelte/icons/heart-handshake";
import MessagesSquare from "lucide-svelte/icons/messages-square";
import ShieldCheck from "lucide-svelte/icons/shield-check";

/** One rotating hero highlight on the landing page. */
export interface FeatureHighlight {
	icon: ComponentType;
	title: string;
	blurb: string;
}

/**
 * The hero carousel alternates between feature highlights. Each profile
 * (standard / kids / elders) surfaces the features most relevant to its
 * audience, so the landing "changes with" the active app profile.
 */
export const FEATURE_SETS: Record<Profile, FeatureHighlight[]> = {
	standard: [
		{
			icon: CheckCheck,
			title: "Chores, done together",
			blurb: "Assign chores to each family member and see them ticked off at a glance.",
		},
		{
			icon: ListChecks,
			title: "One shared list",
			blurb: "Everyone sees the same updates in real time — no more shouting across the house.",
		},
		{
			icon: Users,
			title: "Everyone in their corner",
			blurb: "Parents, kids, and grandparents each get a screen shaped for how they use it.",
		},
	],
	kids: [
		{
			icon: Baby,
			title: "Fun chores, easy wins",
			blurb: "Big, friendly buttons and playful themes make chores feel like a game.",
		},
		{
			icon: CheckCheck,
			title: "Earn your checkmark",
			blurb: "Finish a chore and it lights up — rewards for the whole team.",
		},
		{
			icon: HeartHandshake,
			title: "Help the family",
			blurb: "Pitch in and watch how your small jobs add up to a big help.",
		},
	],
	elders: [
		{
			icon: HeartHandshake,
			title: "Stay close, no fuss",
			blurb: "High-contrast, large-type screens make staying connected effortless.",
		},
		{
			icon: MessagesSquare,
			title: "One glance updates",
			blurb: "See how things are going with a glance — no digging through menus.",
		},
		{
			icon: ShieldCheck,
			title: "Family you can trust",
			blurb: "Your circle stays yours, with the people who matter most.",
		},
	],
};
