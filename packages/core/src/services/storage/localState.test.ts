import { expect, it } from "vitest";
import { createMemoryLocalStateService } from "./localState";

it("migrates legacy values once and removes them without browser writes", async () => {
	const memory = createMemoryLocalStateService();
	memory.legacy.set("session", JSON.stringify({ token: "secret" }));
	await expect(memory.service.read("session")).resolves.toEqual({ token: "secret" });
	expect(memory.values.get("session")).toEqual({ token: "secret" });
	expect(memory.legacy.has("session")).toBe(false);
	memory.legacy.set("session", "stale");
	await memory.service.put("session", { token: "new" });
	expect(memory.legacy.has("session")).toBe(false);
	await memory.service.remove("session");
	expect(memory.values.has("session")).toBe(false);
});

it("preserves corrupt legacy values for fail-closed credential handling", async () => {
	const memory = createMemoryLocalStateService({ session: "corrupt" });
	await expect(memory.service.read("session")).resolves.toBe("corrupt");
});
