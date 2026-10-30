/** Slash commands a parent can type in a FamBuddy conversation. */
export interface BuddyCommandHint {
	name: string;
	description: string;
	/** Commands that need text after them complete with a trailing space. */
	takesText: boolean;
}

export const BUDDY_COMMANDS: readonly BuddyCommandHint[] = [
	{ name: "/ask", description: "Ask its AI a question", takesText: true },
	{ name: "/camera", description: "Open the live camera", takesText: false },
	{ name: "/stop", description: "Close the live camera", takesText: false },
	{ name: "/broadcast", description: "Say it on every FamBuddy", takesText: true },
];

/** Commands matching what is typed so far; none once the command word is finished. */
export function commandSuggestions(text: string): BuddyCommandHint[] {
	if (!text.startsWith("/") || /\s/.test(text)) return [];
	const typed = text.toLowerCase();
	return BUDDY_COMMANDS.filter(
		(command) => command.name.startsWith(typed) && command.name !== typed,
	);
}

export function completeCommand(command: BuddyCommandHint): string {
	return command.takesText ? `${command.name} ` : command.name;
}
