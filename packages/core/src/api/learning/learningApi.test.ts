import { describe, expect, it, vi } from "vitest";
import { LearningAgeBand } from "../protocol";
import type { OidcAuth } from "../../auth/oidc";
import { createLearningApi } from "./learningApi";

const client = vi.hoisted(() => ({
	getLearningSchool: vi.fn(),
	saveLearningSchool: vi.fn(),
	updateLearningProgression: vi.fn(),
	createLearningProfile: vi.fn(),
	listLearningProfiles: vi.fn(),
	getLearningProfile: vi.fn(),
	addLearningGuardian: vi.fn(),
	removeLearningGuardian: vi.fn(),
}));
vi.mock("../../repositories/nativeClient", () => ({ createNativeClient: () => client }));
const auth = { getAccessToken: vi.fn(async () => "token") } as unknown as OidcAuth;
const base = {
	id: "profile",
	familyId: "family",
	displayName: "Jamie",
	ageBand: LearningAgeBand.PRIMARY,
	grade: "Grade 2",
	guardianAccountIds: ["parent"],
	createdAt: "now",
};

describe("createLearningApi", () => {
	it("maps profiles and progression and delegates every operation", async () => {
		const api = createLearningApi("https://server.example", auth);
		const value = {
			...base,
			progression: {
				dateOfBirth: "2018-01-01",
				autoGrade: true,
				schoolYearMonth: 9,
				schoolYearDay: 1,
				country: "US",
				region: "CA",
			},
		};
		client.updateLearningProgression.mockResolvedValue({ profile: value });
		client.createLearningProfile.mockResolvedValue({ profile: value });
		client.listLearningProfiles.mockResolvedValue({ profiles: [value] });
		client.getLearningProfile.mockResolvedValue({ profile: value });
		client.addLearningGuardian.mockResolvedValue({ profile: value });
		client.removeLearningGuardian.mockResolvedValue({ profile: value });
		const school = { name: "School", address: "", phones: [], email: "", teachers: [] };
		await api.getSchool("profile");
		await api.saveSchool("profile", school);
		expect(
			(await api.updateProgression("profile", "Grade 3", value.progression, "Jamie")).progression,
		).toEqual(value.progression);
		await api.createProfile({
			familyId: "family",
			displayName: "Jamie",
			ageBand: "primary",
			grade: "Grade 2",
		});
		expect(await api.listProfiles("family")).toHaveLength(1);
		await api.getProfile("profile");
		await api.addGuardian("profile", "parent");
		await api.removeGuardian("profile", "parent");
		expect(client.createLearningProfile.mock.calls[0][0].ageBand).toBe(LearningAgeBand.PRIMARY);
		expect(client.getLearningSchool.mock.calls[0][1].headers.authorization).toBe("Bearer token");
	});

	it("maps every age band and rejects missing or unsupported profiles", async () => {
		const api = createLearningApi("https://server.example", auth);
		for (const [band, expected] of [
			[LearningAgeBand.EARLY_YEARS, "early_years"],
			[LearningAgeBand.PRIMARY, "primary"],
			[LearningAgeBand.PRETEEN, "preteen"],
			[LearningAgeBand.TEEN, "teen"],
		] as const) {
			client.getLearningProfile.mockResolvedValueOnce({ profile: { ...base, ageBand: band } });
			expect((await api.getProfile("profile")).ageBand).toBe(expected);
		}
		client.getLearningProfile.mockResolvedValue({
			profile: { ...base, ageBand: LearningAgeBand.UNSPECIFIED },
		});
		await expect(api.getProfile("profile")).rejects.toThrow("Unsupported learning age group");
		client.getLearningProfile.mockResolvedValue({});
		await expect(api.getProfile("profile")).rejects.toThrow("Server did not return");
	});
});
