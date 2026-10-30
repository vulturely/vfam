import { expect, it, vi } from "vitest";
import type { OidcAuth } from "../auth/oidc";
import { createResourceService, type StorageConfig } from "./service";

const client = vi.hoisted(() => ({ familyResources: vi.fn() }));
vi.mock("../repositories/nativeClient", () => ({ createNativeClient: () => client }));
const storage = {
	endpoint: "",
	bucket: "",
	region: "",
	access_key_id: "",
	secret_access_key: "",
} as StorageConfig;
it("requires a manager token", async () => {
	const auth = { getAccessToken: async () => null } as unknown as OidcAuth;
	await expect(createResourceService("https://server.example", auth).get()).rejects.toThrow(
		"Family manager sign-in required",
	);
});

it("maps every resource command and parses the response", async () => {
	const auth = { getAccessToken: async () => "token" } as unknown as OidcAuth;
	const service = createResourceService("https://server.example", auth);
	client.familyResources.mockImplementation(async (input) => ({
		resultJson: JSON.stringify({
			command: JSON.parse(input.commandJson),
			platform_paid: true,
			storage: null,
			storage_secret_set: false,
		}),
	}));
	await service.get();
	await service.saveStorage(storage);
	await service.saveStorage(null);
	const commands = client.familyResources.mock.calls.map(
		(call) => JSON.parse(call[0].commandJson).type,
	);
	// Family AI keys are never sent to Vulture; there is no AI resource command.
	expect(commands).toEqual(["get", "save_storage", "save_storage"]);
	expect(Object.keys(service).sort()).toEqual(["get", "saveStorage"]);
	expect(client.familyResources.mock.calls[0][1]).toMatchObject({
		headers: { authorization: "Bearer token" },
		timeoutMs: 15000,
	});
});
