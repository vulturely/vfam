import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vitest/config";
import { uiCoverageThresholds } from "./scripts/ui-coverage-config.mjs";

export default defineConfig({
	plugins: [sveltekit()],
	resolve: {
		conditions: ["browser"],
	},
	test: {
		environment: "jsdom",
		// Behavior tests drive whole screens; a shared CI runner can need more than the 5 s default.
		testTimeout: 30_000,
		include: ["src/**/*.test.ts", "packages/**/*.test.ts", "plugins/**/*.test.ts"],
		setupFiles: ["src/tests/setup.ts"],
		server: {
			deps: {
				inline: ["lucide-svelte", "bits-ui", "runed", "svelte-toolbelt"],
			},
		},
		coverage: {
			provider: "v8",
			reporter: ["text", "html"],
			include: ["src/**/*.{ts,svelte}", "packages/**/*.{ts,svelte}", "plugins/**/*.{ts,svelte}"],
			exclude: ["**/*.test.ts", "src/tests/**", "packages/core/src/chat/wasm/*.d.ts"],
			thresholds: uiCoverageThresholds,
		},
	},
});
