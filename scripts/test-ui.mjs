import { spawn } from "node:child_process";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import coverageLib from "istanbul-lib-coverage";

const { createCoverageMap } = coverageLib;
import libReport from "istanbul-lib-report";
import reports from "istanbul-reports";
import { uiCoverageThresholds } from "./ui-coverage-config.mjs";

const root = process.cwd();
const integrationDirectory = path.join(root, ".integration-coverage");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

async function run(args, env = {}) {
	const code = await new Promise((resolve, reject) => {
		const child = spawn(npm, args, {
			cwd: root,
			env: { ...process.env, ...env },
			stdio: "inherit",
		});
		child.on("error", reject);
		child.on("exit", resolve);
	});
	if (code !== 0) throw new Error(`${args.join(" ")} failed with exit code ${code}`);
}

await rm(integrationDirectory, { recursive: true, force: true });
await run(["run", "test:integration", "--", ...process.argv.slice(2)], {
	VULTURE_COVERAGE: "1",
	VULTURE_COVERAGE_DIR: integrationDirectory,
	VULTURE_UI_PORT: "1421",
});
await run(["run", "test:unit:raw"]);

const coverageMap = createCoverageMap();
const unitCoverage = JSON.parse(
	await readFile(path.join(root, "coverage", "unit", "coverage-final.json"), "utf8"),
);
coverageMap.merge(unitCoverage);
for (const filename of await readdir(integrationDirectory)) {
	if (!filename.endsWith(".json")) continue;
	const entries = JSON.parse(await readFile(path.join(integrationDirectory, filename), "utf8"));
	coverageMap.merge(entries);
}

const context = libReport.createContext({ dir: path.join(root, "coverage"), coverageMap });
for (const reporter of ["text", "html", "json"]) reports.create(reporter).execute(context);
const summary = coverageMap.getCoverageSummary().toJSON();
const failures = Object.entries(uiCoverageThresholds).filter(
	([metric, threshold]) => summary[metric].pct < threshold,
);
if (failures.length && process.env.VULTURE_SKIP_UI_COVERAGE_GATE !== "1") {
	for (const [metric, threshold] of failures) {
		console.error(
			`Coverage for ${metric} (${summary[metric].pct}%) does not meet global threshold (${threshold}%)`,
		);
	}
	process.exitCode = 1;
}
