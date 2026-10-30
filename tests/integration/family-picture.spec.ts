import { Buffer } from "node:buffer";
import { mkdir } from "node:fs/promises";
import { test, expect, seedOidcSession } from "./fixtures";
import { nativeResponse } from "./nativeRpc";
import {
	AccountRole,
	LearningAgeBand,
	TaskStatus,
	Task,
} from "../../packages/core/src/api/protocol";

const FamilyMemberRole = { ADMIN: 1 } as const;

for (const viewport of [
	{ name: "desktop", width: 1440, height: 1000 },
	{ name: "mobile", width: 390, height: 844 },
]) {
	test(`family picture save and reload (${viewport.name})`, async ({ page }, testInfo) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.setViewportSize(viewport);
		const familyId = "00000000-0000-0000-0000-000000000002";
		const accountId = "00000000-0000-0000-0000-000000000001";
		let stored: { image: string; contentType: string } | undefined;
		const tasks: Task[] = [
			new Task({
				id: "00000000-0000-0000-0000-000000000201",
				familyId,
				title: "Book appointment",
				status: TaskStatus.TODO,
			}),
		];
		await page.route("**/vulture.server.v1.VultureControl/*", async (route) => {
			if (route.request().method() === "OPTIONS") return nativeResponse(route);
			const method = route.request().url().split("/").at(-1);
			switch (method) {
				case "GetParentPinAccess":
					return nativeResponse(route, { enabled: true });
				case "GetMyFamily":
					return nativeResponse(route, {
						family: { id: familyId, name: "Morgan family" },
					});
				case "GetAccount":
					return nativeResponse(route, {
						account: {
							id: accountId,
							displayName: "Alex Morgan",
							role: AccountRole.PARENT,
						},
					});
				case "ListFamilyMembers":
					return nativeResponse(route, {
						members: [
							{
								id: "membership",
								accountId,
								familyId,
								role: FamilyMemberRole.ADMIN,
							},
						],
					});
				case "GetAvatar":
					return nativeResponse(route, {});
				case "ListLearningProfiles":
					return nativeResponse(route, {
						profiles: [
							{
								id: "00000000-0000-0000-0000-000000000100",
								familyId,
								displayName: "Jamie Morgan",
								ageBand: LearningAgeBand.PRIMARY,
								grade: "Grade 2",
								guardianAccountIds: [accountId],
							},
						],
					});
				case "ListTasks":
					return nativeResponse(route, { tasks });
				case "CreateTask": {
					const input = route.request().postDataJSON();
					expect(input.isChore).toBe(true);
					expect(input.assigneeAccountIds).toEqual([]);
					expect(input.assigneeProfileIds).toEqual(["00000000-0000-0000-0000-000000000100"]);
					const task = new Task({
						id: "00000000-0000-0000-0000-000000000200",
						familyId,
						title: input.title,
						isChore: input.isChore,
						description: input.description,
						assigneeAccountIds: input.assigneeAccountIds,
						assigneeProfileIds: input.assigneeProfileIds,
						reviewerAccountIds: input.reviewerAccountIds,
						status: TaskStatus.TODO,
						repeat: input.repeat,
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
					});
					tasks.push(task);
					return nativeResponse(route, { task });
				}
				case "UpdateTask": {
					const input = route.request().postDataJSON();
					expect(input.updateProfileAssignees).toBe(true);
					const task = tasks.find((task) => task.id === input.taskId)!;
					if (input.isChore !== undefined) task.isChore = input.isChore;
					task.title = input.title;
					task.assigneeProfileIds = input.assigneeProfileIds;
					return nativeResponse(route, { task });
				}
				case "GetFamilyAvatar":
					return nativeResponse(route, stored ?? {});
				case "SetFamilyAvatar":
					stored = route.request().postDataJSON();
					return nativeResponse(route, { ok: true });
				default:
					throw new Error(`Unexpected RPC: ${method}`);
			}
		});
		await seedOidcSession(page, { name: "Alex Morgan" });
		await page.goto("/");
		await page.getByRole("button", { name: /Alex Morgan Parent/ }).click();
		await expect(page.getByRole("link", { name: "Chores", exact: true })).toHaveCount(0);
		await page.getByRole("button", { name: /^Family tasks/ }).click();
		await expect(page.getByRole("button", { name: "Change family picture" })).toBeVisible();
		await expect(page.getByRole("heading", { name: "Book appointment" })).toBeVisible();
		if (viewport.name === "mobile") {
			// A full-height mobile host must not distribute spare height into grid rows.
			await page.locator(".v-family").evaluate((node) => {
				node.style.minHeight = "calc(100dvh - 100px)";
			});
			let previousPanelHeight: number | undefined;
			for (const height of [844, 1200]) {
				await page.setViewportSize({ width: viewport.width, height });
				const banner = (await page.locator(".v-family-banner").boundingBox())!;
				const panel = (await page.locator(".v-family-panel").boundingBox())!;
				expect(panel.y - banner.y - banner.height).toBeLessThanOrEqual(16);
				if (previousPanelHeight !== undefined)
					expect(Math.abs(panel.height - previousPanelHeight)).toBeLessThan(1);
				previousPanelHeight = panel.height;
			}
			await page.screenshot({
				path: `artifacts/family-mobile-spacing-${testInfo.project.name}.png`,
				fullPage: true,
			});
			await page.locator(".v-family").evaluate((node) => {
				node.style.minHeight = "";
			});
			await page.setViewportSize(viewport);
		}
		// Synthetic landscape: no family photograph or private information.
		const png = await page.evaluate(() => {
			const canvas = document.createElement("canvas");
			canvas.width = 1200;
			canvas.height = 600;
			const ctx = canvas.getContext("2d")!;
			ctx.fillStyle = "#c8e7ed";
			ctx.fillRect(0, 0, 1200, 600);
			ctx.fillStyle = "#ffe5a2";
			ctx.beginPath();
			ctx.arc(940, 135, 72, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = "#598e84";
			ctx.beginPath();
			ctx.moveTo(0, 420);
			ctx.quadraticCurveTo(350, 180, 700, 400);
			ctx.lineTo(1200, 300);
			ctx.lineTo(1200, 600);
			ctx.lineTo(0, 600);
			ctx.fill();
			ctx.fillStyle = "#305c57";
			ctx.beginPath();
			ctx.moveTo(0, 520);
			ctx.quadraticCurveTo(700, 280, 1200, 500);
			ctx.lineTo(1200, 600);
			ctx.lineTo(0, 600);
			ctx.fill();
			return canvas.toDataURL("image/png").split(",")[1];
		});
		await page.locator(".v-family-image-input").setInputFiles({
			name: "family-demo.png",
			mimeType: "image/png",
			buffer: Buffer.from(png, "base64"),
		});
		await expect(page.getByRole("button", { name: "Save picture", exact: true })).toBeVisible();
		await expect(page.getByText(/Picture not saved yet/)).toBeVisible();
		expect(stored).toBeUndefined();
		const controls = page.locator(".v-family-image-controls");
		const box = (await controls.boundingBox())!;
		const banner = (await page.locator(".v-family-banner").boundingBox())!;
		expect(box.y).toBeGreaterThanOrEqual(0);
		if (viewport.name === "mobile") expect(box.y).toBeGreaterThanOrEqual(banner.y + banner.height);
		await expect(page.getByRole("button", { name: "Crop", exact: true })).toBeVisible();
		if (process.env.VULTURE_CAPTURE_SCREENSHOTS && testInfo.project.name === "chromium") {
			await mkdir("docs/images/family-picture", { recursive: true });
			await page.screenshot({
				path: `docs/images/family-picture/${viewport.name}.png`,
				fullPage: true,
			});
		}
		await page.getByRole("button", { name: "Save picture", exact: true }).click();
		await expect(
			page
				.getByLabel("Notifications")
				.getByRole("status")
				.filter({ hasText: "Family picture updated." }),
		).toBeVisible();
		expect(stored!.contentType).toBe("image/png");
		expect(stored!.image.length).toBeGreaterThan(0);
		await page.reload();
		await expect(page.locator(".v-family-banner-img")).toBeVisible();
		await expect(page.getByText(/Picture not saved yet/)).toHaveCount(0);
		const tabs = page.getByRole("tablist", { name: "Family sections" });
		for (const label of ["Tasks", "Chart", "Manage"]) {
			const tab = tabs.getByRole("tab", { name: label, exact: true });
			await expect(tab).toBeVisible();
			await expect(tab.locator("span")).toHaveText(label);
		}
		await page.screenshot({
			path: `artifacts/family-body-tasks-${viewport.name}-${testInfo.project.name}.png`,
			fullPage: true,
		});
		await tabs.getByRole("tab", { name: "Tasks" }).focus();
		await page.keyboard.press("ArrowRight");
		await expect(page.getByRole("tabpanel", { name: "Chart" })).toBeVisible();
		await expect(
			page.getByRole("list", { name: "Family chart" }).getByText("Jamie Morgan"),
		).toBeVisible();
		await page.screenshot({
			path: `artifacts/family-chart-children-${viewport.name}-${testInfo.project.name}.png`,
			fullPage: true,
		});
		await page.keyboard.press("ArrowRight");
		await expect(page.getByRole("tabpanel", { name: "Manage" })).toBeVisible();
		await page
			.locator("summary")
			.filter({ hasText: /^Family services/ })
			.click();
		await expect(page.getByRole("button", { name: "Configure Storage" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Add relative" })).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true,
		);
		await page.screenshot({
			path: `artifacts/family-tabs-${viewport.name}-${testInfo.project.name}.png`,
			fullPage: true,
		});
		expect(
			await page
				.locator(".v-family-banner-img")
				.evaluate((image) => (image as HTMLImageElement).naturalWidth),
		).toBe(1200);
		await page.getByRole("tab", { name: "Tasks", exact: true }).click();
		await page.getByRole("button", { name: "Create task", exact: true }).click();
		const editor = page.getByRole("dialog", { name: "Create task ticket" });
		await editor.getByLabel("Summary").fill("Pack school bag");
		await editor.getByRole("combobox", { name: "Task category" }).selectOption("chore");
		await editor.getByRole("button", { name: "Select assignees…" }).click();
		await page.getByRole("option", { name: /Jamie Morgan/ }).click();
		await editor.getByLabel("Summary").click();
		await editor.getByRole("button", { name: "Select reviewers…" }).click();
		await expect(page.getByRole("option", { name: /Jamie Morgan/ })).toHaveCount(0);
		await editor.getByLabel("Summary").click();
		await page.screenshot({
			path: `artifacts/task-child-assignee-${viewport.name}-${testInfo.project.name}.png`,
			fullPage: true,
		});
		await editor.getByRole("button", { name: "Add task", exact: true }).click();
		const card = page.getByRole("article").filter({ hasText: "Pack school bag" });
		await expect(card.getByText(/Jamie Morgan/)).toBeVisible();
		await card.getByRole("button", { name: "Edit task", exact: true }).click();
		const editing = page.getByRole("dialog", { name: "Edit task ticket" });
		await expect(editing.getByRole("button", { name: /Jamie Morgan/ })).toBeVisible();
		await expect(editing.getByRole("combobox", { name: "Task category" })).toHaveValue("chore");
		await editing.getByLabel("Summary").fill("Pack bag tomorrow");
		await editing.getByRole("button", { name: "Save task", exact: true }).click();
		await expect(
			page
				.getByRole("article")
				.filter({ hasText: "Pack bag tomorrow" })
				.getByText(/Jamie Morgan/),
		).toBeVisible();
		await page.getByRole("combobox", { name: "Filter tasks" }).selectOption("chores");
		await expect(page.getByRole("heading", { name: "Book appointment" })).toHaveCount(0);
		await expect(page.getByRole("heading", { name: "Pack bag tomorrow" })).toBeVisible();
		await page.evaluate(() => {
			location.hash = "#/chores:list";
		});
		await expect(page.getByRole("combobox", { name: "Filter tasks" })).toHaveValue("chores");
		await page.screenshot({
			path: `artifacts/tasks-chores-${viewport.name}-${testInfo.project.name}.png`,
			fullPage: true,
		});
		await page
			.getByRole("article")
			.filter({ hasText: "Pack bag tomorrow" })
			.getByRole("button", { name: "Edit task", exact: true })
			.click();
		await page
			.getByRole("dialog", { name: "Edit task ticket" })
			.getByRole("combobox", { name: "Task category" })
			.selectOption("task");
		await page.getByRole("button", { name: "Save task", exact: true }).click();
		await expect(page.getByRole("heading", { name: "No chores yet" })).toBeVisible();
		await page.getByRole("combobox", { name: "Filter tasks" }).selectOption("all");
		await expect(page.getByRole("heading", { name: "Pack bag tomorrow" })).toBeVisible();
		await expect(page.getByRole("heading", { name: "Book appointment" })).toBeVisible();
	});
}
