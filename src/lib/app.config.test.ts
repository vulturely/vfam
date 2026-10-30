import { afterEach, expect, it, vi } from "vitest";
import { appConfig } from "./app.config";

afterEach(() => {
	vi.unstubAllEnvs();
});

it("connects to the configured Vulture service by default", () => {
	expect(appConfig.serverUrl).toBe("https://vulture.swavan.com");
});

it("uses the direct loopback listener for the desktop callback", () => {
	expect(appConfig.oidc.nativeRedirectUri).toBe("http://127.0.0.1:7793/login/callback");
});

it("prefers the server URL from the environment", async () => {
	vi.stubEnv("VITE_SERVER_URL", "https://localhost:50051");
	vi.resetModules();
	const configured = await import("./app.config");
	expect(configured.appConfig.serverUrl).toBe("https://localhost:50051");
});
