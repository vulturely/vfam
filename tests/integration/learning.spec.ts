import { nativeResponse } from "./nativeRpc";
import { Buffer } from "node:buffer";
import type { Page } from "@playwright/test";
import { test, expect, seedOidcSession } from "./fixtures";
import {
	AccountRole,
	LearningAgeBand,
	LearningAnswerResult,
	LearningSessionState,
	LearningProfile,
	Timetable,
	GetHomeworkResponse,
	HomeworkMediaType,
	GenerateHomeworkDraftResponse,
	ParseWorksheetDraftResponse,
} from "../../packages/core/src/api/protocol";

type LearningSchool = Record<string, unknown>;
async function mockLearningServer(page: Page, withFamily = true, names = ["Jamie"]) {
	const profiles: LearningProfile[] = withFamily
		? names.map(
				(displayName, index) =>
					new LearningProfile({
						id: `00000000-0000-0000-0000-${String(index + 100).padStart(12, "0")}`,
						familyId: "00000000-0000-0000-0000-000000000010",
						displayName,
						ageBand: LearningAgeBand.PRIMARY,
						grade: "Grade 2",
						guardianAccountIds: ["00000000-0000-0000-0000-000000000001"],
					}),
			)
		: [];
	const timetables = new Map<string, Timetable>();
	const schools = new Map<string, LearningSchool>();
	const voice = new Map<string, boolean>();
	const familyId = "00000000-0000-0000-0000-000000000010";
	const parentId = "00000000-0000-0000-0000-000000000001";
	await page.route("**/vulture.server.v1.VultureControl/*", async (route) => {
		if (route.request().method() === "OPTIONS") return nativeResponse(route);
		expect(route.request().headers().authorization).toBe(`Bearer vps_${"a".repeat(64)}`);
		const input = route.request().postDataJSON();
		const method = route.request().url().split("/").at(-1);
		let response: unknown;
		switch (method) {
			case "VoiceAssistant": {
				const command = JSON.parse(input.commandJson);
				if (command.type === "save_policy") voice.set(command.profile_id, command.enabled);
				response = {
					resultJson: JSON.stringify({
						enabled: voice.get(command.profile_id) ?? false,
						text: "",
						intent: "clarify",
					}),
				};
				break;
			}
			case "GetLearningSchool":
				response = schools.get(input.profileId) ?? {};
				break;
			case "SaveLearningSchool": {
				const school = input.school ?? {};
				schools.set(input.profileId, school);
				response = school;
				break;
			}
			case "GetChildPinAccess":
			case "ListTasks":
				response = {};
				break;
			case "GetTimetable":
				response = {
					timetable:
						timetables.get(profiles[0]?.id) ?? new Timetable({ timezone: "UTC", windows: [] }),
				};
				break;
			case "SetProfileTimezone": {
				const current = timetables.get(input.profileId) ?? new Timetable({ timezone: "UTC" });
				current.timezone = input.timezone;
				current.overrideUntil = undefined;
				timetables.set(input.profileId, current);
				response = { timetable: current };
				break;
			}
			case "SaveCalendar": {
				const current = timetables.get(input.profileId) ?? new Timetable({ timezone: "UTC" });
				current.entries = input.entries;
				current.overrideUntil = undefined;
				timetables.set(input.profileId, current);
				response = { timetable: current };
				break;
			}
			case "SaveTimetable": {
				expect(profiles.some((p) => p.id === input.profileId)).toBe(true);
				expect(input.timetable?.overrideUntil).toBeUndefined();
				timetables.set(input.profileId, input.timetable!);
				response = { timetable: input.timetable };
				break;
			}
			case "OverrideTimetable": {
				expect(input.minutes).toBe(20);
				expect(input.reason).toBe("Finish reading");
				const timetable = timetables.get(input.profileId)!;
				timetable.overrideUntil = new Date(Date.now() + 1200000).toISOString();
				response = { timetable };
				break;
			}
			case "GetMyFamily":
				response = { family: withFamily ? { id: familyId, name: "Pilot family" } : undefined };
				break;
			case "ListFamilyMembers":
				response = { members: [{ accountId: parentId }, { accountId: "adult-member" }] };
				break;
			case "GetAccount": {
				response = {
					account: {
						id: input.accountId,
						displayName: input.accountId === parentId ? "Alex" : "Morgan",
						role: AccountRole.PARENT,
					},
				};
				break;
			}
			case "GetAvatar":
			case "GetFamilyAvatar":
				response = {};
				break;
			case "ListLearningProfiles":
				response = { profiles };
				break;
			case "ReviewLearningSessions": {
				expect(profiles.some((p) => p.id === input.profileId)).toBe(true);
				response = {
					attempts: [
						{
							homeworkTitle: "Spelling practice",
							subject: "English",
							totalQuestions: 3,
							session: {
								id: "attempt",
								profileId: input.profileId,
								state: LearningSessionState.CANCELLED,
								createdAt: "2026-10-15T12:00:00Z",
								updatedAt: "2026-10-15T12:04:32Z",
							},
							helpRequested: true,
							answers: [
								{
									id: "answer",
									position: 1,
									prompt: "Spell the fruit",
									answer: "aple",
									result: LearningAnswerResult.NEEDS_REVIEW,
									createdAt: "2026-10-15T12:01:00Z",
								},
							],
						},
					],
				};
				break;
			}
			case "ListHomework":
				response = { items: [] };
				break;
			case "CreateLearningProfile": {
				expect(input.familyId).toBe(familyId);
				const profile = new LearningProfile({
					...input,
					id: `00000000-0000-0000-0000-${String(profiles.length + 100).padStart(12, "0")}`,
					guardianAccountIds: [parentId],
					createdAt: new Date().toISOString(),
				});
				profiles.push(profile);
				response = { profile };
				break;
			}
			case "AddLearningGuardian": {
				const profile = profiles.find((p) => p.id === input.profileId)!;
				profile.guardianAccountIds = [
					...new Set([...profile.guardianAccountIds, input.guardianAccountId]),
				];
				response = { profile };
				break;
			}
			case "RemoveLearningGuardian": {
				const profile = profiles.find((p) => p.id === input.profileId)!;
				profile.guardianAccountIds = profile.guardianAccountIds.filter(
					(id) => id !== input.guardianAccountId,
				);
				response = { profile };
				break;
			}
			default:
				throw new Error(`Unexpected RPC: ${method}`);
		}
		await nativeResponse(route, response);
	});
}

test("parent selects, shares and revokes a profile; reload persists data", async ({
	page,
}, testInfo) => {
	await mockLearningServer(page);
	await seedOidcSession(page, { name: "Alex" });
	await page.goto("/#/home:parent");
	await page.getByRole("link", { name: "Learning", exact: true }).click();
	await page.getByRole("tab", { name: "Setting", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Add a child profile" })).toHaveCount(0);
	await expect(page.getByRole("list", { name: "Learning profiles" })).toHaveCount(0);
	await expect(page.locator(".selected-child").getByText("Jamie", { exact: true })).toBeVisible();
	await page
		.locator("summary")
		.filter({ hasText: /^Guardian access/ })
		.click();
	await expect(page.getByRole("button", { name: "Remove guardian" })).toBeDisabled();
	await page.getByLabel("Share with a parent").selectOption("adult-member");
	await page.getByRole("button", { name: "Add guardian", exact: true }).click();
	await expect(page.getByText("2 guardian(s) can manage this profile.")).toBeVisible();
	const guardians = page.getByRole("list", { name: "Profile guardians" });
	await guardians
		.getByRole("listitem")
		.filter({ hasText: "Morgan" })
		.getByRole("button", { name: "Remove guardian" })
		.click();
	await expect(page.getByText("Guardian access removed.")).toBeVisible();
	await page.reload();
	await expect(page).toHaveURL(/#\/learning:profiles$/);
	await page.getByRole("tab", { name: "Setting", exact: true }).click();
	await expect(page.locator(".selected-child").getByText("Jamie", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Assignment", exact: true }).click();
	await page.getByRole("button", { name: "Attempts", exact: true }).click();
	const attempts = page.getByRole("region", { name: "Child attempts" });
	await expect(attempts.getByText("aple", { exact: true })).toBeVisible();
	await expect(attempts.getByText("Help requested")).toBeVisible();
	await expect(attempts.getByText(/Needs review/)).toBeVisible();
	await expect(attempts.getByRole("textbox")).toHaveCount(0);
	await page.screenshot({
		path: testInfo.outputPath("learning-desktop.png"),
		fullPage: true,
	});
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(page.locator(".selected-child").getByText("Jamie", { exact: true })).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true,
	);
	await page.screenshot({
		path: testInfo.outputPath("learning-mobile.png"),
		fullPage: true,
	});
});

test("profile creation requires an existing family", async ({ page }) => {
	await mockLearningServer(page, false);
	await seedOidcSession(page);
	await page.goto("/#/home:parent");
	await expect(page.getByRole("heading", { name: "Your profile" })).toBeVisible();
	await expect(page.getByRole("button", { name: "3 Children" })).toBeDisabled();
	await page.getByRole("button", { name: "Continue" }).click();
	await expect(page.getByLabel("Family name")).toBeVisible();
	await expect(page.getByLabel("Child's name")).toHaveCount(0);
});

for (const theme of ["light", "dark"]) {
	test(`parent configures overnight timetable, break, timezone and audited override (${theme})`, async ({
		page,
	}, testInfo) => {
		await mockLearningServer(page);
		await seedOidcSession(page);
		await page.addInitScript((theme) => localStorage.setItem("vulture.theme", theme), theme);
		await page.goto("/#/home:parent");
		await expect(page.locator("html")).toHaveAttribute("data-v-theme", theme);
		await page.getByRole("link", { name: "Learning", exact: true }).click();
		await page.getByRole("tab", { name: "Setting", exact: true }).click();
		await page
			.locator("summary")
			.filter({ hasText: /^Timezone/ })
			.click();
		await page.getByLabel("Child timezone", { exact: true }).selectOption("America/Chicago");
		await page.getByRole("button", { name: "Save profile timezone" }).click();
		await expect(page.getByRole("button", { name: "Save profile timezone" })).toHaveCount(0);
		await page.getByRole("tab", { name: "Time Table", exact: true }).click();
		await page.getByRole("button", { name: "Weekly rules and override" }).click();
		await expect(page.getByRole("button", { name: "Add window" })).toBeEnabled();
		await page.getByRole("button", { name: "Add window" }).click();
		const dialog = page.getByRole("dialog", { name: "Add window" });
		await dialog.getByRole("radio", { name: "Sunday" }).click();
		await dialog.getByLabel("Start", { exact: true }).fill("23:00");
		await dialog.getByLabel("End", { exact: true }).fill("02:00");
		await page.screenshot({ path: testInfo.outputPath(`timetable-add-${theme}.png`) });
		await dialog.getByRole("button", { name: "Save", exact: true }).click();
		await expect(dialog).toHaveCount(0);
		await page.getByRole("button", { name: "Add window" }).click();
		await dialog.getByRole("combobox", { name: "Activity" }).selectOption("break");
		await dialog.getByRole("button", { name: "Save", exact: true }).click();
		await expect(dialog).toHaveCount(0);
		await expect(page.getByText(/Timetable saved/)).toBeVisible();
		await page.reload();
		await page.getByRole("link", { name: "Learning", exact: true }).click();
		await page.getByRole("tab", { name: "Time Table", exact: true }).click();
		await page.getByRole("button", { name: "Weekly rules and override" }).click();
		await expect(page.getByRole("button", { name: "Edit Sunday Study 23:00–02:00" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Edit Monday Break 16:00–17:00" })).toBeVisible();
		await expect(page.getByLabel("Child timezone")).toHaveCount(0);
		await expect(
			page.getByText(/Weekly rules repeat in the profile timezone: America\/Chicago/),
		).toBeVisible();
		await page.getByLabel("Override minutes (1–60)").fill("20");
		await page.getByLabel("Override reason").fill("Finish reading");
		await page.getByRole("button", { name: "Grant override" }).click();
		await expect(page.getByText("Temporary override granted and audited.")).toBeVisible();
		await page.screenshot({
			path: testInfo.outputPath(`timetable-${theme}.png`),
			fullPage: true,
		});
		await page.setViewportSize({ width: 390, height: 844 });
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
		).toBe(true);
		await page.screenshot({
			path: testInfo.outputPath(`timetable-${theme}-mobile.png`),
			fullPage: true,
		});
		// The sheet fits a phone screen, and edits and deletes save without a separate button.
		await page.getByRole("button", { name: "Edit Monday Break 16:00–17:00" }).click();
		const edit = page.getByRole("dialog", { name: "Edit window" });
		await expect(edit.getByRole("radio", { name: "Monday" })).toHaveAttribute(
			"aria-checked",
			"true",
		);
		await expect(edit.getByRole("combobox", { name: "Activity" })).toHaveValue("break");
		const sheet = await edit.boundingBox();
		expect(sheet!.x).toBeGreaterThanOrEqual(0);
		expect(sheet!.x + sheet!.width).toBeLessThanOrEqual(390);
		for (const control of [
			edit.getByRole("radio", { name: "Sunday" }),
			edit.getByRole("combobox", { name: "Activity" }),
			edit.getByRole("button", { name: "Save", exact: true }),
		]) {
			const box = (await control.boundingBox())!;
			expect(box.x + box.width).toBeLessThanOrEqual(sheet!.x + sheet!.width);
			// One line: the label never wraps inside the control.
			expect(box.height).toBeLessThan(48);
		}
		await page.screenshot({ path: testInfo.outputPath(`timetable-edit-${theme}-mobile.png`) });
		await edit.getByLabel("End", { exact: true }).fill("18:30");
		await edit.getByRole("button", { name: "Save", exact: true }).click();
		await expect(edit).toHaveCount(0);
		await page.getByRole("button", { name: "Delete Sunday Study 23:00–02:00" }).click();
		await expect(page.getByRole("button", { name: /^(Edit|Delete) Sunday/ })).toHaveCount(0);
		await page.reload();
		await page.getByRole("tab", { name: "Time Table", exact: true }).click();
		await page.getByRole("button", { name: "Weekly rules and override" }).click();
		await expect(page.getByRole("button", { name: "Edit Monday Break 16:00–18:30" })).toBeVisible();
		await expect(page.getByRole("button", { name: /Edit Sunday/ })).toHaveCount(0);
	});
}

for (const width of [320, 390, 1440]) {
	test(`learning card fills its content area and switches children at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 900 });
		await mockLearningServer(page, true, ["Jamie", "Taylor"]);
		await seedOidcSession(page);
		await page.goto("/#/home:parent");
		await page.getByRole("button", { name: /Children’s learning/ }).click();
		await page.getByRole("button", { name: "Next child" }).click();
		await page.getByRole("tab", { name: "Assignment", exact: true }).click();
		await page.getByRole("button", { name: "Previous child" }).click();
		await expect(page.locator(".selected-child").getByText("Jamie", { exact: true })).toBeVisible();
		await expect(page.getByRole("button", { name: "Previous child" })).toBeDisabled();
		await page.getByRole("tab", { name: "Time Table", exact: true }).click();
		await page.getByRole("button", { name: "Next child" }).click();
		await expect(
			page.locator(".selected-child").getByText("Taylor", { exact: true }),
		).toBeVisible();
		await expect(page.getByRole("tab", { name: "Time Table", exact: true })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await expect(
			page.getByRole("region", { name: "Timetable calendar", exact: true }),
		).toBeInViewport();
		const layout = await page.locator("section.learning").evaluate((node) => {
			const card = node.getBoundingClientRect();
			const main = node.closest("main")!;
			const bounds = main.getBoundingClientRect();
			const style = getComputedStyle(main);
			const contentHeight =
				main.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
			return {
				width: card.width,
				height: card.height,
				expectedWidth:
					main.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
				expectedHeight: contentHeight,
				x: card.x + card.width / 2,
				centerX: bounds.x + bounds.width / 2,
				y: card.y + card.height / 2,
				centerY: bounds.y + parseFloat(style.paddingTop) + contentHeight / 2,
				radius: parseFloat(getComputedStyle(node).borderRadius),
			};
		});
		expect(Math.abs(layout.width - layout.expectedWidth)).toBeLessThan(2);
		expect(Math.abs(layout.height - layout.expectedHeight)).toBeLessThan(2);
		expect(Math.abs(layout.x - layout.centerX)).toBeLessThan(2);
		expect(Math.abs(layout.y - layout.centerY)).toBeLessThan(2);
		if (width <= 760) expect(layout.radius).toBe(0);
		else expect(layout.radius).toBeGreaterThan(0);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true,
		);
		await page.screenshot({
			path: `artifacts/learning-card-${width}-${testInfo.project.name}.png`,
			fullPage: true,
		});
	});
}

for (const width of [390, 1440]) {
	test(`Homework bottom bar stays visible and opens its three views at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 900 });
		await mockLearningServer(page);
		await seedOidcSession(page);
		await page.goto("/#/home:parent");
		await page.getByRole("button", { name: /Children’s learning/ }).click();
		const bar = page.getByRole("navigation", { name: "Homework sections" });
		await expect(bar).toBeInViewport();
		await expect(bar.getByRole("button")).toHaveCount(3);
		const before = (await bar.boundingBox())!;
		await page.locator(".learning-content").evaluate((node) => {
			node.scrollTop = node.scrollHeight;
		});
		expect((await bar.boundingBox())!.y).toBeCloseTo(before.y, 0);
		await bar.getByRole("button", { name: "History", exact: true }).click();
		await expect(page.getByRole("heading", { name: "Homework history" })).toBeVisible();
		await expect(page.getByLabel("Homework title")).toHaveCount(0);
		const history = page.getByRole("region", { name: "Homework test history" });
		await expect(history.getByText("Spelling practice", { exact: true })).toBeVisible();
		await expect(history.getByText("Stopped", { exact: true })).toBeVisible();
		await expect(history.getByText("4m 32s")).toBeVisible();
		await history.locator("summary").click();
		await expect(history.getByText("aple", { exact: true })).toBeVisible();
		await expect(history.getByText("Needs review", { exact: true })).toBeVisible();
		await expect
			.poll(() => history.locator("details").evaluate((node) => node.style.height))
			.toBe("");
		await page.screenshot({
			path: `artifacts/homework-test-history-${width}-${testInfo.project.name}.png`,
			fullPage: true,
		});
		await bar.getByRole("button", { name: "Attempts", exact: true }).click();
		await expect(
			page.getByRole("region", { name: "Child attempts" }).getByText("aple", { exact: true }),
		).toBeVisible();
		await page.screenshot({
			path: `artifacts/homework-attempts-${width}-${testInfo.project.name}.png`,
			fullPage: true,
		});
		await bar.getByRole("button", { name: "Homework", exact: true }).click();
		await expect(page.getByRole("searchbox", { name: "Search homework" })).toBeVisible();
		await page.screenshot({
			path: `artifacts/homework-bottom-bar-${width}-${testInfo.project.name}.png`,
			fullPage: true,
		});
	});
}

for (const width of [390, 1440]) {
	test(`homework vertical creator reviews AI answer keys at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 900 });
		await mockLearningServer(page);
		await seedOidcSession(page);
		await page.route("**/vulture.server.v1.VultureControl/GenerateHomeworkDraft", async (route) => {
			if (route.request().method() !== "OPTIONS") {
				const input = route.request().postDataJSON();
				expect(input.topic).toBe("Addition");
				expect(input.aiOptIn).toBe(true);
			}
			await nativeResponse(
				route,
				new GenerateHomeworkDraftResponse({
					title: "Addition",
					questions: [
						{
							question: "What is 2 + 3?",
							answer: "5",
							explanation: "Add two and three to get five.",
						},
					],
				}),
			);
		});
		await page.route("**/vulture.server.v1.VultureControl/CreateHomework", async (route) => {
			if (route.request().method() !== "OPTIONS") {
				const input = route.request().postDataJSON();
				expect(input.answerKey[0].answer).toBe("5");
				expect(input.answerKey[0].explanation).toContain("five");
				expect(input.content.length).toBe(0);
			}
			await nativeResponse(route, {});
		});
		await page.goto("/#/home:parent");
		await page.getByRole("button", { name: /Children’s learning/ }).click();
		await page.getByRole("button", { name: "Add homework", exact: true }).click();
		await expect(
			page.getByRole("heading", {
				name: "How would you like to create homework?",
			}),
		).toBeVisible();
		const methodLayout = await page.locator(".creator").evaluate((form) => {
			const stage = form.querySelector(".stage")!.getBoundingClientRect();
			const heading = form.querySelector(".method-heading")!.getBoundingClientRect();
			const choices = form.querySelector(".method-choices")!.getBoundingClientRect();
			return {
				center: (heading.top + choices.bottom) / 2,
				expected: stage.top + stage.height / 2,
				headingAlign: getComputedStyle(form.querySelector(".method-heading")!).textAlign,
				gap: choices.top - heading.bottom,
			};
		});
		expect(Math.abs(methodLayout.center - methodLayout.expected)).toBeLessThan(16);
		expect(methodLayout.headingAlign).toBe("left");
		expect(methodLayout.gap).toBeGreaterThan(20);
		await page.screenshot({
			path: `artifacts/homework-method-${width}-${testInfo.project.name}.png`,
			fullPage: true,
		});
		await page.getByRole("button", { name: /Automatically/ }).click();
		await page.getByLabel("Topic", { exact: true }).fill("Addition");
		await page.getByLabel("Subject", { exact: true }).fill("Math");
		await page.getByRole("checkbox").check();
		await page.getByRole("button", { name: "Generate homework", exact: true }).click();
		await expect(page.getByLabel("Answer", { exact: true })).toHaveValue("5");
		await expect(page.getByLabel(/^Explanation/)).toHaveValue("Add two and three to get five.");
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true,
		);
		await page.locator(".detail-body").evaluate((node) => {
			node.scrollTop = 0;
		});
		await page.screenshot({
			path: `artifacts/homework-creator-${width}-${testInfo.project.name}.png`,
			fullPage: true,
		});
		await page.getByRole("button", { name: "Save homework", exact: true }).click();
		await expect(page.getByRole("heading", { name: "New homework", exact: true })).toHaveCount(0);
	});
}

for (const width of [390, 1440]) {
	test(`glass worksheet upload supports picker and drop at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 900 });
		await mockLearningServer(page);
		await seedOidcSession(page);
		await page.goto("/#/home:parent");
		await page.getByRole("button", { name: /Children’s learning/ }).click();
		await page.getByRole("button", { name: "Add homework", exact: true }).click();
		await page.getByRole("button", { name: /Manually/ }).click();
		await page.getByRole("button", { name: /^Upload/ }).click();
		await expect(page.getByText("Choose a file or drop it here")).toBeVisible();
		await page.getByLabel("Homework title", { exact: true }).fill("Fractions");
		await page.getByLabel("Homework subject", { exact: true }).fill("Math");
		await page.getByLabel("Worksheet file", { exact: true }).setInputFiles({
			name: "worksheet.png",
			mimeType: "image/png",
			buffer: Buffer.from("png-fixture"),
		});
		await expect(page.locator(".dropzone strong")).toHaveText("worksheet.png");
		await page.locator(".dropzone").evaluate((node) => {
			const transfer = new DataTransfer();
			transfer.items.add(
				new File(["invalid"], "unsafe.exe", {
					type: "application/octet-stream",
				}),
			);
			node.dispatchEvent(
				new DragEvent("drop", {
					bubbles: true,
					cancelable: true,
					dataTransfer: transfer,
				}),
			);
		});
		await expect(page.getByRole("alert")).toHaveText("Choose one supported file.");
		await page.locator(".dropzone").evaluate((node) => {
			const transfer = new DataTransfer();
			transfer.items.add(new File(["new-png"], "replacement.png", { type: "image/png" }));
			node.dispatchEvent(
				new DragEvent("drop", {
					bubbles: true,
					cancelable: true,
					dataTransfer: transfer,
				}),
			);
		});
		await expect(page.locator(".dropzone strong")).toHaveText("replacement.png");
		await expect(page.getByRole("alert")).toHaveCount(0);
		expect(
			await page
				.getByLabel("Worksheet file", { exact: true })
				.evaluate((input: HTMLInputElement) => input.files?.[0]?.name),
		).toBe("replacement.png");
		await page.screenshot({
			path: `artifacts/homework-upload-${width}-${testInfo.project.name}.png`,
			fullPage: true,
		});
	});
}

for (const width of [390, 1440]) {
	test(`typed homework takes plain instructions and questions at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 900 });
		await mockLearningServer(page);
		await seedOidcSession(page);
		await page.route("**/vulture.server.v1.VultureControl/CreateHomework", async (route) => {
			if (route.request().method() !== "OPTIONS") {
				const input = route.request().postDataJSON();
				expect(input.title).toBe("Addition");
				expect(Buffer.from(input.content, "base64").toString()).toBe("Use your fingers.");
				expect(input.answerKey).toEqual([
					expect.objectContaining({ kind: "short_answer", question: "2 + 3?", answer: "5" }),
				]);
			}
			await nativeResponse(route, {});
		});
		await page.goto("/#/home:parent");
		await page.getByRole("button", { name: /Children’s learning/ }).click();
		await page.getByRole("button", { name: "Add homework", exact: true }).click();
		await page.getByRole("button", { name: /Manually/ }).click();
		await page.getByRole("button", { name: /Type it/ }).click();
		await page.getByLabel("Homework title", { exact: true }).fill("Addition");
		await page.getByLabel("Homework subject", { exact: true }).fill("Math");
		const instructions = page.getByLabel("Homework instructions", { exact: true });
		await instructions.fill("Use your fingers.");
		await page.getByRole("button", { name: "Add question", exact: true }).click();
		const question = page.getByRole("group", { name: "Question 1" });
		await question.getByLabel("Question", { exact: true }).fill("2 + 3?");
		await question.getByLabel("Answer", { exact: true }).fill("5");
		await expect(page.getByLabel("Homework title", { exact: true })).toBeInViewport();
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
		).toBe(true);
		await page.screenshot({
			path: `artifacts/homework-typed-${width}-${testInfo.project.name}.png`,
			fullPage: true,
		});
		await page.getByRole("button", { name: "Next step", exact: true }).click();
		await expect(page.getByRole("heading", { name: "Review homework", exact: true })).toBeVisible();
		await expect(page.getByText("Use your fingers.")).toBeVisible();
		await page.getByRole("button", { name: "Previous step", exact: true }).click();
		await expect(instructions).toHaveValue("Use your fingers.");
		await page.getByRole("button", { name: "Next step", exact: true }).click();
		await page.getByRole("button", { name: "Save homework", exact: true }).click();
		await expect(page.getByRole("heading", { name: "New homework", exact: true })).toHaveCount(0);
	});
}

test("storage save errors expose the real message and preserve the homework draft", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 900 });
	await mockLearningServer(page);
	await seedOidcSession(page);
	let writes = 0;
	await page.route("**/vulture.server.v1.VultureControl/CreateHomework", async (route) => {
		if (route.request().method() === "OPTIONS") {
			await nativeResponse(route);
			return;
		}
		writes++;
		if (writes === 1) {
			await route.fulfill({
				status: 200,
				headers: {
					"content-type": "application/json",
					"x-native-error-code": "9",
					"x-native-error-message": encodeURIComponent(
						"Configure family storage in Family setup before saving homework.",
					),
				},
				body: "{}",
			});
		} else await nativeResponse(route, {});
	});
	await page.goto("/#/home:parent");
	await page.getByRole("button", { name: /Children’s learning/ }).click();
	await page.getByRole("button", { name: "Add homework", exact: true }).click();
	await page.getByRole("button", { name: /Manually/ }).click();
	await page.getByRole("button", { name: /Type it/ }).click();
	await page.getByLabel("Homework title", { exact: true }).fill("Work problem");
	await page.getByLabel("Homework subject", { exact: true }).fill("Math");
	await page
		.getByLabel("Homework instructions", { exact: true })
		.fill("If there are 12 people working on 6 tasks, how many people work on each task?");
	await page.getByRole("button", { name: "Next step", exact: true }).click();
	await page.getByRole("button", { name: "Save homework", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText("Configure family storage");
	await expect(page.getByRole("alert")).not.toContainText("missing trailer");
	await expect(page.getByLabel("Homework title", { exact: true })).toHaveValue("Work problem");
	await page.getByRole("button", { name: "Previous step", exact: true }).click();
	await expect(page.getByLabel("Homework instructions", { exact: true })).toHaveValue(
		/12 people working on 6 tasks/,
	);
	await page.getByRole("button", { name: "Next step", exact: true }).click();
	await page.getByRole("button", { name: "Save homework", exact: true }).click();
	await expect(page.getByRole("heading", { name: "New homework", exact: true })).toHaveCount(0);
	expect(writes).toBe(2);
});

for (const width of [390, 1440]) {
	test(`homework row previews and ellipsis edits or confirms deletion at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 900 });
		await mockLearningServer(page);
		await seedOidcSession(page);
		let doc = new GetHomeworkResponse({
			homework: {
				id: "doc",
				title: "Fractions",
				subject: "Math",
				uploadedBy: "00000000-0000-0000-0000-000000000001",
				createdAt: "2026-10-19T06:28:52Z",
			},
			sources: [
				{
					source: { id: "source", version: 1 },
					mediaType: HomeworkMediaType.TEXT,
					pageCount: 1,
				},
			],
			answerKey: [{ question: "2 + 3?", answer: "5", explanation: "Add two and three." }],
		});
		let text = "**Original question**";
		let removed = false;
		let deletes = 0;
		let downloads = 0;
		await page.route("**/vulture.server.v1.VultureControl/ListHomework", (route) =>
			nativeResponse(route, { items: removed ? [] : [doc] }),
		);
		await page.route("**/vulture.server.v1.VultureControl/DownloadHomework", async (route) => {
			if (route.request().method() !== "OPTIONS") downloads++;
			await nativeResponse(route, {
				content: new TextEncoder().encode(text),
				contentType: "text/plain",
			});
		});
		await page.route("**/vulture.server.v1.VultureControl/UpdateHomework", async (route) => {
			if (route.request().method() !== "OPTIONS") {
				const input = route.request().postDataJSON();
				expect(input.homeworkId).toBe("doc");
				expect(input.expectedSource?.version).toBe(1);
				text = Buffer.from(input.content, "base64").toString();
				doc = new GetHomeworkResponse({
					homework: { id: "doc", title: input.title, subject: input.subject },
					sources: [
						{
							source: { id: "source", version: 2 },
							mediaType: HomeworkMediaType.TEXT,
							pageCount: 1,
						},
					],
				});
			}
			await nativeResponse(route, doc);
		});
		await page.route("**/vulture.server.v1.VultureControl/DeleteHomework", async (route) => {
			if (route.request().method() !== "OPTIONS") {
				deletes++;
				removed = true;
			}
			await nativeResponse(route, {});
		});
		await page.goto("/#/home:parent");
		await page.getByRole("button", { name: /Children’s learning/ }).click();
		const row = page.getByRole("listitem").filter({
			has: page.getByRole("button", { name: "Fractions Math", exact: true }),
		});
		await expect(row.getByText("Math · by Alex")).toBeVisible();
		await expect(row.locator("time")).toHaveAttribute("datetime", "2026-10-19T06:28:52Z");
		expect((await row.boundingBox())!.height).toBeLessThanOrEqual(64);
		const backgrounds = await row.evaluate((node) => ({
			main: getComputedStyle(node.querySelector(".assignment")!).backgroundColor,
			menu: getComputedStyle(node.querySelector(".homework-menu-trigger")!).backgroundColor,
		}));
		expect(backgrounds.main).toBe(backgrounds.menu);
		await page.getByRole("button", { name: "Fractions Math", exact: true }).click();
		await expect(page.getByRole("region", { name: "Homework preview" })).toContainText(
			"Original question",
		);
		expect(downloads).toBe(1);
		await expect(page.getByLabel("Homework document")).toContainText("**Original question**");
		await expect(page.getByRole("region", { name: "Questions for your child" })).toHaveCount(0);
		const tooltipLayout = await page
			.getByRole("button", { name: "Prepare practice", exact: true })
			.evaluate((button) => {
				const tooltip = getComputedStyle(button, "::after");
				const bounds = button.getBoundingClientRect();
				return {
					left: tooltip.left,
					right: tooltip.right,
					transform: tooltip.transform,
					cardRight: button.closest(".learning")!.getBoundingClientRect().right,
					buttonRight: bounds.right,
				};
			});
		expect(tooltipLayout.right).toBe("0px");
		expect(tooltipLayout.transform).toBe("none");
		expect(tooltipLayout.buttonRight).toBeLessThan(tooltipLayout.cardRight);
		await expect(page.getByRole("button", { name: "Edit homework", exact: true })).toHaveCount(0);
		if (width === 390)
			await page.getByRole("button", { name: "Back to homework list", exact: true }).click();
		await page.getByRole("button", { name: "Actions for Fractions", exact: true }).click();
		await expect(page.getByRole("menuitem", { name: "Edit questions" })).toHaveCount(0);
		await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
		// One form edits the title, subject, instructions and questions.
		await expect(page.getByRole("group", { name: "Question 1" })).toBeVisible();
		await expect(page.getByLabel("Question", { exact: true })).toHaveValue("2 + 3?");
		await expect(page.getByLabel("Homework instructions", { exact: true })).toHaveValue(
			"**Original question**",
		);
		await expect(page.getByText("Review extracted text", { exact: true })).toHaveCount(0);
		await page.getByRole("button", { name: "Cancel editing homework", exact: true }).click();
		await expect(page.getByRole("region", { name: "Homework preview" })).toContainText(
			"Original question",
		);
		if (width === 390)
			await page.getByRole("button", { name: "Back to homework list", exact: true }).click();
		await page.getByRole("button", { name: "Actions for Fractions", exact: true }).click();
		await page.screenshot({
			path: `artifacts/homework-row-menu-${width}-${testInfo.project.name}.png`,
			fullPage: true,
		});
		await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
		await expect(page.getByLabel("Homework title", { exact: true })).toHaveValue("Fractions");
		await page.getByLabel("Homework title", { exact: true }).fill("Updated fractions");
		await page.getByLabel("Homework instructions", { exact: true }).fill("Updated question");
		await page.getByRole("button", { name: "Save homework changes", exact: true }).click();
		await expect(page.getByRole("region", { name: "Homework preview" })).toContainText(
			"Updated question",
		);
		if (width === 390)
			await page.getByRole("button", { name: "Back to homework list", exact: true }).click();
		await page
			.getByRole("button", {
				name: "Actions for Updated fractions",
				exact: true,
			})
			.click();
		await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
		const confirmation = page.getByRole("alertdialog");
		await expect(confirmation).toContainText("Updated fractions");
		await expect(confirmation.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
		await expect(confirmation).toHaveCSS("opacity", "1");
		const modalBounds = await confirmation.boundingBox();
		expect(modalBounds!.x).toBeGreaterThanOrEqual(0);
		expect(modalBounds!.x + modalBounds!.width).toBeLessThanOrEqual(width);
		await page.screenshot({
			path: `artifacts/homework-delete-modal-${width}-${testInfo.project.name}.png`,
			fullPage: true,
		});
		await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
		await expect(confirmation).toHaveCount(0);
		await expect(
			page.getByRole("button", {
				name: "Actions for Updated fractions",
				exact: true,
			}),
		).toBeFocused();
		expect(deletes).toBe(0);
		await page
			.getByRole("button", {
				name: "Actions for Updated fractions",
				exact: true,
			})
			.click();
		await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
		await page
			.getByRole("alertdialog")
			.getByRole("button", { name: "Delete", exact: true })
			.click();
		await expect(
			page.getByRole("button", {
				name: "Actions for Updated fractions",
				exact: true,
			}),
		).toHaveCount(0);
		expect(deletes).toBe(1);
	});
}

for (const width of [390, 1440]) {
	test(`worksheet YAML rules extract locally and optionally AI writes only the parser at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 900 });
		await mockLearningServer(page);
		await seedOidcSession(page);
		let doc: GetHomeworkResponse | undefined;
		let original = new Uint8Array();
		let reads = 0;
		let applies = 0;
		let assists = 0;
		let updates = 0;
		const segments = [
			{
				id: "line-0",
				pageNumber: 1,
				ordinal: 0,
				text: "1. Capital of France?",
				region: [50, 50, 400, 30],
				confidence: 1,
			},
			{
				id: "line-1",
				pageNumber: 1,
				ordinal: 1,
				text: "Answer: Paris",
				region: [550, 50, 400, 30],
				confidence: 1,
			},
			{
				id: "line-2",
				pageNumber: 1,
				ordinal: 2,
				text: "2. What is 6 × 7?",
				region: [50, 200, 400, 30],
				confidence: 1,
			},
			{
				id: "line-3",
				pageNumber: 1,
				ordinal: 3,
				text: "Answer: 42",
				region: [550, 200, 400, 30],
				confidence: 1,
			},
		];
		const regionYaml =
			"version: 1\nrules:\n  - type: region\n    question: {page: 1, bounds: [0, 0, 500, 150]}\n    answer: {page: 1, bounds: [500, 0, 500, 150]}";
		await page.route("**/vulture.server.v1.VultureControl/ListHomework", (r) =>
			nativeResponse(r, { items: doc ? [doc] : [] }),
		);
		await page.route("**/vulture.server.v1.VultureControl/GenerateHomeworkDraft", () => {
			throw new Error("Worksheet parsing must not generate Q&A with AI");
		});
		await page.route("**/vulture.server.v1.VultureControl/ParseWorksheetDraft", async (route) => {
			if (route.request().method() === "OPTIONS") return nativeResponse(route);
			const input = route.request().postDataJSON();
			const recipe = JSON.parse(input.parserJson);
			applies++;
			if ((input.content ?? "").length) {
				reads++;
				if (!original.length) original = Buffer.from(input.content, "base64");
				expect(input.declaredMediaType).toBe(HomeworkMediaType.PNG);
			} else expect(input.segments.length).toBe(4);
			const isRegion = recipe.rules[0].type === "region";
			const questions = isRegion
				? [{ question: "1. Capital of France?", answer: "Answer: Paris", explanation: "" }]
				: [
						{ question: "Capital of France?", answer: "Paris", explanation: "" },
						{ question: "What is 6 × 7?", answer: "42", explanation: "" },
					];
			await nativeResponse(route, new ParseWorksheetDraftResponse({ segments, questions }));
		});
		await page.route(
			"**/vulture.server.v1.VultureControl/SuggestWorksheetParser",
			async (route) => {
				if (route.request().method() === "OPTIONS") return nativeResponse(route);
				const input = route.request().postDataJSON();
				expect(input.aiOptIn).toBe(true);
				expect(input.layout).toContain("answers");
				expect(input.segments.length).toBe(4);
				assists++;
				await nativeResponse(route, {
					parserJson: JSON.stringify({
						version: 1,
						rules: [
							{
								type: "pattern",
								split: "(?m)^\\d+[.)]\\s+",
								question: "(?s)^(.+?)(?:\\nAnswer:|$)",
								answer: "(?m)^Answer:\\s*(.+)$",
							},
						],
					}),
				});
			},
		);
		await page.route("**/vulture.server.v1.VultureControl/CreateHomework", async (route) => {
			if (route.request().method() === "OPTIONS") return nativeResponse(route);
			const input = route.request().postDataJSON();
			expect(Buffer.from(input.content, "base64")).toEqual(original);
			expect(input.parserYaml).toContain("type: pattern");
			expect(input.answerKey[0].answer).toBe("Paris");
			doc = new GetHomeworkResponse({
				homework: {
					id: "doc",
					profileId: input.profileId,
					title: input.title,
					subject: input.subject,
				},
				sources: [
					{
						source: { id: "source", version: 1 },
						mediaType: HomeworkMediaType.PNG,
						pageCount: 1,
					},
				],
				answerKey: input.answerKey,
				parserYaml: input.parserYaml,
			});
			await nativeResponse(route, { homework: doc.homework, source: doc.sources[0] });
		});
		await page.route("**/vulture.server.v1.VultureControl/DownloadHomework", (r) =>
			nativeResponse(r, { content: original, contentType: "image/png" }),
		);
		await page.route("**/vulture.server.v1.VultureControl/UpdateHomework", async (route) => {
			if (route.request().method() === "OPTIONS") return nativeResponse(route);
			const input = route.request().postDataJSON();
			expect(input.expectedSource?.version).toBe(1);
			expect(input.content).toBeUndefined();
			updates++;
			doc = new GetHomeworkResponse({
				...doc,
				parserYaml: input.parserYaml,
				answerKey: input.answerKey!.questions,
				sources: [
					{
						source: { id: "source", version: 2 },
						mediaType: HomeworkMediaType.PNG,
						pageCount: 1,
					},
				],
			});
			await nativeResponse(route, doc);
		});
		await page.goto("/#/home:parent");
		await page.getByRole("button", { name: /Children’s learning/ }).click();
		await page.getByRole("button", { name: "Add homework", exact: true }).click();
		await page.getByRole("button", { name: /Manually/ }).click();
		await page.getByRole("button", { name: /^Upload/ }).click();
		await page.getByLabel("Homework title", { exact: true }).fill("Worksheet");
		await page.getByLabel("Homework subject", { exact: true }).fill("Math");
		const data = await page.evaluate(() => {
			const c = document.createElement("canvas");
			c.width = 400;
			c.height = 4000;
			const ctx = c.getContext("2d")!;
			ctx.fillStyle = "white";
			ctx.fillRect(0, 0, 400, 4000);
			ctx.fillStyle = "black";
			ctx.font = "20px sans-serif";
			for (let i = 0; i < 40; i++) ctx.fillText(`Worksheet line ${i + 1}`, 20, 50 + i * 90);
			return c.toDataURL("image/png").split(",")[1];
		});
		await page.getByLabel("Worksheet file", { exact: true }).setInputFiles({
			name: "worksheet.png",
			mimeType: "image/png",
			buffer: Buffer.from(data, "base64"),
		});
		await page.getByRole("button", { name: "Read worksheet", exact: true }).click();
		await expect(page.getByText("Paris", { exact: true })).toBeVisible();
		expect(assists).toBe(0);
		expect(reads).toBe(1);
		const yaml = page.getByRole("textbox", {
			name: "Worksheet parser YAML",
			exact: true,
		});
		await page.getByRole("tab", { name: "Parser YAML", exact: true }).click();
		await yaml.fill('questions: [{question: "Do not hard-code answers"}]');
		await page.getByRole("button", { name: "Apply YAML parser", exact: true }).click();
		await expect(page.getByRole("alert").first()).toBeVisible();
		expect(applies).toBe(1);
		await yaml.fill(regionYaml);
		await page.getByRole("button", { name: "Apply YAML parser", exact: true }).click();
		await expect(page.getByText("Answer: Paris", { exact: true })).toBeVisible();
		expect(reads).toBe(1);
		expect(assists).toBe(0);
		await page.getByRole("tab", { name: "Extracted text", exact: true }).click();
		await expect(page.getByRole("region", { name: "Scrollable extracted text" })).toContainText(
			"Page 1 · [550, 50, 400, 30]",
		);
		await page.getByRole("tab", { name: "Original", exact: true }).click();
		const raw = page.getByRole("region", {
			name: "Scrollable original content",
		});
		await expect.poll(() => raw.evaluate((n) => n.scrollHeight > n.clientHeight + 100)).toBe(true);
		await raw.evaluate((n) => (n.scrollTop = 300));
		await expect.poll(() => raw.evaluate((n) => n.scrollTop)).toBeGreaterThan(100);
		await page
			.getByRole("button", {
				name: "I don’t know how to write a parser",
				exact: true,
			})
			.click();
		await page.getByRole("button", { name: "Write parser with AI", exact: true }).click();
		await expect(page.getByRole("alert").filter({ hasText: "Allow AI" })).toContainText("Allow AI");
		expect(assists).toBe(0);
		await page
			.getByLabel("Describe the layout (optional)")
			.fill("Numbered questions; answers in the right column");
		await page.getByRole("checkbox", { name: /Allow AI to read extracted text/ }).check();
		await page.getByRole("button", { name: "Write parser with AI", exact: true }).click();
		await expect(page.getByText("Paris", { exact: true })).toBeVisible();
		expect(assists).toBe(1);
		expect(reads).toBe(1);
		await page.getByRole("tab", { name: "Parser YAML", exact: true }).click();
		await expect(yaml).toHaveValue(/pattern/);
		const editorFits = await yaml.evaluate(
			(node) =>
				node.getBoundingClientRect().height <=
				node.parentElement!.getBoundingClientRect().height + 1,
		);
		expect(editorFits).toBe(true);
		await page.screenshot({
			path: `artifacts/worksheet-parser-yaml-${width}-${testInfo.project.name}.png`,
		});
		await page.getByRole("button", { name: "Save homework", exact: true }).click();
		await expect(page.getByRole("heading", { name: "Worksheet", exact: true })).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Save worksheet parser", exact: true }),
		).toHaveCount(0);
		await page.getByRole("tab", { name: "Parser YAML", exact: true }).click();
		await yaml.fill(regionYaml);
		await expect(
			page.getByRole("button", { name: "Save worksheet parser", exact: true }),
		).toBeDisabled();
		await page.getByRole("button", { name: "Apply YAML parser", exact: true }).click();
		await page.getByRole("button", { name: "Save worksheet parser", exact: true }).click();
		await expect(
			page.getByRole("button", { name: "Save worksheet parser", exact: true }),
		).toHaveCount(0);
		expect(updates).toBe(1);
		await page.screenshot({
			path: `artifacts/worksheet-parser-preview-${width}-${testInfo.project.name}.png`,
		});
		await page.reload();
		await page.getByRole("button", { name: "Worksheet Math", exact: true }).click();
		await expect(
			page
				.getByRole("region", { name: "Scrollable Q&A preview" })
				.getByText("Answer: Paris", { exact: true }),
		).toBeVisible();
	});
}

for (const width of [320, 390, 1440]) {
	test(`calendar fits without scrolling and schedules homework at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: width < 500 ? 667 : 900 });
		await mockLearningServer(page);
		await seedOidcSession(page);
		await page.route("**/vulture.server.v1.VultureControl/ListHomework", (route) =>
			nativeResponse(route, {
				items: [
					{
						homework: {
							id: "00000000-0000-0000-0000-000000000030",
							profileId: "00000000-0000-0000-0000-000000000100",
							title: "Fractions test",
							subject: "Math",
						},
					},
				],
			}),
		);
		await page.goto("/#/home:parent");
		await page.getByRole("button", { name: /Children’s learning/ }).click();
		await page.getByRole("tab", { name: "Time Table", exact: true }).click();
		const calendar = page.getByRole("region", { name: "Timetable calendar" });
		await expect(calendar.getByRole("button", { name: "Add calendar activity" })).toBeEnabled();
		await expect(calendar.locator(".day")).toHaveCount(42);
		const fits = () =>
			page
				.locator(".learning-content")
				.evaluate(
					(n) => n.scrollHeight <= n.clientHeight + 1 && n.scrollWidth <= n.clientWidth + 1,
				);
		expect(await fits()).toBe(true);
		await page.screenshot({
			path: `artifacts/timetable-month-${width}-${testInfo.project.name}.png`,
			fullPage: true,
		});
		await calendar.getByRole("button", { name: "Add calendar activity" }).click();
		await calendar.getByLabel("Calendar activity", { exact: true }).selectOption("test");
		await calendar
			.getByLabel("Scheduled homework")
			.selectOption("00000000-0000-0000-0000-000000000030");
		await calendar.getByLabel("Activity start").fill("10:00");
		await calendar.getByLabel("Activity end").fill("11:00");
		expect(await fits()).toBe(true);
		const editor = calendar.getByRole("complementary", {
			name: "New calendar activity",
		});
		expect(
			await editor.evaluate(
				(n) => n.scrollHeight <= n.clientHeight + 1 && n.scrollWidth <= n.clientWidth + 1,
			),
		).toBe(true);
		await expect(calendar.getByRole("button", { name: "Save calendar activity" })).toBeInViewport();
		await calendar.getByRole("button", { name: "Save calendar activity" }).click();
		await expect(calendar.getByRole("status")).toHaveText("Calendar saved.");
		await calendar.getByRole("button", { name: "Day view" }).click();
		await expect(
			calendar.getByRole("button", { name: /Fractions test, 10:00 to 11:00/ }),
		).toBeVisible();
		await expect(calendar.getByRole("button", { name: /Add activity at/ })).toHaveCount(24);
		expect(await fits()).toBe(true);
		const timeline = calendar.getByLabel("Hourly schedule");
		expect(await timeline.evaluate((n) => n.scrollHeight <= n.clientHeight + 1)).toBe(true);
		await page.screenshot({
			path: `artifacts/timetable-day-${width}-${testInfo.project.name}.png`,
			fullPage: true,
		});
		await calendar.getByRole("button", { name: /Fractions test, 10:00 to 11:00/ }).click();
		await calendar.getByRole("button", { name: "Delete calendar activity" }).click();
		const confirmation = page.getByRole("alertdialog");
		await expect(confirmation).toContainText("Delete this activity?");
		await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
		await expect(
			calendar.getByRole("button", { name: /Fractions test, 10:00 to 11:00/ }),
		).toBeVisible();
	});
}

for (const width of [390, 1440]) {
	test(`selected child settings are compact at ${width}px`, async ({ page }, testInfo) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.setViewportSize({ width, height: 900 });
		await mockLearningServer(page);
		await seedOidcSession(page);
		await page.goto("/#/home:parent");
		await page.getByRole("button", { name: /Children’s learning/ }).click();
		await page.getByRole("tab", { name: "Setting", exact: true }).click();
		await expect(page.getByRole("heading", { name: "Selected: Jamie" })).toHaveCount(0);
		await expect(page.getByLabel("Child timezone", { exact: true })).toBeHidden();
		await page
			.locator("summary")
			.filter({ hasText: /^Guardian access/ })
			.click();
		await expect(page.getByLabel("Share with a parent")).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true,
		);
		await page.screenshot({
			path: `artifacts/child-settings-${width}-${testInfo.project.name}.png`,
			fullPage: true,
		});
	});
}

for (const width of [390, 1440]) {
	test(`school and teacher contacts save per child at ${width}px`, async ({ page }, testInfo) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.setViewportSize({ width, height: 900 });
		await mockLearningServer(page, true, ["Jamie", "Taylor"]);
		await seedOidcSession(page);
		await page.goto("/#/home:parent");
		await page.getByRole("button", { name: /Children’s learning/ }).click();
		await page.getByRole("tab", { name: "Setting", exact: true }).click();
		const openSchool = () =>
			page
				.locator("summary")
				.filter({ hasText: /^School/ })
				.click();
		await openSchool();
		await page.getByLabel("School name", { exact: true }).fill("Oak School");
		await page.getByLabel("School address").fill("10 School Road, Chicago");
		await page.getByLabel("School email").fill("office@example.org");
		await page.getByRole("button", { name: "Add school phone" }).click();
		await page.getByLabel("School phone 1", { exact: true }).fill("+1 555 123 4567");
		await page.getByRole("button", { name: "Save school phone 1", exact: true }).click();
		await expect(page.getByText("Phone number saved.")).toBeVisible();
		await page.getByRole("button", { name: "Add teacher" }).click();
		await page.getByLabel("Teacher 1 name").fill("Ms Jones");
		await page.getByLabel("Teacher 1 role").fill("Classroom");
		await page.getByLabel("Teacher 1 email").fill("jones@example.org");
		await page
			.getByRole("form", { name: "School information" })
			.getByRole("button", { name: "Save", exact: true })
			.click();
		await expect(page.getByText("School details saved.")).toBeVisible();
		await page
			.getByRole("form", { name: "Teacher 1", exact: true })
			.getByRole("button", { name: "Save", exact: true })
			.click();
		await expect(page.getByText("Teacher contact saved.")).toBeVisible();
		await page.getByRole("button", { name: "Next child" }).click();
		await openSchool();
		await expect(page.getByLabel("School name", { exact: true })).toHaveValue("");
		await page.getByRole("button", { name: "Previous child" }).click();
		await openSchool();
		await expect(page.getByLabel("School name", { exact: true })).toHaveValue("Oak School");
		await expect(page.getByLabel("Teacher 1 name")).toHaveValue("Ms Jones");
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true,
		);
		await page.screenshot({
			path: `artifacts/school-contacts-${width}-${testInfo.project.name}.png`,
			fullPage: true,
		});
	});
}

for (const width of [390, 1440]) {
	test(`voice privacy is compact and explicit at ${width}px`, async ({ page }, testInfo) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.setViewportSize({ width, height: 900 });
		await mockLearningServer(page);
		await seedOidcSession(page);
		await page.goto("/#/home:parent");
		await page.getByRole("button", { name: /Children’s learning/ }).click();
		await page.getByRole("tab", { name: "Setting", exact: true }).click();
		await page
			.locator("summary")
			.filter({ hasText: /^Voice privacy/ })
			.click();
		const toggle = page.getByRole("switch", {
			name: "Allow browser speech processing",
		});
		await expect(toggle).not.toBeChecked();
		await expect(page.getByText(/Browser speech processing may send audio/)).toBeVisible();
		await toggle.click();
		await expect(toggle).toBeChecked();
		await toggle.click();
		await expect(toggle).not.toBeChecked();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true,
		);
		await page.screenshot({
			path: `artifacts/voice-settings-${width}-${testInfo.project.name}.png`,
			fullPage: true,
		});
	});
}
