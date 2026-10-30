import { test, expect, seedOidcSession } from "./fixtures";
import { nativeResponse } from "./nativeRpc";
import { AccountRole, TaskStatus } from "../../packages/core/src/api/protocol";

for (const theme of ["light", "dark"]) {
	test(`attachment download uses current credentials; denial stays visible (${theme})`, async ({
		page,
	}, testInfo) => {
		let downloads = 0;
		let deny = false;
		await page.route("**/vulture.server.v1.VultureControl/*", async (route) => {
			if (route.request().method() === "OPTIONS") return nativeResponse(route);
			expect(route.request().headers().authorization).toBe(`Bearer vps_${"a".repeat(64)}`);
			const method = route.request().url().split("/").at(-1);
			const input = route.request().postDataJSON();
			switch (method) {
				case "ListLearningProfiles":
				case "GetAvatar":
				case "GetFamilyAvatar":
					return nativeResponse(route, {});
				case "GetMyFamily":
					return nativeResponse(route, { family: { id: "family", name: "Pilot family" } });
				case "ListFamilyMembers":
					return nativeResponse(route, {
						members: [{ id: "membership", familyId: "family", accountId: "parent" }],
					});
				case "GetAccount":
					return nativeResponse(route, {
						account: { id: input.accountId, displayName: "Alex", role: AccountRole.PARENT },
					});
				case "ListTasks":
					return nativeResponse(route, {
						tasks: [
							{
								id: "task",
								familyId: "family",
								title: "Homework",
								status: TaskStatus.TODO,
								documents: [
									{
										id: "doc",
										taskId: "task",
										name: "private.txt",
										contentType: "text/plain",
										size: BigInt(7),
										url: "https://public.invalid/must-not-use",
									},
								],
							},
						],
					});
				case "DownloadTaskDocument": {
					expect(input.taskId).toBe("task");
					expect(input.documentId).toBe("doc");
					downloads++;
					if (deny) return nativeResponse(route, undefined, 7);
					return nativeResponse(route, {
						name: "private.txt",
						contentType: "text/plain",
						content: new TextEncoder().encode("private"),
					});
				}
				default:
					throw new Error(`Unexpected RPC: ${method}`);
			}
		});
		await page.addInitScript((theme) => localStorage.setItem("vulture.theme", theme), theme);
		await seedOidcSession(page);
		await page.goto("/");
		await page.getByRole("link", { name: "Family", exact: true }).click();
		await expect(page.locator("html")).toHaveAttribute("data-v-theme", theme);
		const attachment = page.getByRole("button", {
			name: "private.txt",
			exact: true,
		});
		await expect(attachment).toBeVisible();
		expect(downloads).toBe(0);
		const downloaded = page.waitForEvent("download");
		await attachment.click();
		expect((await downloaded).suggestedFilename()).toBe("private.txt");
		expect(downloads).toBe(1);
		await page.reload();
		await page.getByRole("link", { name: "Family", exact: true }).click();
		await expect(attachment).toBeVisible();
		deny = true;
		await attachment.click();
		await expect(
			page.getByText("Document download failed. Check your access and try again."),
		).toBeVisible();
		expect(downloads).toBe(2);
		await page.screenshot({
			path: testInfo.outputPath(`private-attachment-${theme}-desktop.png`),
			fullPage: true,
		});
		await page.setViewportSize({ width: 390, height: 844 });
		await page.screenshot({
			path: testInfo.outputPath(`private-attachment-${theme}.png`),
			fullPage: true,
		});
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
		).toBe(true);
	});
}
