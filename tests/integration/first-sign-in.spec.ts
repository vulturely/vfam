import { test, expect, seedOidcSession } from "./fixtures";
import { nativeResponse } from "./nativeRpc";
import type { Page } from "@playwright/test";
import { AccountRole } from "../../packages/core/src/api/protocol";
async function firstAccount(page: Page) {
	let setup = {};
	let family: { id: string; name: string } | undefined;
	const commands: unknown[] = [];
	await page.route("**/vulture.server.v1.VultureControl/*", async (route) => {
		if (route.request().method() === "OPTIONS") return nativeResponse(route);
		const method = route.request().url().split("/").at(-1);
		const input = route.request().postDataJSON();
		switch (method) {
			case "GetAccountSetup":
				return nativeResponse(route, setup);
			case "UpdateAccountSetup": {
				commands.push(input);
				setup = {
					role: input.role,
					dobConfirmed: input.role === AccountRole.PARENT,
					completed: input.complete,
				};
				return nativeResponse(route, setup);
			}
			case "GetMyFamily":
				return nativeResponse(route, { family });
			case "CreateFamily": {
				family = {
					id: "00000000-0000-0000-0000-000000000010",
					name: input.name,
				};
				return nativeResponse(route, { family });
			}
			case "FamilyResources": {
				commands.push(JSON.parse(input.commandJson));
				return nativeResponse(route, {
					resultJson: JSON.stringify({
						storage: null,
						storage_secret_set: false,
						platform_paid: false,
					}),
				});
			}
			case "ListLearningProfiles":
			case "ListTasks":
			case "ListFamilyMembers":
				return nativeResponse(route, {});
			default:
				return nativeResponse(route, undefined, 12);
		}
	});
	await seedOidcSession(page, { name: "Alex", mockAccountSetup: false });
	return commands;
}
async function settled(page: Page) {
	await expect(page.locator(".qa-card")).toHaveCount(1);
	await expect(page.locator(".qa-card:not([inert])")).toHaveCSS("transform", "none");
}
for (const width of [390, 1440]) {
	test(`first sign-in is a focused card flow at ${width}px`, async ({ page }, testInfo) => {
		await page.setViewportSize({ width, height: 900 });
		const commands = await firstAccount(page);
		await page.goto("/");
		await expect(page.getByRole("heading", { name: "Who is this account for?" })).toBeVisible();
		await settled(page);
		await expect(page.getByRole("navigation")).toHaveCount(0);
		await expect(page.getByRole("banner")).toHaveCount(0);
		await page.screenshot({
			path: `artifacts/first-sign-in-role-${width}-${testInfo.project.name}.png`,
			fullPage: true,
		});
		await page.getByRole("button", { name: "I'm a parent" }).click();
		await expect
			.poll(() =>
				page
					.locator(".qa-card")
					.evaluateAll((cards) => cards.some((card) => card.getAnimations().length > 0)),
			)
			.toBe(true);
		await settled(page);
		await page.screenshot({
			path: `artifacts/first-sign-in-dob-${width}-${testInfo.project.name}.png`,
			fullPage: true,
		});
		await page.getByLabel("Date of birth").fill("1990-01-01");
		await page.getByRole("button", { name: "Continue", exact: true }).click();
		await expect(page.getByRole("heading", { name: "Bring your own AI provider?" })).toBeVisible();
		await settled(page);
		await page.screenshot({
			path: `artifacts/first-sign-in-ai-choice-${width}-${testInfo.project.name}.png`,
			fullPage: true,
		});
		await page.getByRole("button", { name: "Yes, connect my provider" }).click();
		await page.getByLabel("Model", { exact: true }).fill("model-id");
		await page.getByRole("button", { name: "Next", exact: true }).click();
		await page.getByLabel("API key", { exact: true }).fill("test-key");
		await settled(page);
		await page.screenshot({
			path: `artifacts/first-sign-in-provider-${width}-${testInfo.project.name}.png`,
			fullPage: true,
		});
		await page.getByRole("button", { name: "Connect & continue" }).click();
		await expect(page.getByRole("heading", { name: "Your household, at a glance." })).toBeVisible();
		expect(commands).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					role: AccountRole.PARENT,
					dateOfBirth: "1990-01-01",
				}),
			]),
		);
		// The provider is saved on this device; Vulture never receives the key.
		expect(JSON.stringify(commands)).not.toContain("test-key");
		expect(commands).not.toContainEqual(expect.objectContaining({ type: "save_ai" }));
		const device = await page.evaluate(() =>
			window.__nativeFallback("family_ai_settings", {
				input: {
					serverUrl: "https://vulture.swavan.com",
					familyId: "00000000-0000-0000-0000-000000000010",
					action: "status",
				},
			}),
		);
		expect(device).toEqual({
			configured: true,
			provider: "openai",
			model: "model-id",
			endpoint: null,
		});
		expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("test-key");
		await page.reload();
		await expect(page.getByRole("heading", { name: "Who is this account for?" })).toHaveCount(0);
	});
}
test("kid selection stays in parent-add instructions even on a direct dashboard link", async ({
	page,
}, testInfo) => {
	await firstAccount(page);
	await page.goto("/");
	await page.getByRole("button", { name: "I'm a kid" }).click();
	await expect(page.getByRole("heading", { name: "Ask your parent to add you." })).toBeVisible();
	await settled(page);
	await page.screenshot({
		path: `artifacts/first-sign-in-kid-${testInfo.project.name}.png`,
		fullPage: true,
	});
	await page.goto("/#/home:parent");
	await expect(page.getByRole("heading", { name: "Ask your parent to add you." })).toBeVisible();
	await expect(page.getByRole("navigation")).toHaveCount(0);
	await expect(page.getByRole("button", { name: "I'm a parent" })).toHaveCount(0);
});
test("parent can skip AI with reduced motion and resume after DOB confirmation", async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	const commands = await firstAccount(page);
	await page.goto("/");
	await page.getByRole("button", { name: "I'm a parent" }).click();
	const dob = page.getByLabel("Date of birth");
	await dob.fill("2020-01-01");
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await expect(dob).toBeVisible();
	expect(commands).toHaveLength(0);
	await dob.fill("1990-01-01");
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await expect(page.getByRole("button", { name: "Not now" })).toBeVisible();
	await page.reload();
	await expect(page.getByRole("heading", { name: "Bring your own AI provider?" })).toBeVisible();
	await page.getByRole("button", { name: "Not now" }).click();
	await expect(page.getByRole("heading", { name: "Your household, at a glance." })).toBeVisible();
	expect(commands.some((command) => (command as { type?: string }).type === "save_ai")).toBe(false);
});

test.use({ video: { mode: "on", size: { width: 1440, height: 900 } } });

test.describe("experience recording", () => {
	test("parent setup walkthrough", async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== "chromium", "Walkthrough is recorded once in Chromium.");
		await page.setViewportSize({ width: 1440, height: 900 });
		await firstAccount(page);
		await page.goto("/");
		await settled(page);
		// Deliberate pauses make the recorded experience readable; acceptance tests above use state assertions.
		await page.waitForTimeout(1300);
		await page.getByRole("button", { name: "I'm a parent" }).click();
		await settled(page);
		await page.waitForTimeout(1000);
		await page.getByLabel("Date of birth").fill("1990-01-01");
		await page.waitForTimeout(700);
		await page.getByRole("button", { name: "Continue", exact: true }).click();
		await settled(page);
		await page.waitForTimeout(1300);
		await page.getByRole("button", { name: "Yes, connect my provider" }).click();
		await settled(page);
		await page.waitForTimeout(1000);
		await page.getByLabel("Model", { exact: true }).fill("example-model");
		await page.waitForTimeout(600);
		await page.getByRole("button", { name: "Next", exact: true }).click();
		await settled(page);
		await page.waitForTimeout(1000);
		await page.getByLabel("API key", { exact: true }).fill("demo-api-key");
		await page.waitForTimeout(700);
		await page.getByRole("button", { name: "Connect & continue" }).click();
		await expect(page.getByRole("heading", { name: "Your household, at a glance." })).toBeVisible();
		await page.waitForTimeout(900);
		const video = page.video();
		expect(video).not.toBeNull();
		await page.context().close();
		await video!.saveAs("artifacts/first-sign-in-parent.webm");
	});
	test("kid setup walkthrough", async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== "chromium", "Walkthrough is recorded once in Chromium.");
		await page.setViewportSize({ width: 1440, height: 900 });
		await firstAccount(page);
		await page.goto("/");
		await settled(page);
		await page.waitForTimeout(1300);
		await page.getByRole("button", { name: "I'm a kid" }).click();
		await expect(page.getByRole("heading", { name: "Ask your parent to add you." })).toBeVisible();
		await settled(page);
		await page.waitForTimeout(2200);
		const video = page.video();
		expect(video).not.toBeNull();
		await page.context().close();
		await video!.saveAs("artifacts/first-sign-in-kid.webm");
	});
});
