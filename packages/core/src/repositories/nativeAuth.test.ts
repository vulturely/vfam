import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	isTauri: vi.fn(),
	invoke: vi.fn(),
	listen: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("../api/ipc", () => ({ createTauriIpcClient: () => ({ invoke: mocks.invoke }) }));

import {
	isNativeApp,
	onNativeAuthCallback,
	openNativeUrl,
	startNativeAuthCallback,
} from "./nativeAuth";

describe("nativeAuth repository", () => {
	it("reports native availability", () => {
		mocks.isTauri.mockReturnValueOnce(true).mockReturnValueOnce(false);
		expect(isNativeApp()).toBe(true);
		expect(isNativeApp()).toBe(false);
	});

	it("forwards callback payloads and returns the event cleanup", async () => {
		const cleanup = vi.fn();
		const listener = vi.fn();
		mocks.listen.mockImplementation(async (_event, handler) => {
			handler({ payload: { code: "code", state: "state" } });
			return cleanup;
		});
		await expect(onNativeAuthCallback(listener)).resolves.toBe(cleanup);
		expect(mocks.listen).toHaveBeenCalledWith("vulture-auth-callback", expect.any(Function));
		expect(listener).toHaveBeenCalledWith({ code: "code", state: "state" });
	});

	it("invokes native callback and opener commands", async () => {
		mocks.invoke.mockResolvedValue("http://127.0.0.1:7793/login/callback");
		await expect(startNativeAuthCallback("token")).resolves.toContain("7793");
		await openNativeUrl("https://example.com");
		expect(mocks.invoke).toHaveBeenNthCalledWith(1, "start_auth_callback", { token: "token" });
		expect(mocks.invoke).toHaveBeenNthCalledWith(2, "plugin:opener|open_url", {
			url: "https://example.com",
		});
	});
});
