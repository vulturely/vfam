import { test, expect } from "./fixtures";
import { nativeResponse } from "./nativeRpc";
import { mockChatSocket } from "./chatSocket";
import { openChildPage, openChildSwitch } from "./childShell";
import { GetChildPolicyResponse, TaskStatus } from "../../packages/core/src/api/protocol";
import type { Page } from "@playwright/test";

const token = `vcs_${"c".repeat(64)}`;
const siblingToken = `vcs_${"d".repeat(64)}`;
const sibling = "00000000-0000-0000-0000-000000000200";
const profileId = "00000000-0000-0000-0000-000000000100";
const familyId = "00000000-0000-0000-0000-000000000010";
const self = `profile:${profileId}`;

async function setup(page: Page) {
	const marks: { taskId: string; status: number }[] = [];
	const avatars: { image: string; contentType: string }[] = [];
	const chat: { action: unknown; token?: string; familyId?: unknown }[] = [];
	const switches: unknown[] = [];
	let active = token;
	let name = "Jamie";
	let task = {
		id: "task-1",
		familyId,
		title: "Feed the cat",
		status: TaskStatus.TODO,
		assigneeProfileIds: [profileId],
		endAt: new Date(Date.now() + 2 * 3600000).toISOString(),
	};
	await page.addInitScript(
		({ token }) => {
			const key = "vulture.child-session:https://auth.swavan.io/auth/v1/:vulturefam";
			if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ token }));
			(window as unknown as Record<string, unknown>).isTauri = true;
			(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
				transformCallback: (value: unknown) => value,
				async invoke(command: string, args: { account?: string; input: Record<string, unknown> }) {
					if (command !== "family_chat_crypto") return window.__nativeFallback(command, args);
					(window as unknown as { chatAccounts: string[] }).chatAccounts ??= [];
					(window as unknown as { chatAccounts: string[] }).chatAccounts.push(
						String(args.account ?? ""),
					);
					switch (args.input.action) {
						case "identity":
							return { deviceId: "kid-device", fingerprint: "d".repeat(64), keyPackages: ["p"] };
						case "pins":
							return { pins: {} };
						default:
							return {};
					}
				},
			};
		},
		{ token },
	);
	await mockChatSocket(page, (command, used) => {
		chat.push({ action: command.action, token: used, familyId: command.familyId });
		switch (command.action) {
			case "roster":
				return {
					devices: [
						{
							deviceId: "kid-device",
							accountId: self,
							fingerprint: "d".repeat(64),
							approved: false,
							revoked: false,
						},
					],
				};
			case "rooms":
				return { rooms: [] };
			default:
				return {};
		}
	});
	await page.route("**/vulture.server.v1.VultureControl/*", async (route) => {
		if (route.request().method() === "OPTIONS") return nativeResponse(route);
		expect(route.request().headers().authorization).toBe(`Bearer ${active}`);
		const method = route.request().url().split("/").at(-1)!;
		const input = route.request().postDataJSON();
		switch (method) {
			case "GetChildSession":
				return nativeResponse(route, {
					context: {
						profileId: active === token ? profileId : sibling,
						familyId,
						displayName: name,
						expiresAt: new Date(Date.now() + 3600000).toISOString(),
					},
				});
			case "GetChildPolicy":
				return nativeResponse(
					route,
					new GetChildPolicyResponse({
						allowed: true,
						currentActivity: "Allowed time",
						evaluatedAt: new Date().toISOString(),
						validUntil: new Date(Date.now() + 30000).toISOString(),
						timezone: "UTC",
					}),
				);
			case "ListChildPractice":
				return nativeResponse(route, {
					activities: [
						{ practice: { id: "set", version: 1 }, title: "Adding to 10", subject: "Math" },
					],
				});
			case "ListChildTasks":
				return nativeResponse(route, { tasks: [task] });
			case "MarkChildTaskStatus":
				marks.push(input);
				task = { ...task, status: input.status };
				return nativeResponse(route, { task });
			case "GetProfileAvatar":
				expect(input.profileId).toBe(active === token ? profileId : sibling);
				return nativeResponse(route, avatars.at(-1) ?? {});
			case "SetProfileAvatar":
				avatars.push(input);
				return nativeResponse(route, { ok: true });
			case "SignInChild": {
				switches.push(input);
				if (input.pin !== "654321") return nativeResponse(route, undefined, 7);
				active = siblingToken;
				name = "Sam";
				return nativeResponse(route, {
					sessionToken: siblingToken,
					context: { profileId: sibling, familyId, displayName: "Sam", expiresAt: "" },
				});
			}
			case "GetFamilyAiChildStatus":
				return nativeResponse(route, {});
			case "ListChildFamily":
				return nativeResponse(route, {
					members: [
						{ participantId: "mum", displayName: "Mum", guardian: true },
						{ participantId: self, displayName: "Jamie", child: true },
						{ participantId: `profile:${sibling}`, displayName: "Sam", child: true },
					],
				});
			default:
				throw new Error(`Unexpected child home RPC ${method}`);
		}
	});
	return { marks, avatars, chat, switches };
}

for (const width of [390, 1440]) {
	test(`child home shows reminders, homework and tasks at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 900 });
		const server = await setup(page);
		await page.goto("/");
		await expect(page.getByRole("heading", { name: "Hi, Jamie!" })).toBeVisible();
		const reminders = page.getByRole("list", { name: "Reminders" });
		await expect(reminders).toContainText("“Feed the cat” is due");
		await expect(reminders).toContainText("You have 1 homework to finish");
		await expect(page.getByRole("button", { name: /Adding to 10/ })).toBeVisible();
		await page.getByRole("button", { name: "Start", exact: true }).click();
		await expect(page.getByRole("button", { name: "I’m done" })).toBeVisible();
		await page.getByRole("button", { name: "I’m done" }).click();
		await expect(page.getByText(/Waiting for a guardian/)).toBeVisible();
		expect(server.marks).toEqual([
			{ taskId: "task-1", status: TaskStatus.IN_PROGRESS },
			{ taskId: "task-1", status: TaskStatus.IN_REVIEW },
		]);
		await page.screenshot({
			path: testInfo.outputPath(`child-home-${width}.png`),
			fullPage: true,
		});
		await page.getByRole("button", { name: /Adding to 10/ }).click();
		await expect(page.getByRole("region", { name: "Learning activities" })).toBeVisible();
		await page.reload();
		await expect(page.getByRole("region", { name: "Learning activities" })).toBeVisible();
	});
}

test("child profile uploads a picture shown in the navigation", async ({ page }) => {
	const server = await setup(page);
	await page.goto("/");
	await openChildPage(page, "Profile");
	await expect(page.getByRole("heading", { name: "Jamie" })).toBeVisible();
	const png = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
		"base64",
	);
	const fileChooser = page.waitForEvent("filechooser");
	await page.getByRole("button", { name: "Add your picture" }).click();
	await (await fileChooser).setFiles({ name: "me.png", mimeType: "image/png", buffer: png });
	await expect(page.getByText("Picture updated.")).toBeVisible();
	expect(server.avatars).toHaveLength(1);
	expect(["image/webp", "image/png"]).toContain(server.avatars[0]!.contentType);
	await expect(
		page.getByRole("button", { name: "Change your picture" }).locator("img"),
	).toBeVisible();
	await expect(page.locator(".v-sidebar-desktop .v-nav-avatar")).toBeVisible();
	await expect(page.getByRole("button", { name: /Remove/ })).toHaveCount(0);
});

test("child chat uses the child's own identity and lists family by name", async ({ page }) => {
	const server = await setup(page);
	// Family chat is open even when learning time is closed.
	await page.route("**/vulture.server.v1.VultureControl/GetChildPolicy", (route) =>
		nativeResponse(
			route,
			new GetChildPolicyResponse({
				allowed: false,
				currentActivity: "Break time",
				evaluatedAt: new Date().toISOString(),
				validUntil: new Date(Date.now() + 30000).toISOString(),
				timezone: "UTC",
			}),
		),
	);
	await page.goto("/");
	await openChildPage(page, "Chat & calls");
	await expect(page.getByRole("button", { name: "Message mum" })).toBeVisible();
	await expect(page.getByText("Mum", { exact: true })).toBeVisible();
	await expect(page.getByText("Sam", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: `Message ${self}` })).toHaveCount(0);
	expect(server.chat.length).toBeGreaterThan(0);
	expect(server.chat.every((c) => c.token === token && c.familyId === familyId)).toBe(true);
	expect(
		await page.evaluate(() => (window as unknown as { chatAccounts: string[] }).chatAccounts),
	).toContain(self);
	// An unapproved device opens Device security on its own.
	await expect(page.getByText("Pending guardian approval")).toBeVisible();
	await expect(page.getByRole("button", { name: "Approve device" })).toHaveCount(0);
});

test("child account menu has only Switch profile, which opens the profile chooser", async ({
	page,
}) => {
	const server = await setup(page);
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/");
	await page.getByRole("button", { name: "Account menu" }).click();
	await expect(page.getByRole("menuitem")).toHaveCount(1);
	await page.keyboard.press("Escape");
	await openChildSwitch(page);
	await expect(page.getByRole("button", { name: /Mum.*Parent/ })).toBeVisible();
	await expect(page.getByRole("button", { name: /Jamie/ })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "End child session" })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Switch child profile" })).toHaveCount(0);
	await page.getByRole("button", { name: /Sam.*Child/ }).click();
	await page.getByLabel("Six-digit PIN").fill("111111");
	await page.getByRole("button", { name: "Unlock", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText("Check your PIN");
	await page.getByLabel("Six-digit PIN").fill("654321");
	await page.getByRole("button", { name: "Unlock", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Hi, Sam!" })).toBeVisible();
	expect(server.switches).toEqual([
		{ profileId: sibling, pin: "111111" },
		{ profileId: sibling, pin: "654321" },
	]);
});

for (const theme of ["light", "dark"]) {
	test(`homework and tasks show as cards with friendly empty states (${theme})`, async ({
		page,
	}, testInfo) => {
		await setup(page);
		// Learning time is closed and there are no tasks.
		await page.route("**/vulture.server.v1.VultureControl/GetChildPolicy", (route) =>
			nativeResponse(
				route,
				new GetChildPolicyResponse({
					allowed: false,
					evaluatedAt: new Date().toISOString(),
					validUntil: new Date(Date.now() + 30000).toISOString(),
					timezone: "UTC",
				}),
			),
		);
		await page.route("**/vulture.server.v1.VultureControl/ListChildTasks", (route) =>
			nativeResponse(route, { tasks: [] }),
		);
		await page.addInitScript((theme) => localStorage.setItem("vulture.theme", theme), theme);
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto("/");
		const homework = page.getByRole("region", { name: "Homework" });
		const tasks = page.getByRole("region", { name: "Tasks" });
		await expect(homework.getByText("Homework opens during learning time.")).toBeVisible();
		await expect(tasks.getByText("No tasks for you right now.")).toBeVisible();
		// Side by side on a wide screen.
		const [left, right] = [(await homework.boundingBox())!, (await tasks.boundingBox())!];
		expect(Math.abs(left.y - right.y)).toBeLessThan(2);
		expect(right.x).toBeGreaterThan(left.x + left.width - 1);
		await page.screenshot({ path: testInfo.outputPath(`child-home-empty-${theme}.png`) });
		// Stacked on a phone, with nothing cut off.
		await page.setViewportSize({ width: 390, height: 844 });
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
		).toBe(true);
		expect((await tasks.boundingBox())!.y).toBeGreaterThan((await homework.boundingBox())!.y);
	});
}
