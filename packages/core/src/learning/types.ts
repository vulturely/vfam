export const ageBands = {
	early_years: "Ages 3–5",
	primary: "Ages 6–8",
	preteen: "Ages 9–12",
	teen: "Ages 13–17",
} as const;
export type AgeBand = keyof typeof ageBands;

export interface LearningProfile {
	progression?: Progression;
	id: string;
	familyId: string;
	displayName: string;
	ageBand: AgeBand;
	grade: string;
	guardianAccountIds: string[];
	createdAt: string;
}
export interface Progression {
	dateOfBirth: string;
	autoGrade: boolean;
	schoolYearMonth: number;
	schoolYearDay: number;
	country: string;
	region: string;
}
export interface ProfileDraft {
	progression?: Progression;
	familyId: string;
	displayName: string;
	ageBand: AgeBand;
	grade: string;
}

export interface GuardianCandidate {
	accountId: string;
	displayName: string;
}

export interface SchoolDetails {
	name: string;
	address: string;
	phones: string[];
	email: string;
	teachers: TeacherContact[];
}
export interface TeacherContact {
	name: string;
	role: string;
	email: string;
	phone: string;
}
