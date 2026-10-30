import { expect, it, vi } from "vitest";
import { createChatPeopleService, profileParticipant } from "./people";

const child = {
	profileId: "kid",
	familyId: "family",
	displayName: "Ana",
	expiresAt: "",
};
function people(overrides: Partial<Parameters<typeof createChatPeopleService>[0]> = {}) {
	return createChatPeopleService({
		child: () => null,
		parent: () => ({ id: "mum", name: "Mum", role: "manager" }),
		family: {
			getMyFamily: vi.fn(async () => ({ id: "family" }) as never),
			listMembers: vi.fn(async () => [
				{ id: "1", accountId: "mum" },
				{ id: "2", accountId: "dad" },
				{ id: "3", accountId: "gran" },
			]) as never,
			getAccount: vi.fn(async (id: string) => {
				if (id === "gran") throw new Error("offline");
				return { id, displayName: "Dad", role: "parent" as const };
			}),
		},
		learning: {
			listProfiles: vi.fn(async () => [{ id: "kid", displayName: "Ana" } as never]),
		},
		childHome: { family: vi.fn(async () => []) },
		...overrides,
	});
}

it("lists adults and children for a parent", async () => {
	expect(await people().load()).toEqual({
		self: { id: "mum", name: "Mum", manager: true, child: false },
		familyId: "family",
		members: [
			{ accountId: "dad", name: "Dad" },
			{ accountId: "gran", name: "" },
			{ accountId: "profile:kid", name: "Ana" },
		],
	});
});

it("still lists adults when learning profiles are unavailable", async () => {
	const service = people({
		learning: { listProfiles: vi.fn(async () => Promise.reject(new Error("down"))) },
	});
	expect((await service.load()).members.map((m) => m.accountId)).toEqual(["dad", "gran"]);
});

it("uses the child's profile identity and family list in a child session", async () => {
	const service = people({
		child: () => child,
		childHome: {
			family: vi.fn(async () => [
				{ participantId: "mum", displayName: "Mum", child: false, guardian: true },
				{
					participantId: profileParticipant("kid"),
					displayName: "Ana",
					child: true,
					guardian: false,
				},
			]),
		},
	});
	expect(await service.load()).toEqual({
		self: { id: "profile:kid", name: "Ana", manager: false, child: true },
		familyId: "family",
		members: [{ accountId: "mum", name: "Mum" }],
	});
});

it("requires a family or a session", async () => {
	await expect(
		people({ family: { getMyFamily: async () => null } as never }).load(),
	).rejects.toThrow("Join a family");
	await expect(people({ parent: () => null }).load()).rejects.toThrow("Sign in");
});
