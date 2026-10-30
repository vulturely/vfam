import { test, expect, seedOidcSession, openParentLearning } from "./fixtures";
import { nativeResponse } from "./nativeRpc";
import {
	AccountRole,
	LearningAgeBand,
	LearningProfile,
	SourceVersion,
	GeneratePracticeResponse,
	ParentPracticeQuestion,
	PracticeQuestionKind,
	ApprovePracticeResponse,
	TutorPracticeResponse,
	UncertainPracticeAnswer,
	GetHomeworkResponse,
	GetSourceSegmentsResponse,
} from "../../packages/core/src/api/protocol";
for (const theme of ["light", "dark"]) {
	test(`parent reviews practice and previews hints in ${theme} theme`, async ({
		page,
	}, testInfo) => {
		const parentId = "00000000-0000-0000-0000-000000000001";
		const familyId = "00000000-0000-0000-0000-000000000010";
		const profileId = "00000000-0000-0000-0000-000000000100";
		const homeworkId = "00000000-0000-0000-0000-000000000200";
		const source = new SourceVersion({
			id: "00000000-0000-0000-0000-000000000300",
			version: 2,
		});
		let set: GeneratePracticeResponse | undefined;
		let attempts = 0;
		let hints = 0;
		let uncertain: UncertainPracticeAnswer[] = [];
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
				case "GetAvatar":
				case "GetFamilyAvatar":
					return nativeResponse(route, {});
				case "GetTimetable":
					response = { timetable: { timezone: "UTC", windows: [] } };
					break;
				case "DownloadHomework":
					return nativeResponse(route, {
						content: new TextEncoder().encode("Worksheet source"),
						contentType: "text/plain",
					});
				case "GetParentPinAccess":
					return nativeResponse(route, { enabled: true });
				case "GetMyFamily":
					response = { family: { id: familyId, name: "Pilot family" } };
					break;
				case "GetAccount":
					response = {
						account: { id: input.accountId, displayName: "Alex", role: AccountRole.PARENT },
					};
					break;
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
					response = {
						items: [
							new GetHomeworkResponse({
								homework: {
									id: homeworkId,
									familyId,
									profileId,
									title: "Addition practice",
									subject: "Maths",
								},
								sources: [{ source, homeworkId, pageCount: 1 }],
							}),
						],
					};
					break;
				case "GetSourceSegments":
					expect(input.source).toEqual(source);
					response = new GetSourceSegmentsResponse({ source, state: "confirmed" });
					break;
				case "ListPractice":
					expect(input.source).toEqual(source);
					response = { sets: set ? [set] : [] };
					break;
				case "GeneratePractice": {
					expect(input.aiOptIn).toBe(true);
					expect(input.source).toEqual(source);
					expect(input.subject).toBe("math");
					expect(input.difficulty).toBe("easy");
					expect(input.maxQuestions).toBe(1);
					attempts++;
					if (attempts === 1) return nativeResponse(route, undefined, 14);
					set = new GeneratePracticeResponse({
						practice: {
							practice: { id: "set", version: 1 },
							source,
							title: "Addition draft",
							reviewState: "draft",
						},
						questions: [
							new ParentPracticeQuestion({
								question: {
									position: 1,
									kind: PracticeQuestionKind.SHORT_ANSWER,
									prompt: "What is 2 + 2?",
								},
								expectedAnswer: "4",
								hints: ["Count one group", "Count both groups"],
								sourceSegmentId: "region-1",
								sourceQuote: "Add 2 + 2",
								a: 2n,
								b: 2n,
								operation: "add",
							}),
						],
					});
					response = set;
					break;
				}
				case "RevisePractice": {
					expect(input.expectedPractice).toEqual(set!.practice!.practice);
					expect(input.title).toBe("Reviewed addition");
					expect(input.questions[0].hints[0]).toBe("Count each group first");
					set = new GeneratePracticeResponse({
						practice: {
							...set!.practice,
							practice: { id: "set", version: set!.practice!.practice!.version + 1 },
							title: input.title,
							reviewState: input.reject ? "rejected" : "draft",
						},
						questions: input.questions,
					});
					response = set;
					break;
				}
				case "ApprovePractice":
					expect(input.expectedPractice).toEqual(set!.practice!.practice);
					expect(set!.practice!.practice!.version).toBe(2);
					set!.practice!.reviewState = "approved";
					response = new ApprovePracticeResponse({ practice: set!.practice });
					break;
				case "TutorPractice": {
					expect(input.practice).toEqual(set!.practice!.practice);
					expect(set!.practice!.reviewState).toBe("approved");
					expect(input.position).toBe(1);
					if (input.requestHint) hints++;
					if (input.answer !== undefined) {
						expect(input.answer).toBe("four things");
						uncertain = [
							new UncertainPracticeAnswer({
								sessionId: "session",
								position: 1,
								answer: input.answer,
								prompt: "What is 2 + 2?",
							}),
						];
					}
					response = new TutorPracticeResponse({
						sessionId: "session",
						question: set!.questions[0].question,
						hint: hints > 0 && hints <= 2 ? set!.questions[0].hints[hints - 1] : "",
						revealedAnswer: hints >= 3 ? "4" : undefined,
						result: input.answer !== undefined ? "needs_review" : "",
					});
					break;
				}
				case "GetUncertainAnswers":
					expect(input.practice).toEqual(set!.practice!.practice);
					response = { answers: uncertain };
					break;
				default:
					throw new Error(`Unexpected RPC: ${method}`);
			}
			await nativeResponse(route, response);
		});
		await seedOidcSession(page);
		await page.addInitScript((value) => localStorage.setItem("vulture.theme", value), theme);
		await page.goto("/");
		await expect(page.locator("html")).toHaveAttribute("data-v-theme", theme);
		await openParentLearning(page);
		await page.getByRole("button", { name: /^Addition practice / }).click();
		await page.getByRole("button", { name: "Prepare practice", exact: true }).click();
		const review = page.getByRole("region", { name: "Parent practice review" });
		await review.getByLabel("Practice subject").selectOption("math");
		await review.getByLabel("Practice difficulty").selectOption("easy");
		await review.getByLabel("Maximum questions (1–12)").fill("1");
		const generate = review.getByRole("button", {
			name: "Generate practice draft",
			exact: true,
		});
		await expect(generate).toBeDisabled();
		await review.getByRole("checkbox", { name: /I allow AI/ }).check();
		await generate.click();
		const failure = page.getByRole("alert");
		await expect(failure).toBeVisible();
		await generate.click();
		await expect(failure).toHaveCount(0);
		await expect(review.getByLabel("Practice title")).toHaveValue("Addition draft");
		expect(attempts).toBe(2);
		const approve = review.getByRole("button", {
			name: "Approve practice set",
			exact: true,
		});
		const preview = review.getByRole("button", {
			name: "Preview tutor",
			exact: true,
		});
		await expect(preview).toBeDisabled();
		await review.getByLabel("Practice title").fill("Reviewed addition");
		await review.getByLabel("Hint 1 for question 1").fill("Count each group first");
		await expect(approve).toBeDisabled();
		await review.getByRole("button", { name: "Save practice edits as draft" }).click();
		await expect(approve).toBeEnabled();
		await expect(
			review.getByRole("button", { name: "Reviewed addition · draft · v2" }),
		).toBeVisible();
		await approve.click();
		await expect(preview).toBeEnabled();
		await preview.click();
		const tutor = review.getByRole("region", { name: "Tutor preview" });
		await expect(tutor.getByRole("heading", { name: "What is 2 + 2?" })).toBeVisible();
		for (const hint of ["Count each group first", "Count both groups"]) {
			await tutor.getByRole("button", { name: "Get next hint", exact: true }).click();
			await expect(tutor.getByText(`Hint: ${hint}`, { exact: true })).toBeVisible();
			await expect(tutor.getByText("Answer: 4", { exact: true })).toHaveCount(0);
		}
		await tutor.getByRole("button", { name: "Show answer after hints" }).click();
		await expect(tutor.getByText("Answer: 4", { exact: true })).toBeVisible();
		await expect(tutor.getByRole("button", { name: "Show answer after hints" })).toBeDisabled();
		await tutor.getByLabel("Tutor answer").fill("four things");
		await tutor.getByRole("button", { name: "Check answer", exact: true }).click();
		await expect(
			tutor.getByText("Uncertain grading — parent review needed", {
				exact: true,
			}),
		).toBeVisible();
		await review.getByRole("button", { name: "Load answers needing parent review" }).click();
		await expect(review.getByRole("list", { name: "Answers needing parent review" })).toContainText(
			"four things · Parent review needed",
		);
		await page.screenshot({
			path: testInfo.outputPath(`practice-${theme}-desktop.png`),
			fullPage: true,
		});
		await page.setViewportSize({ width: 390, height: 844 });
		await expect(tutor).toBeVisible();
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
		).toBe(true);
		await page.screenshot({
			path: testInfo.outputPath(`practice-${theme}-mobile.png`),
			fullPage: true,
		});
		await review.getByRole("button", { name: "Reject practice set", exact: true }).click();
		await expect(
			review.getByRole("button", { name: "Reviewed addition · rejected · v3" }),
		).toBeVisible();
		await expect(preview).toBeDisabled();
		await expect(approve).toBeDisabled();
		await expect(tutor).toHaveCount(0);
		expect(hints).toBe(3);
	});
}
