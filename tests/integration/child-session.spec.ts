import { GetChildPolicyResponse } from "../../packages/core/src/api/protocol";
import type { BrowserContext } from "@playwright/test";
import { test, expect, seedOidcSession, prepareNativePage, readNativeState } from "./fixtures";
import { nativeResponse } from "./nativeRpc";
import { openChildSwitch } from "./childShell";
import { AccountRole, LearningAgeBand } from "../../packages/core/src/api/protocol";

const parentKey = "oidc.user:https://auth.swavan.io/auth/v1/:vulturefam";
const childKey = "vulture.child-session:https://auth.swavan.io/auth/v1/:vulturefam";
const parentId = "00000000-0000-0000-0000-000000000001";
const familyId = "00000000-0000-0000-0000-000000000010";
const profileId = "00000000-0000-0000-0000-000000000100";
const firstParent = `vps_${"a".repeat(64)}`;
const freshParent = `vps_${"b".repeat(64)}`;
const childToken = `vcs_${"c".repeat(64)}`;

async function mockSessions(context: BrowserContext, failUnlock = false) {
	let activeParent: string | null = firstParent;
	let childActive = false;
	const flowId = "00000000-0000-0000-0000-000000000999";
	const nonce = "fresh-login-nonce";
	const expiresAt = new Date(Date.now() + 3600000).toISOString();
	const child = { profileId, familyId, displayName: "Jamie", expiresAt };
	await context.route("**/.well-known/openid-configuration", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				authorization_endpoint: "https://provider.invalid/test-provider/authorize",
			}),
		}),
	);
	await context.route("**/test-provider/authorize?**", (route) => {
		const url = new URL(route.request().url());
		expect(url.searchParams.get("prompt")).toBe("login");
		expect(url.searchParams.get("max_age")).toBe("0");
		expect(url.searchParams.get("nonce")).toBe(nonce);
		expect(url.searchParams.get("code_challenge_method")).toBe("S256");
		const callback = new URL(url.searchParams.get("redirect_uri")!);
		callback.searchParams.set("code", "fresh-test-code");
		callback.searchParams.set("state", url.searchParams.get("state")!);
		return route.fulfill({
			status: 200,
			contentType: "text/html",
			body: `<!doctype html><script>window.location.replace(${JSON.stringify(callback.toString())})</script>`,
		});
	});
	await context.route("**/vulture.server.v1.VultureControl/*", async (route) => {
		if (route.request().method() === "OPTIONS") {
			await nativeResponse(route);
			return;
		}
		const token = route.request().headers().authorization?.replace("Bearer ", "");
		const method = route.request().url().split("/").at(-1)!;
		const input = route.request().postDataJSON();
		if (
			![
				"BeginParentSignIn",
				"ExchangeAuthCode",
				"UnlockParent",
				"GetChildSession",
				"GetChildPolicy",
				"ListChildPractice",
				"ListChildTasks",
				"GetProfileAvatar",
				"ListChildFamily",
				"RevokeSession",
			].includes(method) &&
			(!activeParent || token !== activeParent)
		) {
			await nativeResponse(route, undefined, 16);
			return;
		}
		switch (method) {
			case "GetParentPinAccess":
				return nativeResponse(route, { enabled: true });
			case "UnlockParent": {
				if (!childActive || token !== childToken || input.pin !== "482691")
					return nativeResponse(route, undefined, 16);
				childActive = false;
				activeParent = freshParent;
				return nativeResponse(route, {
					accountId: parentId,
					displayName: "Alex",
					accessToken: freshParent,
					expiresAt,
				});
			}
			case "GetChildPinAccess":
				await nativeResponse(route, { enabled: true, loginId: "child-login" });
				break;
			case "ListTasks":
				return nativeResponse(route, {});
			case "GetParentSession":
				await nativeResponse(route, { accountId: parentId, displayName: "Alex", expiresAt });
				break;
			case "GetMyFamily":
				await nativeResponse(route, { family: { id: familyId, name: "Pilot family" } });
				break;
			case "GetAvatar":
				await nativeResponse(route, {});
				break;
			case "ListFamilyMembers":
				await nativeResponse(route, { members: [{ accountId: parentId }] });
				break;
			case "GetAccount":
				await nativeResponse(route, {
					account: { id: parentId, displayName: "Alex", role: AccountRole.PARENT },
				});
				break;
			case "ListLearningProfiles":
				await nativeResponse(route, {
					profiles: [
						{
							id: profileId,
							familyId,
							displayName: "Jamie",
							ageBand: LearningAgeBand.PRIMARY,
							guardianAccountIds: [parentId],
						},
					],
				});
				break;
			case "ReviewLearningSessions":
				await nativeResponse(route, {});
				return;
			case "ListHomework":
				await nativeResponse(route, { items: [] });
				break;
			case "SignInChild": {
				expect(input.loginId).toBe("child-login");
				expect(input.pin).toBe("123456");
				activeParent = null;
				childActive = true;
				await nativeResponse(route, { sessionToken: childToken, context: child });
				break;
			}
			case "ListChildPractice":
			case "ListChildTasks":
			case "GetProfileAvatar":
				await nativeResponse(route, {});
				break;
			case "ListChildFamily":
				await nativeResponse(route, {
					members: [
						{ participantId: parentId, displayName: "Alex", guardian: true },
						{ participantId: `profile:${profileId}`, displayName: "Jamie", child: true },
					],
				});
				break;
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
			case "GetAccountSetup":
				await nativeResponse(route, {
					role: AccountRole.PARENT,
					dobConfirmed: true,
					completed: true,
				});
				break;
			case "GetChildSession":
				await nativeResponse(
					route,
					childActive && token === childToken ? { context: child } : undefined,
					childActive && token === childToken ? 0 : 16,
				);
				break;
			case "BeginParentSignIn": {
				expect(input.codeChallenge).toHaveLength(43);
				await nativeResponse(route, { flowId, nonce, expiresAt });
				break;
			}
			case "ExchangeAuthCode": {
				expect(input.flowId).toBe(flowId);
				expect(input.childSessionToken).toBe(childToken);
				expect(input.code).toBe("fresh-test-code");
				expect(input.codeVerifier.length).toBeGreaterThanOrEqual(43);
				if (failUnlock) {
					await nativeResponse(route, undefined, 16);
					return;
				}
				childActive = false;
				activeParent = freshParent;
				await nativeResponse(route, {
					accountId: parentId,
					displayName: "Alex",
					accessToken: freshParent,
					expiresAt,
				});
				break;
			}
			case "RevokeSession":
				if (token === activeParent) activeParent = null;
				if (token === childToken) childActive = false;
				await nativeResponse(route, { ok: true });
				break;
			default:
				throw new Error(`Unexpected session RPC ${method}`);
		}
	});
	return {
		expireChild: () => {
			childActive = false;
		},
	};
}

async function enterChildMode(page: import("@playwright/test").Page) {
	await page.goto("/#/home:parent");
	await expect(page.getByRole("button", { name: /Children’s learning/ })).toBeVisible();
	await page.evaluate(() => {
		location.hash = "/profile:choose";
	});
	await page.getByRole("button", { name: /Jamie.*Child/ }).click();
	await page.getByLabel("Six-digit PIN").fill("123456");
	await page.getByRole("button", { name: "Unlock", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Hi, Jamie!" })).toBeVisible();
}

/** Parent unlock is the parent's tile in the profile chooser under Switch profile. */
async function openParentUnlock(page: import("@playwright/test").Page) {
	await openChildSwitch(page);
	await page.getByRole("button", { name: /Alex.*Parent/ }).click();
}

test("handoff clears parent credentials across tabs; guardian freshly signs in to unlock", async ({
	page,
	context,
}) => {
	await seedOidcSession(page, { name: "Alex", mockSession: false });
	await mockSessions(context);
	await page.goto("/#/home:parent");
	await expect(page.locator('a[href="#/learning:profiles"]')).toBeVisible();
	const otherTab = await context.newPage();
	await prepareNativePage(otherTab);
	await otherTab.goto("/#/home:parent");
	await expect(otherTab.locator('a[href="#/learning:profiles"]')).toBeVisible();
	await enterChildMode(page);
	await expect(otherTab.getByRole("heading", { name: "Hi, Jamie!" })).toBeVisible();
	expect(await readNativeState(page, parentKey)).toBeNull();
	await page.goto("/#/learning:profiles");
	await expect(page.getByRole("region", { name: "Parent learning dashboard" })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Start quiz", exact: true })).toHaveCount(0);
	await page.goto("/#/family:manage");
	await expect(page.getByRole("heading", { name: "Hi, Jamie!" })).toBeVisible();
	await expect(page.locator('a[href="#/learning:profiles"]')).toHaveCount(0);
	await openParentUnlock(page);
	await page.getByRole("button", { name: "Forgot PIN? Sign in to reset" }).click();
	await expect(page.locator('a[href="#/learning:profiles"]')).toBeVisible();
	expect(await readNativeState(page, childKey)).toBeNull();
	expect((await readNativeState<{ accessToken: string }>(page, parentKey))?.accessToken).toBe(
		freshParent,
	);
	await expect(otherTab.locator('a[href="#/learning:profiles"]')).toBeVisible();
	await otherTab.close();
});

test("failed guardian login retains child mode and no parent credential", async ({
	page,
	context,
}) => {
	await seedOidcSession(page, { mockSession: false });
	await mockSessions(context, true);
	await enterChildMode(page);
	await openParentUnlock(page);
	await page.getByRole("button", { name: "Forgot PIN? Sign in to reset" }).click();
	await expect(page.getByRole("alert")).toBeVisible();
	expect(await readNativeState(page, parentKey)).toBeNull();
	await page.getByRole("button", { name: "Back to sign in" }).click();
	await expect(page.getByRole("heading", { name: "Hi, Jamie!" })).toBeVisible();
});

test("expired child sessions stay restricted and can be ended without restoring a parent", async ({
	page,
	context,
}, testInfo) => {
	await seedOidcSession(page, { mockSession: false });
	const server = await mockSessions(context);
	await enterChildMode(page);
	server.expireChild();
	await page.reload();
	await expect(page.getByRole("heading", { name: "Learning session paused" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Guardian sign-in" })).toBeVisible();
	await page.getByRole("button", { name: "Help", exact: true }).click();
	await expect(
		page.getByText("Closing Vulture still permits other apps", { exact: false }),
	).toBeVisible();
	await expect(page.locator('a[href="#/learning:profiles"]')).toHaveCount(0);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.screenshot({
		path: testInfo.outputPath("child-mode-mobile.png"),
		fullPage: true,
	});
	await page.getByRole("button", { name: "End child session" }).click();
	await expect(page.getByRole("button", { name: "Open menu", exact: true })).toHaveCount(0);
	await expect(page.locator(".v-login-button")).toBeVisible();
	expect(await readNativeState(page, parentKey)).toBeNull();
	expect(await readNativeState(page, childKey)).toBeNull();
});

for (const width of [390, 1440]) {
	test(`parent PIN unlock returns to parent controls at ${width}px`, async ({
		page,
		context,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 900 });
		await seedOidcSession(page, { mockSession: false });
		await mockSessions(context);
		await enterChildMode(page);
		await openParentUnlock(page);
		await page.getByLabel("Parent PIN", { exact: true }).fill("000000");
		await page.getByRole("button", { name: "Unlock", exact: true }).click();
		await expect(page.getByRole("alert")).toContainText("Check your parent PIN");
		expect(await readNativeState(page, parentKey)).toBeNull();
		await page.getByLabel("Parent PIN", { exact: true }).fill("482691");
		await page.screenshot({
			path: `artifacts/parent-pin-unlock-${width}-${testInfo.project.name}.png`,
			fullPage: true,
		});
		await page.getByRole("button", { name: "Unlock", exact: true }).click();
		await expect(page.getByRole("heading", { name: "Your household, at a glance." })).toBeVisible();
		expect(await readNativeState(page, childKey)).toBeNull();
		expect((await readNativeState<{ accessToken: string }>(page, parentKey))?.accessToken).toBe(
			freshParent,
		);
	});
}
