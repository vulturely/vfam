/**
 * Profile avatar capability that the profile screen consumes. Core defines
 * the contract so `ProfileScreen` (in core) can type a service provided by an
 * external plugin without importing that plugin package. The identity plugin
 * implements this by wrapping the core family service; core screens consume
 * the registered instance from the runtime's plugin service map.
 */
export interface IdentityService {
	setAvatar(image: Uint8Array, contentType: string): Promise<void>;
	getAvatar(accountId: string): Promise<{ image: Uint8Array; contentType: string } | null>;
}
