import type { Plugin } from "./types";

/**
 * Declare a Vulture plugin. Type-checked against the plugin contract; the
 * runtime lives in `@vulture/core`.
 */
export function definePlugin(def: Plugin): Plugin {
	return def;
}

export type { NavItem, Plugin, PluginContext, PluginFamilyService, ScreenDef } from "./types";
