import { SESSION_EXPIRED_EVENT } from "../api/auth/sessionEvents";
import { createLocalStateService, type LocalStateService } from "../services/storage/localState";

export interface StoredSession {
	version?: number;
	accountId: string;
	displayName: string;
	email?: string;
	givenName?: string;
	familyName?: string;
	picture?: string;
	accessToken: string;
	idToken: string;
	expiresAt: number;
	/** Set once the parent PIN was entered for this exact parent session. */
	pinUnlocked?: boolean;
	/** Set by a sign-in started from "Forgot PIN?"; cleared once a new PIN is saved. */
	pinReset?: boolean;
}
export interface ChildContext {
	profileId: string;
	familyId: string;
	displayName: string;
	expiresAt: string;
}
export type ChildSessionState =
	({ status: "active" } & ChildContext) | { status: "locked"; message: string };

export function createSessionStorage(
	authority: string,
	clientId: string,
	state: LocalStateService = createLocalStateService(),
) {
	const parentKey = `oidc.user:${authority}:${clientId}`;
	const childKey = `vulture.child-session:${authority}:${clientId}`;
	const rememberedKey = `vulture.child-profiles:${authority}:${clientId}`;
	const pendingKey = `oidc.pending:${authority}:${clientId}`;
	async function hasChild() {
		return (await state.read(childKey)) !== null;
	}
	async function clearParent() {
		await Promise.all([
			state.remove(parentKey),
			state.remove(pendingKey),
			state.remove("vulture:mailbox-consent"),
			state.remove("vulture.accounts"),
			state.remove("vulture:family-tasks:v1"),
		]);
	}
	return {
		rememberedKey,
		async rememberChild(loginId: string, displayName: string) {
			const children = await readRememberedChildren(rememberedKey, state);
			await state.put(
				rememberedKey,
				[...children.filter((child) => child.loginId !== loginId), { loginId, displayName }].slice(
					-12,
				),
			);
		},
		rememberedChildren() {
			return readRememberedChildren(rememberedKey, state);
		},
		async forgetChild(loginId: string) {
			const children = await readRememberedChildren(rememberedKey, state);
			await state.put(
				rememberedKey,
				children.filter((child) => child.loginId !== loginId),
			);
		},
		parentKey,
		childKey,
		pendingKey,
		hasChild,
		async hasParent() {
			return (await state.read(parentKey)) !== null;
		},
		readPending<T>(): Promise<T | null> {
			return state.read<T>(pendingKey);
		},
		async savePending(value: unknown) {
			await state.put(pendingKey, value);
		},
		async readParent(): Promise<StoredSession | null> {
			if (await hasChild()) return null;
			const value = await state.read<StoredSession | string>(parentKey);
			if (value === null) return null;
			if (
				typeof value === "object" &&
				value.version === 2 &&
				typeof value.accessToken === "string" &&
				value.accessToken.startsWith("vps_") &&
				value.expiresAt > Date.now()
			)
				return value;
			await clearParent();
			return null;
		},
		async childToken(): Promise<string | null> {
			const value = await state.read<{ token?: string } | string>(childKey);
			if (value === null) return null;
			return typeof value === "object" && typeof value.token === "string" ? value.token : "invalid";
		},
		async saveChild(token: string) {
			try {
				await state.put(childKey, { token });
			} finally {
				await clearParent();
			}
		},
		async saveParent(session: StoredSession) {
			await state.put(parentKey, { ...session, version: 2 });
			await state.remove(childKey);
		},
		clearParent,
		async clearAll() {
			await clearParent();
			await state.remove(childKey);
		},
		watch(onBoundary: () => void) {
			const unwatch = state.watch((key) => {
				if (key === null || key === parentKey || key === childKey) onBoundary();
			});
			const pageshow = (event: { persisted: boolean }) => {
				if (event.persisted) onBoundary();
			};
			// Only the session that was rejected is cleared, then sign-in opens.
			const expired = (event: Event) => {
				void (async () => {
					const token = (event as CustomEvent<string>).detail;
					if (await hasChild()) {
						const child = await state.read<{ token?: string }>(childKey);
						if (child?.token !== token) return;
						await state.remove(childKey);
					} else {
						const current = await state.read<StoredSession>(parentKey);
						if (current?.accessToken !== token) return;
						await clearParent();
					}
					window.location.replace("/");
				})();
			};
			window.addEventListener(SESSION_EXPIRED_EVENT, expired);
			window.addEventListener("pageshow", pageshow);
			return () => {
				unwatch();
				window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
				window.removeEventListener("pageshow", pageshow);
			};
		},
	};
}

export interface RememberedChild {
	loginId: string;
	displayName: string;
}
export async function readRememberedChildren(
	key: string,
	state: LocalStateService = createLocalStateService(),
): Promise<RememberedChild[]> {
	const parsed = await state.read<unknown>(key);
	if (!Array.isArray(parsed)) return [];
	const valid = parsed
		.filter(
			(item): item is RememberedChild =>
				!!item && typeof item.loginId === "string" && typeof item.displayName === "string",
		)
		.slice(-12);
	return [...new Map(valid.map((child) => [child.loginId, child])).values()];
}
