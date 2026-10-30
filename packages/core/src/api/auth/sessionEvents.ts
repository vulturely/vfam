import { isNativeServerError } from "../../repositories/server";

export const SESSION_EXPIRED_EVENT = "vulture:session-expired";

// These answer a wrong PIN or sign-in code with UNAUTHENTICATED, which is not an
// expired session; the session checks report their own state.
const CREDENTIAL_METHODS = new Set([
	"SignInChild",
	"UnlockParent",
	"VerifyParentPin",
	"ExchangeAuthCode",
	"BeginParentSignIn",
	"GetParentSession",
	"GetChildSession",
	"RevokeSession",
]);

/** Sends the app back to sign-in when the server rejects the current parent or child session. */
export function reportSessionExpiry(error: unknown, token: string | null | undefined, method = "") {
	if (
		typeof window === "undefined" ||
		!token ||
		!/^v[pc]s_/.test(token) ||
		CREDENTIAL_METHODS.has(method) ||
		!isNativeServerError(error, "unauthenticated")
	)
		return;
	window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: token }));
}
