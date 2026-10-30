import type { Page } from "@playwright/test";
import convert from "ast-v8-to-istanbul";
import coverageLib from "istanbul-lib-coverage";
import { parseAstAsync } from "vite";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { createCoverageMap } = coverageLib;
const productPath = /\/(?:src|packages|plugins)\//;

function sourceFilename(url: string) {
	const pathname = decodeURIComponent(new URL(url).pathname);
	return pathname.startsWith("/@fs/") ? pathname.slice(4) : path.join(process.cwd(), pathname);
}

export async function startBrowserCoverage(page: Page, browserName: string) {
	if (process.env.VULTURE_COVERAGE !== "1" || browserName !== "chromium") return false;
	await page.coverage.startJSCoverage({ resetOnNavigation: false });
	return true;
}

export async function stopBrowserCoverage(page: Page, started: boolean) {
	if (!started || page.isClosed()) return {};
	const entries = await page.coverage.stopJSCoverage();
	const coverageMap = createCoverageMap();
	for (const entry of entries) {
		if (
			!entry.source ||
			entry.url.includes("/node_modules/") ||
			entry.url.includes("?import") ||
			!productPath.test(entry.url)
		)
			continue;
		const match = entry.source.match(
			/\/\/# sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,([^\s]+)/,
		);
		if (!match) continue;
		const sourceMap = JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
		const converted = await convert({
			code: entry.source,
			ast: parseAstAsync(entry.source),
			sourceMap,
			coverage: { url: pathToFileURL(sourceFilename(entry.url)).href, functions: entry.functions },
		});
		coverageMap.merge(converted);
	}
	return coverageMap.toJSON();
}
