import { createNativeClient } from "../../repositories/nativeClient";
import type { OidcAuth } from "../../auth/oidc";
import type { AgeBand, LearningProfile, ProfileDraft } from "../../learning/types";
import { LearningAgeBand, type LearningProfile as ProtoProfile } from "../protocol";

export interface LearningApi {
	getSchool(profileId: string): Promise<import("../../learning/types").SchoolDetails>;
	saveSchool(
		profileId: string,
		school: import("../../learning/types").SchoolDetails,
	): Promise<import("../../learning/types").SchoolDetails>;

	updateProgression(
		profileId: string,
		grade: string,
		progression?: import("../../learning/types").Progression,
		displayName?: string,
	): Promise<LearningProfile>;
	createProfile(input: ProfileDraft): Promise<LearningProfile>;
	listProfiles(familyId: string): Promise<LearningProfile[]>;
	getProfile(profileId: string): Promise<LearningProfile>;
	removeGuardian(profileId: string, guardianAccountId: string): Promise<LearningProfile>;
	addGuardian(profileId: string, guardianAccountId: string): Promise<LearningProfile>;
}
const bands: Record<AgeBand, LearningAgeBand> = {
	early_years: LearningAgeBand.EARLY_YEARS,
	primary: LearningAgeBand.PRIMARY,
	preteen: LearningAgeBand.PRETEEN,
	teen: LearningAgeBand.TEEN,
};
function school(value?: import("../../learning/types").SchoolDetails) {
	return {
		name: value?.name ?? "",
		address: value?.address ?? "",
		phones: value?.phones ?? [],
		email: value?.email ?? "",
		teachers: (value?.teachers ?? []).map((teacher) => ({
			name: teacher.name ?? "",
			role: teacher.role ?? "",
			email: teacher.email ?? "",
			phone: teacher.phone ?? "",
		})),
	};
}
function profile(value: ProtoProfile | undefined): LearningProfile {
	if (!value) throw new Error("Server did not return a learning profile.");
	const ageBand = (Object.keys(bands) as AgeBand[]).find((key) => bands[key] === value.ageBand);
	if (!ageBand) throw new Error("Unsupported learning age group.");
	return {
		progression: value.progression
			? {
					dateOfBirth: value.progression.dateOfBirth,
					autoGrade: value.progression.autoGrade,
					schoolYearMonth: value.progression.schoolYearMonth,
					schoolYearDay: value.progression.schoolYearDay,
					country: value.progression.country,
					region: value.progression.region,
				}
			: undefined,
		id: value.id,
		familyId: value.familyId,
		displayName: value.displayName,
		ageBand,
		grade: value.grade,
		guardianAccountIds: value.guardianAccountIds,
		createdAt: value.createdAt,
	};
}
export function createLearningApi(serverUrl: string, auth: OidcAuth): LearningApi {
	const client = createNativeClient("control", serverUrl);
	async function options(): Promise<{ headers: Record<string, string> }> {
		const token = await auth.getAccessToken();
		return { headers: token ? { authorization: `Bearer ${token}` } : {} };
	}
	return {
		async getSchool(profileId) {
			return school(
				(await client.getLearningSchool(
					{ profileId },
					await options(),
				)) as import("../../learning/types").SchoolDetails,
			);
		},
		async saveSchool(profileId, details) {
			return school(
				(await client.saveLearningSchool(
					{ profileId, school: details },
					await options(),
				)) as import("../../learning/types").SchoolDetails,
			);
		},
		async updateProgression(profileId, grade, progression, displayName) {
			return profile(
				(
					(await client.updateLearningProgression(
						{ profileId, grade, progression, displayName },
						await options(),
					)) as { profile?: ProtoProfile }
				).profile,
			);
		},
		async createProfile(input) {
			return profile(
				(
					(await client.createLearningProfile(
						{ ...input, ageBand: bands[input.ageBand] },
						await options(),
					)) as { profile?: ProtoProfile }
				).profile,
			);
		},
		async listProfiles(familyId) {
			return (
				(await client.listLearningProfiles({ familyId }, await options())) as {
					profiles: ProtoProfile[];
				}
			).profiles.map(profile);
		},
		async getProfile(profileId) {
			return profile(
				(
					(await client.getLearningProfile({ profileId }, await options())) as {
						profile?: ProtoProfile;
					}
				).profile,
			);
		},
		async addGuardian(profileId, guardianAccountId) {
			return profile(
				(
					(await client.addLearningGuardian({ profileId, guardianAccountId }, await options())) as {
						profile?: ProtoProfile;
					}
				).profile,
			);
		},
		async removeGuardian(profileId, guardianAccountId) {
			return profile(
				(
					(await client.removeLearningGuardian(
						{ profileId, guardianAccountId },
						await options(),
					)) as {
						profile?: ProtoProfile;
					}
				).profile,
			);
		},
	};
}
