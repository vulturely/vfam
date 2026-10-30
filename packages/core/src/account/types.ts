import type { Person, Role } from "@vulture/data";

export type AccountRole = "parent" | "kid" | "grandparent";
export type AuthMode = "signin" | "signup";

export interface AccountFormInput {
	displayName: string;
	email?: string;
	familyName?: string;
	role: AccountRole;
}

export interface AccountRecord {
	id: string;
	displayName: string;
	role: AccountRole;
	email?: string;
	createdAt: string;
	updatedAt: string;
}

export interface SignedInAccount {
	account: AccountRecord;
	familyId: string;
	person: Person;
	landingScreen: string;
}

export interface RoleOption {
	role: AccountRole;
	personRole: Role;
	screen: string;
	title: string;
	subtitle: string;
	cta: string;
	placeholder: string;
}

export const ROLE_OPTIONS: RoleOption[] = [
	{
		role: "parent",
		personRole: "manager",
		screen: "home:parent",
		title: "Parent command center",
		subtitle: "Plan chores, coordinate the family, and keep everyone connected.",
		cta: "Create parent account",
		placeholder: "e.g. Priya",
	},
	{
		role: "kid",
		personRole: "kid",
		screen: "home:kid",
		title: "Kid adventure screen",
		subtitle: "See your missions, earn wins, and ask grown-ups for help.",
		cta: "Create kid account",
		placeholder: "e.g. Max",
	},
	{
		role: "grandparent",
		personRole: "elder",
		screen: "home:grandparent",
		title: "Grandparent companion",
		subtitle: "Large, calm controls for family updates, reminders, and check-ins.",
		cta: "Create grandparent account",
		placeholder: "e.g. Nana Jo",
	},
];

export function roleOptionFor(role: AccountRole): RoleOption {
	return ROLE_OPTIONS.find((option) => option.role === role) ?? ROLE_OPTIONS[0];
}
