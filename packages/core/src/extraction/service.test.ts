import { expect, it, vi } from "vitest";
import type { SourceSegment, SourceVersion } from "../api/protocol";
import type { OidcAuth } from "../auth/oidc";
import { createExtractionService } from "./service";

const client = vi.hoisted(() => ({
	getSourceSegments: vi.fn(),
	extractHomework: vi.fn(),
	confirmSource: vi.fn(),
}));
vi.mock("../repositories/nativeClient", () => ({ createNativeClient: () => client }));
const source = { id: "source" } as SourceVersion;
const auth = { getAccessToken: vi.fn(async () => "token") } as unknown as OidcAuth;

it("loads and extracts with the caller credentials", async () => {
	const service = createExtractionService("https://server.example", auth);
	client.getSourceSegments.mockResolvedValue({ segments: [] });
	client.extractHomework.mockResolvedValue({ segments: [{}] });
	await service.load(source);
	await service.extract(source);
	expect(client.getSourceSegments.mock.calls[0][0]).toEqual({ source });
	expect(client.extractHomework.mock.calls[0][0]).toEqual({ source });
	expect(client.extractHomework.mock.calls[0][1].headers.authorization).toBe("Bearer token");
});

it("forwards correction validation to the native boundary", async () => {
	const service = createExtractionService("https://server.example", auth);
	client.confirmSource.mockRejectedValue(new Error("Correct every region"));
	await expect(service.confirm(source, [])).rejects.toThrow("Correct every region");
	await expect(service.confirm(source, [{ text: " " } as SourceSegment])).rejects.toThrow(
		"Correct every region",
	);
	client.confirmSource.mockResolvedValue({ ok: true });
	const corrections = [{ text: "corrected" } as SourceSegment];
	await service.confirm(source, corrections);
	expect(client.confirmSource).toHaveBeenCalledWith(
		{ expectedSource: source, corrections },
		expect.any(Object),
	);
});
