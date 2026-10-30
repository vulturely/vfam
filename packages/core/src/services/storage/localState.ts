import {
	createLocalStateRepository,
	type LocalStateRepository,
} from "../../repositories/localState";

export interface LocalStateService {
	get<T>(key: string): Promise<T | null>;
	put(key: string, value: unknown): Promise<void>;
	delete(key: string): Promise<void>;
	read<T>(key: string): Promise<T | null>;
	remove(key: string): Promise<void>;
	discardLegacy(key: string): void;
	watch(onChange: (key: string | null) => void): () => void;
}

export function createLocalStateService(
	repository: LocalStateRepository = createLocalStateRepository(),
): LocalStateService {
	async function migrate<T>(key: string): Promise<T | null> {
		const current = await repository.get<T>(key);
		const legacy = repository.readLegacy(key);
		if (current !== null) {
			if (legacy !== null) repository.removeLegacy(key);
			return current;
		}
		if (legacy === null) return null;
		let value: unknown = legacy;
		try {
			value = JSON.parse(legacy);
		} catch {
			// Preserve corrupt legacy state so credential validation still fails closed.
		}
		await repository.put(key, value);
		repository.removeLegacy(key);
		return value as T;
	}
	return {
		get: (key) => repository.get(key),
		put: async (key, value) => {
			await repository.put(key, value);
			repository.removeLegacy(key);
		},
		delete: async (key) => {
			await repository.delete(key);
			repository.removeLegacy(key);
		},
		read: migrate,
		remove: async (key) => {
			await repository.delete(key);
			repository.removeLegacy(key);
		},
		discardLegacy: (key) => repository.removeLegacy(key),
		watch: (onChange) => repository.watch(onChange),
	};
}

export function createMemoryLocalStateService(initial: Record<string, unknown> = {}) {
	const values = new Map<string, unknown>(Object.entries(initial));
	const legacy = new Map<string, string>();
	const repository: LocalStateRepository = {
		get: async <T>(key: string) => (values.has(key) ? (values.get(key) as T) : null),
		put: async (key, value) => {
			values.set(key, value);
		},
		delete: async (key) => {
			values.delete(key);
		},
		readLegacy: (key) => legacy.get(key) ?? null,
		removeLegacy: (key) => {
			legacy.delete(key);
		},
		watch: () => () => {},
	};
	return {
		service: createLocalStateService(repository),
		values,
		legacy,
	};
}
