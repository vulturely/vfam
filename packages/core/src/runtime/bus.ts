type Listener<T> = (event: T) => void;

/**
 * Cross-plugin event bus. Backs `PluginContext.subscribe` and lets the shell
 * broadcast domain events (e.g. "chores:changed") without coupling plugins.
 */
export interface EventBus {
	publish: <T>(topic: string, event: T) => void;
	/** Returns an unsubscribe fn. */
	subscribe: <T>(topic: string, fn: Listener<T>) => () => void;
}

export function createBus(): EventBus {
	const listeners = new Map<string, Set<Listener<unknown>>>();

	return {
		publish<T>(topic: string, event: T) {
			const set = listeners.get(topic);
			if (!set) return;
			for (const fn of set) fn(event);
		},
		subscribe<T>(topic: string, fn: Listener<T>) {
			let set = listeners.get(topic);
			if (!set) {
				set = new Set();
				listeners.set(topic, set);
			}
			set.add(fn as Listener<unknown>);
			return () => {
				set!.delete(fn as Listener<unknown>);
				if (set!.size === 0) listeners.delete(topic);
			};
		},
	};
}
