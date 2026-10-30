import { describe, it, expect } from "vitest";
import { DEFAULT_PARSER_YAML, parserJson, parserYaml } from "./questions";
describe("worksheet extraction recipe YAML", () => {
	it("defines patterns rather than hard-coded questions and answers", () => {
		const recipe = JSON.parse(parserJson(DEFAULT_PARSER_YAML));
		expect(recipe.version).toBe(1);
		expect(recipe.rules[0].type).toBe("pattern");
		expect(recipe.rules[0].split).toContain("\\d+");
		expect(recipe.questions).toBeUndefined();
	});
	it("round trips AI-authored JSON rules into reviewable YAML", () => {
		const json = JSON.stringify({
			version: 1,
			rules: [
				{
					type: "region",
					question: { page: 1, bounds: [0, 0, 500, 200] },
					answer: { page: 1, bounds: [500, 0, 500, 200] },
				},
			],
		});
		expect(JSON.parse(parserJson(parserYaml(json)))).toEqual(JSON.parse(json));
	});
	it("rejects literal Q&A data, duplicate keys, aliases, tags and oversized input", () => {
		for (const yaml of [
			"questions: [{question: Test, answer: 42}]",
			"version: 1\nversion: 1\nrules: []",
			"version: 1\nrules: &items [*items]",
			"version: 1\nrules: !!js/function x",
			"version: 2\nrules: [{}]",
			"x".repeat(50001),
		])
			expect(() => parserJson(yaml)).toThrow();
	});
});
