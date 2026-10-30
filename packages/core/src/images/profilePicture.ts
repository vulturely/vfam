import { preparePhoto } from "./preparePhoto";

const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 1024 * 1024;
const SIZE = 512;

/** Shrinks a chosen photo to a small square-bounded WebP the server accepts (≤1 MiB). */
export async function profilePicture(
	file: File,
): Promise<{ image: Uint8Array; contentType: string }> {
	const photo = await preparePhoto(file);
	const resized = await shrink(photo);
	if (resized) return resized;
	if (!ACCEPTED.includes(photo.type)) throw new Error("Choose a PNG, JPEG or WebP picture.");
	if (photo.size > MAX_BYTES) throw new Error("Choose a picture smaller than 1 MB.");
	return { image: new Uint8Array(await photo.arrayBuffer()), contentType: photo.type };
}

async function shrink(photo: File) {
	if (typeof createImageBitmap === "undefined") return null;
	try {
		const bitmap = await createImageBitmap(photo);
		const scale = Math.min(1, SIZE / Math.max(bitmap.width, bitmap.height));
		const canvas = document.createElement("canvas");
		canvas.width = Math.max(1, Math.round(bitmap.width * scale));
		canvas.height = Math.max(1, Math.round(bitmap.height * scale));
		const context = canvas.getContext("2d");
		if (!context) {
			bitmap.close();
			return null;
		}
		context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
		bitmap.close();
		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, "image/webp", 0.85),
		);
		if (!blob || blob.type !== "image/webp" || blob.size > MAX_BYTES) return null;
		return { image: new Uint8Array(await blob.arrayBuffer()), contentType: "image/webp" };
	} catch {
		return null;
	}
}
