import { GetChildPolicyResponse } from "../../packages/core/src/api/protocol";
import { test, expect } from "./fixtures";
import { nativeResponse } from "./nativeRpc";
import { openChildPage } from "./childShell";
import * as p from "../../packages/core/src/api/protocol";
import type { Page } from "@playwright/test";
const token = `vcs_${"c".repeat(64)}`;
const sessionId = "00000000-0000-0000-0000-000000000111";
async function setup(
	page: Page,
	subject = "spelling",
	long = false,
	loseAnswer = false,
	voice = false,
	// Assigned homework: one question per entry, answered with the matching expected response.
	script?: { question: Partial<p.PracticeQuestion>; expected: string }[],
) {
	let answered = 0,
		hints = 0,
		help = false,
		started = false,
		state = p.LearningSessionState.ACTIVE,
		lost = false;
	const ids = new Map<string, p.SubmitLearningAnswerResponse>();
	const spoken: { sessionId: string; position: number }[] = [];
	const prompt =
		subject === "spelling"
			? "Spell the fruit"
			: long
				? `What is 2 + 2? ${"Read this carefully. ".repeat(100)}`
				: "What is 2 + 2?";
	const session = () => ({
		id: sessionId,
		profileId: "profile",
		state,
		practice: { id: "set", version: 1 },
	});
	const view = () =>
		new p.GetLearningSessionResponse({
			session: session(),
			answered,
			total: script?.length ?? 2,
			question:
				state !== p.LearningSessionState.ACTIVE
					? undefined
					: script
						? { position: answered + 1, ...script[answered].question }
						: {
								position: answered + 1,
								prompt,
								hintCount: 2,
								kind:
									subject === "spelling"
										? p.PracticeQuestionKind.SPELLING
										: p.PracticeQuestionKind.SHORT_ANSWER,
							},
			hint: hints === 1 ? "Think about the topic" : hints === 2 ? "Take your time" : "",
			revealedAnswer: hints >= 3 ? (subject === "spelling" ? "apple" : "4") : undefined,
			helpRequested: help,
			lastResult: answered ? p.LearningAnswerResult.CORRECT : undefined,
		});
	await page.addInitScript((token) => {
		const key = "vulture.child-session:https://auth.swavan.io/auth/v1/:vulturefam";
		if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ token }));
	}, token);
	await page.route("**/vulture.server.v1.VultureControl/*", async (route) => {
		if (route.request().method() === "OPTIONS") {
			await nativeResponse(route);
			return;
		}
		expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
		const method = route.request().url().split("/").at(-1)!;
		const input = route.request().postDataJSON();
		switch (method) {
			case "VoiceAssistant": {
				const command = JSON.parse(input.commandJson);
				const answer = command.text?.startsWith("my answer is ");
				await nativeResponse(route, {
					resultJson: JSON.stringify({
						enabled: voice,
						intent: answer ? "answer" : command.text === "stop" ? "stop" : "read",
						text: answer ? "Review your answer, then choose Check answer." : prompt,
					}),
				});
				break;
			}
			case "GetChildPolicy":
				await nativeResponse(
					route,
					new GetChildPolicyResponse({
						allowed: true,
						currentActivity: "Allowed time",
						evaluatedAt: new Date().toISOString(),
						validUntil: new Date(Date.now() + 30000).toISOString(),
						timezone: "UTC",
					}),
				);
				break;
			case "GetTimetable":
				await nativeResponse(route, { timetable: { timezone: "UTC", windows: [] } });
				break;
			case "ListChildTasks":
			case "GetProfileAvatar":
				await nativeResponse(route, {});
				break;
			case "GetQuestionAudio":
				spoken.push(input);
				// A tiny silent WAV, as the server's speech engine would make.
				await nativeResponse(route, {
					audio: new Uint8Array([...new TextEncoder().encode("RIFF"), ...new Array(40).fill(0)]),
					contentType: "audio/wav",
				});
				break;
			case "GetChildSession":
				await nativeResponse(route, {
					context: {
						profileId: "profile",
						familyId: "family",
						displayName: "Jamie",
						expiresAt: new Date(Date.now() + 3600000).toISOString(),
					},
				});
				break;
			case "ListChildPractice":
				await nativeResponse(route, {
					activities: [
						{
							practice: { id: "set", version: 1 },
							title: `${subject} practice`,
							subject,
							sessionId: started ? sessionId : undefined,
							state: started ? state : p.LearningSessionState.UNSPECIFIED,
						},
					],
				});
				break;
			case "StartLearningSession":
				started = true;
				await nativeResponse(route, { session: session() });
				break;
			case "GetLearningSession":
				await nativeResponse(route, view());
				break;
			case "ControlLearningSession": {
				expect(input.position).toBe(answered + 1);
				if (input.action === p.LearningSessionAction.HINT) hints++;
				if (input.action === p.LearningSessionAction.HELP) help = true;
				if (input.action === p.LearningSessionAction.STOP) state = p.LearningSessionState.CANCELLED;
				await nativeResponse(route, view());
				break;
			}
			case "SubmitLearningAnswer": {
				let receipt = ids.get(input.requestId);
				if (!receipt) {
					expect(input.position).toBe(answered + 1);
					expect(input.answer).toBe(
						script ? script[answered].expected : subject === "spelling" ? "apple" : "4",
					);
					answered++;
					hints = 0;
					if (answered === (script?.length ?? 2)) state = p.LearningSessionState.COMPLETED;
					receipt = new p.SubmitLearningAnswerResponse({
						answerId: `answer-${answered}`,
						result: p.LearningAnswerResult.CORRECT,
					});
					ids.set(input.requestId, receipt);
				}
				if (loseAnswer && !lost) {
					lost = true;
					await route.abort();
					return;
				}
				await nativeResponse(route, receipt);
				break;
			}
			default:
				throw new Error(`Unexpected child learning RPC ${method}`);
		}
	});
	return { count: () => ids.size, spoken };
}
for (const subject of ["spelling", "math"]) {
	test(`complete approved ${subject}, keyboard answers, refresh resumes and never duplicates`, async ({
		page,
	}, testInfo) => {
		const server = await setup(page, subject, subject === "math", true);
		await page.setViewportSize({ width: 320, height: 740 });
		await page.goto("/");
		await openChildPage(page, "Learning");
		await page.getByRole("button", { name: "Start practice", exact: true }).click();
		const input = page.getByLabel("Your answer");
		await expect(input).toBeFocused();
		await page.getByRole("button", { name: "Hint", exact: true }).click();
		await expect(page.getByText("Hint: Think about the topic")).toBeVisible();
		expect(
			await page.getByRole("region", { name: "Learning activities" }).textContent(),
		).not.toContain(subject === "spelling" ? "apple" : "Let's learn it together: 4");
		await page.getByRole("button", { name: "Hint", exact: true }).click();
		await expect(page.getByText("Hint: Take your time")).toBeVisible();
		await page.getByRole("button", { name: "Hint", exact: true }).click();
		await expect(page.getByText(/Let's learn it together/)).toBeVisible();
		await input.fill(subject === "spelling" ? "apple" : "4");
		await input.press("Enter");
		await expect(page.getByRole("alert")).toBeVisible();
		await page.getByRole("button", { name: "Retry saving answer" }).click();
		await expect(page.getByText("1 of 2 done")).toBeVisible();
		expect(server.count()).toBe(1);
		await page.reload();
		await expect(page.getByText("1 of 2 done")).toBeVisible();
		await expect(page.getByText(/Let's learn it together/)).toHaveCount(0);
		await input.fill(subject === "spelling" ? "apple" : "4");
		await input.press("Enter");
		await expect(page.getByRole("heading", { name: "Practice complete!" })).toBeVisible();
		expect(server.count()).toBe(2);
		await page.getByRole("button", { name: "Back to activities" }).click();
		await page.getByRole("button", { name: "View completed practice" }).click();
		await expect(page.getByText("2 of 2 done")).toBeVisible();
		expect(server.count()).toBe(2);
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
		).toBe(true);
		await page.screenshot({
			path: testInfo.outputPath(`${subject}-complete-mobile.png`),
			fullPage: true,
		});
	});
}
test("touch-sized controls, help and stop persist across refresh in dark theme", async ({
	page,
}, testInfo) => {
	await setup(page, "math", true);
	await page.addInitScript(() => localStorage.setItem("vulture.theme", "dark"));
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/");
	await openChildPage(page, "Learning");
	await page.getByRole("button", { name: "Start practice", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-v-theme", "dark");
	for (const name of ["Hint", "Ask for help", "Stop practice"]) {
		const box = await page.getByRole("button", { name, exact: true }).boundingBox();
		expect(box!.height).toBeGreaterThanOrEqual(44);
	}
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true,
	);
	await page.getByRole("button", { name: "Ask for help" }).click();
	await expect(page.getByText(/Help requested/)).toBeVisible();
	await page.reload();
	await expect(page.getByText(/Help requested/)).toBeVisible();
	await page.screenshot({
		path: testInfo.outputPath("long-question-mobile.png"),
		fullPage: true,
	});
	await page.getByRole("button", { name: "Stop practice" }).click();
	await expect(page.getByRole("heading", { name: "Practice stopped" })).toBeVisible();
	await page.reload();
	await page.getByRole("button", { name: "View stopped practice" }).click();
	await expect(page.getByRole("heading", { name: "Practice stopped" })).toBeVisible();
});

test("microphone denial leaves keyboard spelling fully usable without media capture", async ({
	page,
	context,
}) => {
	await context.clearPermissions();
	await page.addInitScript(() => {
		// The prototype exists before WebKit creates navigator.mediaDevices.
		Object.defineProperty(MediaDevices.prototype, "getUserMedia", {
			configurable: true,
			value: async () => {
				const count = Number(sessionStorage.getItem("pilotMediaRequests") ?? 0) + 1;
				sessionStorage.setItem("pilotMediaRequests", String(count));
				throw new DOMException("Microphone denied", "NotAllowedError");
			},
		});
	});
	await setup(page);
	await page.goto("/");
	await openChildPage(page, "Learning");
	// Simulate the browser denial, then prove the entire text workflow still works.
	expect(
		await page.evaluate(async () => {
			try {
				await navigator.mediaDevices.getUserMedia({ audio: true });
				return "unexpected grant";
			} catch (error) {
				return (error as DOMException).name;
			}
		}),
	).toBe("NotAllowedError");
	await page.getByRole("button", { name: "Start practice", exact: true }).click();
	for (let question = 0; question < 2; question++) {
		const input = page.getByLabel("Your answer");
		await input.fill("apple");
		await input.press("Enter");
		await expect(page.getByText(`${question + 1} of 2 done`)).toBeVisible();
	}
	await expect(page.getByRole("heading", { name: "Practice complete!" })).toBeVisible();
	expect(await page.evaluate(() => Number(sessionStorage.getItem("pilotMediaRequests")))).toBe(1);
});

test("voice push-to-talk reviews spelling, interrupts, mutes and preserves typed practice", async ({
	page,
}, testInfo) => {
	const server = await setup(page, "spelling", false, false, true);
	await page.addInitScript(() => {
		class Speech {
			onresult: ((event: unknown) => void) | null = null;
			onerror: (() => void) | null = null;
			onend: (() => void) | null = null;
			start() {
				(window as unknown as { voiceResult: (text: string) => void }).voiceResult = (text) =>
					this.onresult?.({
						results: [[{ transcript: text, confidence: 0.99 }]],
					});
			}
			stop() {}
			abort() {
				this.onresult = null;
			}
		}
		Object.defineProperty(window, "SpeechRecognition", { value: Speech });
		Object.defineProperty(navigator, "mediaDevices", {
			value: {
				getUserMedia: async () => {
					const track = { stop() {}, muted: false, readyState: "live" };
					return { getTracks: () => [track], getAudioTracks: () => [track] };
				},
			},
		});
		Object.defineProperty(window, "speechSynthesis", {
			value: { cancel() {}, getVoices: () => [] },
		});
	});
	await page.goto("/");
	await openChildPage(page, "Learning");
	await page.getByRole("button", { name: "Start practice", exact: true }).click();
	const talk = page.getByRole("button", { name: "Hold to talk" });
	for (const theme of ["light", "dark"]) {
		await page.evaluate(
			(theme) => document.documentElement.setAttribute("data-v-theme", theme),
			theme,
		);
		const colors = await page
			.getByRole("region", { name: "FamBud voice tutor" })
			.evaluate((region) => {
				const button = region.querySelector("button")!;
				return {
					button: getComputedStyle(button).backgroundColor,
					primary: getComputedStyle(
						document.querySelector<HTMLButtonElement>('button[type="submit"]')!,
					).backgroundColor,
				};
			});
		expect(colors.button).toBe(colors.primary);
		await page.screenshot({
			path: testInfo.outputPath(`voice-${theme}.png`),
			fullPage: true,
		});
	}

	await expect(talk).toBeEnabled();
	await talk.focus();
	await page.keyboard.down("Space");
	await expect(page.getByText("Listening…")).toBeVisible();
	await page.evaluate(() =>
		(window as unknown as { voiceResult: (text: string) => void }).voiceResult(
			"my answer is a p p l e",
		),
	);
	await page.keyboard.up("Space");
	await expect(page.getByLabel("Your answer")).toHaveValue("apple");
	expect(server.count()).toBe(0);
	await expect(page.getByText("Review your answer, then choose Check answer.")).toBeVisible();
	await page.getByRole("button", { name: "Mute voice", exact: true }).click();
	await expect(talk).toBeDisabled();
	await page.getByRole("button", { name: "Unmute voice" }).click();
	await talk.focus();
	await page.keyboard.down("Space");
	await expect(page.getByText("Listening…")).toBeVisible();
	await page.keyboard.up("Space");
	await page.getByRole("button", { name: "Stop voice" }).click();
	await expect(page.getByText("Hold the button and say your answer")).toBeVisible();
	await page.getByRole("button", { name: "Check answer", exact: true }).click();
	await expect(page.getByText("1 of 2 done")).toBeVisible();
	expect(server.count()).toBe(1);
});

test("assigned homework: match, true/false, choose-many and spoken spelling by touch and keyboard", async ({
	page,
}) => {
	await page.addInitScript(() => {
		const spoken: string[] = [];
		Object.assign(window, { __spoken: spoken });
		Object.defineProperty(window, "speechSynthesis", {
			value: {
				getVoices: () => [{ localService: true, lang: "en-US" }],
				cancel() {},
				speak(utterance: { text: string; onend?: () => void }) {
					spoken.push(utterance.text);
					utterance.onend?.();
				},
			},
		});
		Object.assign(window, {
			SpeechSynthesisUtterance: class {
				voice: unknown;
				onend?: () => void;
				onerror?: () => void;
				constructor(public text: string) {}
			},
		});
	});
	await setup(page, "science", false, false, false, [
		{
			question: {
				kind: p.PracticeQuestionKind.MATCHING,
				prompt: "Match each baby to its parent",
				items: ["Puppy", "Kitten"],
				choices: ["Cat", "Dog"],
			},
			expected: '["Dog","Cat"]',
		},
		{
			question: {
				kind: p.PracticeQuestionKind.TRUE_FALSE,
				prompt: "The sun is a star.",
				choices: ["True", "False"],
			},
			expected: "True",
		},
		{
			question: {
				kind: p.PracticeQuestionKind.CHOOSE_MANY,
				prompt: "Pick the even numbers",
				choices: ["2", "3", "4"],
			},
			expected: '["2","4"]',
		},
		{
			question: {
				kind: p.PracticeQuestionKind.SPELLING,
				prompt: "Spell the word you hear.",
				say: "Banana. I ate a banana.",
			},
			expected: "banana",
		},
	]);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/");
	await openChildPage(page, "Learning");
	await page.getByRole("button", { name: "Start practice", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Match each baby to its parent" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Hint", exact: true })).toHaveCount(0);
	const check = page.getByRole("button", { name: "Check answer" });
	await page.getByLabel("Puppy").selectOption("Dog");
	await expect(check).toBeDisabled();
	await page.getByLabel("Kitten").selectOption("Cat");
	await check.click();
	await expect(page.getByText("1 of 4 done")).toBeVisible();
	await page.getByRole("radio", { name: "True" }).click();
	await check.click();
	await expect(page.getByText("2 of 4 done")).toBeVisible();
	await page.getByRole("checkbox", { name: "2" }).check();
	await page.getByRole("checkbox", { name: "4" }).check();
	await check.click();
	await expect(page.getByText("3 of 4 done")).toBeVisible();
	// The server has no speech engine here, so the device voice reads the word.
	await page.route("**/vulture.server.v1.VultureControl/GetQuestionAudio", (route) =>
		nativeResponse(route, undefined, 14),
	);
	await page.getByRole("button", { name: "Hear the word" }).click();
	await expect
		.poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken))
		.toEqual(["Banana. I ate a banana."]);
	await page.getByLabel("Your answer").fill("banana");
	await page.getByLabel("Your answer").press("Enter");
	await expect(page.getByRole("heading", { name: "Practice complete!" })).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true,
	);
});

for (const theme of ["light", "dark"]) {
	test(`a spelling question shows only what a child needs (${theme})`, async ({
		page,
	}, testInfo) => {
		const server = await setup(page, "spelling", false, false, false, [
			{
				question: {
					prompt: "Spell the word you hear.",
					kind: p.PracticeQuestionKind.SPELLING,
					say: "banana",
					hintCount: 0,
				},
				expected: "banana",
			},
		]);
		await page.addInitScript((theme) => localStorage.setItem("vulture.theme", theme), theme);
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto("/");
		await openChildPage(page, "Learning");
		await page.getByRole("button", { name: "Start practice", exact: true }).click();
		await expect(page.getByRole("heading", { name: "Spell the word you hear." })).toBeVisible();
		await expect(page.getByText("0 of 1 done")).toBeVisible();
		// No timetable status, timetable help or voice tutor while voice is off.
		await expect(page.getByText(/Right now:/)).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Help", exact: true })).toHaveCount(0);
		await expect(page.getByRole("region", { name: "FamBud voice tutor" })).toHaveCount(0);
		for (const name of ["Hear the word", "Check answer"]) {
			const box = await page.getByRole("button", { name, exact: true }).boundingBox();
			expect(box!.height).toBeGreaterThanOrEqual(48);
		}
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
		).toBe(true);
		await page.screenshot({ path: testInfo.outputPath(`spelling-question-${theme}.png`) });
		// "Hear the word" plays the word made by the family's server.
		await page.evaluate(() => {
			(window as unknown as { played: string[] }).played = [];
			HTMLMediaElement.prototype.play = function () {
				(window as unknown as { played: string[] }).played.push(this.src);
				queueMicrotask(() => this.dispatchEvent(new Event("ended")));
				return Promise.resolve();
			};
		});
		await page.getByRole("button", { name: "Hear the word" }).click();
		await expect
			.poll(() => page.evaluate(() => (window as unknown as { played: string[] }).played.length))
			.toBe(1);
		expect(server.spoken).toEqual([expect.objectContaining({ position: 1 })]);
		await page.getByLabel("Your answer").fill("banana");
		await page.getByRole("button", { name: "Check answer", exact: true }).click();
		await expect(page.getByRole("heading", { name: "Practice complete!" })).toBeVisible();
	});
}
