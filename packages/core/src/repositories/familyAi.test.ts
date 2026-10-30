import { expect, it, vi } from "vitest";
import type { IpcClient } from "../api/ipc";
import { createFamilyAiRepository } from "./familyAi";

it("invokes the native family AI commands with a single input object", async () => {
	const ipc = { invoke: vi.fn().mockResolvedValue({ configured: false }) };
	const repository = createFamilyAiRepository(ipc as unknown as IpcClient);
	const scope = { serverUrl: "https://server.example", familyId: "family" };
	await repository.settings({ ...scope, action: "status" });
	await repository.run({ ...scope, token: "vps_token", jobId: "job" });
	expect(ipc.invoke).toHaveBeenNthCalledWith(1, "family_ai_settings", {
		input: { ...scope, action: "status" },
	});
	expect(ipc.invoke).toHaveBeenNthCalledWith(2, "family_ai_run", {
		input: { ...scope, token: "vps_token", jobId: "job" },
	});
});
