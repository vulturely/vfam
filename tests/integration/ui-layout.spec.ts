import { test, expect, seedOidcSession } from "./fixtures";
import { nativeResponse } from "./nativeRpc";
import { AccountRole } from "../../packages/core/src/api/protocol";

const FamilyMemberRole = { ADMIN: 1, MEMBER: 2 } as const;

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

for (const width of [390, 820, 1440]) {
	test(`terms scroll inside the panel at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 844 });
		await page.goto("/#/terms");
		const panel = page.getByRole("region", {
			name: "Terms and Conditions content",
		});
		await expect(panel).toBeVisible();
		expect(
			await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1),
		).toBe(true);
		expect(await panel.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
		await panel.focus();
		await page.keyboard.press("End");
		await expect.poll(() => panel.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
		await expect(panel.getByText(/Questions about these terms/)).toBeInViewport();
		expect(await page.evaluate(() => scrollY)).toBe(0);
	});
}

test("home cards navigate to learning, family members and tasks", async ({ page }) => {
	await page.setViewportSize({ width: 820, height: 1180 });
	await page.route("**/vulture.server.v1.VultureControl/GetMyFamily", (route) =>
		nativeResponse(route, { family: { id: "family", name: "Morgan family" } }),
	);
	await page.route("**/vulture.server.v1.VultureControl/ListFamilyMembers", (route) =>
		nativeResponse(route, {
			members: [
				{
					id: "member",
					familyId: "family",
					accountId: "00000000-0000-0000-0000-000000000001",
					role: FamilyMemberRole.ADMIN,
				},
			],
		}),
	);
	await page.route("**/vulture.server.v1.VultureControl/ListLearningProfiles", (route) =>
		nativeResponse(route, {}),
	);
	await page.route("**/vulture.server.v1.VultureControl/ListTasks", (route) =>
		nativeResponse(route, {}),
	);
	await page.route("**/vulture.server.v1.VultureControl/FamilyResources", (route) =>
		nativeResponse(route, {
			resultJson: JSON.stringify({
				platform_paid: false,
				storage: null,
				storage_secret_set: false,
			}),
		}),
	);
	await seedOidcSession(page);
	for (const [name, route] of [
		["Open learning", "learning:profiles"],
		["Manage members", "family:manage?tab=manage"],
		["Manage tasks", "family:manage?tab=tasks"],
	]) {
		await page.goto("/#/home:parent");
		await page.getByRole("button", { name: new RegExp(name) }).click();
		await expect(page).toHaveURL((url) => url.hash === `#/${route}`);
		if (name === "Manage members") {
			await expect(page.getByRole("tab", { name: /Manage/ })).toHaveAttribute(
				"aria-selected",
				"true",
			);
			const manage = page.locator(".v-manage-accordion summary").first();
			const addRelative = page.getByRole("button", {
				name: "Add relative",
				exact: true,
			});
			const row = (await manage.boundingBox())!;
			const action = (await addRelative.boundingBox())!;
			expect(Math.abs(row.y + row.height / 2 - action.y - action.height / 2)).toBeLessThan(1);
			await expect(addRelative).toHaveAttribute("data-tooltip", "Add relative");
			await manage.click();
			await expect(page.getByText("Invite relatives by their account id.")).toBeHidden();
			await expect(addRelative).toBeVisible();
			await addRelative.click();
			await expect(page.getByRole("dialog", { name: "Add relatives" })).toBeVisible();
			await page
				.getByRole("dialog", { name: "Add relatives" })
				.getByRole("button", { name: "Close", exact: true })
				.click();
			await page.locator("summary").filter({ hasText: "Family services" }).click();
			for (const title of ["Storage", "AI"]) {
				await page.getByRole("button", { name: `Configure ${title}`, exact: true }).click();
				const panel = page.getByRole("dialog", { name: `${title} settings` });
				await expect(panel).toBeVisible();
				await panel.getByRole("button", { name: "Close", exact: true }).click();
				await expect(panel).toBeHidden();
			}
		}
		if (name === "Manage tasks") {
			const add = page.getByRole("button", {
				name: "Create task",
				exact: true,
			});
			const heading = page.getByRole("heading", { name: "Tasks", exact: true });
			const buttonBox = (await add.boundingBox())!;
			const titleBox = (await heading.boundingBox())!;
			expect(
				Math.abs(buttonBox.y + buttonBox.height / 2 - titleBox.y - titleBox.height / 2),
			).toBeLessThan(1);
			await expect(add).toHaveAttribute("data-tooltip", "Create task");
			await add.click();
			await expect(page.getByRole("dialog", { name: "Create task ticket" })).toBeVisible();
		}
	}
});

for (const width of [390, 820, 1440]) {
	test(`side forms preserve glass navigation and scroll at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 700 });
		await page.addInitScript(() => localStorage.setItem("vulture.theme", "dark"));
		await page.route("**/vulture.server.v1.VultureControl/GetMyFamily", (route) =>
			nativeResponse(route, { family: { id: "family", name: "Morgan family" } }),
		);
		await page.route("**/vulture.server.v1.VultureControl/ListFamilyMembers", (route) =>
			nativeResponse(route, {
				members: [
					{
						id: "member",
						familyId: "family",
						accountId: "00000000-0000-0000-0000-000000000001",
						role: FamilyMemberRole.ADMIN,
					},
				],
			}),
		);
		await page.route("**/vulture.server.v1.VultureControl/ListLearningProfiles", (route) =>
			nativeResponse(route, {}),
		);
		await page.route("**/vulture.server.v1.VultureControl/ListTasks", (route) =>
			nativeResponse(route, {}),
		);
		await seedOidcSession(page);

		const resourceCommands: unknown[] = [];
		await page.route("**/vulture.server.v1.VultureControl/FamilyResources", (route) => {
			if (route.request().method() === "OPTIONS") return nativeResponse(route);
			resourceCommands.push(JSON.parse(route.request().postDataJSON().commandJson));
			return nativeResponse(route, {
				resultJson: JSON.stringify({
					platform_paid: true,
					storage: null,
					storage_secret_set: false,
				}),
			});
		});
		await page.goto("/#/home:parent");
		await page.getByRole("button", { name: /Manage members/ }).click();
		await page.locator("summary").filter({ hasText: "Family services" }).click();
		for (const title of ["Storage", "AI"]) {
			const trigger = page.getByRole("button", {
				name: `Configure ${title}`,
				exact: true,
			});
			await trigger.click();
			const panel = page.getByRole("dialog", { name: `${title} settings` });
			await expect(panel).toBeVisible();
			await panel.evaluate(async (node) => {
				await Promise.all(node.getAnimations().map((animation) => animation.finished));
			});
			await panel.getByLabel(`${title} service`).selectOption("own");
			await panel.getByRole("button", { name: "Next", exact: true }).click();
			await expect(panel.getByText("2. Configuration", { exact: true })).toHaveAttribute(
				"aria-current",
				"step",
			);
			const bounds = (await panel.boundingBox())!;
			expect(bounds.x).toBeGreaterThanOrEqual(0);
			expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
			const nav = page.locator(".v-sidebar");
			if (width <= 760) {
				await expect(nav).toBeHidden();
				expect(bounds.y).toBe(0);
				expect(bounds.width).toBe(width);
				expect(bounds.height).toBe(700);
				expect(
					await panel
						.locator("input")
						.first()
						.evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
				).toBeGreaterThanOrEqual(16);
				expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");
			} else {
				await expect(nav).toBeVisible();
				await expect.poll(async () => (await nav.boundingBox())!.width).toBeGreaterThan(450);
				const navBounds = (await nav.boundingBox())!;
				expect(bounds.y).toBeCloseTo(navBounds.y, 0);
				expect(bounds.height).toBeCloseTo(navBounds.height, 0);
				expect(bounds.y + bounds.height).toBeCloseTo(navBounds.y + navBounds.height, 0);
				expect(await nav.evaluate((node) => getComputedStyle(node).borderTopRightRadius)).not.toBe(
					"0px",
				);
			}
			const footer = panel.locator("footer");
			const save = footer.getByRole("button", {
				name: title === "Storage" ? "Save storage" : "Save AI provider",
			});
			await expect(save).toHaveClass(/v-btn-primary/);
			expect(await save.evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe(
				"rgba(0, 0, 0, 0)",
			);
			const back = footer.getByRole("button", { name: "Back", exact: true });
			await expect(back).toBeVisible();
			const backBounds = (await back.boundingBox())!;
			const saveBounds = (await save.boundingBox())!;
			expect(
				Math.abs(backBounds.y + backBounds.height / 2 - saveBounds.y - saveBounds.height / 2),
			).toBeLessThan(1);
			for (const button of [
				back,
				save,
				footer.getByRole("button", { name: "Close", exact: true }),
			]) {
				await expect(button.locator("svg")).toBeVisible();
				if (width <= 760) {
					const buttonBounds = (await button.boundingBox())!;
					expect(buttonBounds.width).toBe(36);
					expect(buttonBounds.height).toBe(36);
				}
			}
			expect(await save.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe("none");
			const footerBefore = (await footer.boundingBox())!;
			if (width <= 760) expect(footerBefore.height).toBeLessThanOrEqual(52);
			expect(footerBefore.y).toBeGreaterThan(bounds.y + bounds.height / 2);
			await expect(footer.getByRole("button", { name: "Close", exact: true })).toBeVisible();
			await expect(panel.locator("header").getByRole("button")).toHaveCount(0);
			if (title === "Storage") {
				const body = panel.locator(".body");
				expect(await body.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
				await body.evaluate((node) => (node.scrollTop = node.scrollHeight));
				await expect(panel.getByLabel("Secret access key")).toBeInViewport();
				expect((await footer.boundingBox())!.y).toBeCloseTo(footerBefore.y, 0);
				await expect(panel.getByRole("button", { name: "Save storage" })).toBeInViewport();
			}
			await panel.getByRole("button", { name: "Close", exact: true }).focus();
			await page.keyboard.press("Tab");
			await expect(
				title === "Storage"
					? panel.getByLabel("HTTPS storage endpoint")
					: panel.getByRole("combobox", { name: "Provider", exact: true }),
			).toBeFocused();
			await panel
				.getByRole("button", {
					name: title === "Storage" ? "Save storage" : "Save AI provider",
				})
				.focus();
			await page.screenshot({
				path: `artifacts/side-form-${title.toLowerCase()}-${width}.png`,
			});
			await back.click();
			await panel.getByLabel(`${title} service`).selectOption("platform");
			await panel.getByRole("button", { name: "Next", exact: true }).click();
			await expect(save).toHaveCount(0);
			expect(resourceCommands).not.toContainEqual({
				type: title === "Storage" ? "save_storage" : "save_ai",
				config: null,
			});
			await page.keyboard.press("Escape");
			await expect(panel).toBeHidden();
			await expect(trigger).toBeFocused();
		}
		if (width <= 760) await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
	});
}

for (const width of [390, 1280]) {
	test(`existing relatives can save reciprocal relationships at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 844 });
		await seedOidcSession(page);
		const familyId = "00000000-0000-0000-0000-000000000010";
		const relative = "00000000-0000-0000-0000-000000000002";
		let relationship = "",
			reciprocal = "";
		let saves = 0;
		await page.route("**/vulture.server.v1.VultureControl/GetMyFamily", (route) =>
			nativeResponse(route, { family: { id: familyId, name: "Morgan family" } }),
		);
		await page.route("**/vulture.server.v1.VultureControl/GetAccount", (route) => {
			const request = route.request().postDataJSON();
			const isRelative = request.accountId === relative;
			return nativeResponse(route, {
				account: {
					id: isRelative ? relative : "00000000-0000-0000-0000-000000000001",
					displayName: isRelative ? "Alex" : "Morgan",
					role: AccountRole.PARENT,
				},
			});
		});
		await page.route("**/vulture.server.v1.VultureControl/ListFamilyMembers", (route) =>
			nativeResponse(route, {
				members: [
					{
						id: "self",
						familyId,
						accountId: "00000000-0000-0000-0000-000000000001",
						role: FamilyMemberRole.ADMIN,
					},
					{
						id: "relative",
						familyId,
						accountId: relative,
						role: FamilyMemberRole.MEMBER,
						relationship,
						reciprocalRelationship: reciprocal,
					},
				],
			}),
		);
		await page.route("**/vulture.server.v1.VultureControl/SetFamilyRelationship", async (route) => {
			const request = route.request().postDataJSON();
			expect(request.familyId).toBe(familyId);
			expect(request.accountId).toBe(relative);
			relationship = request.relationship;
			reciprocal = request.reciprocalRelationship;
			saves++;
			await nativeResponse(route, {});
		});
		await page.goto("/#/home:parent");
		await page.getByRole("button", { name: /Manage members/ }).click();
		await page.getByRole("button", { name: "Edit relationship with Alex" }).click();
		const form = page.getByRole("dialog", {
			name: "Relationship",
			exact: true,
		});
		await form.getByLabel("Their relationship to you").selectOption("wife");
		await expect(form.getByLabel("Your relationship to them")).toHaveValue("husband");
		await form.getByLabel("Your relationship to them").selectOption("partner");
		await form.getByLabel("Your relationship to them").selectOption("husband");
		await expect(form).toHaveCSS("opacity", "1");
		const bounds = (await form.boundingBox())!;
		expect(bounds.x).toBeGreaterThanOrEqual(0);
		expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
		await page.screenshot({
			path: `artifacts/family-relationship-${width}-${testInfo.project.name}.png`,
			animations: "disabled",
		});
		await form.getByRole("button", { name: "Save", exact: true }).click();
		await expect(form).toHaveCount(0);
		expect(relationship).toBe("wife");
		expect(reciprocal).toBe("husband");
		await expect(page.getByText("Wife", { exact: true })).toBeVisible();
		await page.reload();
		await page.goto("/#/home:parent");
		await page.getByRole("button", { name: /Manage members/ }).click();
		await expect(page.getByText("Wife", { exact: true })).toBeVisible();
		await page.getByRole("button", { name: "Edit relationship with Alex" }).click();
		await form.getByLabel("Their relationship to you").selectOption("sister");
		await form.getByRole("button", { name: "Close", exact: true }).click();
		await expect(form).toHaveCount(0);
		expect(saves).toBe(1);
		await expect(page.getByText("Wife", { exact: true })).toBeVisible();
	});
}
