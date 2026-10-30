import { definePlugin } from "@vulture/plugin-sdk";
import { createIdentityService } from "./service";

export default definePlugin({
	id: "identity",
	name: "Identity",
	version: "0.1.0",
	roles: ["manager", "kid", "elder"],
	screens: [],
	setup(ctx) {
		// Expose a typed profile-avatar service to the shell, backed by the core
		// family service. Core screens (ProfileScreen) consume this via the
		// runtime's plugin service registry; the plugin adds no transport.
		ctx.services["identity"] = createIdentityService(ctx.family);
	},
});
