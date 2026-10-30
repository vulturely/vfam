import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionApi } from "./sessionApi";
import { NativeServerError, type ServerRepository } from "../../repositories/server";

const unary = vi.hoisted(() => vi.fn());
const server = { unary, stream: vi.fn() } as ServerRepository;

beforeEach(() => {
	vi.resetAllMocks();
	unary.mockResolvedValue({});
});

describe("createSessionApi", () => {
	it("forwards every session operation with optional bearer credentials", async () => {
		const api = createSessionApi("https://server.example", server);
		await api.getParentPinAccess("token");
		await api.setParentPin("123456", "token");
		await api.unlockParent("123456", "token");
		await api.beginParentSignIn({ redirectUri: "uri", codeChallenge: "challenge" });
		await api.exchangeAuthCode({
			code: "code",
			codeVerifier: "verifier",
			redirectUri: "uri",
			flowId: "flow",
		});
		await api.startChildSession("profile", "token");
		await api.getChildPinAccess("profile", "token");
		await api.setChildPin("profile", "123456", "token");
		await api.signInChild("login", "123456");
		await api.signInChild("login", "123456", "token");
		await api.revokeSession("token");
		await api.switchChild("sibling", "654321", "child-token");
		expect(unary).toHaveBeenLastCalledWith(
			"control",
			"SignInChild",
			{ profileId: "sibling", pin: "654321" },
			{ token: "child-token" },
		);

		expect(unary).toHaveBeenNthCalledWith(
			1,
			"control",
			"GetParentPinAccess",
			{},
			{
				token: "token",
			},
		);
		expect(unary).toHaveBeenNthCalledWith(
			4,
			"control",
			"BeginParentSignIn",
			{ redirectUri: "uri", codeChallenge: "challenge" },
			{ token: undefined },
		);
		expect(unary).toHaveBeenNthCalledWith(
			9,
			"control",
			"SignInChild",
			{ loginId: "login", pin: "123456" },
			{ token: undefined },
		);
		expect(unary).toHaveBeenNthCalledWith(
			10,
			"control",
			"SignInChild",
			{ loginId: "login", pin: "123456" },
			{ token: "token" },
		);
	});

	it("returns null only for unauthenticated parent and child sessions", async () => {
		const api = createSessionApi("https://server.example", server);
		unary.mockResolvedValueOnce({ accountId: "parent" });
		expect(await api.getParentSession("token")).toEqual({ accountId: "parent" });
		unary.mockRejectedValueOnce(new NativeServerError("unauthenticated", "expired"));
		expect(await api.getParentSession("token")).toBeNull();
		unary.mockRejectedValueOnce(new NativeServerError("unavailable", "offline"));
		await expect(api.getParentSession("token")).rejects.toThrow("offline");
		unary.mockResolvedValueOnce({ context: { profileId: "child" } });
		expect(await api.getChildSession("token")).toEqual({ profileId: "child" });
		unary.mockResolvedValueOnce({});
		expect(await api.getChildSession("token")).toBeNull();
		unary.mockRejectedValueOnce(new NativeServerError("unauthenticated", "expired"));
		expect(await api.getChildSession("token")).toBeNull();
		unary.mockRejectedValueOnce(new Error("failed"));
		await expect(api.getChildSession("token")).rejects.toThrow("failed");
	});
});
