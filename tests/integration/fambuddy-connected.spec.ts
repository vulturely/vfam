import { test, expect } from "./fixtures";
import { installFixture, gateway, pairingCode } from "../devices/fambuddy/emulator/fixture";

for (const width of [390, 1280]) {
	test(`Connected FamBuddy uses Vulture controls and both approvals at ${width}px`, async ({
		page,
	}, info) => {
		await page.setViewportSize({ width, height: 844 });
		await page.goto("/");
		const fixture = await installFixture(page);
		try {
			await page.reload();
			await expect(page.getByRole("heading", { name: "Your household, at a glance." })).toBeVisible(
				{ timeout: 30000 },
			);
			if (width < 600) await page.getByRole("button", { name: "Open menu" }).click();
			await page
				.getByRole(width < 600 ? "button" : "link", {
					name: "FamBuddy",
					exact: true,
				})
				.click();
			await page.getByRole("button", { name: "Home-network pairing" }).click();
			await page.getByLabel("Device address").fill(gateway);
			await page.getByLabel("One-use pairing code").fill(pairingCode);
			await page.getByRole("button", { name: "Check device", exact: true }).click();
			await expect(page.getByRole("group", { name: "Device certificate" })).toContainText(
				"AB:CD:EF:01",
			);
			await page.getByRole("button", { name: "They match, connect", exact: true }).click();
			await expect(page.getByRole("heading", { name: "Your FamBuddy" })).toBeVisible();
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
			).toBeTruthy();
			await page.screenshot({
				path: `/private/tmp/fambuddy-final-${info.project.name}-${width}.png`,
				fullPage: true,
			});
			const approve = page.getByRole("button", {
				name: "Approve question and send to AI",
			});
			await page.getByLabel("Edit reviewed text").fill("Unsaved edit");
			await expect(approve).toBeDisabled();
			await page.getByLabel("Edit reviewed text").fill("Why is the sky blue?");
			await approve.click();
			await expect(page.getByRole("button", { name: "Approve answer for speech" })).toBeEnabled();
			expect(fixture.calls.filter((call) => call.command.case === "approve")).toHaveLength(1);
			await page.getByRole("button", { name: "Approve answer for speech" }).click();
			await expect(page.getByText("No pending requests.")).toBeVisible();
			expect(fixture.calls.filter((call) => call.command.case === "approve")).toHaveLength(2);
			await page.getByRole("button", { name: "Mute and cancel all requests" }).click();
			await expect(page.getByRole("button", { name: "Start live talk" })).toBeDisabled();
			await page.getByRole("button", { name: "Disconnect", exact: true }).click();
			await expect(page.getByText(/Paired on your home network/)).toHaveCount(0);
			await expect(page.getByRole("button", { name: "Start live talk" })).toHaveCount(0);
			await page.getByRole("button", { name: "Home-network pairing" }).click();
			await expect(page.getByRole("heading", { name: "Connect a FamBuddy" })).toBeVisible();
		} finally {
			await fixture.cleanup();
		}
	});
}
