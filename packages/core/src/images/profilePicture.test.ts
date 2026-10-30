import { afterEach, expect, it, vi } from "vitest";
import { profilePicture } from "./profilePicture";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});
const file = (type: string, size = 4) => new File([new Uint8Array(size)], "photo", { type });

it("keeps small supported pictures when the canvas is unavailable", async () => {
	vi.stubGlobal("createImageBitmap", undefined);
	expect(await profilePicture(file("image/png"))).toEqual({
		image: new Uint8Array(4),
		contentType: "image/png",
	});
	await expect(profilePicture(file("image/gif"))).rejects.toThrow("PNG, JPEG or WebP");
	await expect(profilePicture(file("image/jpeg", 1024 * 1024 + 1))).rejects.toThrow("smaller");
	await expect(profilePicture(file("text/plain"))).rejects.toThrow("image");
});

it("shrinks pictures to WebP when the canvas can encode it", async () => {
	const close = vi.fn();
	vi.stubGlobal(
		"createImageBitmap",
		vi.fn(async () => ({ width: 2048, height: 1024, close })),
	);
	const drawImage = vi.fn();
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
		drawImage,
	} as never);
	vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((done) =>
		done(new Blob([new Uint8Array([9])], { type: "image/webp" })),
	);
	const result = await profilePicture(file("image/jpeg"));
	expect(result.contentType).toBe("image/webp");
	expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 512, 256);
	expect(close).toHaveBeenCalled();
});

it("falls back to the original when the canvas cannot help", async () => {
	const close = vi.fn();
	vi.stubGlobal(
		"createImageBitmap",
		vi.fn(async () => ({ width: 10, height: 10, close })),
	);
	const context = vi
		.spyOn(HTMLCanvasElement.prototype, "getContext")
		.mockReturnValueOnce(null)
		.mockReturnValueOnce({ drawImage: vi.fn() } as never);
	vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((done) => done(null));
	expect((await profilePicture(file("image/png"))).contentType).toBe("image/png");
	expect((await profilePicture(file("image/png"))).contentType).toBe("image/png");
	expect(context).toHaveBeenCalledTimes(2);
	vi.stubGlobal(
		"createImageBitmap",
		vi.fn(async () => Promise.reject(new Error("decode"))),
	);
	expect((await profilePicture(file("image/webp"))).contentType).toBe("image/webp");
});
