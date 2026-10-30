/** Normalize iPhone photos before either previewing or storing their bytes. */
export async function preparePhoto(file: File): Promise<File> {
	const heic =
		/\.(heic|heif)$/i.test(file.name) || /^image\/hei[cf](?:-sequence)?$/i.test(file.type);
	if (!heic) {
		if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
		return file;
	}
	try {
		const { heicTo } = await import("heic-to/csp");
		const jpeg = await heicTo({ blob: file, type: "image/jpeg", quality: 0.9 });
		if (!jpeg.size) throw new Error("Empty conversion");
		return new File([jpeg], file.name.replace(/\.[^.]+$/, "") + ".jpg", {
			type: "image/jpeg",
		});
	} catch {
		throw new Error("Could not read this HEIC photo. Try another photo or export it as JPEG.");
	}
}
