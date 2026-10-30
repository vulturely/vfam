import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OidcAuth } from "../auth/oidc";
import type { CacheService } from "../services/storage/cache";
import { NativeServerError, type ServerRepository } from "../repositories/server";
import { createFamilyService } from "./service";

const unary = vi.hoisted(() => vi.fn());
const server = { unary, stream: vi.fn() } as ServerRepository;
const auth = { getAccessToken: vi.fn(async () => "token") } as unknown as OidcAuth;
const family = { id: "family", name: "Family", description: "About", createdAt: "now" };
const member = {
	id: "member",
	familyId: "family",
	accountId: "account",
	role: 2,
	createdAt: "now",
	relationship: "wife",
	reciprocalRelationship: "husband",
};

beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(auth.getAccessToken).mockResolvedValue("token");
});

function fixture(values: Record<string, unknown> = {}) {
	const cache = {
		get: vi.fn(async (key: string) => values[key] ?? null),
		put: vi.fn(async () => {}),
		clear: vi.fn(async () => {}),
		delete: vi.fn(async () => {}),
	} as unknown as CacheService;
	return { cache, service: createFamilyService("https://server.example", auth, cache, server) };
}

describe("family display cache", () => {
	it("uses fresh cache before the network", async () => {
		const cachedMember = { ...member, role: "member" };
		const { service } = fixture({
			"family:mine": family,
			"family:family:members": [cachedMember],
		});
		expect(await service.getMyFamily()).toEqual(family);
		expect(await service.listMembers("family")).toEqual([{ ...member, role: "member" }]);
		expect(unary).not.toHaveBeenCalled();
	});

	it("loads, caches, and marks stale data only for offline failures", async () => {
		const { cache, service } = fixture();
		unary.mockResolvedValueOnce({ family });
		expect(await service.getMyFamily()).toEqual(family);
		expect(cache.put).toHaveBeenCalledWith("family:mine", family);
		unary.mockRejectedValueOnce(new NativeServerError("unavailable", "offline"));
		cache.get = vi.fn(async (_key, includeExpired) => (includeExpired ? family : null)) as never;
		expect(await service.getMyFamily()).toEqual({ ...family, stale: true });
		unary.mockRejectedValueOnce(new NativeServerError("permission_denied", "denied"));
		await expect(service.getMyFamily()).rejects.toThrow("denied");
		unary.mockRejectedValueOnce(new TypeError("fetch failed"));
		cache.get = vi.fn(async (_key, includeExpired) => (includeExpired ? [member] : null)) as never;
		expect(await service.listMembers("family")).toEqual([{ ...member, stale: true }]);
	});

	it("does not cache an absent family", async () => {
		const { cache, service } = fixture();
		unary.mockResolvedValueOnce({});
		expect(await service.getMyFamily()).toBeNull();
		expect(cache.put).not.toHaveBeenCalled();
	});
});

describe("family mutations and lookups", () => {
	it("maps mutations and invalidates cached display data", async () => {
		const { cache, service } = fixture();
		unary.mockImplementation(async (_service, method) => {
			if (["CreateFamily", "RenameFamily", "UpdateFamilyDescription"].includes(method))
				return { family };
			if (method === "AddFamilyMember") return { member };
			return {};
		});
		await service.createFamily("Family");
		await service.renameFamily("Family");
		await service.updateFamilyDescription("About");
		expect(await service.addMember("family", "account", "member")).toMatchObject({
			role: "member",
		});
		await service.setRelationship("family", "account", "wife", "husband");
		expect(cache.clear).toHaveBeenCalledTimes(5);
		expect(unary).toHaveBeenCalledWith(
			"control",
			"AddFamilyMember",
			{ familyId: "family", accountId: "account", role: 2 },
			{ token: "token" },
		);
		unary.mockResolvedValueOnce({ member: { ...member, role: 1 } });
		expect((await service.addMember("family", "account", "admin")).role).toBe("admin");
		for (const method of ["CreateFamily", "RenameFamily", "UpdateFamilyDescription"]) {
			unary.mockResolvedValueOnce({});
			const operation =
				method === "CreateFamily"
					? service.createFamily("Family")
					: method === "RenameFamily"
						? service.renameFamily("Family")
						: service.updateFamilyDescription("About");
			await expect(operation).rejects.toThrow("Server did not return");
		}
		unary.mockResolvedValueOnce({});
		await expect(service.addMember("family", "account", "member")).rejects.toThrow(
			"Server did not return",
		);
	});

	it("maps account roles and avatar responses", async () => {
		const { service } = fixture();
		for (const [role, expected] of [
			[2, "kid"],
			[3, "grandparent"],
			[1, "parent"],
			[0, "parent"],
		] as const) {
			unary.mockResolvedValueOnce({ account: { id: "account", displayName: "Name", role } });
			expect((await service.getAccount("account"))?.role).toBe(expected);
		}
		unary.mockResolvedValueOnce({});
		expect(await service.getAccount("account")).toBeNull();
		unary.mockResolvedValueOnce({ image: "", contentType: "image/png" });
		expect(await service.getAvatar("account")).toBeNull();
		unary.mockResolvedValueOnce({ image: "AQ==", contentType: "image/png" });
		expect((await service.getAvatar("account"))?.image).toEqual(new Uint8Array([1]));
		unary.mockResolvedValueOnce({ image: "Ag==", contentType: "image/jpeg" });
		expect((await service.getFamilyAvatar("family"))?.contentType).toBe("image/jpeg");
		unary.mockResolvedValueOnce({ image: "Ag==", contentType: "" });
		expect(await service.getFamilyAvatar("family")).toBeNull();
		await service.setAvatar(new Uint8Array([1]), "image/png");
		await service.setFamilyAvatar(new Uint8Array([2]), "image/jpeg");
		expect(unary).toHaveBeenCalledWith(
			"control",
			"SetAvatar",
			{ image: "AQ==", contentType: "image/png" },
			{ token: "token" },
		);
		expect(unary).toHaveBeenCalledWith(
			"control",
			"SetFamilyAvatar",
			{ image: "Ag==", contentType: "image/jpeg" },
			{ token: "token" },
		);
	});
});
