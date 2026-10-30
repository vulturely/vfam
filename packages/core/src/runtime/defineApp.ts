import type { Plugin } from "@vulture/plugin-sdk";
import type { OidcConfig } from "../auth/oidc";

/** Which shipped product this build of the shell is. Drives the theme preset. */
export type Profile = "standard" | "kids" | "elders";

/** The complete description of one shipped app: theme + plugin selection. */
export interface AppConfig {
	/** App id, e.g. "family-manager". Used in logs and drift checks. */
	id: string;
	name: string;
	profile: Profile;
	plugins: Plugin[];
	/** OIDC provider settings used for sign-in. */
	oidc: OidcConfig;
	/** Base URL of the Vulture server accessed by the native backend. */
	serverUrl: string;
}

/**
 * Declare a thin app. Keeps the app source to: a config file importing
 * plugins + a one-line `<VultureApp config={appConfig} />`.
 */
export function defineApp(config: AppConfig): AppConfig {
	return config;
}
