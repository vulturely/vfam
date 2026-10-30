export interface Route {
	/** Screen registry id, e.g. "family:manage". */
	screen: string;
	params: Record<string, string>;
}

export function parseHash(hash: string): Route {
	const cleaned = hash.replace(/^#\/?/, "");
	const [screen, query = ""] = cleaned.split("?");
	const params: Record<string, string> = {};
	for (const pair of query.split("&")) {
		if (!pair) continue;
		const [key, value] = pair.split("=");
		params[decodeURIComponent(key)] = decodeURIComponent(value ?? "");
	}
	return canonicalRoute({ screen: screen || "", params });
}

function canonicalRoute(route: Route): Route {
	return route.screen === "chores:list"
		? {
				screen: "family:manage",
				params: { ...route.params, tab: "tasks", filter: "chores" },
			}
		: route;
}

function serialize(route: Route): string {
	const query = new URLSearchParams(route.params).toString();
	return `#/${route.screen}${query ? `?${query}` : ""}`;
}

/**
 * Hash router backing `PluginContext.navigate` and the shell's screen outlet.
 * Feature screens are registry ids, never file routes — `#/family:manage`.
 */
export function createRouter(initialScreen: string) {
	const route = $state<Route>(parseHash(location.hash));

	function navigate(screen: string, params: Record<string, string> = {}) {
		location.hash = serialize(canonicalRoute({ screen, params }));
	}

	if (typeof window !== "undefined") {
		window.addEventListener("hashchange", () => {
			const next = parseHash(location.hash);
			if (next.screen) {
				route.screen = next.screen;
				route.params = next.params;
			}
		});
	}

	// If the URL has no hash yet, adopt the default screen without clobbering a
	// real hash the user may have typed. The shell renders nothing until one is set.
	if (typeof window !== "undefined" && !location.hash && initialScreen) {
		navigate(initialScreen);
	}

	return {
		get current() {
			return route;
		},
		navigate,
	};
}
