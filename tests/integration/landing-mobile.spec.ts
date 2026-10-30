import { test, expect } from "./fixtures";

for (const [width, height] of [
	[320, 568],
	[390, 844],
	[760, 390],
	[1440, 900],
]) {
	test(`landing fits ${width}x${height} and enlarged text`, async ({ page }, testInfo) => {
		await page.setViewportSize({ width, height });
		await page.goto("/");
		const heading = page.getByRole("heading", { name: "Welcome to VFAM" });
		await expect(heading).toBeVisible();
		const card = page.locator(".v-hero .v-card");
		const logo = page.locator(".v-login-logo");
		const body = page.locator(".v-login-body");
		const login = card.getByRole("button", { name: "Login", exact: true });
		await expect(logo).toBeVisible();
		await expect(login).toBeEnabled();
		const [heroBox, cardBox, logoBox, bodyBox] = await Promise.all([
			page.locator(".v-hero").boundingBox(),
			card.boundingBox(),
			logo.boundingBox(),
			body.boundingBox(),
		]);
		expect(cardBox!.x + cardBox!.width / 2).toBeCloseTo(heroBox!.x + heroBox!.width / 2, 0);
		expect(logoBox!.y + logoBox!.height).toBeLessThanOrEqual(bodyBox!.y);
		const loginBox = await login.boundingBox();
		expect(loginBox!.width).toBeLessThan(bodyBox!.width);
		const fits = async () => {
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
				width,
			);
			for (const node of await page
				.locator(".v-hero, .v-hero .v-card, .v-login-body, .v-login-button, h1")
				.all()) {
				const rect = (await node.boundingBox())!;
				expect(rect.x).toBeGreaterThanOrEqual(0);
				expect(rect.x + rect.width).toBeLessThanOrEqual(width + 1);
				expect(await node.evaluate((n) => n.scrollWidth <= n.clientWidth + 1)).toBe(true);
			}
		};
		await fits();
		await page.screenshot({
			path: `artifacts/landing-responsive-${width}-${testInfo.project.name}.png`,
			fullPage: true,
		});
		await page.evaluate(() => (document.documentElement.style.fontSize = "24px"));
		await fits();
		await expect(page.locator(".v-landing-sidebar")).toHaveCount(0);
		await expect(page.locator(".v-footer")).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Open menu", exact: true })).toHaveCount(0);
	});
}
