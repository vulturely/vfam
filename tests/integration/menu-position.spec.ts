import { nativeResponse } from "./nativeRpc";
import { test, seedOidcSession, expect } from "./fixtures";

test.beforeEach(async ({ page }) => {
	await page.route("**/vulture.server.v1.VultureControl/*", (route) => {
		const method = route.request().url().split("/").at(-1);
		if (
			["GetParentSession", "GetAccountSetup", "GetMyFamily", "RevokeSession"].includes(method || "")
		)
			return route.fallback();
		return nativeResponse(route);
	});
});

test("VFam stays at bottom center across mobile routes and scrolling", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await seedOidcSession(page);
	await page.goto("/");
	const trigger = page.getByRole("button", { name: "Open menu" });
	await expect(trigger).toBeVisible();
	for (const screen of ["home:parent", "profile", "chat", "calls", "family:manage"]) {
		await page.evaluate((route) => {
			location.hash = `/${route}`;
		}, screen);
		await expect(page).toHaveURL(new RegExp(`#/${screen}$`));
		for (const scroll of [0, 10000]) {
			await page.evaluate((y) => window.scrollTo(0, y), scroll);
			const bounds = await trigger.boundingBox();
			expect(bounds!.x + bounds!.width / 2).toBeCloseTo(195, 0);
			expect(844 - bounds!.y - bounds!.height).toBeCloseTo(16, 0);
		}
	}
});

for (const width of [820, 1440]) {
	test(`public pages keep content beside the centered rail at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 1000 });
		for (const route of ["", "contact", "privacy", "terms"]) {
			await page.goto(`/#/${route}`);
			const rail = page.getByRole("complementary", {
				name: "Landing navigation",
			});
			if (route === "") {
				await expect(rail).toHaveCount(0);
				await expect(page.locator(".v-login-button")).toBeVisible();
				continue;
			}
			await expect(rail).toBeVisible();
			const content = page.locator(".v-landing-content");
			const railBox = (await rail.boundingBox())!;
			const contentBox = (await content.boundingBox())!;
			expect(railBox.x).toBe(0);
			expect(railBox.y).toBeCloseTo(16, 0);
			expect(railBox.height).toBeCloseTo(968, 0);
			expect(Math.abs(railBox.y + railBox.height / 2 - 500)).toBeLessThan(1);
			expect(contentBox.x).toBeGreaterThanOrEqual(railBox.width);
			expect(contentBox.width).toBeGreaterThan(width * 0.7);
			await page.evaluate(() => window.scrollTo(0, 10000));
			const scrolledRail = (await rail.boundingBox())!;
			expect(Math.abs(scrolledRail.y + scrolledRail.height / 2 - 500)).toBeLessThan(1);
		}
	});
}

for (const width of [820, 1440]) {
	test(`app rail stays fixed across routes and scrolling at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 1000 });
		await seedOidcSession(page);
		await page.goto("/");
		const rail = page.locator(".v-sidebar");
		await expect(rail).toBeVisible();
		const initial = (await rail.boundingBox())!;
		expect(initial.y).toBeCloseTo(16, 0);
		expect(initial.height).toBeCloseTo(968, 0);
		await expect(rail).toHaveCSS("position", "fixed");
		for (const route of [
			"home:parent",
			"profile",
			"learning:profiles",
			"chores:list",
			"family:manage",
		]) {
			await page.evaluate((screen) => {
				location.hash = `/${screen}`;
			}, route);
			await expect(page).toHaveURL(new RegExp(`#/${route}$`));
			for (const scroll of [0, 10000]) {
				await page.evaluate((y) => {
					window.scrollTo(0, y);
					document.querySelector(".v-content")?.scrollTo(0, y);
				}, scroll);
				const bounds = (await rail.boundingBox())!;
				expect(bounds.x).toBe(0);
				expect(bounds.y).toBeCloseTo(initial.y, 0);
				expect(Math.abs(bounds.y + bounds.height / 2 - 500)).toBeLessThan(1);
			}
		}
	});
}
