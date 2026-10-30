import { expect, it, vi } from "vitest";
import type { IpcClient } from "../api/ipc";
import { loadOidcDiscovery } from "./oidcDiscovery";

it("loads and caches native discovery documents by authority", async () => {
	const document = { authorization_endpoint: "https://issuer.example/authorize" };
	const ipc = { invoke: vi.fn().mockResolvedValue(document) } as unknown as IpcClient;
	const authority = `https://issuer-${crypto.randomUUID()}.example/`;
	await expect(loadOidcDiscovery(authority, ipc)).resolves.toEqual(document);
	await expect(loadOidcDiscovery(authority, ipc)).resolves.toEqual(document);
	expect(ipc.invoke).toHaveBeenCalledExactlyOnceWith("oidc_discovery", {
		input: { authority },
	});
});

it("propagates native discovery failures", async () => {
	const ipc = {
		invoke: vi.fn().mockRejectedValue(new Error("Discovery unavailable")),
	} as unknown as IpcClient;
	const authority = `https://invalid-${crypto.randomUUID()}.example`;
	await expect(loadOidcDiscovery(authority, ipc)).rejects.toThrow("Discovery unavailable");
});
