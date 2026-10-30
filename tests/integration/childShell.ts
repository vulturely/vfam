import { expect, type Page } from "@playwright/test";

/** Opens a child shell page from the sidebar, or from the menu sheet on narrow screens. */
export async function openChildPage(page: Page, label: string) {
	await expect(page.locator(".v-sidebar")).toBeAttached();
	const link = page.getByRole("link", { name: label, exact: true });
	if (await link.isVisible()) {
		await link.click();
		return;
	}
	await page.getByRole("button", { name: "Open menu", exact: true }).click();
	await page.getByRole("button", { name: label, exact: true }).click();
}

/** Opens Switch profile: the profile chooser with the parent and the child's siblings. */
export async function openChildSwitch(page: Page) {
	await expect(page.locator(".v-sidebar")).toBeAttached();
	const account = page.getByRole("button", { name: "Account menu" });
	if (await account.isVisible()) {
		await account.click();
		await page.getByRole("menuitem", { name: "Switch profile" }).click();
	} else {
		await page.getByRole("button", { name: "Open menu", exact: true }).click();
		await page.getByRole("button", { name: "Switch profile" }).click();
	}
	await expect(page.getByRole("heading", { name: "Who’s here?" })).toBeVisible();
}
