import { describe, expect, it } from "vitest";
import {
	FAMILY_BANNER_HEIGHT,
	FAMILY_BANNER_WIDTH,
	bannerGeometry,
	cropGeometry,
	fitGeometry,
} from "./banner";

describe("fitGeometry (contain)", () => {
	it("fits a wide-ish image inside the banner, centered both ways", () => {
		// Image 2000x1000 (aspect 2) vs banner 1200x360 (aspect 3.33).
		const g = fitGeometry(2000, 1000);
		// Image is taller relative to banner, so it's height-limited.
		expect(g.dHeight).toBe(FAMILY_BANNER_HEIGHT); // 360
		expect(g.dWidth).toBeCloseTo(360 * 2); // 720
		expect(g.dx).toBeCloseTo((1200 - 720) / 2); // centered horizontally
		expect(g.dy).toBe(0);
		expect(g.sWidth).toBe(2000); // draws the whole image
		expect(g.sHeight).toBe(1000);
	});

	it("width-limits a wider-than-banner image, centered vertically", () => {
		const g = fitGeometry(4000, 1000); // aspect 4 > banner 3.33
		expect(g.dWidth).toBe(FAMILY_BANNER_WIDTH); // 1200
		expect(g.dHeight).toBeCloseTo(1200 / 4); // 300
		expect(g.dx).toBe(0);
		expect(g.dy).toBeCloseTo((360 - 300) / 2);
	});
});

describe("cropGeometry (cover)", () => {
	it("fills the canvas using a 2000x600 slice of a wide image", () => {
		const g = cropGeometry(2000, 1000);
		expect(g.dWidth).toBe(FAMILY_BANNER_WIDTH);
		expect(g.dHeight).toBe(FAMILY_BANNER_HEIGHT);
		expect(g.sWidth).toBe(2000); // whole width
		expect(g.sHeight).toBeCloseTo(600);
		expect(g.sx).toBe(0);
		expect(g.sy).toBeCloseTo((1000 - 600) / 2); // centered vertically
	});

	it("pans the source window to the top at y=0", () => {
		const g = cropGeometry(2000, 1000, 0, 0);
		expect(g.sy).toBe(0);
	});

	it("pans the source window to the bottom at y=100", () => {
		const g = cropGeometry(2000, 1000, 0, 100);
		expect(g.sy).toBeCloseTo(1000 - 600);
	});

	it("clamps out-of-range pan positions to the image bounds", () => {
		const g = cropGeometry(2000, 1000, 0, 500);
		expect(g.sy).toBeCloseTo(1000 - 600);
	});
});

describe("bannerGeometry", () => {
	it("dispatches to crop for the 'crop' fit", () => {
		const g = bannerGeometry("crop", 2000, 1000, 25, 75);
		expect(g.sWidth).toBe(2000);
		expect(g.sy).toBeGreaterThan(0);
	});

	it("dispatches to fit for the 'fit' fit (position ignored)", () => {
		const g = bannerGeometry("fit", 4000, 1000, 25, 75);
		expect(g.dWidth).toBe(FAMILY_BANNER_WIDTH);
	});
});
