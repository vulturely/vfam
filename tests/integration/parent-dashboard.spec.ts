import { test, expect, seedOidcSession, openParentLearning } from "./fixtures";
import { nativeResponse } from "./nativeRpc";
import {
	AccountRole,
	LearningAgeBand,
	PracticeQuestionKind,
	LearningAnswerResult,
	LearningSessionState,
	FamBudDevice,
	FamBudCommand,
	RobotCapabilityValue,
} from "../../packages/core/src/api/protocol";

for (const theme of ["light", "dark"]) {
	test(`parent dashboard starts approved quiz, observes progress/status, stops and revokes (${theme})`, async ({
		page,
	}, testInfo) => {
		const profile = "00000000-0000-0000-0000-000000000100";
		let completed = false;
		let state = "";
		const device = new FamBudDevice({
			id: "00000000-0000-0000-0000-000000000200",
			profileId: profile,
			displayName: "FamBud simulator",
			connected: true,
			batteryPercent: 100,
			firmware: "sim/1",
			capabilities: [RobotCapabilityValue.START_QUIZ, RobotCapabilityValue.STOP_QUIZ],
			lastSeenAt: new Date().toISOString(),
		});
		let command: FamBudCommand | undefined;
		await page.route("**/vulture.server.v1.VultureControl/*", async (route) => {
			const method = route.request().url().split("/").at(-1);
			let response: unknown;
			switch (method) {
				case "ListTasks":
				case "GetLearningSchool":
				case "GetAvatar":
				case "GetFamilyAvatar":
					return nativeResponse(route, {});
				case "GetAccount":
					response = {
						account: { id: "parent", displayName: "Alex", role: AccountRole.PARENT },
					};
					break;
				case "GetChildPinAccess":
				case "GetParentPinAccess":
					return nativeResponse(route, { enabled: true });
				case "VoiceAssistant":
					return nativeResponse(route, {
						resultJson: JSON.stringify({ enabled: false, text: "", intent: "clarify" }),
					});
				case "GetMyFamily":
					response = { family: { id: "family", name: "Pilot" } };
					break;
				case "ListFamilyMembers":
					response = { members: [{ accountId: "parent" }] };
					break;
				case "ListLearningProfiles":
					response = {
						profiles: [
							{
								id: profile,
								familyId: "family",
								displayName: "Jamie",
								ageBand: LearningAgeBand.PRIMARY,
								guardianAccountIds: ["parent"],
							},
						],
					};
					break;
				case "GetTimetable":
					response = {
						timetable: {
							timezone: "UTC",
							windows: [{ day: 0, start: 960, end: 1020, kind: "allowed" }],
						},
					};
					break;
				case "ListHomework":
					response = {
						items: [
							{
								homework: { id: "homework", title: "Spelling worksheet", subject: "Spelling" },
								sources: [{ source: { id: "source", version: 1 } }],
							},
						],
					};
					break;
				case "ListPractice":
					response = {
						sets: [
							{
								practice: {
									practice: { id: "00000000-0000-0000-0000-000000000300", version: 2 },
									title: "Approved words",
									approved: true,
									reviewState: "approved",
								},
								questions: [
									{ question: { kind: PracticeQuestionKind.SPELLING, prompt: "Spell fruit" } },
								],
							},
						],
					};
					break;
				case "ReviewLearningSessions":
					response = {
						attempts: completed
							? [
									{
										session: {
											id: "session",
											createdAt: "2026-10-15T12:00:00Z",
											state: LearningSessionState.COMPLETED,
										},
										answers: [{ id: "a", answer: "apple", result: LearningAnswerResult.CORRECT }],
									},
								]
							: [],
					};
					break;
				default:
					throw new Error(`Unexpected RPC ${method}`);
			}
			await nativeResponse(route, response);
		});
		await page.route("**/vulture.server.v1.RobotGatewayService/*", async (route) => {
			if (route.request().method() === "OPTIONS") {
				await nativeResponse(route);
				return;
			}
			expect(route.request().headers().authorization).toBe(`Bearer vps_${"a".repeat(64)}`);
			const input = route.request().postDataJSON();
			switch (route.request().url().split("/").at(-1)) {
				case "ListRobots":
					if (command) command.state = state;
					await nativeResponse(route, {
						devices: [device],
						commands: command ? [command] : [],
					});
					break;
				case "IssueRobotCommand": {
					expect(input.target).toBe(device.id);
					expect(input.practiceVersion).toBe(2);
					expect(input.practiceId).toBe("00000000-0000-0000-0000-000000000300");
					expect(input.commandId).not.toBe(input.nonce);
					command = new FamBudCommand({ ...input, state: "queued", sessionId: "session" });
					state = "queued";
					await nativeResponse(route, { command });
					break;
				}
				case "CancelRobotCommand":
					expect(input.commandId).toBe(command!.commandId);
					state = "cancelled";
					await nativeResponse(route, {});
					break;
				case "RevokeRobot":
					device.revoked = true;
					device.connected = false;
					await nativeResponse(route, {});
					break;
				default:
					throw new Error("Unexpected robot RPC");
			}
		});
		await seedOidcSession(page);
		await page.addInitScript((theme) => localStorage.setItem("vulture.theme", theme), theme);
		await page.goto("/");
		await openParentLearning(page);
		await page.getByRole("tab", { name: "Setting", exact: true }).click();
		await page.locator("summary").filter({ hasText: "FamBud devices" }).click();
		const dashboard = page.getByRole("region", { name: "FamBud controls" });
		await expect(dashboard.getByRole("combobox")).toHaveValue(
			"00000000-0000-0000-0000-000000000300",
		);
		await expect(dashboard.getByRole("button", { name: "Fly · unsupported" })).toBeDisabled();
		await dashboard.getByRole("button", { name: "Start quiz" }).click();
		await expect(dashboard.getByText(/Quiz queued/)).toBeVisible();
		state = "accepted";
		await dashboard.getByRole("button", { name: "Refresh devices" }).click();
		await expect(dashboard.getByText(/Acknowledged/)).toBeVisible();
		state = "succeeded";
		completed = true;
		await dashboard.getByRole("button", { name: "Refresh devices" }).click();
		await expect(dashboard.getByText(/· succeeded ·/)).toBeVisible();
		await page.reload();
		await openParentLearning(page);
		await page.getByRole("tab", { name: "Setting", exact: true }).click();
		await page.locator("summary").filter({ hasText: "FamBud devices" }).click();
		await expect(dashboard.getByText(/· succeeded ·/)).toBeVisible();
		await dashboard.getByRole("button", { name: "Start quiz" }).click();
		await expect(dashboard.getByText(/Quiz queued/)).toBeVisible();
		device.connected = false;
		device.lastSeenAt = new Date(Date.now() - 31000).toISOString();
		await dashboard.getByRole("button", { name: "Refresh devices" }).click();
		await expect(dashboard.getByText("Disconnected · telemetry stale")).toBeVisible();
		await dashboard.getByRole("button", { name: "Stop quiz" }).click();
		await expect(dashboard.getByText(/Queued learning commands cancelled/)).toBeVisible();
		state = "failed";
		await dashboard.getByRole("button", { name: "Refresh devices" }).click();
		await expect(dashboard.getByText(/· failed ·/)).toBeVisible();
		await dashboard.getByRole("button", { name: "Revoke device" }).click();
		await expect(dashboard.getByText("Revoked — reconnect denied")).toBeVisible();
		await expect(dashboard.getByRole("button", { name: "Start quiz" })).toBeDisabled();
		await page.screenshot({
			path: `artifacts/fambud-controls-${theme}-${testInfo.project.name}.png`,
			fullPage: true,
		});
		await page.setViewportSize({ width: 390, height: 844 });
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
		).toBe(true);
		await page.screenshot({
			path: `artifacts/fambud-controls-${theme}-mobile-${testInfo.project.name}.png`,
			fullPage: true,
		});
	});
}
