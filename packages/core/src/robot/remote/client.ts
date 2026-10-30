import { createNativeClient } from "../../repositories/nativeClient";
import type { OidcAuth } from "../../auth/oidc";
export type ParentAuth = Pick<OidcAuth, "getAccessToken">;
export function relayOrigin(server: string): string {
	const url = new URL(server, globalThis.location.origin);
	if (url.protocol !== "https:" || url.username || url.password || url.port)
		throw new Error("Remote approvals require the Vulture HTTPS server on port 443.");
	return url.origin;
}
export function relayClient(origin: string) {
	return createNativeClient("fambuddy_relay", relayOrigin(origin));
}
export async function parentHeaders(auth: ParentAuth) {
	const token = await auth.getAccessToken();
	if (!token?.startsWith("vps_")) throw new Error("Sign in to Vulture as a parent.");
	return { authorization: `Bearer ${token}` };
}
