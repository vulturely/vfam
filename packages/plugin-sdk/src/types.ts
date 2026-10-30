import type { Component, ComponentType } from "svelte";
import type { Role } from "@vulture/data";

/** A single sidebar navigation entry contributed by a plugin screen. */
export interface NavItem {
	/** Matches the id of a ScreenDef, e.g. "chores:list". */
	id: string;
	label: string;
	icon?: ComponentType;
	/** Restrict which roles see this entry. Default: all of the plugin's roles. */
	roles?: Role[];
	order?: number;
}

/** A screen the plugin contributes to the shell's screen registry. */
export interface ScreenDef {
	/** Unique id, namespaced by plugin: "chores:list". */
	id: string;
	component: Component;
	title?: string;
	/** Presence of `nav` contributes a sidebar entry for this screen. */
	nav?: NavItem;
}

/** Runtime services handed to a plugin when the app boots. */
export interface PluginContext {
	pluginId: string;
	/**
	 * Typed service registry for this plugin. Screens should depend on service
	 * modules, not raw APIs or IPC calls. IPC adapters belong below services in
	 * each plugin's API layer.
	 */
	services: Record<string, unknown>;
	navigate: (screen: string, params?: Record<string, string>) => void;
	role: Role;
	familyId: string | null;
	/** Granted Tauri capability ids for this plugin. */
	permissions: string[];
	/** Cross-plugin event bus subscription. Returns an unsubscribe fn. */
	subscribe: <T>(topic: string, fn: (event: T) => void) => () => void;
	/**
	 * The shell's family service, which the plugin may wrap/extend to expose
	 * plugin-level capabilities (e.g. a profile avatar service). Plugins must
	 * not call transport/IPC directly; they consume this core service.
	 */
	family: PluginFamilyService;
}

/**
 * The minimal slice of the core family service that plugins may consume. Kept
 * structural so `@vulture/plugin-sdk` stays decoupled from `@vulture/core`.
 */
export interface PluginFamilyService {
	setAvatar(image: Uint8Array, contentType: string): Promise<void>;
	getAvatar(accountId: string): Promise<{ image: Uint8Array; contentType: string } | null>;
}

/** The shape every Vulture plugin exports. */
export interface Plugin {
	/** Also the Tauri plugin name used to namespace commands. */
	id: string;
	name: string;
	version: string;
	/** Which personas this plugin serves. */
	roles: Role[];
	screens: ScreenDef[];
	/** Called once when the app boots with this plugin's context. */
	setup?: (ctx: PluginContext) => void | (() => void);
}
