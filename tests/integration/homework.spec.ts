import { Buffer } from "node:buffer";
import { test, expect, seedOidcSession, openParentLearning } from "./fixtures";
import { nativeResponse } from "./nativeRpc";
import {
	AccountRole,
	LearningAgeBand,
	LearningProfile,
	ParseWorksheetDraftResponse,
	GetHomeworkResponse,
	HomeworkMediaType,
} from "../../packages/core/src/api/protocol";

const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
	"base64",
);

for (const theme of ["light", "dark"]) {
	test(`homework upload retries, previews and deletes in ${theme} theme`, async ({
		page,
	}, testInfo) => {
		const parentId = "00000000-0000-0000-0000-000000000001";
		const familyId = "00000000-0000-0000-0000-000000000010";
		const profileId = "00000000-0000-0000-0000-000000000100";
		const homeworkId = "00000000-0000-0000-0000-000000000200";
		let attempts = 0;
		let assigned = 0;
		let downloads = 0;
		let items: GetHomeworkResponse[] = [];
		await page.route("**/vulture.server.v1.VultureControl/*", async (route) => {
			if (route.request().method() === "OPTIONS") {
				await nativeResponse(route);
				return;
			}
			expect(route.request().headers().authorization).toBe(`Bearer vps_${"a".repeat(64)}`);
			const input = route.request().postDataJSON();
			const method = route.request().url().split("/").at(-1);
			let response: unknown;
			switch (method) {
				case "ListTasks":
				case "ReviewLearningSessions":
				case "ListPractice":
				case "GetAvatar":
				case "GetFamilyAvatar":
					return nativeResponse(route, {});
				case "GetTimetable":
					response = { timetable: { timezone: "UTC", windows: [] } };
					break;
				case "GetParentPinAccess":
					return nativeResponse(route, { enabled: true });
				case "GetMyFamily":
					response = { family: { id: familyId, name: "Pilot family" } };
					break;
				case "GetAccount": {
					response = {
						account: { id: input.accountId, displayName: "Alex", role: AccountRole.PARENT },
					};
					break;
				}
				case "ListFamilyMembers":
					response = { members: [{ accountId: parentId }] };
					break;
				case "ListLearningProfiles":
					response = {
						profiles: [
							new LearningProfile({
								id: profileId,
								familyId,
								displayName: "Jamie",
								ageBand: LearningAgeBand.PRIMARY,
								guardianAccountIds: [parentId],
							}),
						],
					};
					break;
				case "ListHomework":
					expect(input.profileId).toBe(profileId);
					response = { items };
					break;
				case "ParseWorksheetDraft": {
					response = new ParseWorksheetDraftResponse({
						segments: [
							{
								pageNumber: 1,
								ordinal: 0,
								text: "1. What is 2 + 3?",
								region: [10, 10, 800, 30],
							},
						],
						questions: [{ question: "What is 2 + 3?", answer: "", explanation: "" }],
						warnings: ["No answer found in worksheet."],
					});
					break;
				}
				case "CreateHomework": {
					expect(input.profileId).toBe(profileId);
					expect(input.title).toBe("Addition practice");
					expect(input.subject).toBe("Maths");
					expect(input.filename).toBe("worksheet.png");
					expect(input.declaredMediaType).toBe(HomeworkMediaType.PNG);
					expect(Buffer.from(input.content, "base64")).toEqual(png);
					attempts++;
					if (attempts === 1) return nativeResponse(route, undefined, 14);
					const item = new GetHomeworkResponse({
						homework: {
							id: homeworkId,
							familyId,
							profileId,
							title: input.title,
							subject: input.subject,
						},
						sources: [
							{
								source: { id: "source", version: 1 },
								homeworkId,
								mediaType: HomeworkMediaType.PNG,
								pageCount: 1,
							},
						],
						answerKey: input.answerKey,
						parserYaml: input.parserYaml,
					});
					items = [item];
					response = { homework: item.homework, source: item.sources[0] };
					break;
				}
				case "UpdateHomework": {
					expect(input.homeworkId).toBe(homeworkId);
					expect(input.expectedSource).toEqual({ id: "source", version: 1 });
					expect(input.answerKey.questions).toEqual([
						expect.objectContaining({
							kind: "short_answer",
							question: "What is 2 + 3?",
							answer: "5",
						}),
					]);
					items = [new GetHomeworkResponse({ ...items[0], answerKey: input.answerKey.questions })];
					response = items[0];
					break;
				}
				case "AssignHomework":
					expect(input.homeworkId).toBe(homeworkId);
					assigned++;
					response = { practice: { title: "Addition practice", origin: "assigned" } };
					break;
				case "DownloadHomework":
					expect(input.homeworkId).toBe(homeworkId);
					downloads++;
					response = { content: png, contentType: "image/png" };
					break;
				case "DeleteHomework":
					expect(input.homeworkId).toBe(homeworkId);
					items = [];
					response = {};
					break;
				default:
					throw new Error(`Unexpected RPC: ${method}`);
			}
			await nativeResponse(route, response);
		});
		await seedOidcSession(page);
		await page.addInitScript((value) => localStorage.setItem("vulture.theme", value), theme);
		await page.goto("/");
		await openParentLearning(page);
		await page.getByRole("button", { name: "Add homework", exact: true }).click();
		await page.getByRole("button", { name: /Manually/ }).click();
		await page.getByRole("button", { name: /^Upload/ }).click();
		await page.getByLabel("Homework title").fill("Addition practice");
		await page.getByLabel("Homework subject").fill("Maths");
		await page.getByLabel("Worksheet file").setInputFiles({
			name: "worksheet.png",
			mimeType: "image/png",
			buffer: png,
		});

		await page.getByRole("button", { name: "Read worksheet", exact: true }).click();
		await expect(page.getByText("What is 2 + 3?", { exact: true })).toBeVisible();
		await page.getByRole("button", { name: "Save homework", exact: true }).click();
		await expect(page.getByRole("alert")).toBeVisible();
		await page.getByRole("button", { name: "Save homework", exact: true }).click();
		// Wait for the creator (which has its own worksheet tabs) to close.
		await expect(page.getByRole("heading", { name: "New homework", exact: true })).toHaveCount(0);
		await expect(page.getByRole("tab", { name: "Q&A preview", exact: true })).toBeVisible();
		await page.getByRole("tab", { name: "Original", exact: true }).click();
		const preview = page.getByRole("img", {
			name: "Worksheet preview: Addition practice",
		});
		await expect(preview).toBeVisible();
		expect(attempts).toBe(2);
		await page.reload();
		await openParentLearning(page);
		await page.getByRole("button", { name: "Addition practice Maths", exact: true }).click();
		// Worksheets with questions open on their Q&A preview.
		await page.getByRole("tab", { name: "Original", exact: true }).click();
		await expect(preview).toBeVisible();
		await expect(preview).toHaveAttribute("src", /^blob:/);
		await expect.poll(() => downloads).toBe(2);
		// Questions live in their own view, opened from the row menu, not in the preview.
		await expect(page.getByRole("region", { name: "Questions for your child" })).toHaveCount(0);
		await page.getByRole("button", { name: "Actions for Addition practice", exact: true }).click();
		await page.getByRole("menuitem", { name: "Questions", exact: true }).click();
		const questions = page.getByRole("region", { name: "Questions for your child" });
		// Extracted questions need their answers before the child can answer them in the app.
		await expect(questions.getByText(/missing answers/)).toBeVisible();
		const assign = page.getByRole("button", { name: "Assign to child", exact: true });
		await expect(assign).toBeDisabled();
		await page.getByRole("button", { name: "Edit questions", exact: true }).click();
		// The edit form covers the title, subject and questions together.
		await page
			.getByRole("group", { name: "Question 1" })
			.getByLabel("Answer", { exact: true })
			.fill("5");
		await page.getByRole("button", { name: "Save homework changes" }).click();
		// Saving returns to the Questions view.
		await expect(questions.getByText("5", { exact: true })).toBeVisible();
		await assign.click();
		await expect(page.getByText(/^Assigned\. Your child/)).toBeVisible();
		expect(assigned).toBe(1);
		await page.getByRole("button", { name: "Addition practice Maths", exact: true }).click();
		await page.getByRole("tab", { name: "Original", exact: true }).click();
		await page.screenshot({
			path: testInfo.outputPath(`homework-${theme}-desktop.png`),
			fullPage: true,
		});
		await page.setViewportSize({ width: 390, height: 844 });
		await expect(preview).toBeVisible();
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
		).toBe(true);
		await page.getByRole("button", { name: "Back to homework list", exact: true }).click();
		await page
			.getByRole("button", {
				name: "Actions for Addition practice",
				exact: true,
			})
			.click();
		await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
		const modal = page.getByRole("alertdialog");
		await expect(modal).toBeVisible();
		await modal.getByRole("button", { name: "Delete", exact: true }).click();
		await expect(
			page.getByRole("button", {
				name: "Addition practice Maths",
				exact: true,
			}),
		).toHaveCount(0);
		expect(items).toHaveLength(0);
		await page.getByRole("button", { name: "Add homework", exact: true }).click();
		await page.getByRole("button", { name: /Manually/ }).click();
		await expect(page.getByRole("button", { name: /^Email/ })).toHaveCount(0);
		await expect(page.getByRole("button", { name: /Web page/ })).toHaveCount(0);
	});
}
