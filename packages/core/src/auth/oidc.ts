import { createSessionStorage, type StoredSession, type ChildSessionState } from "./sessionStorage";
import { randomUUID, type Person } from "@vulture/data";
import { createSessionApi } from "../api/auth/sessionApi";
import type { AccountRecord, SignedInAccount } from "../account/types";
import {
	isNativeApp,
	onNativeAuthCallback,
	openNativeUrl,
	startNativeAuthCallback,
} from "../repositories/nativeAuth";
import { loadOidcDiscovery } from "../repositories/oidcDiscovery";

/**
 * OIDC provider settings for one app. `authority` is the Swavan issuer
 * (e.g. `https://auth.swavan.io/auth/v1/`), `clientId` the registered OIDC
 * client, and `redirectUri` the SPA route the provider returns to after
 * login.
 */
export interface OidcConfig {
	authority: string;
	clientId: string;
	redirectUri: string;
	/** HTTPS callback registered with the identity provider for desktop handoff. */
	nativeRedirectUri?: string;
	postLogoutRedirectUri: string;
	scope?: string;
}

/** Browser-side OIDC auth backed by Swavan (auth.swavan.io). */
export interface OidcAuth {
	isNative(): boolean;
	/** Redirect the browser to Swavan's login page. */
	signIn(options?: { resetParentPin?: boolean }): Promise<void>;
	/** Exchange the authorization code on the callback URL for a session. */
	handleCallback(): Promise<SignedInAccount>;
	/** Return the stored session, or null when signed out or expired. */
	getUser(): Promise<SignedInAccount | null>;
	/** Return the current access token, or null when signed out/expired. */
	getAccessToken(): Promise<string | null>;
	getChildAccessToken(): Promise<string | null>;
	/** The active child session token, otherwise the parent token; chat and calls serve both. */
	getSessionAccessToken(): Promise<string | null>;
	listRememberedChildren(): Promise<import("./sessionStorage").RememberedChild[]>;
	forgetRememberedChild(loginId: string): Promise<void>;
	/** Revoke the Vulture session and clear local credentials; future login is always fresh. */
	signOut(): Promise<void>;
	startChildSession(profileId: string): Promise<void>;
	/** From a child session, opens a sibling's profile with their PIN. */
	switchChildProfile(profileId: string, pin: string): Promise<void>;
	getParentPinAccess(): Promise<{ enabled: boolean }>;
	/** Replacing a PIN needs `currentPin` unless this session signed in to reset it. */
	setParentPin(pin: string, currentPin?: string): Promise<{ enabled: boolean }>;
	/** True after a "Forgot PIN?" sign-in until a new parent PIN is saved. */
	parentPinResetPending(): Promise<boolean>;
	unlockParent(pin: string): Promise<void>;
	/** Re-checks the parent PIN for the signed-in parent on a shared device. */
	verifyParentPin(pin: string): Promise<void>;
	/** True when a parent PIN is set and not yet entered for this parent session. */
	parentPinLocked(): Promise<boolean>;
	getChildPinAccess(profileId: string): Promise<{ enabled: boolean; loginId: string }>;
	setChildPin(profileId: string, pin: string): Promise<{ enabled: boolean; loginId: string }>;
	signInChild(loginId: string, pin: string, remember?: boolean): Promise<void>;
	getChildSession(): Promise<ChildSessionState | null>;
	watchSessionBoundary(onBoundary: () => void): () => void;
}

/**
 * The authorization-code + PKCE flow, with the token exchange performed by the
 * Vulture server (a backend-for-frontend). The SPA redirects the browser to
 * the provider, then hands the returned code + PKCE verifier to the server's
 * `ExchangeAuthCode` RPC, which authenticates as the confidential client with
 * its secret (kept server-side) and returns the user + access token.
 */
export function createOidcAuth(
	config: OidcConfig,
	serverUrl: string,
	state?: import("../services/storage/localState").LocalStateService,
): OidcAuth {
	const client = createSessionApi(serverUrl);

	const storage = createSessionStorage(config.authority, config.clientId, state);
	async function parentForAction() {
		const hadParent = await storage.hasParent();
		const parent = await storage.readParent();
		if (!parent && hadParent && !(await storage.hasChild())) window.location.replace("/");
		return parent;
	}
	async function finishCallback(code: string, state: string) {
		const pending = await storage.readPending<PendingSignIn>();
		if (!pending || pending.state !== state) {
			throw new Error("OIDC state mismatch; the sign-in request is stale.");
		}
		const childSessionToken = (await storage.childToken()) ?? undefined;
		const response = await client.exchangeAuthCode({
			code,
			codeVerifier: pending.codeVerifier,
			redirectUri: pending.redirectUri,
			flowId: pending.flowId,
			childSessionToken,
		});
		// Signing in from child mode is the forgotten-PIN recovery path, so it
		// opens parent screens; an ordinary sign-in still asks for the parent PIN.
		const session = {
			...buildSession(response),
			pinUnlocked: childSessionToken?.startsWith("vcs_") === true,
			pinReset: pending.resetParentPin === true,
		};
		await storage.saveParent(session);
		return signedInAccountFromSession(session);
	}

	let signInFlight: Promise<void> | undefined;
	// Set while a desktop sign-in waits on the browser; another click restarts it.
	let restartPending: ((next: Promise<void>) => void) | undefined;

	return {
		isNative: isNativeApp,
		async signIn(options = {}) {
			const restart = restartPending;
			if (restart) {
				restartPending = undefined;
				signInFlight = undefined;
			}
			signInFlight ??= (async () => {
				const discovery = await loadOidcDiscovery(config.authority);
				const csrfState = randomUUID();
				const codeVerifier = generateVerifier();
				const codeChallenge = await s256Challenge(codeVerifier);
				const native = isNativeApp();
				let redirectUri = config.redirectUri;
				let state = csrfState;
				let callback:
					| Promise<{
							code?: string;
							state?: string;
							error?: string;
					  }>
					| undefined;
				let unlisten: (() => void) | undefined;
				let openExternal: ((url: string) => Promise<void>) | undefined;
				if (native) {
					if (!config.nativeRedirectUri)
						throw new Error("Desktop sign-in callback is not configured.");
					let receive!: (value: { code?: string; state?: string; error?: string }) => void;
					callback = new Promise((resolve) => {
						receive = resolve;
					});
					unlisten = await onNativeAuthCallback(receive);
					const relayToken = crypto.randomUUID();
					redirectUri = config.nativeRedirectUri;
					try {
						const localCallback = await startNativeAuthCallback(relayToken);
						const port = new URL(localCallback).port;
						state = `vulture-desktop:${port}:${relayToken}:${csrfState}`;
						openExternal = openNativeUrl;
					} catch (error) {
						unlisten();
						throw error;
					}
				}

				try {
					const flow = await client.beginParentSignIn({
						redirectUri,
						codeChallenge,
					});
					await storage.savePending({
						state,
						flowId: flow.flowId,
						codeVerifier,
						redirectUri,
						resetParentPin: options.resetParentPin === true,
					});
					const params = new URLSearchParams({
						response_type: "code",
						client_id: config.clientId,
						redirect_uri: redirectUri,
						scope: config.scope ?? "openid profile email",
						state,
						code_challenge: codeChallenge,
						code_challenge_method: "S256",
						prompt: "login",
						max_age: "0",
						nonce: flow.nonce,
					});
					const authorizationUrl = `${discovery.authorization_endpoint}?${params}`;
					if (!native) {
						window.location.assign(authorizationUrl);
						return;
					}
					await openExternal!(authorizationUrl);
					let restartThis!: (next: Promise<void>) => void;
					const replaced = new Promise<{ next: Promise<void> }>((resolve) => {
						restartThis = (next) => resolve({ next });
					});
					restartPending = restartThis;
					const result = await Promise.race([callback!, replaced]);
					if (restartPending === restartThis) restartPending = undefined;
					if ("next" in result) {
						unlisten?.();
						unlisten = undefined;
						await result.next;
						return;
					}
					if (result.error) throw new Error(result.error);
					if (!result.code || !result.state)
						throw new Error("The sign-in callback was incomplete.");
					await finishCallback(result.code, result.state);
				} finally {
					unlisten?.();
				}
			})();
			const flight = signInFlight;
			restart?.(flight);
			try {
				await flight;
			} finally {
				if (signInFlight === flight) signInFlight = undefined;
			}
		},

		async handleCallback() {
			const url = new URL(window.location.href);
			const code = url.searchParams.get("code");
			const state = url.searchParams.get("state");
			if (!code || !state) {
				throw new Error("Missing authorization code or state in the callback URL.");
			}

			return finishCallback(code, state);
		},

		async getUser() {
			const session = await storage.readParent();
			if (!session) return null;
			const current = await client.getParentSession(session.accessToken);
			if (!current) {
				// The server rejected the session: clear it and open sign-in.
				await storage.clearParent();
				if (window.location.pathname !== "/" || window.location.hash) window.location.replace("/");
				return null;
			}
			return signedInAccountFromSession({
				...session,
				...current,
				expiresAt: Date.parse(current.expiresAt),
			});
		},

		async getChildAccessToken() {
			return storage.childToken();
		},
		async getSessionAccessToken() {
			return (await storage.childToken()) ?? (await parentForAction())?.accessToken ?? null;
		},
		listRememberedChildren: () => storage.rememberedChildren(),
		forgetRememberedChild: (loginId) => storage.forgetChild(loginId),
		async getAccessToken() {
			return (await parentForAction())?.accessToken ?? null;
		},
		async getParentPinAccess() {
			const parent = await parentForAction();
			if (!parent) throw new Error("Sign in to manage your parent PIN.");
			return client.getParentPinAccess(parent.accessToken);
		},
		async setParentPin(pin, currentPin = "") {
			const parent = await parentForAction();
			if (!parent) throw new Error("Sign in to manage your parent PIN.");
			const access = await client.setParentPin(pin, parent.accessToken, currentPin);
			// The server accepted the current PIN or a reset sign-in, so this session is unlocked.
			await storage.saveParent({ ...parent, pinUnlocked: true, pinReset: false });
			return access;
		},
		async parentPinResetPending() {
			return (await storage.readParent())?.pinReset === true;
		},
		async verifyParentPin(pin) {
			const parent = await parentForAction();
			if (!parent) throw new Error("Sign in to open your parent profile.");
			await client.verifyParentPin(pin, parent.accessToken);
			await storage.saveParent({ ...parent, pinUnlocked: true });
		},
		async parentPinLocked() {
			const parent = await storage.readParent();
			if (!parent || parent.pinUnlocked) return false;
			try {
				return (await client.getParentPinAccess(parent.accessToken)).enabled;
			} catch {
				// Unknown PIN state keeps parent screens locked rather than open.
				return true;
			}
		},
		async unlockParent(pin) {
			const child = await storage.childToken();
			if (!child) throw new Error("No child session to unlock.");
			const response = await client.unlockParent(pin, child);
			if (!response.accessToken.startsWith("vps_")) throw new Error("Invalid parent session.");
			// The PIN was just entered, so the restored parent session starts unlocked.
			await storage.saveParent({ ...buildSession(response), pinUnlocked: true });
			window.location.hash = "#/home:parent";
			window.location.reload();
		},
		async startChildSession(profileId) {
			const parent = await parentForAction();
			if (!parent) throw new Error("Sign in again before starting child mode.");
			const response = await client.startChildSession(profileId, parent.accessToken);
			if (!response.context || !response.sessionToken.startsWith("vcs_")) {
				await storage.clearParent();
				window.location.replace("/");
				return;
			}
			try {
				await storage.saveChild(response.sessionToken);
			} finally {
				window.location.replace("/");
			}
		},
		async getChildPinAccess(profileId) {
			const parent = await parentForAction();
			if (!parent) throw new Error("A guardian must sign in to manage child access.");
			return client.getChildPinAccess(profileId, parent.accessToken);
		},
		async setChildPin(profileId, pin) {
			const parent = await parentForAction();
			if (!parent) throw new Error("A guardian must sign in to manage child access.");
			return client.setChildPin(profileId, pin, parent.accessToken);
		},
		async signInChild(loginId, pin, remember = false) {
			const previous = (await storage.childToken()) ?? (await storage.readParent())?.accessToken;
			const response = await client.signInChild(
				loginId,
				pin,
				previous && /^v[pc]s_[a-f0-9]{64}$/i.test(previous) ? previous : undefined,
			);
			if (!response.context || !response.sessionToken.startsWith("vcs_")) {
				await storage.clearParent();
				window.location.replace("/");
				return;
			}
			try {
				await storage.saveChild(response.sessionToken);
				if (remember) await storage.rememberChild(loginId, response.context.displayName);
			} finally {
				window.location.replace("/");
			}
		},
		async switchChildProfile(profileId, pin) {
			const current = await storage.childToken();
			if (!current) throw new Error("No child session to switch from.");
			const response = await client.switchChild(profileId, pin, current);
			if (!response.context || !response.sessionToken.startsWith("vcs_"))
				throw new Error("Invalid child session.");
			try {
				await storage.saveChild(response.sessionToken);
			} finally {
				window.location.replace("/");
			}
		},
		async getChildSession() {
			const token = await storage.childToken();
			if (token === null) return null;
			try {
				const context = await client.getChildSession(token);
				if (!context) throw new Error("Missing child session context.");
				return { status: "active", ...context };
			} catch {
				return {
					status: "locked",
					message: "This learning session is unavailable. Ask a guardian to sign in again.",
				};
			}
		},
		watchSessionBoundary: (onBoundary) => storage.watch(onBoundary),
		async signOut() {
			const token = (await storage.childToken()) ?? (await storage.readParent())?.accessToken;
			await storage.clearAll();
			try {
				if (token) await client.revokeSession(token);
			} finally {
				window.location.replace("/");
			}
		},
	};
}

function buildSession(response: {
	accountId: string;
	displayName: string;
	email: string;
	givenName: string;
	familyName: string;
	picture: string;
	accessToken: string;
	idToken: string;
	expiresAt?: string;
}): StoredSession {
	return {
		version: 2,
		accountId: response.accountId,
		displayName: response.displayName || displayNameFromEmail(response.email) || response.accountId,
		email: response.email || undefined,
		givenName: response.givenName || undefined,
		familyName: response.familyName || undefined,
		picture: response.picture || undefined,
		accessToken: response.accessToken,
		idToken: response.idToken,
		// Missing server expiry fails closed; provider tokens are never imported.
		expiresAt: response.expiresAt ? Date.parse(response.expiresAt) : 0,
	};
}

function displayNameFromEmail(email?: string): string | undefined {
	const localPart = email?.split("@")[0]?.trim();
	return localPart || undefined;
}

interface PendingSignIn {
	state: string;
	flowId: string;
	codeVerifier: string;
	redirectUri: string;
	/** Started from "Forgot PIN?": the new session may set a new parent PIN. */
	resetParentPin?: boolean;
}

/** Generate a PKCE code_verifier (43-128 chars, unreserved chars only). */
function generateVerifier(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return base64Url(bytes);
}

/** Compute the S256 PKCE code_challenge for a verifier. */
async function s256Challenge(verifier: string): Promise<string> {
	const data = new TextEncoder().encode(verifier);
	const digest = await crypto.subtle.digest("SHA-256", data);
	return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Map a Swavan OIDC user to a Vulture session. The `sub` claim is the stable
 * account id (the same value the server uses as the account id for
 * `CreateFamily`). The provider does not carry Vulture's parent/kid/grandparent
 * role, so the session defaults to the parent/manager landing; role mapping
 * from provider groups can be layered on later.
 */
export function signedInAccountFromSession(session: StoredSession): SignedInAccount {
	const now = new Date().toISOString();
	const familyId = `family-${session.accountId}`;
	// Prefer "First Last" from given_name + family_name, falling back to the
	// provider's display name, then the account id.
	const fullName =
		[session.givenName, session.familyName].filter(Boolean).join(" ").trim() ||
		session.displayName ||
		displayNameFromEmail(session.email) ||
		session.accountId;

	const account: AccountRecord = {
		id: session.accountId,
		displayName: fullName,
		role: "parent",
		email: session.email,
		createdAt: now,
		updatedAt: now,
	};

	const person: Person = {
		id: session.accountId,
		familyId,
		name: fullName,
		role: "manager",
		deviceId: randomUUID(),
		createdAt: now,
		picture: session.picture,
	};

	return {
		account,
		familyId,
		person,
		landingScreen: "home:parent",
	};
}
