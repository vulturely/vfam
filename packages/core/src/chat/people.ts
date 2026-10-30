import type { ChildContext } from "../auth/sessionStorage";
import type { ChildHomeService } from "../child-home/service";
import type { FamilyService } from "../family/service";
import type { LearningService } from "../learning/service";

export interface ChatPerson {
	/** An account id, or `profile:<uuid>` for a child's learning profile. */
	accountId: string;
	name: string;
}
export interface ChatPeople {
	self: { id: string; name: string; manager: boolean; child: boolean };
	familyId: string;
	/** Everyone else in the family. */
	members: ChatPerson[];
}
export interface ChatPeopleService {
	load(): Promise<ChatPeople>;
}

/** Chat and call identity of a child's learning profile, matching the server. */
export function profileParticipant(profileId: string) {
	return `profile:${profileId}`;
}

export function createChatPeopleService(deps: {
	child: () => ChildContext | null;
	parent: () => { id: string; name: string; role: string } | null;
	family: Pick<FamilyService, "getMyFamily" | "listMembers" | "getAccount">;
	learning: Pick<LearningService, "listProfiles">;
	childHome: Pick<ChildHomeService, "family">;
}): ChatPeopleService {
	async function forChild(child: ChildContext): Promise<ChatPeople> {
		const self = profileParticipant(child.profileId);
		const members = await deps.childHome.family();
		return {
			self: { id: self, name: child.displayName, manager: false, child: true },
			familyId: child.familyId,
			members: members
				.filter((member) => member.participantId !== self)
				.map((member) => ({ accountId: member.participantId, name: member.displayName })),
		};
	}
	async function forParent(account: { id: string; name: string; role: string }) {
		const family = await deps.family.getMyFamily();
		if (!family) throw new Error("Join a family before opening private chat.");
		const [members, profiles] = await Promise.all([
			deps.family.listMembers(family.id),
			// Children are reachable in chat; a missing learning service must not block adults.
			deps.learning.listProfiles(family.id).catch(() => []),
		]);
		const others = members.filter((member) => member.accountId !== account.id);
		const names = await Promise.allSettled(
			others.map(async (member) => (await deps.family.getAccount(member.accountId))?.displayName),
		);
		return {
			self: {
				id: account.id,
				name: account.name,
				manager: account.role === "manager",
				child: false,
			},
			familyId: family.id,
			members: [
				...others.map((member, index) => {
					const result = names[index]!;
					return {
						accountId: member.accountId,
						name: result.status === "fulfilled" ? (result.value ?? "") : "",
					};
				}),
				...profiles.map((profile) => ({
					accountId: profileParticipant(profile.id),
					name: profile.displayName,
				})),
			],
		};
	}
	return {
		async load() {
			const child = deps.child();
			if (child) return forChild(child);
			const account = deps.parent();
			if (!account) throw new Error("Sign in before opening private chat.");
			return forParent(account);
		},
	};
}
