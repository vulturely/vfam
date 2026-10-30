import { defineConfig, devices } from "@playwright/test";

const uiPort = Number(process.env.VULTURE_UI_PORT ?? 1421);
const baseURL = `http://localhost:${uiPort}`;
const instrumentCoverage = process.env.VULTURE_COVERAGE === "1";

export default defineConfig({
	testDir: "./tests/integration",
	timeout: instrumentCoverage ? 60_000 : 30_000,
	expect: {
		timeout: instrumentCoverage ? 30_000 : 10_000,
	},
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 1,
	workers: process.env.CI ? 1 : undefined,
	reporter: [["html", { open: "never" }], ["list"]],
	use: {
		baseURL: baseURL,
		actionTimeout: instrumentCoverage ? 30_000 : 10_000,
		trace: "on-first-retry",
		screenshot: "only-on-failure",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
		{
			name: "webkit",
			use: { ...devices["Desktop Safari"] },
		},
	],
	webServer: {
		command: "npm run dev",
		url: baseURL,
		reuseExistingServer: false,
		env: { VULTURE_UI_PORT: String(uiPort) },
		timeout: 120_000,
	},
});
