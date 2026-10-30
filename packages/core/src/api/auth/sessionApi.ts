import type { ChildContext } from "../../auth/sessionStorage";
import {
	createServerRepository,
	isNativeServerError,
	type ServerRepository,
} from "../../repositories/server";

export interface ParentMetadata {
	accountId: string;
	displayName: string;
	email: string;
	givenName: string;
	familyName: string;
	picture: string;
	expiresAt: string;
}
export interface ParentGrant extends ParentMetadata {
	accessToken: string;
	idToken: string;
}

interface ChildSessionResponse {
	sessionToken: string;
	context?: ChildContext;
}

export function createSessionApi(serverUrl: string, server = createServerRepository(serverUrl)) {
	function call<T>(method: string, payload: Record<string, unknown>, token?: string): Promise<T> {
		return server.unary<T>("control", method, payload, { token });
	}

	return {
		getParentPinAccess(token: string): Promise<{ enabled: boolean }> {
			return call("GetParentPinAccess", {}, token);
		},
		setParentPin(pin: string, token: string, currentPin = ""): Promise<{ enabled: boolean }> {
			return call("SetParentPin", { pin, currentPin }, token);
		},
		unlockParent(pin: string, token: string): Promise<ParentGrant> {
			return call("UnlockParent", { pin }, token);
		},
		verifyParentPin(pin: string, token: string): Promise<object> {
			return call("VerifyParentPin", { pin }, token);
		},
		beginParentSignIn(input: {
			redirectUri: string;
			codeChallenge: string;
		}): Promise<{ flowId: string; nonce: string; expiresAt: string }> {
			return call("BeginParentSignIn", input);
		},
		exchangeAuthCode(input: {
			code: string;
			codeVerifier: string;
			redirectUri: string;
			flowId: string;
			childSessionToken?: string;
		}): Promise<ParentGrant> {
			return call("ExchangeAuthCode", input);
		},
		async getParentSession(token: string): Promise<ParentMetadata | null> {
			try {
				return await call("GetParentSession", {}, token);
			} catch (error) {
				if (isNativeServerError(error, "unauthenticated")) return null;
				throw error;
			}
		},
		startChildSession(profileId: string, token: string): Promise<ChildSessionResponse> {
			return call("StartChildSession", { profileId }, token);
		},
		getChildPinAccess(
			profileId: string,
			token: string,
		): Promise<{ enabled: boolean; loginId: string }> {
			return call("GetChildPinAccess", { profileId }, token);
		},
		setChildPin(
			profileId: string,
			pin: string,
			token: string,
		): Promise<{ enabled: boolean; loginId: string }> {
			return call("SetChildPin", { profileId, pin }, token);
		},
		signInChild(loginId: string, pin: string, token?: string): Promise<ChildSessionResponse> {
			return call("SignInChild", { loginId, pin }, token);
		},
		/** A signed-in child switches to a sibling in the same family with the sibling's PIN. */
		switchChild(profileId: string, pin: string, token: string): Promise<ChildSessionResponse> {
			return call("SignInChild", { profileId, pin }, token);
		},
		async getChildSession(token: string): Promise<ChildContext | null> {
			try {
				const response = await call<{ context?: ChildContext }>("GetChildSession", {}, token);
				return response.context ?? null;
			} catch (error) {
				if (isNativeServerError(error, "unauthenticated")) return null;
				throw error;
			}
		},
		async revokeSession(token: string): Promise<void> {
			await call("RevokeSession", {}, token);
		},
	};
}

export type SessionApi = ReturnType<typeof createSessionApi>;
export type SessionServerRepository = ServerRepository;
