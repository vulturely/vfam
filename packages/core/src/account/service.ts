import type { Person } from "@vulture/data";
import { randomUUID } from "@vulture/data";
import type { AccountApi } from "../api/account/accountApi";
import type { OidcAuth } from "../auth/oidc";
import type { AccountFormInput, SignedInAccount } from "./types";
import { roleOptionFor } from "./types";
import { createAccountRepository } from "../repositories/account";

export interface AccountService {
	register(input: AccountFormInput): Promise<SignedInAccount>;
	signIn(input: AccountFormInput): Promise<SignedInAccount>;
}

export function createAccountService(
	api: AccountApi,
	auth?: OidcAuth,
	repository: ReturnType<typeof createAccountRepository> = createAccountRepository(),
): AccountService {
	return {
		async register(input) {
			await repository.validateInput(input);
			return signedInAccount(await api.createAccount(input), input.familyName);
		},
		async signIn(input) {
			await repository.validateInput(input);
			if (!auth) throw new Error("OIDC sign-in is not configured.");
			await auth.signIn();
			const session = await auth.getUser();
			if (!session) throw new Error("Sign-in did not return an account.");
			return session;
		},
	};
}

function signedInAccount(
	account: Awaited<ReturnType<AccountApi["createAccount"]>>,
	familyName?: string,
): SignedInAccount {
	const option = roleOptionFor(account.role);
	const familyId = slugId(familyName?.trim() || "family");
	const person: Person = {
		id: account.id,
		familyId,
		name: account.displayName,
		role: option.personRole,
		deviceId: randomUUID(),
		createdAt: account.createdAt,
	};

	return {
		account,
		familyId,
		person,
		landingScreen: option.screen,
	};
}

function slugId(value: string): string {
	const slug = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
	return `${slug || "family"}-${randomUUID()}`;
}
