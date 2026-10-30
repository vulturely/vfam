import { afterEach, expect, it, vi } from "vitest";
import { preparePhoto } from "./preparePhoto";
const convert = vi.hoisted(() => vi.fn());
vi.mock("heic-to/csp", () => ({ heicTo: convert }));
afterEach(() => vi.resetAllMocks());
it("leaves ordinary images untouched", async () => {
	const photo = new File(["png"], "family.png", { type: "image/png" });
	expect(await preparePhoto(photo)).toBe(photo);
	expect(convert).not.toHaveBeenCalled();
});
it.each([
	["family.HEIC", ""],
	["family.heif", "application/octet-stream"],
	["photo", "image/heic"],
	["photo", "image/heif-sequence"],
])("converts %s (%s) to JPEG bytes and MIME type", async (name, type) => {
	const photo = new File(["heic"], name, { type });
	convert.mockResolvedValue(new Blob(["jpeg"], { type: "image/jpeg" }));
	const result = await preparePhoto(photo);
	expect(result.type).toBe("image/jpeg");
	expect(result.name).toMatch(/\.jpg$/);
	expect(result.size).toBe(4);
	expect(convert).toHaveBeenCalledWith({
		blob: photo,
		type: "image/jpeg",
		quality: 0.9,
	});
});
it("reports conversion failures and empty output instead of returning a broken preview", async () => {
	const photo = new File(["corrupt"], "bad.heic");
	convert.mockRejectedValueOnce(new Error("decoder failure"));
	await expect(preparePhoto(photo)).rejects.toThrow("Could not read this HEIC photo");
	convert.mockResolvedValueOnce(new Blob([]));
	await expect(preparePhoto(photo)).rejects.toThrow("Could not read this HEIC photo");
});
it("rejects non-image files", async () => {
	await expect(
		preparePhoto(new File(["text"], "notes.txt", { type: "text/plain" })),
	).rejects.toThrow("Choose an image file");
	expect(convert).not.toHaveBeenCalled();
});
