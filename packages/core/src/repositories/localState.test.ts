import { expect, it, vi } from "vitest";
import { createLocalStateRepository } from "./localState";

it("keeps local state JSON behind the native cache command", async () => {
	const invoke = vi.fn().mockResolvedValue({ theme: "dark" });
	const repository = createLocalStateRepository({ invoke });
	await expect(repository.get("theme")).resolves.toEqual({ theme: "dark" });
	await repository.put("theme", { theme: "light" });
	await repository.delete("theme");
	expect(invoke.mock.calls).toEqual([
		["local_cache", { request: { action: "get", namespace: "local-state-v1", key: "theme" } }],
		[
			"local_cache",
			{
				request: {
					action: "put",
					namespace: "local-state-v1",
					key: "theme",
					value: { theme: "light" },
				},
				source: expect.any(String),
			},
		],
		[
			"local_cache",
			{
				request: { action: "delete", namespace: "local-state-v1", key: "theme" },
				source: expect.any(String),
			},
		],
	]);
});
