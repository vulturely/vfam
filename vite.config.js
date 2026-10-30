import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const tauriHost = process.env.TAURI_DEV_HOST;
const uiPort = Number.parseInt(process.env.VULTURE_UI_PORT ?? "1420", 10);
const coreSourceDir = resolve(process.cwd(), "packages/core/src");
const bindHost = process.env.VULTURE_UI_HOST ?? tauriHost;
const publicHost = process.env.VULTURE_PUBLIC_HOST ?? tauriHost;
const allowedHosts = (process.env.VULTURE_ALLOWED_HOSTS ?? "")
	.split(",")
	.map((allowedHost) => allowedHost.trim())
	.filter(Boolean);
if (tauriHost) allowedHosts.push(tauriHost);
const uniqueAllowedHosts = [...new Set(allowedHosts)];
const tlsCert = process.env.VULTURE_TLS_CERT;
const tlsKey = process.env.VULTURE_TLS_KEY;
const https =
	tlsCert && tlsKey ? { cert: readFileSync(tlsCert), key: readFileSync(tlsKey) } : undefined;

/** @type {import("vite").Plugin} */
const coreSourcePlugin = {
	name: "vulture-core-source",
	enforce: "post",
	configureServer(server) {
		const allowed = server.config.server.fs.allow;
		if (!allowed.includes(coreSourceDir)) allowed.push(coreSourceDir);
	},
};

export default defineConfig(async () => {
	const kitPlugins = await sveltekit();
	return {
		plugins: [tailwindcss(), ...kitPlugins, coreSourcePlugin],
		worker: /** @type {import("vite").UserConfig["worker"]} */ ({
			format: "es",
		}),
		optimizeDeps: {
			exclude: ["@vulture/core", "yaml"],
		},
		clearScreen: false,
		server: {
			port: uiPort,
			strictPort: true,
			host: bindHost || false,
			https,
			allowedHosts: uniqueAllowedHosts,
			hmr: publicHost
				? {
						protocol: https ? "wss" : "ws",
						host: publicHost,
						clientPort: uiPort,
					}
				: undefined,
			watch: {
				// Test output must not reload a running app (that drops its live FamBuddy stream).
				ignored: [
					"**/src-tauri/**",
					"**/build/**",
					"**/.svelte-kit/**",
					"**/coverage/**",
					"**/test-results/**",
					"**/playwright-report/**",
				],
			},
		},
	};
});
