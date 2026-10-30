import { createNativeClient } from "../../repositories/nativeClient";
import type { OidcAuth } from "../../auth/oidc";
import type { CallCommand, CallReply, CallAdapter } from "../../calls/service";

export function createCallAdapter(serverUrl: string, auth: OidcAuth): CallAdapter {
	const url = new URL(serverUrl);
	if (
		url.protocol !== "https:" &&
		(url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
	) {
		throw new Error("Family calls require HTTPS signaling.");
	}
	const client = createNativeClient("control", serverUrl);
	return {
		async execute(command: CallCommand): Promise<CallReply> {
			const token = await auth.getSessionAccessToken();
			if (!token) throw new Error("Sign in again to use family calls.");
			const response = await client.familyCall(
				{ commandJson: JSON.stringify(command) },
				{
					headers: { authorization: `Bearer ${token}` },
					timeoutMs: 5000,
				},
			);
			return JSON.parse((response as { resultJson: string }).resultJson) as CallReply;
		},
	};
}
