import { createNativeClient } from "../repositories/nativeClient";
import type { OidcAuth } from "../auth/oidc";
import { Task, TaskStatus } from "../api/protocol";
import type { AvatarRecord } from "../family/service";

/** A family member a child may chat with or call. */
export interface ChildFamilyMember {
	/** An account id, or `profile:<uuid>` for another child. */
	participantId: string;
	displayName: string;
	child: boolean;
	guardian: boolean;
}

/** Home, tasks, family and picture for the signed-in child; every call uses the child token. */
export interface ChildHomeService {
	tasks(): Promise<Task[]>;
	/** Children may only start a task or send it to a guardian for review. */
	markTask(taskId: string, status: TaskStatus.IN_PROGRESS | TaskStatus.IN_REVIEW): Promise<Task>;
	family(): Promise<ChildFamilyMember[]>;
	avatar(profileId: string): Promise<AvatarRecord | null>;
	/** Sets the child's own picture; no image clears it. */
	setAvatar(image?: AvatarRecord): Promise<void>;
}

export function createChildHomeService(serverUrl: string, auth: OidcAuth): ChildHomeService {
	const client = createNativeClient("control", serverUrl);
	async function options() {
		const token = await auth.getChildAccessToken();
		if (!token) throw new Error("Child session expired. Ask a guardian to sign in.");
		return { headers: { authorization: `Bearer ${token}` } };
	}
	return {
		tasks: async () => {
			const response = (await client.listChildTasks({}, await options())) as { tasks?: Task[] };
			return response.tasks ?? [];
		},
		markTask: async (taskId, status) => {
			const response = (await client.markChildTaskStatus({ taskId, status }, await options())) as {
				task?: Task;
			};
			if (!response.task) throw new Error("The server did not return the task.");
			return response.task;
		},
		family: async () => {
			const response = (await client.listChildFamily({}, await options())) as {
				members?: Partial<ChildFamilyMember>[];
			};
			return (response.members ?? []).map((member) => ({
				participantId: member.participantId ?? "",
				displayName: member.displayName ?? "",
				child: member.child ?? false,
				guardian: member.guardian ?? false,
			}));
		},
		avatar: async (profileId) => {
			const response = (await client.getProfileAvatar({ profileId }, await options())) as {
				image?: Uint8Array;
				contentType?: string;
			};
			return response.image?.length && response.contentType
				? { image: response.image, contentType: response.contentType }
				: null;
		},
		setAvatar: async (avatar) => {
			await client.setProfileAvatar(
				{ image: avatar?.image ?? new Uint8Array(), contentType: avatar?.contentType ?? "" },
				await options(),
			);
		},
	};
}
