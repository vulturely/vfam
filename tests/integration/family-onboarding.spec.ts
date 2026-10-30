import { test, expect, seedOidcSession, readNativeState } from "./fixtures";
import { nativeResponse } from "./nativeRpc";
import type { Page } from "@playwright/test";
import {
	AccountRole,
	LearningProfile,
	LearningAgeBand,
} from "../../packages/core/src/api/protocol";
const loginId = "11111111-1111-4111-8111-111111111111";
const familyId = "00000000-0000-0000-0000-000000000010";
const parentId = "00000000-0000-0000-0000-000000000001";
const childContext = {
	profileId: "00000000-0000-0000-0000-000000000020",
	familyId,
	displayName: "Jamie",
	expiresAt: new Date(Date.now() + 7200000).toISOString(),
};

async function mockServer(page: Page, withChild = false, parentPinEnabled = true) {
	const profiles: LearningProfile[] = withChild
		? [
				new LearningProfile({
					id: childContext.profileId,
					familyId,
					displayName: "Jamie",
					ageBand: LearningAgeBand.PRIMARY,
					guardianAccountIds: [parentId],
				}),
			]
		: [];
	let access = { enabled: withChild, loginId: withChild ? loginId : "" };
	await page.route("**/vulture.server.v1.VultureControl/*", async (route) => {
		if (route.request().method() === "OPTIONS") return nativeResponse(route);
		const method = route.request().url().split("/").at(-1);
		const input = route.request().postDataJSON();
		switch (method) {
			case "GetTimetable":
				return nativeResponse(route, { timetable: { timezone: "UTC" } });
			case "SetProfileTimezone":
				return nativeResponse(route, { timetable: { timezone: input.timezone } });
			case "GetParentPinAccess":
				return nativeResponse(route, { enabled: parentPinEnabled });
			case "SetParentPin": {
				expect(input.pin).toBe("482691");
				parentPinEnabled = true;
				return nativeResponse(route, { enabled: true });
			}
			case "GetMyFamily":
				return nativeResponse(route, { family: { id: familyId, name: "Morgan family" } });
			case "GetAvatar":
			case "GetFamilyAvatar":
			case "ListTasks":
				return nativeResponse(route, {});
			case "ListFamilyMembers":
				return nativeResponse(route, { members: [{ accountId: parentId }] });
			case "GetAccount":
				return nativeResponse(route, {
					account: {
						id: parentId,
						displayName: "Alex Morgan",
						role: AccountRole.PARENT,
					},
				});
			case "ListLearningProfiles":
				return nativeResponse(route, { profiles });
			case "CreateLearningProfile": {
				const profile = new LearningProfile({
					...input,
					id: childContext.profileId,
					guardianAccountIds: [parentId],
				});
				profiles.push(profile);
				return nativeResponse(route, { profile });
			}
			case "UpdateLearningProgression": {
				const profile = profiles.find((p) => p.id === input.profileId)!;
				profile.grade = input.grade;
				profile.progression = input.progression;
				if (input.displayName !== undefined) profile.displayName = input.displayName;
				return nativeResponse(route, { profile });
			}
			case "GetChildPinAccess":
				return nativeResponse(route, access);
			case "SetChildPin": {
				expect(input.profileId).toBe(childContext.profileId);
				expect(input.pin).toBe("123456");
				access = { enabled: true, loginId };
				return nativeResponse(route, access);
			}
			case "SignInChild": {
				expect(input.loginId).toBe(loginId);
				expect(input.pin).toBe("123456");
				return nativeResponse(route, {
					sessionToken: `vcs_${"c".repeat(64)}`,
					context: childContext,
				});
			}
			case "GetChildSession":
				return nativeResponse(route, { context: childContext });
			case "VerifyParentPin":
				return input.pin === "482691"
					? nativeResponse(route, {})
					: nativeResponse(route, undefined, 7);
			default:
				return nativeResponse(route, undefined, 12);
		}
	});
	await page.route("**/vulture.server.v1.TimetableService/*", (route) =>
		nativeResponse(route, undefined, 7),
	);
}

for (const width of [390, 1440]) {
	test(`family onboarding and child PIN setup at ${width}px`, async ({ page }, testInfo) => {
		await page.setViewportSize({ width, height: 1000 });
		await mockServer(page);
		await seedOidcSession(page, { name: "Alex Morgan" });
		await page.goto("/#/family:setup");
		await expect(page.getByRole("heading", { name: "Your profile" })).toBeVisible();
		const card = await page.getByRole("region", { name: "Your profile" }).boundingBox();
		expect(card).not.toBeNull();
		expect(Math.abs(card!.x + card!.width / 2 - width / 2)).toBeLessThan(2);
		expect(Math.abs(card!.y + card!.height / 2 - 500)).toBeLessThan(2);
		await page.screenshot({
			path: `artifacts/onboarding-start-${width}-${testInfo.project.name}.png`,
			fullPage: true,
		});
		await page.getByRole("button", { name: "2 Your family" }).click();
		await expect(page.getByLabel("Family name", { exact: true })).toBeVisible();
		await expect(page.getByRole("img", { name: "Default family picture" })).toBeVisible();
		await expect(page.getByText("More family settings")).toHaveCount(0);
		await page.screenshot({
			path: `artifacts/family-name-${width}-${testInfo.project.name}.png`,
			fullPage: true,
		});
		await page.getByRole("button", { name: /3 Children/ }).click();
		await page.getByRole("button", { name: "Add a child" }).click();
		await page.screenshot({
			path: `artifacts/child-form-empty-${width}-${testInfo.project.name}.png`,
			fullPage: true,
		});
		await page.getByLabel("Child's name").fill("Jamie");
		await page.getByLabel("Date of birth").fill(`${new Date().getUTCFullYear() - 7}-01-01`);
		await expect(page.getByLabel("Age group", { exact: true })).toHaveCount(0);
		const nameBox = await page.getByLabel("Child's name").boundingBox();
		const dobBox = await page.getByLabel("Date of birth").boundingBox();
		expect(Math.abs(nameBox!.y - dobBox!.y)).toBeLessThan(2);
		await page.screenshot({
			path: `artifacts/child-form-${width}-${testInfo.project.name}.png`,
			fullPage: true,
		});
		await page.getByText("Grade and school calendar").click();
		await page.getByLabel("Grade or learning stage (optional)").fill("Grade 2");
		await page.getByRole("button", { name: "Add child", exact: true }).click();
		const gradeAccordion = page.locator("details.school-calendar");
		const pinAccordion = page.locator(".pin-accordion");
		expect((await pinAccordion.boundingBox())!.y).toBeGreaterThan(
			(await gradeAccordion.boundingBox())!.y,
		);
		await page.getByText("Profile PIN", { exact: true }).click();
		await expect(page.getByLabel("Six-digit PIN", { exact: true })).toHaveAttribute(
			"type",
			"password",
		);
		await expect(page.getByLabel("Confirm PIN", { exact: true })).toHaveAttribute(
			"type",
			"password",
		);
		await page.getByLabel("Six-digit PIN", { exact: true }).fill("123456");
		await page.getByLabel("Confirm PIN").fill("123456");
		await page.getByRole("button", { name: "Set PIN", exact: true }).click();
		await expect(page.getByText("PIN saved.", { exact: true })).toBeVisible();
		await page.getByText("Sign-in on another device").click();
		await expect(page.getByText(loginId, { exact: true })).toBeVisible();
		await expect(page.getByLabel("New six-digit PIN")).toHaveCount(0);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true,
		);
		await page.screenshot({
			path: `artifacts/onboarding-${width}-${testInfo.project.name}.png`,
			fullPage: true,
		});
	});
}

test("a fresh parent sign-in asks for the parent PIN before opening parent screens", async ({
	page,
}) => {
	await mockServer(page, true);
	await seedOidcSession(page, { name: "Alex Morgan", pinUnlocked: false });
	await page.goto("/#/learning:profiles");
	await expect(page).toHaveURL(/#\/profile:choose/);
	await page.getByRole("button", { name: /Alex Morgan/ }).click();
	const pin = page.getByLabel("Parent PIN");
	await pin.fill("000000");
	await page.getByRole("button", { name: "Unlock" }).click();
	await expect(page.getByRole("alert")).toContainText("Check your parent PIN");
	await page.evaluate(() => {
		location.hash = "#/learning:profiles";
	});
	await expect(page).toHaveURL(/#\/profile:choose/);
	await page.getByRole("button", { name: /Alex Morgan/ }).click();
	await page.getByLabel("Parent PIN").fill("482691");
	await page.getByRole("button", { name: "Unlock" }).click();
	await expect(page).toHaveURL(/#\/home:parent/);
	const parent = await readNativeState<{ pinUnlocked?: boolean }>(
		page,
		"oidc.user:https://auth.swavan.io/auth/v1/:vulturefam",
	);
	expect(parent?.pinUnlocked).toBe(true);
});

test("a parent who forgot the PIN signs in again and sets a new one", async ({ page }) => {
	await mockServer(page, true);
	const saved: { pin: string; currentPin?: string }[] = [];
	await page.route("**/vulture.server.v1.VultureControl/SetParentPin", (route) => {
		saved.push(route.request().postDataJSON());
		return nativeResponse(route, { enabled: true });
	});
	await seedOidcSession(page, { name: "Alex Morgan", pinUnlocked: false, pinReset: true });
	await page.goto("/#/home:parent");
	await expect(page.getByRole("heading", { name: "Set a new parent PIN" })).toBeVisible();
	await expect(page.getByLabel("Current parent PIN")).toHaveCount(0);
	await page.getByLabel("New parent PIN", { exact: true }).fill("135790");
	await page.getByLabel("Confirm parent PIN").fill("135790");
	await page.getByRole("button", { name: "Save PIN" }).click();
	await expect(page).toHaveURL(/#\/home:parent/);
	expect(saved).toEqual([expect.objectContaining({ pin: "135790" })]);
	expect(saved[0].currentPin ?? "").toBe("");
	const parent = await readNativeState<{ pinUnlocked?: boolean; pinReset?: boolean }>(
		page,
		"oidc.user:https://auth.swavan.io/auth/v1/:vulturefam",
	);
	expect(parent).toMatchObject({ pinUnlocked: true, pinReset: false });
});

for (const width of [390, 1440]) {
	test(`landing excludes child sign-in and its legacy route at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 900 });
		for (const path of ["/", "/#/child:sign-in"]) {
			await page.goto(path);
			await expect(
				page.getByRole("heading", {
					name: "Welcome to VFAM",
				}),
			).toBeVisible();
			await expect(page.getByRole("button", { name: "Child sign-in", exact: true })).toHaveCount(0);
			await expect(page.getByLabel("Child sign-in code")).toHaveCount(0);
			await expect(page.getByLabel("Six-digit PIN")).toHaveCount(0);
		}
	});
}

for (const width of [390, 1440]) {
	test(`signed-in users choose a profile when more than one exists at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 900 });
		await mockServer(page, true);
		await seedOidcSession(page, { name: "Alex Morgan" });
		await page.goto("/");
		await expect(page.getByRole("heading", { name: "Who’s here?" })).toBeVisible();
		await expect(page.getByRole("button", { name: /Alex Morgan/ })).toBeVisible();
		await expect(page.getByRole("button", { name: /Jamie/ })).toBeVisible();
		await expect(page.getByRole("link", { name: "Learning", exact: true })).toHaveCount(0);
		await page.screenshot({
			path: `artifacts/profile-picker-${width}-${testInfo.project.name}.png`,
			fullPage: true,
		});
		await page.getByRole("button", { name: /Jamie/ }).click();
		await page.getByLabel("Six-digit PIN").fill("123456");
		await page.getByRole("button", { name: "Unlock" }).click();
		await expect(page.getByRole("heading", { name: "Hi, Jamie!" })).toBeVisible();
	});
}
test("a signed-in user with only their own profile opens home directly", async ({ page }) => {
	await mockServer(page);
	await seedOidcSession(page);
	await page.goto("/");
	await expect(page.getByRole("heading", { name: "Your household, at a glance." })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Who’s here?" })).toHaveCount(0);
});

test("selected family picture opens a decoded preview immediately", async ({ page }) => {
	await mockServer(page);
	await seedOidcSession(page, { name: "Alex Morgan" });
	await page.goto("/#/family:setup");
	await page.getByRole("button", { name: "2 Your family" }).click();
	await page.getByLabel("Upload family picture").setInputFiles({
		name: "family.png",
		mimeType: "image/png",
		buffer: Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
			"base64",
		),
	});
	const preview = page.getByRole("img", { name: "Family preview" });
	await expect(preview).toBeVisible();
	await expect
		.poll(() =>
			preview.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
		)
		.toBe(true);
});

test("HEIC family pictures convert into a decoded JPEG preview", async ({ page }) => {
	await mockServer(page);
	let saved: { image: string; contentType: string } | undefined;
	await page.route("**/vulture.server.v1.VultureControl/SetFamilyAvatar", async (route) => {
		if (route.request().method() === "OPTIONS") return nativeResponse(route);
		saved = route.request().postDataJSON();
		return nativeResponse(route, { ok: true });
	});
	await seedOidcSession(page, { name: "Alex Morgan" });
	await page.goto("/#/family:setup");
	await page.getByRole("button", { name: "2 Your family" }).click();
	await page
		.getByLabel("Upload family picture")
		.setInputFiles("tests/integration/fixtures/family-photo.heic");
	const preview = page.getByRole("img", { name: "Family preview" });
	await expect(preview).toBeVisible({ timeout: 20000 });
	await expect
		.poll(() =>
			preview.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 64),
		)
		.toBe(true);
	const mime = await preview.evaluate(async (image: HTMLImageElement) =>
		(await fetch(image.src)).headers.get("content-type"),
	);
	expect(mime).toBe("image/jpeg");
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Add your children" })).toBeVisible();
	expect(saved?.contentType).toBe("image/jpeg");
	expect(Array.from(Buffer.from(saved!.image, "base64").subarray(0, 2))).toEqual([255, 216]);
});

test("parents choose a regional calendar and can switch an existing child back to manual", async ({
	page,
}, testInfo) => {
	await mockServer(page);
	await seedOidcSession(page, { name: "Alex Morgan" });
	await page.goto("/#/family:setup");
	await page.getByRole("button", { name: "3 Children" }).click();
	await page.getByRole("button", { name: "Add a child" }).click();
	await page.getByLabel("Child's name").fill("Jamie");
	await page
		.getByLabel("Date of birth", { exact: true })
		.fill(`${new Date().getUTCFullYear() - 7}-01-01`);
	await page.getByText("Grade and school calendar", { exact: true }).click();
	await expect(page.getByLabel("Grade updates")).toHaveValue("false");
	await expect
		.poll(() =>
			page.locator("details.school-calendar").evaluate((node) => node.getAnimations().length),
		)
		.toBe(0);
	const gradeBox = await page.getByLabel("Grade or learning stage (optional)").boundingBox();
	const modeBox = await page.getByLabel("Grade updates").boundingBox();
	expect(Math.abs(gradeBox!.y - modeBox!.y)).toBeLessThan(2);

	await page.getByLabel("Grade or learning stage (optional)").fill("Grade 2");
	await page.getByLabel("Grade updates").selectOption("true");
	await page.getByLabel("Country", { exact: true }).fill("Nepal");
	await page.getByLabel("State or region").fill("Bagmati");
	await page.getByLabel("School-year start month").selectOption("4");
	await page.getByLabel("Day", { exact: true }).fill("15");
	await expect
		.poll(() =>
			page.locator("details.school-calendar").evaluate((node) => node.getAnimations().length),
		)
		.toBe(0);
	for (const [left, right] of [
		["Country", "State or region"],
		["School-year start month", "Day"],
	]) {
		const leftBox = await page.getByLabel(left, { exact: true }).boundingBox();
		const rightBox = await page.getByLabel(right, { exact: true }).boundingBox();
		expect(Math.abs(leftBox!.y - rightBox!.y)).toBeLessThan(2);
		expect(leftBox!.height).toBeLessThanOrEqual(42);
		expect(rightBox!.height).toBeLessThanOrEqual(42);
	}

	await page.screenshot({
		path: `artifacts/child-school-calendar-${testInfo.project.name}.png`,
		fullPage: true,
	});
	await page.getByRole("button", { name: "Add child", exact: true }).click();
	await page.getByText("Grade and school calendar", { exact: true }).click();
	await expect(page.getByLabel("Grade updates")).toHaveValue("true");
	await expect(page.getByLabel("Country", { exact: true })).toHaveValue("Nepal");
	await page.getByLabel("Grade updates").selectOption("false");
	await page.getByLabel("Grade or learning stage (optional)").fill("Grade 3");
	await page.getByRole("button", { name: "Save school calendar" }).click();
	await expect(page.getByText("School calendar saved.")).toBeVisible();
	await page.reload();
	await page.getByRole("button", { name: "3 Children" }).click();
	await page.getByRole("button", { name: /Jamie/ }).click();
	await page.getByText("Grade and school calendar", { exact: true }).click();
	await expect(page.getByLabel("Grade updates")).toHaveValue("false");
	await expect(page.getByLabel("Grade or learning stage (optional)")).toHaveValue("Grade 3");
});

test("school calendar animates open and closed and respects reduced motion", async ({ page }) => {
	await mockServer(page);
	await seedOidcSession(page, { name: "Alex Morgan" });
	await page.goto("/#/family:setup");
	await page.getByRole("button", { name: "3 Children" }).click();
	await page.getByRole("button", { name: "Add a child" }).click();
	const summary = page.getByText("Grade and school calendar", { exact: true });
	const accordion = page.locator("details.school-calendar");
	await summary.click();
	await expect
		.poll(() => accordion.evaluate((node) => node.getAnimations().length))
		.toBeGreaterThan(0);
	await expect.poll(() => accordion.evaluate((node) => node.getAnimations().length)).toBe(0);
	await expect(accordion).toHaveAttribute("open", "");
	const manualHeight = (await accordion.boundingBox())!.height;
	await page.getByLabel("Grade updates").selectOption("true");
	await expect
		.poll(() => accordion.evaluate((node) => node.getAnimations().length))
		.toBeGreaterThan(0);
	await expect.poll(() => accordion.evaluate((node) => node.getAnimations().length)).toBe(0);
	expect((await accordion.boundingBox())!.height).toBeGreaterThan(manualHeight + 50);
	await page.getByLabel("Grade updates").selectOption("false");
	await expect
		.poll(() => accordion.evaluate((node) => node.getAnimations().length))
		.toBeGreaterThan(0);
	await expect.poll(() => accordion.evaluate((node) => node.getAnimations().length)).toBe(0);
	expect(Math.abs((await accordion.boundingBox())!.height - manualHeight)).toBeLessThan(2);
	await summary.click();
	await expect
		.poll(() => accordion.evaluate((node) => node.getAnimations().length))
		.toBeGreaterThan(0);
	await expect(accordion).not.toHaveAttribute("open");
	await page.emulateMedia({ reducedMotion: "reduce" });
	await summary.click();
	await expect(accordion).toHaveAttribute("open", "");
	expect(await accordion.evaluate((node) => node.getAnimations().length)).toBe(0);
	await page.getByLabel("Grade updates").selectOption("true");
	await expect(page.getByLabel("Country", { exact: true })).toBeVisible();
	expect(await accordion.evaluate((node) => node.getAnimations().length)).toBe(0);
	await page.getByLabel("Grade updates").selectOption("false");

	await summary.click();
	await expect(accordion).not.toHaveAttribute("open");
});

for (const width of [390, 1440]) {
	test(`guardian dropdown matches the attached design at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 1000 });
		await mockServer(page, true);
		const parents = ["Josh (Dad)", "Christina (Mom)", "Jenna (Aunt)", "Taylor"].map(
			(displayName, index) => ({
				id: `00000000-0000-0000-0000-00000000010${index}`,
				displayName,
				role: AccountRole.PARENT,
			}),
		);
		await page.route("**/vulture.server.v1.VultureControl/ListFamilyMembers", (route) =>
			nativeResponse(route, { members: parents.map((account) => ({ accountId: account.id })) }),
		);
		await page.route("**/vulture.server.v1.VultureControl/GetAccount", (route) => {
			if (route.request().method() === "OPTIONS") return nativeResponse(route);
			const input = route.request().postDataJSON();
			const account = parents.find((account) => account.id === input.accountId);
			return account ? nativeResponse(route, { account }) : route.fallback();
		});
		await seedOidcSession(page, { name: "Alex Morgan" });
		await page.goto("/#/family:setup");
		await page.getByRole("button", { name: "3 Children" }).click();
		await page.getByRole("button", { name: /Jamie/ }).click();
		await page.getByText("Guardian access", { exact: true }).click();
		const guardianPanel = page.locator(".guardian-access");
		await expect.poll(() => guardianPanel.evaluate((node) => node.getAnimations().length)).toBe(0);
		const beforeDropdown = await guardianPanel.boundingBox();
		await page.getByRole("textbox", { name: "Guardian user ID" }).click();
		await expect
			.poll(async () => (await guardianPanel.boundingBox())!.height)
			.toBeCloseTo(beforeDropdown!.height, 0);
		await expect(page.getByRole("checkbox", { name: "Josh (Dad)" })).toBeVisible();
		const dropdown = page.getByRole("group", { name: "Choose guardians" });
		await expect.poll(() => dropdown.evaluate((node) => node.getAnimations().length)).toBe(0);
		const inputBounds = (await page.locator(".guardian-input-row").boundingBox())!;
		const dropdownBounds = (await dropdown.boundingBox())!;
		expect(Math.abs(inputBounds.x - dropdownBounds.x)).toBeLessThan(2);
		expect(Math.abs(inputBounds.width - dropdownBounds.width)).toBeLessThan(2);

		await expect(page.getByRole("button", { name: "Add guardian", exact: true })).toHaveCount(0);
		await page.getByRole("checkbox", { name: "Josh (Dad)" }).check();
		await expect(page.getByRole("button", { name: "Save guardians" })).toBeEnabled();
		await expect(page.getByText("Page 1 of 2", { exact: true })).toBeVisible();
		await page.getByRole("button", { name: "Next guardian page" }).click();
		await expect(page.getByRole("checkbox", { name: "Taylor" })).toBeVisible();
		await page.getByRole("button", { name: "Previous guardian page" }).click();
		await expect(page.getByRole("checkbox", { name: "Josh (Dad)" })).toBeChecked();
		await expect
			.poll(() => page.locator(".guardian-access").evaluate((node) => node.getAnimations().length))
			.toBe(0);
		await page.screenshot({
			path: `artifacts/guardian-dropdown-${width}-${testInfo.project.name}.png`,
			fullPage: true,
		});
		await page.getByRole("searchbox", { name: "Search guardians" }).fill("Jenna");
		await expect(page.getByRole("checkbox")).toHaveCount(1);
		await page.getByRole("button", { name: "Cancel adding guardians" }).click();
		await expect(page.getByRole("searchbox", { name: "Search guardians" })).toHaveCount(0);
		await expect(page.getByRole("textbox", { name: "Guardian user ID" })).toBeVisible();
		await expect(page.locator(".child-settings details.school-calendar")).toHaveCount(1);
		await expect(page.locator("details.pin-accordion")).toHaveCount(1);
		await expect(page.locator("details.guardian-access")).toHaveCount(1);
		await page.screenshot({
			path: `artifacts/child-accordion-${width}-${testInfo.project.name}.png`,
			fullPage: true,
		});
		await page.getByRole("button", { name: /Jamie/ }).click();
		await expect(page.getByRole("textbox", { name: "Guardian user ID" })).toHaveCount(0);
		await page.getByRole("button", { name: /Jamie/ }).click();
		await page.getByText("Guardian access", { exact: true }).click();
		await expect(page.getByRole("textbox", { name: "Guardian user ID" })).toBeVisible();
	});
}

test("edited child names persist after reloading setup", async ({ page }) => {
	await mockServer(page, true);
	await seedOidcSession(page, { name: "Alex Morgan" });
	await page.goto("/#/family:setup");
	await page.getByRole("button", { name: "3 Children" }).click();
	await page.getByRole("button", { name: /Jamie/ }).click();
	await expect(page.locator("details.personal")).not.toHaveAttribute("open");
	await page.getByText("Personal", { exact: true }).click();
	await page.getByLabel("Child's name").fill("Jamie Morgan");
	await page.getByRole("button", { name: "Save personal changes" }).click();
	await expect(page.getByRole("button", { name: /Jamie Morgan/ })).toBeVisible();
	await page.reload();
	await page.getByRole("button", { name: "3 Children" }).click();
	await page.getByRole("button", { name: /Jamie Morgan/ }).click();
	await expect(page.getByLabel("Child's name")).toHaveValue("Jamie Morgan");
});

for (const width of [390, 1440]) {
	test(`new child slides in from the right and retains its draft at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 1000 });
		await mockServer(page, true);
		await seedOidcSession(page, { name: "Alex Morgan" });
		await page.goto("/#/family:setup");
		await page.getByRole("button", { name: "3 Children" }).click();
		await expect(page.getByRole("button", { name: "Previous child" })).toBeDisabled();
		await page.getByRole("button", { name: "Add a child" }).click();
		await expect(page.getByLabel("Child's name")).toHaveValue("");
		await page.getByLabel("Child's name").fill("New sibling");
		const dob = `${new Date().getUTCFullYear() - 7}-01-01`;
		await page.getByLabel("Date of birth").fill(dob);
		await page.getByRole("button", { name: "Previous child" }).click();
		await expect(page.locator(".child-pane")).toHaveCount(1);
		await expect(page.getByRole("button", { name: /Jamie/ })).toHaveAttribute(
			"aria-expanded",
			"false",
		);
		await page.getByRole("button", { name: /Jamie/ }).click();
		await expect(page.locator("details.personal")).not.toHaveAttribute("open");
		await expect(page.getByLabel("Child's name")).toHaveValue("Jamie");
		await page.getByRole("button", { name: "Next child" }).click();
		await expect(page.locator(".child-pane")).toHaveCount(1);
		await expect(page.getByLabel("Child's name")).toHaveValue("New sibling");
		await expect(page.getByLabel("Date of birth")).toHaveValue(dob);
		await expect
			.poll(() =>
				page
					.locator(".child-pane")
					.evaluateAll((nodes) =>
						nodes.reduce((count, node) => count + node.getAnimations().length, 0),
					),
			)
			.toBe(0);
		await page.screenshot({
			path: `artifacts/child-carousel-${width}-${testInfo.project.name}.png`,
			fullPage: true,
		});
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true,
		);
		await page.getByRole("button", { name: "Add child", exact: true }).click();
		await expect(page.getByRole("button", { name: /New sibling/ })).toBeVisible();
		await expect(page.getByText("2 of 2", { exact: true })).toBeVisible();
	});
}

test("returning to a child restores only that child's open sections", async ({ page }) => {
	await mockServer(page, true);
	await page.route("**/vulture.server.v1.VultureControl/ListLearningProfiles", (route) =>
		nativeResponse(route, {
			profiles: ["Jamie", "Taylor", "Riley"].map(
				(displayName, index) =>
					new LearningProfile({
						id: `00000000-0000-0000-0000-00000000002${index}`,
						familyId,
						displayName,
						ageBand: LearningAgeBand.PRIMARY,
						guardianAccountIds: [parentId],
					}),
			),
		}),
	);
	await seedOidcSession(page, { name: "Alex Morgan" });
	await page.goto("/#/family:setup");
	await page.getByRole("button", { name: "3 Children" }).click();
	await page.getByRole("button", { name: /Jamie/ }).click();
	for (const name of ["Personal", "Profile PIN", "Guardian access"])
		await page.getByText(name, { exact: true }).click();
	await page.getByRole("button", { name: "Next child" }).click();
	await expect(page.getByRole("button", { name: /Taylor/ })).toHaveAttribute(
		"aria-expanded",
		"false",
	);
	await page.getByRole("button", { name: "Next child" }).click();
	await page.getByRole("button", { name: /Riley/ }).click();
	await expect(page.locator(".child-pane")).toHaveCount(1);
	await page.getByText("Grade and school calendar", { exact: true }).click();
	await page.getByRole("button", { name: "Previous child" }).click();
	await expect(page.getByRole("button", { name: /Taylor/ })).toHaveAttribute(
		"aria-expanded",
		"false",
	);
	await page.getByRole("button", { name: "Previous child" }).click();
	await expect(page.locator(".child-pane")).toHaveCount(1);
	await expect(page.getByRole("button", { name: /Jamie/ })).toHaveAttribute(
		"aria-expanded",
		"true",
	);
	for (const selector of ["details.personal", "details.pin-accordion", "details.guardian-access"])
		await expect(page.locator(selector)).toHaveAttribute("open");
	await expect(page.locator("details.school-calendar")).not.toHaveAttribute("open");
	await page.getByRole("button", { name: /Jamie/ }).click();
	await page.getByRole("button", { name: "Next child" }).click();
	await page.getByRole("button", { name: "Previous child" }).click();
	await expect(page.locator(".child-pane")).toHaveCount(1);
	await expect(page.getByRole("button", { name: /Jamie/ })).toHaveAttribute(
		"aria-expanded",
		"false",
	);
});

for (const width of [320, 390, 768, 1440]) {
	test(`storage editor stays inside the onboarding card and can close at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 800 });
		await mockServer(page);
		await page.route("**/vulture.server.v1.VultureControl/FamilyResources", (route) =>
			nativeResponse(route, {
				resultJson: JSON.stringify({
					platform_paid: true,
					storage: null,
					storage_secret_set: false,
				}),
			}),
		);
		await seedOidcSession(page, { name: "Alex Morgan" });
		await page.goto("/#/family:setup");
		await page.getByRole("button", { name: "4 Services" }).click();
		await page.getByText("Connect family services", { exact: true }).click();
		const trigger = page.getByRole("button", { name: "Configure Storage" });
		await trigger.click();
		const panel = page.getByRole("region", { name: "Storage settings" });
		await expect(panel).toBeVisible();
		await expect.poll(() => panel.evaluate((node) => node.getAnimations().length)).toBe(0);
		await expect
			.poll(() => panel.evaluate((node) => getComputedStyle(node).transform))
			.toBe("none");
		const card = page.locator("section.setup");
		await expect.poll(() => card.evaluate((node) => getComputedStyle(node).transform)).toBe("none");
		const bounds = (await panel.boundingBox())!;
		const cardBounds = (await card.boundingBox())!;
		await expect
			.poll(() =>
				panel.evaluate((node) => {
					const panelBounds = node.getBoundingClientRect();
					const setupBounds = node.closest("section.setup")!.getBoundingClientRect();
					return panelBounds.x >= setupBounds.x - 1 && panelBounds.right <= setupBounds.right + 1;
				}),
			)
			.toBe(true);
		expect(await panel.evaluate((node) => !!node.closest("section.setup"))).toBe(true);
		expect(bounds.y).toBeGreaterThanOrEqual(cardBounds.y);
		expect(bounds.y + bounds.height).toBeLessThanOrEqual(cardBounds.y + cardBounds.height + 1);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true,
		);
		const close = panel.getByRole("button", { name: "Close", exact: true });
		await expect(
			panel.locator("header").getByRole("button", { name: "Close", exact: true }),
		).toBeVisible();
		await expect(panel.getByRole("button", { name: "Save storage" })).toHaveCount(0);
		await close.scrollIntoViewIfNeeded();
		await expect(close).toBeInViewport();
		await panel.getByLabel("Storage service").selectOption("own");
		await panel.getByRole("button", { name: "Next", exact: true }).click();
		await expect(panel.getByLabel("HTTPS storage endpoint")).toBeVisible();
		await panel.getByLabel("Secret access key").scrollIntoViewIfNeeded();
		await expect(panel.getByLabel("Secret access key")).toBeInViewport();
		await close.scrollIntoViewIfNeeded();
		await expect(close).toBeInViewport();
		await page.screenshot({
			path: `artifacts/onboarding-storage-${width}-${testInfo.project.name}.png`,
			fullPage: true,
		});
		await close.click();
		await expect(panel).toHaveCount(0);
		await expect(trigger).toBeFocused();
		await trigger.click();
		await expect(panel).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(panel).toHaveCount(0);
		const services = page.locator("details.services");
		await page.getByText("Connect family services", { exact: true }).click();
		await expect(services).not.toHaveAttribute("open");
		await page.getByText("Connect family services", { exact: true }).click();
		await expect(page.getByRole("button", { name: "Configure AI" })).toBeVisible();
	});
}

for (const width of [390, 1440]) {
	test(`parent configures their PIN from profile selection at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 900 });
		await mockServer(page, true, false);
		await seedOidcSession(page, { name: "Alex Morgan" });
		await page.goto("/");
		await page.getByRole("button", { name: /Alex Morgan/ }).click();
		await expect(page.getByRole("heading", { name: "Your parent PIN" })).toBeVisible();
		await page.getByLabel("New parent PIN").fill("482691");
		await page.getByLabel("Confirm parent PIN").fill("482691");
		await page.screenshot({
			path: `artifacts/parent-pin-setup-${width}-${testInfo.project.name}.png`,
			fullPage: true,
		});
		await page.getByRole("button", { name: "Save PIN", exact: true }).click();
		await expect(page.getByRole("heading", { name: "Your household, at a glance." })).toBeVisible();
	});
}
