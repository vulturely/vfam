import process from "node:process";

// A macOS release must keep one signing identity across versions; otherwise the
// Keychain treats every update as a new app and asks for the password again.
if (
	process.platform === "darwin" &&
	!process.env.APPLE_SIGNING_IDENTITY &&
	process.env.VFAM_ALLOW_UNSIGNED_BUNDLE !== "1"
) {
	console.error(
		"macOS bundles must be signed: set APPLE_SIGNING_IDENTITY to the Developer ID Application identity, " +
			"or VFAM_ALLOW_UNSIGNED_BUNDLE=1 for a local test bundle.",
	);
	process.exit(1);
}
