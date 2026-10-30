import type { NavEntry } from "../runtime/registry.svelte";

/** Navigation the shell shows instead of the parent router, used by child sessions. */
export interface ShellNav {
	/** The item with id "profile" is shown with the account controls. */
	items: Pick<NavEntry, "id" | "label" | "icon">[];
	current: string;
	navigate(id: string): void;
	picture: string | null;
	/** The only account action a child has. */
	switchProfile(): void;
}
