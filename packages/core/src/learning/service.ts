import type { LearningApi } from "../api/learning/learningApi";
import type { FamilyService } from "../family/service";
import { type GuardianCandidate, type ProfileDraft } from "./types";

export interface LearningService {
	getSchool: LearningApi["getSchool"];
	saveSchool: LearningApi["saveSchool"];
	updateProgression: LearningApi["updateProgression"];
	listEligibleGuardians(familyId: string): Promise<GuardianCandidate[]>;
	createProfile: LearningApi["createProfile"];
	listProfiles: LearningApi["listProfiles"];
	getProfile: LearningApi["getProfile"];
	addGuardian: LearningApi["addGuardian"];
	removeGuardian: LearningApi["removeGuardian"];
}
export function createLearningService(
	api: LearningApi,
	family: Pick<FamilyService, "listMembers" | "getAccount">,
): LearningService {
	return {
		getSchool: (id) => api.getSchool(id),
		saveSchool: (id, school) => api.saveSchool(id, school),
		async listEligibleGuardians(familyId) {
			const members = await family.listMembers(familyId);
			const accounts = await Promise.all(
				members.map((member) => family.getAccount(member.accountId)),
			);
			return accounts.flatMap((account) =>
				account?.role === "parent"
					? [{ accountId: account.id, displayName: account.displayName }]
					: [],
			);
		},
		async createProfile(input: ProfileDraft) {
			return api.createProfile({
				...input,
				displayName: input.displayName.trim(),
				grade: input.grade.trim(),
			});
		},
		updateProgression: (id, grade, progression, displayName) =>
			api.updateProgression(id, grade, progression, displayName),
		listProfiles: (familyId) => api.listProfiles(familyId),
		getProfile: (profileId) => api.getProfile(profileId),
		async addGuardian(profileId, guardianAccountId) {
			return api.addGuardian(profileId, guardianAccountId.trim());
		},
		removeGuardian: (profileId, guardianAccountId) =>
			api.removeGuardian(profileId, guardianAccountId),
	};
}
