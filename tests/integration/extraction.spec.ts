import { test, expect, seedOidcSession, openParentLearning } from "./fixtures";
import { nativeResponse } from "./nativeRpc";
import {
	AccountRole,
	LearningAgeBand,
	LearningProfile,
	ConfirmSourceResponse,
	GetSourceSegmentsResponse,
	GetHomeworkResponse,
	SourceVersion,
	SourceSegment,
} from "../../packages/core/src/api/protocol";

for (const theme of ["light", "dark"]) {
	test(`parent corrects and approves OCR with retry in ${theme} theme`, async ({
		page,
	}, testInfo) => {
		const parentId = "00000000-0000-0000-0000-000000000001";
		const familyId = "00000000-0000-0000-0000-000000000010";
		const profileId = "00000000-0000-0000-0000-000000000100";
		const homeworkId = "00000000-0000-0000-0000-000000000200";
		let source = new SourceVersion({
			id: "00000000-0000-0000-0000-000000000300",
			version: 1,
		});
		let extractionState = "pending";
		let extracts = 0;
		let lists = 0;
		let loadedConfirmedVersion = false;
		let segments: SourceSegment[] = [];
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
					lists++;
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
					loadedConfirmedVersion ||= source.version === 2;
					response = new GetSourceSegmentsResponse({ source, state: extractionState, segments });
					break;
				case "ExtractHomework":
					expect(input.source).toEqual(source);
					extracts++;
					extractionState = extracts === 1 ? "provider_failed" : "extracted";
					segments =
						extracts === 1
							? []
							: [
									new SourceSegment({
										id: "region-1",
										source,
										pageNumber: 1,
										ordinal: 0,
										needsReview: true,
										confidence: 0.35,
										region: [10, 20, 300, 80],
									}),
								];
					response = new GetSourceSegmentsResponse({ source, state: extractionState, segments });
					break;
				case "ConfirmSource": {
					expect(input.expectedSource).toEqual(source);
					expect(input.corrections).toHaveLength(1);
					expect(input.corrections[0].text).toBe("What is 2 + 2?");
					expect(input.corrections[0].region).toEqual([10, 20, 300, 80]);
					source = new SourceVersion({ id: source.id, version: 2 });
					extractionState = "confirmed";
					segments = [
						new SourceSegment({
							...input.corrections[0],
							source,
							needsReview: false,
							confirmedAt: "2026-10-15T00:00:00Z",
						}),
					];
					response = new ConfirmSourceResponse({ source, segments });
					break;
				}
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
		await expect(page.getByRole("button", { name: "Review source text" })).toHaveCount(0);
		// Practice starts by reviewing the worksheet text it will be written from.
		await page.getByRole("button", { name: "Prepare practice", exact: true }).click();
		const practice = page.getByRole("region", { name: "Parent practice review" });
		await expect(practice.getByText(/Step 1 of 2: check the worksheet text/)).toBeVisible();
		await expect(practice.getByRole("button", { name: "Generate practice draft" })).toHaveCount(0);
		const review = practice.getByRole("region", { name: "Parent text review" });
		const extract = review.getByRole("button", {
			name: "Extract / retry text",
			exact: true,
		});
		await expect(extract).toBeEnabled();
		await expect(review.getByRole("textbox")).toHaveCount(0);
		await extract.click();
		const failure = page.getByRole("alert").filter({ hasText: "OCR could not finish" });
		await expect(failure).toBeVisible();
		await extract.click();
		await expect(failure).toHaveCount(0);
		const text = review.getByRole("textbox", { name: "Page 1 region 1 text" });
		await expect(text).toHaveValue("");
		await expect(review.getByText(/35% confidence.*Uncertain/)).toBeVisible();
		const approve = review.getByRole("button", {
			name: "Approve corrected source text",
			exact: true,
		});
		await expect(approve).toBeDisabled();
		await text.fill("   ");
		await expect(approve).toBeDisabled();
		await text.fill("What is 2 + 2?");
		await expect(approve).toBeEnabled();
		await page.screenshot({
			path: testInfo.outputPath(`extraction-${theme}-desktop.png`),
			fullPage: true,
		});
		await page.setViewportSize({ width: 390, height: 844 });
		await expect(text).toBeVisible();
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
		).toBe(true);
		await page.screenshot({
			path: testInfo.outputPath(`extraction-${theme}-mobile.png`),
			fullPage: true,
		});
		await approve.click({ noWaitAfter: true });
		// Once approved, practice moves straight on to generation.
		await expect(practice.getByRole("button", { name: "Generate practice draft" })).toBeVisible();
		await expect(practice.getByText(/Step 1 of 2/)).toHaveCount(0);
		await expect.poll(() => loadedConfirmedVersion).toBe(true);
		expect(source.version).toBe(2);
		expect(lists).toBeGreaterThanOrEqual(2);
		expect(extracts).toBe(2);
	});
}
