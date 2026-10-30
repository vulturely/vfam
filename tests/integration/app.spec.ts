import { test, expect, seedOidcSession } from "./fixtures";
import { nativeResponse } from "./nativeRpc";

test.describe("Shell onboarding", () => {
	test.beforeEach(async ({ page }) => {
		await page.route("**/vulture.server.v1.VultureControl/ListTasks", (route) =>
			nativeResponse(route, {}),
		);
		await page.route("**/vulture.server.v1.VultureControl/ListFamilyMembers", (route) =>
			nativeResponse(route, {}),
		);
	});
	test("shows Vulture onboarding before a family exists", async ({ page }) => {
		await page.goto("/");

		await expect(page.getByRole("button", { name: "VFAM home" })).toHaveCount(0);
		await expect(page.getByRole("heading", { name: "Welcome to VFAM" })).toBeVisible();
		await expect(page.locator(".v-login-button")).toBeVisible();
		await expect(page.locator(".v-landing-sidebar")).toHaveCount(0);
		await expect(page.locator(".v-footer")).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Open menu" })).toHaveCount(0);
	});

	test("toggles between light and dark themes", async ({ page }) => {
		await page.goto("/#/about");

		await expect(page.locator("html")).toHaveAttribute("data-v-theme", "light");
		await page.getByRole("button", { name: "Switch to dark theme" }).click();
		await expect(page.locator("html")).toHaveAttribute("data-v-theme", "dark");
	});

	test("opens labeled navigation as a mobile bottom sheet", async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("/#/about");
		const trigger = page.getByRole("button", {
			name: "Open menu",
			exact: true,
		});
		await expect(trigger).toBeVisible();
		await expect(trigger).toHaveText(/Vf\s*am/);
		const menuButton = await trigger.boundingBox();
		expect(menuButton!.x + menuButton!.width / 2).toBeCloseTo(195, 0);
		await expect(page.locator(".v-landing-sidebar")).toBeHidden();
		await trigger.click();
		const menu = page.getByRole("dialog", { name: "Menu" });
		await expect
			.poll(async () =>
				Math.round((await menu.boundingBox())!.y + (await menu.boundingBox())!.height),
			)
			.toBe(828);
		const sheet = await menu.boundingBox();
		expect(sheet!.x).toBe(16);
		expect(sheet!.width).toBe(358);
		expect(sheet!.height).toBeLessThanOrEqual(844 * 0.8 + 1);
		expect(sheet!.y).toBeGreaterThan(0);
		await expect(menu.getByRole("button", { name: "Login", exact: true })).toBeVisible();
		await menu.getByRole("button", { name: "Dark mode", exact: true }).click();
		await expect(page.locator("html")).toHaveAttribute("data-v-theme", "dark");
		await expect(menu.getByRole("button", { name: "Light mode", exact: true })).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(menu).toHaveCount(0);
		await expect(trigger).toBeFocused();
		await trigger.click();
		await menu.getByRole("button", { name: "About", exact: true }).click();
		await expect(page).toHaveURL(/#\/about$/);
		await expect(menu).toHaveCount(0);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true,
		);
	});

	test("drags VFam horizontally without opening navigation", async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("/#/about");
		const trigger = page.getByRole("button", { name: "Open menu" });
		await expect(trigger.locator("svg")).toHaveCount(0);
		for (const destination of [0, 390]) {
			const bounds = (await trigger.boundingBox())!;
			await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
			await page.mouse.down();
			await page.mouse.move(destination, bounds.y + bounds.height / 2 + 20, {
				steps: 8,
			});
			await page.mouse.up();
			const moved = (await trigger.boundingBox())!;
			expect(moved.x).toBeGreaterThanOrEqual(15.5);
			expect(moved.x + moved.width).toBeLessThanOrEqual(374);
			expect(844 - moved.y - moved.height).toBeCloseTo(16, 0);
			expect(destination === 0 ? moved.x : moved.x + moved.width).toBeCloseTo(
				destination === 0 ? 16 : 374,
				0,
			);
			await expect(page.getByRole("dialog", { name: "Menu" })).toHaveCount(0);
		}
		await trigger.click();
		await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.getByRole("dialog", { name: "Menu" })).toHaveCount(0);
		await trigger.focus();
		await page.keyboard.press("Enter");
		await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(trigger).toBeFocused();
		await page.setViewportSize({ width: 320, height: 844 });
		await expect
			.poll(async () => {
				const resized = (await trigger.boundingBox())!;
				return resized.x + resized.width;
			})
			.toBeLessThanOrEqual(304);
	});

	test("shows page information at the top only on small screens", async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		for (const [route, title] of [
			["contact", "Contact"],
			["privacy", "Privacy Policy"],
			["terms", "Terms and Conditions"],
		]) {
			await page.goto(`/#/${route}`);
			const bar = page.locator(".v-info-topbar");
			await expect(bar.getByRole("heading", { name: title, exact: true })).toBeVisible();
			await expect(page.getByRole("heading", { name: title, exact: true })).toHaveCount(1);
			const bounds = (await bar.boundingBox())!;
			expect(bounds.y).toBe(0);
			if (route !== "contact") {
				const card = page.locator(".v-info .v-card");
				await expect(card).toHaveCSS("box-shadow", "none");
				await expect(card).toHaveCSS("border-top-width", "0px");
			}
		}
		await page.setViewportSize({ width: 1440, height: 1000 });
		await expect(page.locator(".v-info-topbar")).toBeHidden();
		await expect(
			page.getByRole("heading", { name: "Terms and Conditions", exact: true }),
		).toBeVisible();
		await expect(page.locator(".v-info .v-card")).not.toHaveCSS("box-shadow", "none");
	});

	test("restores a signed-in session and renders the shell", async ({ page }) => {
		await seedOidcSession(page, { name: "Alex", email: "alex@example.com" });
		await page.goto("/");

		await expect(page).toHaveURL(/#\/home:parent$/);
		await expect(page.getByRole("link", { name: "Chores", exact: true })).toHaveCount(0);
		await expect(page.getByRole("link", { name: "Family", exact: true })).toBeVisible();
		await expect(page.getByRole("link", { name: "Profile", exact: true })).toBeVisible();
	});

	test("supports logout back to onboarding", async ({ page }) => {
		await seedOidcSession(page, { name: "Morgan" });
		await page.goto("/");
		await expect(page).toHaveURL(/#\/home:parent$/);

		// Keep the test hermetic: point the provider's discovery at a fake
		// end-session endpoint that bounces back to the app root, so logout
		// doesn't land on the real (possibly running) Swavan identity provider.
		await page.route("**/.well-known/openid-configuration", (route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					issuer: "https://auth.swavan.io/auth/v1/",
					end_session_endpoint: "http://localhost:1420/",
				}),
			}),
		);

		await page.getByLabel("Account menu").click();
		// Exit only appears in the desktop app; the browser test has no native shell.
		await expect(page.getByRole("menuitem", { name: "Switch profile" })).toBeVisible();
		await expect(page.getByRole("menuitem", { name: "Exit" })).toHaveCount(0);
		await page.getByRole("menuitem", { name: "Log out" }).click();
		await expect(page.getByRole("button", { name: "VFAM home" })).toHaveCount(0);
		await expect(page.locator(".v-login-button")).toBeVisible();
	});
});

// Chore creation, editing, filtering and legacy routes are exercised in
// family-picture.spec.ts through the persisted Tasks workspace.
