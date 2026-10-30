import { beforeEach, expect, it, vi } from "vitest";
import type { OidcAuth } from "../../auth/oidc";
import { createCallAdapter } from "./callApi";
const { familyCall } = vi.hoisted(() => ({ familyCall: vi.fn() }));
vi.mock("../../repositories/nativeClient", () => ({
	createNativeClient: () => ({ familyCall }),
}));
const auth = {
	getSessionAccessToken: vi.fn(async () => "credential"),
} as unknown as OidcAuth;
beforeEach(() => {
	vi.clearAllMocks();
	familyCall.mockResolvedValue({ resultJson: '{"device":"lease"}' });
});
it("uses authenticated bounded native signaling with strict JSON commands", async () => {
	const result = await createCallAdapter("https://family.example", auth).execute({
		action: "register",
		name: "Desktop",
	});
	expect(result).toEqual({ device: "lease" });
	expect(familyCall).toHaveBeenCalledWith(
		{ commandJson: '{"action":"register","name":"Desktop"}' },
		{ headers: { authorization: "Bearer credential" }, timeoutMs: 5000 },
	);
});
it("rejects non-TLS signaling outside loopback", () => {
	expect(() => createCallAdapter("http://family.example", auth)).toThrow("HTTPS");
	expect(() => createCallAdapter("https://family.example", auth)).not.toThrow();
	expect(() => createCallAdapter("http://127.0.0.1", auth)).not.toThrow();
	expect(() => createCallAdapter("ftp://localhost", auth)).toThrow("HTTPS");
});
it("does not send a call command without a valid session", async () => {
	const missing = { getSessionAccessToken: async () => null } as unknown as OidcAuth;
	await expect(
		createCallAdapter("https://family.example", missing).execute({
			action: "register",
			name: "Desktop",
		}),
	).rejects.toThrow("Sign in");
	expect(familyCall).not.toHaveBeenCalled();
});
it("propagates transport failures and invalid server replies", async () => {
	const api = createCallAdapter("https://family.example", auth);
	familyCall.mockRejectedValueOnce(new Error("Revoked"));
	await expect(api.execute({ action: "poll", device: "lease" })).rejects.toThrow("Revoked");
	familyCall.mockResolvedValueOnce({ resultJson: "invalid" });
	await expect(api.execute({ action: "poll", device: "lease" })).rejects.toThrow();
});
