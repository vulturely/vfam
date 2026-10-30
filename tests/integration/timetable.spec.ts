import { test, expect } from "./fixtures";
import { nativeResponse } from "./nativeRpc";
import { openChildPage, openChildSwitch } from "./childShell";
import { GetChildPolicyResponse } from "../../packages/core/src/api/protocol";
import type { Page } from "@playwright/test";
async function child(page: Page) {
	let allowed = false,
		offline = false,
		ttl = 30000,
		requests = 0;
	await page.addInitScript(() => {
		localStorage.setItem(
			"vulture.child-session:https://auth.swavan.io/auth/v1/:vulturefam",
			JSON.stringify({ token: `vcs_${"c".repeat(64)}` }),
		);
	});
	await page.route("**/vulture.server.v1.VultureControl/*", async (route) => {
		if (route.request().method() === "OPTIONS") {
			await nativeResponse(route);
			return;
		}
		const method = route.request().url().split("/").at(-1);
		switch (method) {
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
			case "GetChildPolicy":
				requests++;
				if (offline) {
					await route.abort();
					return;
				}
				await nativeResponse(
					route,
					new GetChildPolicyResponse({
						allowed,
						currentActivity: allowed ? "Study time" : "Break time",
						nextAllowedAt: allowed ? undefined : "2026-10-20T16:00:00Z",
						evaluatedAt: new Date().toISOString(),
						validUntil: new Date(Date.now() + ttl).toISOString(),
						timezone: "America/Chicago",
					}),
				);
				break;
			case "ListChildPractice":
				expect(allowed).toBe(true);
				await nativeResponse(route, {});
				break;
			case "ListChildTasks":
			case "GetProfileAvatar":
			case "ListChildFamily":
				await nativeResponse(route, {});
				break;
			default:
				throw new Error(`Unexpected RPC ${method}`);
		}
	});
	await page.goto("/");
	await openChildPage(page, "Learning");
	return {
		allow: () => {
			allowed = true;
		},
		deny: () => {
			allowed = false;
		},
		offline: () => {
			offline = true;
		},
		shortLease: () => {
			ttl = 1500;
		},
		requests: () => requests,
	};
}
test("blocked child routes and reloads retain Help, next time, and parent unlock", async ({
	page,
}) => {
	await child(page);
	await expect(page.getByRole("heading", { name: "Time for a pause" })).toBeVisible();
	await expect(page.getByText(/Right now: Break time/)).toBeVisible();
	await expect(page.getByText(/Learning opens again/)).toBeVisible();
	await expect(page.getByRole("heading", { name: "Your learning space" })).toHaveCount(0);
	await page.getByRole("button", { name: "Help", exact: true }).click();
	await expect(page.getByText(/Closing Vulture still lets you use other apps/)).toBeVisible();
	await openChildSwitch(page);
	await expect(page.getByRole("button", { name: /Parent$/ })).toBeVisible();
	await page.evaluate(() => {
		location.hash = "#learning:profiles";
	});
	await page.reload();
	await expect(page.getByRole("heading", { name: "Hi, Jamie!" })).toBeVisible();
	await expect(page.getByText("Homework opens during learning time.")).toBeVisible();
	await openChildPage(page, "Learning");
	await expect(page.getByRole("heading", { name: "Time for a pause" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Children's learning" })).toHaveCount(0);
});
test("policy expiry blocks learning, reconnect revalidates and restart discards cached allow", async ({
	page,
}) => {
	const state = await child(page);
	// Wait for the server's answer; the pause screen also shows before it arrives.
	await expect(page.getByText("Right now: Break time")).toBeVisible();
	state.allow();
	state.shortLease();
	await page.getByRole("button", { name: "Try again" }).click();
	await expect(page.getByRole("heading", { name: "Your learning space" })).toBeVisible();
	state.offline();
	await expect(page.getByRole("heading", { name: "Time for a pause" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Your learning space" })).toHaveCount(0);
	await page.getByRole("button", { name: "Try again" }).click();
	await expect(page.getByRole("alert")).toBeVisible();
	await page.reload();
	await openChildPage(page, "Learning");
	await expect(page.getByRole("heading", { name: "Time for a pause" })).toBeVisible();
});
test("offline event clears even an unexpired policy and online checks a new policy", async ({
	page,
}) => {
	const state = await child(page);
	// Wait for the server's answer; the pause screen also shows before it arrives.
	await expect(page.getByText("Right now: Break time")).toBeVisible();
	state.allow();
	await page.getByRole("button", { name: "Try again" }).click();
	await expect(page.getByRole("heading", { name: "Your learning space" })).toBeVisible();
	await page.evaluate(() => window.dispatchEvent(new Event("offline")));
	await expect(page.getByRole("heading", { name: "Your learning space" })).toHaveCount(0);
	state.deny();
	await page.evaluate(() => window.dispatchEvent(new Event("online")));
	await expect(page.getByText("Right now: Break time")).toBeVisible();
	expect(state.requests()).toBeGreaterThanOrEqual(3);
});
