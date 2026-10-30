import { expect, it } from "vitest";
import { createRouter, parseHash } from "./router.svelte";

it("opens legacy Chores links in the unified Tasks chore filter", () => {
	expect(parseHash("#/chores:list")).toEqual({
		screen: "family:manage",
		params: { tab: "tasks", filter: "chores" },
	});
	expect(parseHash("#/chores:list?tab=manage&filter=all")).toEqual({
		screen: "family:manage",
		params: { tab: "tasks", filter: "chores" },
	});
});
it("preserves current routes and filters", () => {
	expect(parseHash("#/family:manage?tab=tasks&filter=chores")).toEqual({
		screen: "family:manage",
		params: { tab: "tasks", filter: "chores" },
	});
	expect(parseHash("#/chat")).toEqual({ screen: "chat", params: {} });
});

it("keeps normal navigation parameters encoded only once", () => {
	const router = createRouter("");
	router.navigate("family:manage", { tab: "tasks", note: "A + B" });
	expect(location.hash).toBe("#/family:manage?tab=tasks&note=A+%2B+B");
	router.navigate("chores:list");
	expect(location.hash).toBe("#/family:manage?tab=tasks&filter=chores");
});
