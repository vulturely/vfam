import { createNativeClient } from "../repositories/nativeClient";
import type { OidcAuth } from "../auth/oidc";
export interface StorageConfig {
	endpoint: string;
	bucket: string;
	region: string;
	access_key_id: string;
	secret_access_key: string;
}
export interface ResourceSettings {
	platform_paid: boolean;
	storage: StorageConfig | null;
	storage_secret_set: boolean;
}
/** Family storage settings. Family AI keys live only on family devices (see family-ai). */
export interface ResourceService {
	get(): Promise<ResourceSettings>;
	saveStorage(config: StorageConfig | null): Promise<ResourceSettings>;
}
export function createResourceService(serverUrl: string, auth: OidcAuth): ResourceService {
	const client = createNativeClient("control", serverUrl);
	async function call(command: object): Promise<ResourceSettings> {
		const token = await auth.getAccessToken();
		if (!token) throw new Error("Family manager sign-in required.");
		const reply = await client.familyResources(
			{ commandJson: JSON.stringify(command) },
			{ headers: { authorization: `Bearer ${token}` }, timeoutMs: 15000 },
		);
		return JSON.parse((reply as { resultJson: string }).resultJson) as ResourceSettings;
	}
	return {
		get: () => call({ type: "get" }),
		saveStorage: (config) => call({ type: "save_storage", config }),
	};
}
