import type { AccountFormInput, AccountRecord } from "../../account/types";
import { createNativeClient } from "../../repositories/nativeClient";
import { AccountRole, type Account } from "../protocol";

export interface AccountApi {
	createAccount(input: AccountFormInput): Promise<AccountRecord>;
}

export function createAccountApi(serverUrl: string): AccountApi {
	const client = createNativeClient("control", serverUrl);
	return {
		async createAccount(input) {
			const response = (await client.createAccount({
				displayName: input.displayName.trim(),
				email: input.email?.trim().toLowerCase() || undefined,
				role:
					input.role === "kid"
						? AccountRole.KID
						: input.role === "grandparent"
							? AccountRole.GRANDPARENT
							: AccountRole.PARENT,
			})) as { account?: Account };
			if (!response.account) throw new Error("Server did not return an account.");
			return {
				id: response.account.id,
				displayName: response.account.displayName,
				role:
					response.account.role === AccountRole.KID
						? "kid"
						: response.account.role === AccountRole.GRANDPARENT
							? "grandparent"
							: "parent",
				email: response.account.email,
				createdAt: response.account.createdAt,
				updatedAt: response.account.updatedAt,
			};
		},
	};
}
