import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rustRoot = fileURLToPath(new URL("../src-tauri/", import.meta.url));
const errors = [];

async function collectRustFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = await Promise.all(
		entries.map((entry) => {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) return collectRustFiles(path);
			return entry.isFile() && entry.name.endsWith(".rs") ? [path] : [];
		}),
	);
	return files.flat();
}

function significantLines(source) {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.split(/\r?\n/)
		.map((line) => line.replace(/\/\/.*$/, "").trim())
		.filter(Boolean);
}

function lineCount(source) {
	if (!source) return 0;
	return source.split(/\r?\n/).length - (source.endsWith("\n") ? 1 : 0);
}

const files = [join(rustRoot, "build.rs"), ...(await collectRustFiles(join(rustRoot, "src")))];

for (const file of files) {
	const source = await readFile(file, "utf8");
	const displayPath = relative(rustRoot, file);
	const lines = lineCount(source);
	const name = basename(file);

	if (lines > 1000) errors.push(`${displayPath}: ${lines} lines; maximum is 1000`);

	if (name === "lib.rs" || name === "mod.rs") {
		for (const line of significantLines(source)) {
			if (!/^(?:pub(?:\([^)]*\))?\s+)?(?:use|mod)\b.*;$/.test(line)) {
				errors.push(`${displayPath}: only module, import, and export declarations are allowed`);
			}
		}
	}

	if (name === "main.rs") {
		const entrypoint = significantLines(source)
			.filter((line) => !line.startsWith("#!["))
			.join("")
			.replace(/\s+/g, "");
		if (!/^fnmain\(\)\{\w+(?:::\w+)*::run\(\);?\}$/.test(entrypoint)) {
			errors.push(`${displayPath}: main must only call the library run function`);
		}
	}
}

if (errors.length) {
	console.error(errors.join("\n"));
	process.exitCode = 1;
}
