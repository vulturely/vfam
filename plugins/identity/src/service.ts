import type { IdentityService } from "@vulture/core";
import type { PluginFamilyService } from "@vulture/plugin-sdk";

/**
 * Profile avatar capability exposed by the identity plugin. Implementation
 * wraps the core family service's avatar operations behind a core-typed
 * `IdentityService`, so the profile screen (in core) can consume it through
 * the runtime's plugin service registry with a sound type.
 */
export function createIdentityService(family: PluginFamilyService): IdentityService {
	return {
		setAvatar(image, contentType) {
			return family.setAvatar(image, contentType);
		},
		getAvatar(accountId: string) {
			return family.getAvatar(accountId);
		},
	};
}
