import { test, expect, seedOidcSession, readNativeState } from "./fixtures";
import { nativeResponse } from "./nativeRpc";
import { GetChildPolicyResponse } from "../../packages/core/src/api/protocol";

const parentKey = "oidc.user:https://auth.swavan.io/auth/v1/:vulturefam";
const childKey = "vulture.child-session:https://auth.swavan.io/auth/v1/:vulturefam";

test("a parent whose session the server rejects is taken to sign-in", async ({ page }) => {
	await seedOidcSession(page);
	let expired = false;
	await page.route("**/vulture.server.v1.VultureControl/*", async (route) => {
		if (route.request().method() === "OPTIONS") return nativeResponse(route);
		const method = route.request().url().split("/").at(-1)!;
		if (expired && method !== "RevokeSession") return nativeResponse(route, undefined, 16);
		switch (method) {
			case "GetMyFamily":
				return nativeResponse(route, {
					family: { id: "00000000-0000-0000-0000-000000000010", name: "Pilot family" },
				});
			case "ListFamilyMembers":
			case "ListTasks":
			case "ListLearningProfiles":
				return nativeResponse(route, {});
			default:
				return route.fallback();
		}
	});
	await page.goto("/#/home:parent");
	await expect(page.getByRole("heading", { name: "Your household, at a glance." })).toBeVisible();
	// Expire only after the first load, so the refresh is what meets the rejection.
	const refresh = page.getByRole("button", { name: "Refresh household stats" });
	await expect(refresh).toBeEnabled();
	expired = true;
	await refresh.click();
	await expect(page.locator(".v-login-button")).toBeVisible();
	expect(await readNativeState(page, parentKey)).toBeNull();
});

test("a child whose session the server rejects is taken to sign-in", async ({ page }) => {
	const token = `vcs_${"c".repeat(64)}`;
	let expired = false;
	// Seed once: the app must clear the session itself, and a reload must not restore it.
	await page.addInitScript((token) => {
		const key = "vulture.child-session:https://auth.swavan.io/auth/v1/:vulturefam";
		if (sessionStorage.getItem("seeded")) return;
		sessionStorage.setItem("seeded", "1");
		localStorage.setItem(key, JSON.stringify({ token }));
	}, token);
	await page.route("**/vulture.server.v1.VultureControl/*", async (route) => {
		if (route.request().method() === "OPTIONS") return nativeResponse(route);
		const method = route.request().url().split("/").at(-1)!;
		if (expired) return nativeResponse(route, undefined, 16);
		switch (method) {
			case "GetChildSession":
				return nativeResponse(route, {
					context: {
						profileId: "00000000-0000-0000-0000-000000000100",
						familyId: "00000000-0000-0000-0000-000000000010",
						displayName: "Jamie",
						expiresAt: new Date(Date.now() + 3600000).toISOString(),
					},
				});
			case "GetChildPolicy":
				return nativeResponse(
					route,
					new GetChildPolicyResponse({
						allowed: false,
						evaluatedAt: new Date().toISOString(),
						validUntil: new Date(Date.now() + 30000).toISOString(),
						timezone: "UTC",
					}),
				);
			default:
				return nativeResponse(route, {});
		}
	});
	await page.goto("/");
	await expect(page.getByRole("heading", { name: "Hi, Jamie!" })).toBeVisible();
	const refresh = page.getByRole("button", { name: "Refresh home" });
	await expect(refresh).toBeEnabled();
	expired = true;
	await refresh.click();
	await expect(page.locator(".v-login-button")).toBeVisible();
	expect(await readNativeState(page, childKey)).toBeNull();
});
