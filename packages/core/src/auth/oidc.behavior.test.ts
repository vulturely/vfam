import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryLocalStateService } from "../services/storage/localState";
import { createOidcAuth, type OidcConfig } from "./oidc";
import { createSessionStorage } from "./sessionStorage";

const mocks = vi.hoisted(() => ({
	api: {
		beginParentSignIn: vi.fn(),
		exchangeAuthCode: vi.fn(),
		getParentSession: vi.fn(),
		getChildSession: vi.fn(),
		revokeSession: vi.fn(),
		startChildSession: vi.fn(),
		signInChild: vi.fn(),
		switchChild: vi.fn(),
		unlockParent: vi.fn(),
		getParentPinAccess: vi.fn(),
		setParentPin: vi.fn(),
		getChildPinAccess: vi.fn(),
		setChildPin: vi.fn(),
	},
	native: true,
	callback: undefined as
		((value: { code?: string; state?: string; error?: string }) => void) | undefined,
	unlisten: vi.fn(),
	start: vi.fn(),
	open: vi.fn(),
}));

vi.mock("../api/auth/sessionApi", () => ({ createSessionApi: () => mocks.api }));
vi.mock("../repositories/oidcDiscovery", () => ({
	loadOidcDiscovery: vi.fn(async () => ({
		authorization_endpoint: "https://auth.example/authorize",
	})),
}));
vi.mock("../repositories/nativeAuth", () => ({
	isNativeApp: () => mocks.native,
	onNativeAuthCallback: vi.fn(async (callback) => {
		mocks.callback = callback;
		return mocks.unlisten;
	}),
	startNativeAuthCallback: mocks.start,
	openNativeUrl: mocks.open,
}));

const authority = "https://auth.example";
const config: OidcConfig = {
	authority,
	clientId: "vulture",
	redirectUri: "https://app.example/callback",
	nativeRedirectUri: "https://app.example/native",
	postLogoutRedirectUri: "https://app.example",
};
let memory: ReturnType<typeof createMemoryLocalStateService>;
let storage: ReturnType<typeof createSessionStorage>;
function stored(key: string): string | null {
	const value = memory.values.get(key);
	return value === undefined ? null : typeof value === "string" ? value : JSON.stringify(value);
}
const parentGrant = {
	accountId: "parent",
	displayName: "Alex",
	email: "alex@example.com",
	givenName: "Alex",
	familyName: "Morgan",
	picture: "",
	accessToken: `vps_${"a".repeat(64)}`,
	idToken: "id",
	expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

beforeEach(() => {
	memory = createMemoryLocalStateService();
	storage = createSessionStorage(authority, config.clientId, memory.service);
	vi.clearAllMocks();
	mocks.native = true;
	mocks.callback = undefined;
	mocks.start.mockResolvedValue("http://127.0.0.1:7793/login/callback");
	mocks.api.beginParentSignIn.mockResolvedValue({
		flowId: "flow",
		nonce: "nonce",
		expiresAt: new Date(Date.now() + 60_000).toISOString(),
	});
	mocks.api.exchangeAuthCode.mockResolvedValue(parentGrant);
	mocks.api.getParentSession.mockResolvedValue(parentGrant);
	mocks.api.revokeSession.mockResolvedValue(undefined);
	vi.stubGlobal("window", {
		location: {
			replace: vi.fn(),
			assign: vi.fn(),
			reload: vi.fn(),
			hash: "",
			href: "",
		},
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

it("completes native OIDC with PKCE and exchanges the callback through the session API", async () => {
	mocks.open.mockImplementation(async (url: string) => {
		const state = new URL(url).searchParams.get("state")!;
		mocks.callback?.({ code: "code", state });
	});
	const auth = createOidcAuth(config, "https://server.example", memory.service);
	await auth.signIn();
	expect(mocks.api.beginParentSignIn).toHaveBeenCalledWith({
		redirectUri: config.nativeRedirectUri,
		codeChallenge: expect.any(String),
	});
	expect(mocks.api.exchangeAuthCode).toHaveBeenCalledWith(
		expect.objectContaining({ code: "code", flowId: "flow", codeVerifier: expect.any(String) }),
	);
	expect(mocks.unlisten).toHaveBeenCalledOnce();
	expect(stored(storage.parentKey)).toContain(parentGrant.accessToken);
	expect((await auth.getUser())?.person.name).toBe("Alex Morgan");
});

it("rejects callback state mismatches and missing callback parameters", async () => {
	const auth = createOidcAuth(config, "https://server.example", memory.service);
	memory.values.set(storage.pendingKey, {
		state: "expected",
		flowId: "flow",
		codeVerifier: "verifier",
		redirectUri: config.redirectUri,
	});
	window.location.href = "https://app.example/login/callback?code=code&state=wrong";
	await expect(auth.handleCallback()).rejects.toThrow("state mismatch");
	window.location.href = "https://app.example/login/callback";
	await expect(auth.handleCallback()).rejects.toThrow("Missing authorization code or state");
	window.location.href = "https://app.example/login/callback?code=code&state=expected";
	expect((await auth.handleCallback()).account.id).toBe("parent");
	// An ordinary sign-in still asks for the parent PIN on a shared device.
	expect(await storage.readParent()).toMatchObject({ pinUnlocked: false });
});

it("treats a sign-in from child mode as the forgotten parent PIN recovery", async () => {
	const auth = createOidcAuth(config, "https://server.example", memory.service);
	memory.values.set(storage.childKey, { token: `vcs_${"c".repeat(64)}` });
	memory.values.set(storage.pendingKey, {
		state: "expected",
		flowId: "flow",
		codeVerifier: "verifier",
		redirectUri: config.redirectUri,
	});
	window.location.href = "https://app.example/login/callback?code=code&state=expected";
	await auth.handleCallback();
	expect(mocks.api.exchangeAuthCode).toHaveBeenCalledWith(
		expect.objectContaining({ childSessionToken: `vcs_${"c".repeat(64)}` }),
	);
	expect(await storage.readParent()).toMatchObject({ pinUnlocked: true });
});

it("validates and revokes parent sessions while clearing every credential", async () => {
	const auth = createOidcAuth(config, "https://server.example", memory.service);
	await storage.saveParent({
		accountId: "parent",
		displayName: "Alex",
		accessToken: parentGrant.accessToken,
		idToken: "id",
		expiresAt: Date.now() + 60_000,
	});
	expect(await auth.getAccessToken()).toBe(parentGrant.accessToken);
	expect((await auth.getUser())?.familyId).toBe("family-parent");
	await auth.signOut();
	expect(mocks.api.revokeSession).toHaveBeenCalledWith(parentGrant.accessToken);
	expect(stored(storage.parentKey)).toBeNull();
	expect(window.location.replace).toHaveBeenCalledWith("/");
});

it("keeps child sessions separate and remembers explicit child sign-in", async () => {
	const context = {
		profileId: "child",
		familyId: "family",
		displayName: "Jamie",
		expiresAt: new Date(Date.now() + 60_000).toISOString(),
	};
	mocks.api.signInChild.mockResolvedValue({ sessionToken: `vcs_${"b".repeat(64)}`, context });
	mocks.api.getChildSession.mockResolvedValue(context);
	const auth = createOidcAuth(config, "https://server.example", memory.service);
	await auth.signInChild("jamie", "123456", true);
	expect(mocks.api.signInChild).toHaveBeenCalledWith("jamie", "123456", undefined);
	expect(await auth.getChildAccessToken()).toBe(`vcs_${"b".repeat(64)}`);
	expect(await auth.getChildSession()).toMatchObject({ status: "active", displayName: "Jamie" });
	expect(stored(storage.rememberedKey)).toContain("Jamie");
	mocks.api.getChildSession.mockResolvedValue(null);
	expect(await auth.getChildSession()).toMatchObject({ status: "locked" });
	await auth.signOut();
	expect(mocks.api.revokeSession).toHaveBeenCalledWith(`vcs_${"b".repeat(64)}`);
});

it("switches a child session to a sibling and rejects invalid grants", async () => {
	const auth = createOidcAuth(config, "https://server.example", memory.service);
	await expect(auth.switchChildProfile("sibling", "654321")).rejects.toThrow("No child session");
	const current = `vcs_${"b".repeat(64)}`;
	await storage.saveChild(current);
	mocks.api.switchChild.mockResolvedValueOnce({ sessionToken: "invalid" });
	await expect(auth.switchChildProfile("sibling", "654321")).rejects.toThrow(
		"Invalid child session",
	);
	expect(await auth.getChildAccessToken()).toBe(current);
	const next = `vcs_${"c".repeat(64)}`;
	mocks.api.switchChild.mockResolvedValueOnce({
		sessionToken: next,
		context: { profileId: "sibling", familyId: "family", displayName: "Sam", expiresAt: "" },
	});
	await auth.switchChildProfile("sibling", "654321");
	expect(mocks.api.switchChild).toHaveBeenLastCalledWith("sibling", "654321", current);
	expect(await auth.getChildAccessToken()).toBe(next);
	expect(window.location.replace).toHaveBeenCalledWith("/");
});

it("rejects invalid child and parent session transitions", async () => {
	const auth = createOidcAuth(config, "https://server.example", memory.service);
	await expect(auth.unlockParent("123456")).rejects.toThrow("No child session to unlock");
	await storage.saveChild(`vcs_${"b".repeat(64)}`);
	mocks.api.unlockParent.mockResolvedValue({ ...parentGrant, accessToken: "invalid" });
	await expect(auth.unlockParent("123456")).rejects.toThrow("Invalid parent session");
	mocks.api.startChildSession.mockResolvedValue({ sessionToken: "invalid" });
	await storage.saveParent({
		accountId: "parent",
		displayName: "Alex",
		accessToken: parentGrant.accessToken,
		idToken: "id",
		expiresAt: Date.now() + 60_000,
	});
	await auth.startChildSession("child");
	expect(stored(storage.parentKey)).toBeNull();
	expect(window.location.replace).toHaveBeenCalledWith("/");
});

it("launches browser OIDC with default scopes and validates native callback configuration", async () => {
	mocks.native = false;
	const auth = createOidcAuth(config, "https://server.example", memory.service);
	await auth.signIn();
	expect(window.location.assign).toHaveBeenCalledWith(
		expect.stringContaining("scope=openid+profile+email"),
	);
	mocks.native = true;
	const missingCallback = createOidcAuth(
		{ ...config, nativeRedirectUri: undefined },
		"https://server.example",
		memory.service,
	);
	await expect(missingCallback.signIn()).rejects.toThrow("callback is not configured");
});

it("surfaces native callback errors and incomplete responses", async () => {
	mocks.open.mockImplementation(async () => mocks.callback?.({ error: "access_denied" }));
	await expect(
		createOidcAuth(config, "https://server.example", memory.service).signIn(),
	).rejects.toThrow("access_denied");
	expect(mocks.unlisten).toHaveBeenCalled();
	mocks.open.mockImplementation(async () => mocks.callback?.({ code: "code" }));
	await expect(
		createOidcAuth(config, "https://server.example", memory.service).signIn(),
	).rejects.toThrow("callback was incomplete");
});

it("clears credentials when revocation fails and enforces PIN guardian guards", async () => {
	const auth = createOidcAuth(config, "https://server.example", memory.service);
	await expect(auth.getParentPinAccess()).rejects.toThrow("Sign in to manage your parent PIN");
	await expect(auth.setParentPin("123456")).rejects.toThrow("Sign in to manage your parent PIN");
	await expect(auth.getChildPinAccess("child")).rejects.toThrow("guardian must sign in");
	await expect(auth.setChildPin("child", "123456")).rejects.toThrow("guardian must sign in");
	await storage.saveParent({
		accountId: "parent",
		displayName: "Alex",
		accessToken: parentGrant.accessToken,
		idToken: "id",
		expiresAt: Date.now() + 60_000,
	});
	mocks.api.getParentPinAccess.mockResolvedValue({ configured: true });
	expect(await auth.getParentPinAccess()).toEqual({ configured: true });
	mocks.api.getChildPinAccess.mockResolvedValue({ configured: false });
	expect(await auth.getChildPinAccess("child")).toEqual({ configured: false });
	mocks.api.revokeSession.mockRejectedValue(new Error("offline"));
	await expect(auth.signOut()).rejects.toThrow("offline");
	expect(stored(storage.parentKey)).toBeNull();
	expect(window.location.replace).toHaveBeenCalledWith("/");
});

it("clears invalid child transitions and does not remember an opt-out child sign-in", async () => {
	await storage.saveParent({
		accountId: "parent",
		displayName: "Alex",
		accessToken: parentGrant.accessToken,
		idToken: "id",
		expiresAt: Date.now() + 60_000,
	});
	mocks.api.startChildSession.mockResolvedValue({
		sessionToken: `vcs_${"b".repeat(64)}`,
		context: null,
	});
	await createOidcAuth(config, "https://server.example", memory.service).startChildSession("child");
	expect(stored(storage.parentKey)).toBeNull();
	expect(window.location.replace).toHaveBeenCalledWith("/");
	mocks.api.signInChild.mockResolvedValue({
		sessionToken: `vcs_${"b".repeat(64)}`,
		context: null,
	});
	const auth = createOidcAuth(config, "https://server.example", memory.service);
	await auth.signInChild("child", "123456", false);
	expect(await auth.getChildSession()).toBeNull();
	expect(stored(storage.rememberedKey)).toBeNull();
});

it("shares one callback listener and flow across concurrent sign-in attempts", async () => {
	let begin!: (value: { flowId: string; nonce: string; expiresAt: string }) => void;
	mocks.api.beginParentSignIn.mockReturnValue(
		new Promise((resolve) => {
			begin = resolve;
		}),
	);
	mocks.open.mockImplementation(async (url: string) => {
		const state = new URL(url).searchParams.get("state")!;
		mocks.callback?.({ code: "code", state });
	});
	const auth = createOidcAuth(config, "https://server.example", memory.service);
	const first = auth.signIn();
	const second = auth.signIn();
	await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
	expect(mocks.api.beginParentSignIn).toHaveBeenCalledOnce();
	begin({ flowId: "flow", nonce: "nonce", expiresAt: new Date(Date.now() + 60_000).toISOString() });
	await Promise.all([first, second]);
	expect(mocks.start).toHaveBeenCalledOnce();
	expect(mocks.api.beginParentSignIn).toHaveBeenCalledOnce();
	expect(mocks.open).toHaveBeenCalledOnce();
	expect(mocks.unlisten).toHaveBeenCalledOnce();
});

it("restarts a desktop sign-in that is waiting on the browser instead of joining it", async () => {
	mocks.api.beginParentSignIn
		.mockResolvedValueOnce({
			flowId: "first-flow",
			nonce: "nonce",
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
		})
		.mockResolvedValueOnce({
			flowId: "second-flow",
			nonce: "nonce",
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
		});
	mocks.open.mockResolvedValueOnce(undefined).mockImplementationOnce(async (url: string) => {
		const state = new URL(url).searchParams.get("state")!;
		mocks.callback?.({ code: "code", state });
	});
	const auth = createOidcAuth(config, "https://server.example", memory.service);
	const first = auth.signIn();
	await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledOnce());
	await new Promise((resolve) => setTimeout(resolve, 0));
	const second = auth.signIn();
	await Promise.all([first, second]);
	expect(mocks.start).toHaveBeenCalledTimes(2);
	expect(mocks.open).toHaveBeenCalledTimes(2);
	expect(mocks.unlisten).toHaveBeenCalledTimes(2);
	expect(mocks.api.exchangeAuthCode).toHaveBeenCalledOnce();
	expect(mocks.api.exchangeAuthCode).toHaveBeenCalledWith(
		expect.objectContaining({ code: "code", flowId: "second-flow" }),
	);
	expect(await storage.readParent()).toMatchObject({ accountId: "parent" });
});

it("starts a fresh desktop sign-in after the previous one completes", async () => {
	mocks.open.mockImplementation(async (url: string) => {
		const state = new URL(url).searchParams.get("state")!;
		mocks.callback?.({ code: "code", state });
	});
	const auth = createOidcAuth(config, "https://server.example", memory.service);
	await auth.signIn();
	await auth.signIn();
	expect(mocks.start).toHaveBeenCalledTimes(2);
	expect(mocks.api.exchangeAuthCode).toHaveBeenCalledTimes(2);
});

it("marks a sign-in started from Forgot PIN so the new session can set a new PIN", async () => {
	const auth = createOidcAuth(config, "https://server.example", memory.service);
	memory.values.set(storage.pendingKey, {
		state: "expected",
		flowId: "flow",
		codeVerifier: "verifier",
		redirectUri: config.redirectUri,
		resetParentPin: true,
	});
	window.location.href = "https://app.example/login/callback?code=code&state=expected";
	await auth.handleCallback();
	expect(await storage.readParent()).toMatchObject({ pinReset: true, pinUnlocked: false });
	await expect(auth.parentPinResetPending()).resolves.toBe(true);
});

it("opens sign-in when the server rejects the stored parent session", async () => {
	const auth = createOidcAuth(config, "https://server.example", memory.service);
	await storage.saveParent({
		accountId: "parent",
		displayName: "Alex",
		accessToken: parentGrant.accessToken,
		idToken: "id",
		expiresAt: Date.now() + 60_000,
	});
	mocks.api.getParentSession.mockResolvedValue(null);
	window.location.hash = "#/home:parent";
	expect(await auth.getUser()).toBeNull();
	expect(stored(storage.parentKey)).toBeNull();
	expect(window.location.replace).toHaveBeenCalledWith("/");
	// Already on the sign-in page: no extra reload.
	vi.mocked(window.location.replace).mockClear();
	window.location.hash = "";
	Object.assign(window.location, { pathname: "/" });
	await storage.saveParent({
		accountId: "parent",
		displayName: "Alex",
		accessToken: parentGrant.accessToken,
		idToken: "id",
		expiresAt: Date.now() + 60_000,
	});
	expect(await auth.getUser()).toBeNull();
	expect(window.location.replace).not.toHaveBeenCalled();
});
