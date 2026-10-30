import { test, expect, seedOidcSession } from "./fixtures";
import { nativeResponse } from "./nativeRpc";

test.beforeEach(async ({ page }) => {
	await page.route("**/vulture.server.v1.VultureControl/*", (route) => {
		const method = route.request().url().split("/").at(-1);
		if (
			["GetParentSession", "GetAccountSetup", "GetMyFamily", "RevokeSession"].includes(method ?? "")
		)
			return route.fallback();
		return nativeResponse(route);
	});
});

for (const width of [390, 1280]) {
	test(`FamBuddy setup belongs to the Vulture shell at ${width}px`, async ({ page }, info) => {
		await page.setViewportSize({ width, height: 844 });
		await seedOidcSession(page);
		await page.goto("/");
		await expect(page.getByRole("heading", { name: "Your household, at a glance." })).toBeVisible({
			timeout: 30000,
		});
		if (width < 600) await page.getByRole("button", { name: "Open menu" }).click();
		await page
			.getByRole(width < 600 ? "button" : "link", {
				name: "FamBuddy",
				exact: true,
			})
			.click();
		await expect(page.getByRole("heading", { name: "FamBuddy", exact: true })).toBeVisible({
			timeout: 30000,
		});
		await page.getByRole("button", { name: "Home-network pairing" }).click();
		await expect(page.getByRole("heading", { name: "Connect a FamBuddy" })).toBeVisible({
			timeout: 30000,
		});
		await expect(page.getByLabel("Device address")).toHaveValue("https://fambuddy.local:5443");
		await expect(page.getByRole("button", { name: "Check device" })).toBeDisabled();
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
		).toBeTruthy();
		if (width < 600) await expect(page.getByRole("dialog", { name: "Menu" })).toBeHidden();
		await page.screenshot({
			path: `/private/tmp/fambuddy-${info.project.name}-${width}.png`,
			fullPage: true,
		});
		// Pairing lives in a sheet opened from the header, not on the page.
		const sheet = page.getByRole("dialog", { name: "Connect a FamBuddy" });
		const box = (await sheet.boundingBox())!;
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(width);
		await expect(page.getByText("Existing home-network pairing")).toHaveCount(0);
		await page.keyboard.press("Escape");
		await expect(sheet).toHaveCount(0);
		await expect(page.getByLabel("Device address")).toHaveCount(0);
	});
}
