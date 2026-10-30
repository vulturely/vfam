import { describe, expect, it, vi } from "vitest";
import { createIdentityService } from "./service";
import type { PluginFamilyService } from "@vulture/plugin-sdk";

function makeFamily(): PluginFamilyService {
	return {
		setAvatar: vi.fn(async () => {}),
		getAvatar: vi.fn(async () => null),
	};
}

describe("createIdentityService", () => {
	it("delegates avatar upload to the core family service", async () => {
		const family = makeFamily();
		const service = createIdentityService(family);
		const bytes = new Uint8Array([1, 2, 3]);

		await service.setAvatar(bytes, "image/png");

		expect(family.setAvatar).toHaveBeenCalledTimes(1);
		expect(family.setAvatar).toHaveBeenCalledWith(bytes, "image/png");
	});

	it("delegates avatar fetch to the core family service", async () => {
		const family = makeFamily();
		const service = createIdentityService(family);

		await service.getAvatar("acct-1");

		expect(family.getAvatar).toHaveBeenCalledTimes(1);
		expect(family.getAvatar).toHaveBeenCalledWith("acct-1");
	});
});
