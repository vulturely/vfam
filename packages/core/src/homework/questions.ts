import YAML from "yaml";

export const DEFAULT_PARSER_YAML = `version: 1
rules:
  - type: pattern
    # Start a question at each numbered line: 1. or 1)
    split: '(?m)^\\s*\\d+[.)]\\s+'
    question: '(?s)^(.+?)(?:\\n(?:Answer|Explanation):|$)'
    answer: '(?m)^Answer:\\s*(.+)$'
    explanation: '(?m)^Explanation:\\s*(.+)$'

# Optional filters for a pattern rule:
#   page: 1
#   bounds: [0, 0, 500, 1000]
# Regions use [x, y, width, height] on a 0–1000 page grid.
# For boxes/columns, replace the rule above with a region rule:
# - type: region
#   question: {page: 1, bounds: [0, 0, 500, 250]}
#   answer: {page: 1, bounds: [500, 0, 500, 250]}
`;
export function parserJson(yaml: string): string {
	if (new TextEncoder().encode(yaml).length > 50000)
		throw new Error("Keep the YAML below 50,000 bytes.");
	const doc = YAML.parseDocument(yaml);
	if (doc.errors.length || doc.warnings.length)
		throw new Error(doc.errors[0]?.message ?? doc.warnings[0].message);
	const value: unknown = doc.toJS({ maxAliasCount: 0 });
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Object.keys(value).some((k) => !["version", "rules"].includes(k)) ||
		(value as { version?: unknown }).version !== 1 ||
		!Array.isArray((value as { rules?: unknown }).rules) ||
		!(value as { rules: unknown[] }).rules.length
	)
		throw new Error(
			"YAML must define version: 1 and a rules list. Write extraction rules, not question/answer data.",
		);
	return JSON.stringify(value);
}
export function parserYaml(json: string): string {
	const yaml = YAML.stringify(JSON.parse(json));
	parserJson(yaml);
	return yaml;
}
