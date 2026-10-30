import { defineApp } from "@vulture/core";
import identity from "@vulture/plugin-identity";
import defaults from "./app.config.json";

/**
 * The entire Vulture app: which plugins are compiled in and which theme
 * profile it uses. Tasks and chores share the core family workspace.
 *
 * Public OIDC issuer/client and API URL settings can be overridden with
 * nonsecret VITE_* values. Redirects follow the browser origin and must be
 * registered with the provider.
 */
const DEFAULT_DEV_HOST = "localhost";

function currentOrigin(): string {
	if (typeof window === "undefined") return `https://${DEFAULT_DEV_HOST}:1420`;
	return window.location.origin;
}

const origin = currentOrigin();

export const appConfig = defineApp({
	id: "vfam",
	name: "VFAM",
	profile: "standard",
	plugins: [identity],
	serverUrl: new URL(import.meta.env.VITE_SERVER_URL || defaults.serverUrl, origin).href.replace(
		/\/$/,
		"",
	),
	oidc: {
		// These public settings contain no client secret.
		authority: import.meta.env.VITE_OIDC_AUTHORITY || "https://auth.swavan.io/auth/v1/",
		clientId: import.meta.env.VITE_OIDC_CLIENT_ID || "vulturefam",
		redirectUri: `${origin}/login/callback`,
		nativeRedirectUri:
			import.meta.env.VITE_OIDC_DESKTOP_REDIRECT_URI || defaults.desktopRedirectUri,
		postLogoutRedirectUri: origin,
		scope: "openid profile email",
	},
});
