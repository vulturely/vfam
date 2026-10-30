import { expect, it } from "vitest";
import { BUDDY_COMMANDS, commandSuggestions, completeCommand } from "./buddyCommands";

it("suggests commands only while the command word is being typed", () => {
	expect(commandSuggestions("/")).toHaveLength(BUDDY_COMMANDS.length);
	expect(commandSuggestions("/CA").map((command) => command.name)).toEqual(["/camera"]);
	expect(commandSuggestions("/camera")).toEqual([]);
	expect(commandSuggestions("/ask why")).toEqual([]);
	expect(commandSuggestions("hello")).toEqual([]);
	expect(commandSuggestions("/x")).toEqual([]);
});

it("leaves room for text after commands that take it", () => {
	const [ask, camera] = BUDDY_COMMANDS;
	expect(completeCommand(ask)).toBe("/ask ");
	expect(completeCommand(camera)).toBe("/camera");
});
