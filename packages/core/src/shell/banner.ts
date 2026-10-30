/** Pure geometry for drawing an image into a fixed banner-sized canvas.
 *
 * These helpers have no DOM/canvas dependency so the banner crop/fit math can
 * be unit-tested directly. A geometry object maps onto the 9-arg
 * `CanvasRenderingContext2D.drawImage(image, sx, sy, sWidth, sHeight,
 * dx, dy, dWidth, dHeight)` call.
 */

export const FAMILY_BANNER_WIDTH = 1200;
export const FAMILY_BANNER_HEIGHT = 360;

export type BannerFit = "crop" | "fit";

export interface BannerGeometry {
	sx: number;
	sy: number;
	sWidth: number;
	sHeight: number;
	dx: number;
	dy: number;
	dWidth: number;
	dHeight: number;
}

/**
 * Geometry for one image into the banner canvas.
 * `banner` sizes default to the family banner dimensions.
 */
export function bannerGeometry(
	fit: BannerFit,
	imageWidth: number,
	imageHeight: number,
	positionX = 50,
	positionY = 50,
	bannerWidth = FAMILY_BANNER_WIDTH,
	bannerHeight = FAMILY_BANNER_HEIGHT,
): BannerGeometry {
	if (fit === "fit") {
		return fitGeometry(imageWidth, imageHeight, bannerWidth, bannerHeight);
	}
	return cropGeometry(imageWidth, imageHeight, positionX, positionY, bannerWidth, bannerHeight);
}

/**
 * "Fit" (contain): the whole image is drawn inside the banner, scaled down to
 * fit with the banner's aspect, centered. Letterboxes with transparent
 * background (the caller fills the banner if it wants a solid backdrop).
 */
export function fitGeometry(
	imageWidth: number,
	imageHeight: number,
	bannerWidth = FAMILY_BANNER_WIDTH,
	bannerHeight = FAMILY_BANNER_HEIGHT,
): BannerGeometry {
	const imageAspect = imageWidth / imageHeight;
	const bannerAspect = bannerWidth / bannerHeight;
	let dWidth: number;
	let dHeight: number;
	if (imageAspect > bannerAspect) {
		dWidth = bannerWidth;
		dHeight = bannerWidth / imageAspect;
	} else {
		dHeight = bannerHeight;
		dWidth = bannerHeight * imageAspect;
	}
	return {
		sx: 0,
		sy: 0,
		sWidth: imageWidth,
		sHeight: imageHeight,
		dx: (bannerWidth - dWidth) / 2,
		dy: (bannerHeight - dHeight) / 2,
		dWidth,
		dHeight,
	};
}

/**
 * "Crop" (cover): the banner window slides over the image using percentage
 * (0-100) pan controls, filling the entire canvas.
 */
export function cropGeometry(
	imageWidth: number,
	imageHeight: number,
	positionX = 50,
	positionY = 50,
	bannerWidth = FAMILY_BANNER_WIDTH,
	bannerHeight = FAMILY_BANNER_HEIGHT,
): BannerGeometry {
	const scale = Math.max(bannerWidth / imageWidth, bannerHeight / imageHeight);
	const sWidth = bannerWidth / scale;
	const sHeight = bannerHeight / scale;
	const sx = (imageWidth - sWidth) * clampPercent(positionX);
	const sy = (imageHeight - sHeight) * clampPercent(positionY);
	return {
		sx,
		sy,
		sWidth,
		sHeight,
		dx: 0,
		dy: 0,
		dWidth: bannerWidth,
		dHeight: bannerHeight,
	};
}

function clampPercent(value: number): number {
	if (Number.isNaN(value)) return 0.5;
	return Math.min(1, Math.max(0, value / 100));
}
