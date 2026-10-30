import { describe, expect, it, vi } from "vitest";
import type { LearningApi } from "../api/learning/learningApi";
import { createLearningService } from "./service";

// Eligibility is derived from actual family members, never a global account search.
describe("guardian candidates", () => {
	it("offers parent members and excludes children and missing accounts", async () => {
		const unexpected = async () => {
			throw new Error("Unexpected learning API call");
		};
		const api: LearningApi = {
			createProfile: unexpected,
			listProfiles: unexpected,
			getProfile: unexpected,
			addGuardian: unexpected,
			removeGuardian: unexpected,
			getSchool: unexpected,
			saveSchool: unexpected,
			updateProgression: unexpected,
		};
		const family = {
			listMembers: vi.fn(async () =>
				["parent", "child", "missing"].map((accountId) => ({
					id: accountId,
					familyId: "family-1",
					accountId,
					role: "member" as const,
					createdAt: "2026-10-14T00:00:00Z",
				})),
			),
			getAccount: vi.fn(async (id: string) =>
				id === "missing"
					? null
					: {
							id,
							displayName: id === "parent" ? "Morgan" : "Jamie",
							role: id === "parent" ? ("parent" as const) : ("kid" as const),
						},
			),
		};
		const service = createLearningService(api, family);
		expect(await service.listEligibleGuardians("family-1")).toEqual([
			{ accountId: "parent", displayName: "Morgan" },
		]);
		expect(family.listMembers).toHaveBeenCalledWith("family-1");
	});
});

describe("learning service workflows", () => {
	function fixture() {
		const api = {
			createProfile: vi.fn(async (input) => input),
			listProfiles: vi.fn(),
			getProfile: vi.fn(),
			addGuardian: vi.fn(),
			removeGuardian: vi.fn(),
			getSchool: vi.fn(),
			saveSchool: vi.fn(),
			updateProgression: vi.fn(),
		};
		const family = { listMembers: vi.fn(), getAccount: vi.fn() };
		return { api, service: createLearningService(api as unknown as LearningApi, family) };
	}
	const draft = {
		familyId: "family",
		displayName: "  Jamie  ",
		ageBand: "primary" as const,
		grade: " Grade 2 ",
	};

	it("trims profile drafts and forwards validation to the native API", async () => {
		const { api, service } = fixture();
		api.createProfile.mockImplementation(async (input: typeof draft) => {
			if (!input.familyId || !input.displayName.trim() || input.displayName.length > 80)
				throw new Error("Choose a family");
			if (input.grade.length > 40 || !(input.ageBand in { primary: true }))
				throw new Error("Choose an age group");
			return input;
		});
		await service.createProfile(draft);
		expect(api.createProfile).toHaveBeenCalledWith({
			...draft,
			displayName: "Jamie",
			grade: "Grade 2",
		});
		for (const invalid of [
			{ ...draft, familyId: "" },
			{ ...draft, displayName: " " },
			{ ...draft, displayName: "x".repeat(81) },
		])
			await expect(service.createProfile(invalid)).rejects.toThrow("Choose a family");
		await expect(service.createProfile({ ...draft, ageBand: "adult" as never })).rejects.toThrow(
			"Choose an age group",
		);
		await expect(service.createProfile({ ...draft, grade: "x".repeat(41) })).rejects.toThrow(
			"Choose an age group",
		);
	});

	it("validates guardians and delegates the remaining workflows", async () => {
		const { api, service } = fixture();
		api.addGuardian.mockRejectedValueOnce(new Error("Choose a parent"));
		await expect(service.addGuardian("profile", " ")).rejects.toThrow("Choose a parent");
		await service.addGuardian("profile", " guardian ");
		expect(api.addGuardian).toHaveBeenCalledWith("profile", "guardian");
		await service.getSchool("profile");
		await service.saveSchool("profile", {} as never);
		await service.updateProgression("profile", "Grade 3");
		await service.listProfiles("family");
		await service.getProfile("profile");
		await service.removeGuardian("profile", "guardian");
		for (const method of [
			"getSchool",
			"saveSchool",
			"updateProgression",
			"listProfiles",
			"getProfile",
			"removeGuardian",
		])
			expect(api[method as keyof LearningApi]).toHaveBeenCalled();
	});
});
