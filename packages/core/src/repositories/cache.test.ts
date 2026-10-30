import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, native } = vi.hoisted(() => ({
	invoke: vi.fn(),
	native: { value: true },
}));

vi.mock("@tauri-apps/api/core", () => ({
	isTauri: () => native.value,
}));
vi.mock("../api/ipc", () => ({
	createTauriIpcClient: () => ({ invoke }),
}));

import { createCacheRepository } from "./cache";

describe("createCacheRepository", () => {
	beforeEach(() => {
		invoke.mockReset();
		native.value = true;
	});

	it("keeps native cache IPC in the repository", async () => {
		invoke.mockResolvedValue({ name: "Family" });
		const repository = createCacheRepository();
		await expect(
			repository.execute({ action: "get", namespace: "account", key: "family" }),
		).resolves.toEqual({ name: "Family" });
		expect(invoke).toHaveBeenCalledWith("local_cache", {
			request: { action: "get", namespace: "account", key: "family" },
		});
	});

	it("does not substitute plaintext browser storage", async () => {
		native.value = false;
		const repository = createCacheRepository();
		await expect(
			repository.execute({
				action: "put",
				namespace: "account",
				key: "family",
				value: { name: "Family" },
			}),
		).resolves.toBeNull();
		expect(invoke).not.toHaveBeenCalled();
	});
});
