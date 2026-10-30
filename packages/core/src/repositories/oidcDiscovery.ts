import { createTauriIpcClient, type IpcClient } from "../api/ipc";

export interface OidcDiscovery {
	authorization_endpoint: string;
}

const discoveryCache = new Map<string, OidcDiscovery>();

export async function loadOidcDiscovery(
	authority: string,
	ipc: IpcClient = createTauriIpcClient(),
): Promise<OidcDiscovery> {
	const cached = discoveryCache.get(authority);
	if (cached) return cached;
	const document = await ipc.invoke<OidcDiscovery>("oidc_discovery", {
		input: { authority },
	});
	discoveryCache.set(authority, document);
	return document;
}
