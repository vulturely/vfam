import { createNativeClient } from "../repositories/nativeClient";
import { AccountRole } from "../api/protocol";
import type { OidcAuth } from "../auth/oidc";
export interface AccountSetupState {
	role: "parent" | "kid" | "grandparent" | null;
	dobConfirmed: boolean;
	completed: boolean;
}
export interface AccountSetupService {
	get(): Promise<AccountSetupState>;
	update(input: {
		role: "parent" | "kid";
		dateOfBirth?: string;
		complete?: boolean;
	}): Promise<AccountSetupState>;
}
export function createAccountSetupService(serverUrl: string, auth: OidcAuth): AccountSetupService {
	const client = createNativeClient("control", serverUrl);
	async function options() {
		const token = await auth.getAccessToken();
		if (!token) throw new Error("Sign in to continue setup.");
		return { headers: { authorization: `Bearer ${token}` } };
	}
	function state(value: {
		role: AccountRole;
		dobConfirmed: boolean;
		completed: boolean;
	}): AccountSetupState {
		return {
			role:
				value.role === AccountRole.PARENT
					? "parent"
					: value.role === AccountRole.KID
						? "kid"
						: value.role === AccountRole.GRANDPARENT
							? "grandparent"
							: null,
			dobConfirmed: value.dobConfirmed,
			completed: value.completed,
		};
	}
	return {
		async get() {
			return state(
				(await client.getAccountSetup({}, await options())) as {
					role: AccountRole;
					dobConfirmed: boolean;
					completed: boolean;
				},
			);
		},
		async update(input) {
			return state(
				(await client.updateAccountSetup(
					{
						...input,
						role: input.role === "parent" ? AccountRole.PARENT : AccountRole.KID,
					},
					await options(),
				)) as {
					role: AccountRole;
					dobConfirmed: boolean;
					completed: boolean;
				},
			);
		},
	};
}
