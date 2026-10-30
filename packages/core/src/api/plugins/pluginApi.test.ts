import { expect, it, vi } from "vitest";
import { createPluginCommandApi } from "./pluginApi";
import type { IpcClient } from "../ipc";

it("scopes plugin commands through the IPC client", async () => {
	const ipc = { invoke: vi.fn(async () => ({ ok: true })) } as unknown as IpcClient;
	const api = createPluginCommandApi("identity", ipc);
	await expect(api.call("avatar", { id: "account" })).resolves.toEqual({ ok: true });
	expect(ipc.invoke).toHaveBeenCalledWith("plugin:identity|avatar", { id: "account" });
});

it("allows commands without arguments", async () => {
	const ipc = { invoke: vi.fn(async () => "done") } as unknown as IpcClient;
	const api = createPluginCommandApi("identity", ipc);

	await expect(api.call("status")).resolves.toBe("done");
	expect(ipc.invoke).toHaveBeenCalledWith("plugin:identity|status", undefined);
});
