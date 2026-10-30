import {
	test,
	expect,
	seedOidcSession,
	openParentLearning,
	mockFamilyAiProvider,
	type FamilyAiPrompt,
} from "./fixtures";
import { nativeResponse } from "./nativeRpc";
import {
	AccountRole,
	LearningAgeBand,
	LearningProfile,
	SourceVersion,
	GeneratePracticeResponse,
	ParentPracticeQuestion,
	PracticeQuestionKind,
	GetHomeworkResponse,
	GetSourceSegmentsResponse,
} from "../../packages/core/src/api/protocol";

const parentId = "00000000-0000-0000-0000-000000000001";
const familyId = "00000000-0000-0000-0000-000000000010";
const profileId = "00000000-0000-0000-0000-000000000100";
const homeworkId = "00000000-0000-0000-0000-000000000200";
const jobId = "00000000-0000-0000-0000-0000000000aa";
const source = new SourceVersion({ id: "00000000-0000-0000-0000-000000000300", version: 2 });
const prompt: FamilyAiPrompt = {
	system: "Generate parent-reviewed practice only.",
	user: JSON.stringify({ sources: [{ text: "Add 2 + 2" }] }),
	schemaName: "vulture_practice_v1",
	schemaJson: JSON.stringify({ type: "object" }),
	maxOutputTokens: 4096,
};

test("practice runs on the parent's device with family AI; the server never gets the key", async ({
	page,
}) => {
	const methods: string[] = [];
	let set: GeneratePracticeResponse | undefined;
	let completedOutput = "";
	await page.route("**/vulture.server.v1.VultureControl/*", async (route) => {
		if (route.request().method() === "OPTIONS") return nativeResponse(route);
		const input = route.request().postDataJSON();
		const method = route.request().url().split("/").at(-1)!;
		methods.push(method);
		// No request to Vulture may ever carry the family's AI key.
		expect(JSON.stringify(input ?? {})).not.toContain("sk-family-secret");
		switch (method) {
			case "ListTasks":
			case "ReviewLearningSessions":
			case "GetAvatar":
			case "GetFamilyAvatar":
				return nativeResponse(route, {});
			case "GetTimetable":
				return nativeResponse(route, { timetable: { timezone: "UTC", windows: [] } });
			case "GetParentPinAccess":
				return nativeResponse(route, { enabled: true });
			case "DownloadHomework":
				return nativeResponse(route, {
					content: new TextEncoder().encode("Worksheet source"),
					contentType: "text/plain",
				});
			case "GetMyFamily":
				return nativeResponse(route, { family: { id: familyId, name: "Pilot family" } });
			case "GetAccount":
				return nativeResponse(route, {
					account: { id: input.accountId, displayName: "Alex", role: AccountRole.PARENT },
				});
			case "ListFamilyMembers":
				return nativeResponse(route, { members: [{ accountId: parentId }] });
			case "ListLearningProfiles":
				return nativeResponse(route, {
					profiles: [
						new LearningProfile({
							id: profileId,
							familyId,
							displayName: "Jamie",
							ageBand: LearningAgeBand.PRIMARY,
							guardianAccountIds: [parentId],
						}),
					],
				});
			case "ListHomework":
				return nativeResponse(route, {
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
				});
			case "GetSourceSegments":
				return nativeResponse(route, new GetSourceSegmentsResponse({ source, state: "confirmed" }));
			case "ListPractice":
				return nativeResponse(route, { sets: set ? [set] : [] });
			case "PrepareFamilyAiJob":
				expect(input.practice).toMatchObject({
					source,
					subject: "math",
					difficulty: "easy",
					maxQuestions: 1,
					aiOptIn: true,
				});
				return nativeResponse(route, { id: jobId, status: 2, prompt });
			case "GetFamilyAiJob":
				expect(input.id).toBe(jobId);
				return nativeResponse(route, { id: jobId, status: 2, prompt });
			case "CompleteFamilyAiJob":
				expect(input.id).toBe(jobId);
				completedOutput = input.output;
				set = new GeneratePracticeResponse({
					practice: {
						practice: { id: "set", version: 1 },
						source,
						title: "Device draft",
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
				return nativeResponse(route, { job: { id: jobId, status: 3 }, practice: set });
			default:
				throw new Error(`Unexpected RPC: ${method}`);
		}
	});
	const prompts: FamilyAiPrompt[] = [];
	mockFamilyAiProvider(page, (received) => {
		prompts.push(received);
		return JSON.stringify({ title: "Device draft", questions: [] });
	});
	await seedOidcSession(page);
	await page.goto("/");
	// Family AI previously saved on this device (the key itself stays in the OS key store).
	await page.evaluate(
		(family) =>
			window.__nativeFallback("family_ai_settings", {
				input: {
					serverUrl: "https://vulture.swavan.com",
					familyId: family,
					action: "save",
					config: {
						provider: "openai",
						model: "gpt-family",
						endpoint: "",
						apiKey: "sk-family-secret",
					},
				},
			}),
		familyId,
	);
	await openParentLearning(page);
	await page.getByRole("button", { name: /^Addition practice / }).click();
	await page.getByRole("button", { name: "Prepare practice", exact: true }).click();
	const review = page.getByRole("region", { name: "Parent practice review" });
	await review.getByLabel("Practice subject").selectOption("math");
	await review.getByLabel("Practice difficulty").selectOption("easy");
	await review.getByLabel("Maximum questions (1–12)").fill("1");
	await review.getByRole("checkbox", { name: /I allow AI/ }).check();
	await review.getByRole("button", { name: "Generate practice draft", exact: true }).click();
	await expect(review.getByLabel("Practice title")).toHaveValue("Device draft");
	// The device called its provider with the server-prepared prompt and returned the raw output.
	expect(prompts).toEqual([prompt]);
	expect(completedOutput).toBe(JSON.stringify({ title: "Device draft", questions: [] }));
	expect(methods).toEqual(
		expect.arrayContaining(["PrepareFamilyAiJob", "GetFamilyAiJob", "CompleteFamilyAiJob"]),
	);
	expect(methods).not.toContain("GeneratePractice");
});

test("practice falls back to platform AI when this device has no family AI", async ({ page }) => {
	const methods: string[] = [];
	await page.route("**/vulture.server.v1.VultureControl/*", async (route) => {
		if (route.request().method() === "OPTIONS") return nativeResponse(route);
		const input = route.request().postDataJSON();
		const method = route.request().url().split("/").at(-1)!;
		methods.push(method);
		switch (method) {
			case "ListTasks":
			case "ReviewLearningSessions":
			case "GetAvatar":
			case "GetFamilyAvatar":
				return nativeResponse(route, {});
			case "GetTimetable":
				return nativeResponse(route, { timetable: { timezone: "UTC", windows: [] } });
			case "GetParentPinAccess":
				return nativeResponse(route, { enabled: true });
			case "DownloadHomework":
				return nativeResponse(route, {
					content: new TextEncoder().encode("Worksheet source"),
					contentType: "text/plain",
				});
			case "GetMyFamily":
				return nativeResponse(route, { family: { id: familyId, name: "Pilot family" } });
			case "GetAccount":
				return nativeResponse(route, {
					account: { id: input.accountId, displayName: "Alex", role: AccountRole.PARENT },
				});
			case "ListFamilyMembers":
				return nativeResponse(route, { members: [{ accountId: parentId }] });
			case "ListLearningProfiles":
				return nativeResponse(route, {
					profiles: [
						new LearningProfile({
							id: profileId,
							familyId,
							displayName: "Jamie",
							ageBand: LearningAgeBand.PRIMARY,
							guardianAccountIds: [parentId],
						}),
					],
				});
			case "ListHomework":
				return nativeResponse(route, {
					items: [
						new GetHomeworkResponse({
							homework: { id: homeworkId, familyId, profileId, title: "Addition practice" },
							sources: [{ source, homeworkId, pageCount: 1 }],
						}),
					],
				});
			case "GetSourceSegments":
				return nativeResponse(route, new GetSourceSegmentsResponse({ source, state: "confirmed" }));
			case "ListPractice":
				return nativeResponse(route, { sets: [] });
			case "GeneratePractice":
				return nativeResponse(
					route,
					new GeneratePracticeResponse({
						practice: {
							practice: { id: "set", version: 1 },
							source,
							title: "Platform draft",
							reviewState: "draft",
						},
						questions: [],
					}),
				);
			default:
				throw new Error(`Unexpected RPC: ${method}`);
		}
	});
	await seedOidcSession(page);
	await page.goto("/");
	await openParentLearning(page);
	await page.getByRole("button", { name: /^Addition practice / }).click();
	await page.getByRole("button", { name: "Prepare practice", exact: true }).click();
	const review = page.getByRole("region", { name: "Parent practice review" });
	await review.getByLabel("Maximum questions (1–12)").fill("1");
	await review.getByRole("checkbox", { name: /I allow AI/ }).check();
	await review.getByRole("button", { name: "Generate practice draft", exact: true }).click();
	await expect(review.getByLabel("Practice title")).toHaveValue("Platform draft");
	expect(methods).toContain("GeneratePractice");
	expect(methods).not.toContain("PrepareFamilyAiJob");
});
