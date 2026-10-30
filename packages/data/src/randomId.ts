/**
 * Generate a random RFC 4122 version 4 UUID string.
 *
 * `crypto.randomUUID()` is only available in *secure contexts* (HTTPS, or the
 * loopback host `localhost`). When a Vulture app is served over plain HTTP on
 * a non-local LAN hostname during dev,
 * `crypto.randomUUID` is `undefined` and calling it throws. Prefer the native
 * API when the runtime exposes it, then getRandomValues-backed bytes, and only
 * fall back to `Math.random` when no CSPRNG is reachable, so ID generation
 * never crashes on page load.
 */
export function randomUUID(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}

	const bytes = randomBytes(16);
	bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
	bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 16 cryptographically-random bytes, or `Math.random` bytes if no CSPRNG. */
function randomBytes(count: number): Uint8Array {
	const bytes = new Uint8Array(count);
	// getRandomValues is also secure-context-only, so guard for it too.
	if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
		crypto.getRandomValues(bytes);
		return bytes;
	}
	for (let i = 0; i < count; i++) {
		bytes[i] = Math.floor(Math.random() * 256);
	}
	return bytes;
}
