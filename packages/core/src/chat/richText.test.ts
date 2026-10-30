import { describe, expect, it } from "vitest";
import { renderChatRichText } from "./richText";

function document(content: unknown[]) {
	return JSON.stringify({ type: "doc", content });
}

describe("renderChatRichText", () => {
	it("renders every supported mark and escapes text and URLs", () => {
		const marks = [
			{ type: "bold" },
			{ type: "italic" },
			{ type: "underline" },
			{ type: "strike" },
			{ type: "code" },
			{ type: "unknown" },
			{ type: "link", attrs: { href: ' https://example.com/?a="b"&c=d ' } },
		];
		const html = renderChatRichText(document([{ type: "text", text: "<'&>", marks }]));
		expect(html).toContain("<strong><em><u><s><code>");
		expect(html).toContain("https://example.com/?a=&quot;b&quot;&amp;c=d");
		expect(html).toContain("&lt;&#39;&amp;&gt;");
		expect(
			renderChatRichText(
				document([
					{
						type: "text",
						text: "plain",
						marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
					},
				]),
			),
		).toBe("plain");
		expect(
			renderChatRichText(
				document([
					{
						type: "text",
						text: "email",
						marks: [{ type: "link", attrs: { href: "mailto:a@example.com" } }],
					},
				]),
			),
		).toContain("mailto:a@example.com");
		expect(
			renderChatRichText(document([{ type: "text", text: "none", marks: [{ type: "link" }] }])),
		).toBe("none");
	});

	it("renders all block types and list options", () => {
		const text = (value: string) => ({ type: "text", text: value });
		const html = renderChatRichText(
			document([
				{ type: "paragraph", content: [] },
				{ type: "heading", attrs: { level: 0 }, content: [text("low")] },
				{ type: "heading", attrs: { level: 9 }, content: [text("high")] },
				{ type: "bulletList", content: [{ type: "listItem", content: [text("item")] }] },
				{
					type: "orderedList",
					attrs: { start: 3 },
					content: [{ type: "listItem", content: [text("third")] }],
				},
				{ type: "orderedList", attrs: { start: 1.5 }, content: [] },
				{ type: "orderedList", attrs: { start: "3" }, content: [] },
				{ type: "blockquote", content: [text("quote")] },
				{ type: "codeBlock", content: [text("code")] },
				{ type: "hardBreak" },
				{ type: "horizontalRule" },
				{ type: "unknown", content: [text("fallback")] },
			]),
		);
		for (const expected of [
			"<p><br></p>",
			"<h1>low</h1>",
			"<h3>high</h3>",
			"<ul><li>item</li></ul>",
			'<ol start="3"><li>third</li></ol>',
			"<ol></ol>",
			"<blockquote>quote</blockquote>",
			"<pre><code>code</code></pre>",
			"<br>",
			"<hr>",
			"fallback",
		]) {
			expect(html).toContain(expected);
		}
	});

	it("handles invalid JSON and non-document roots as escaped plain text", () => {
		expect(renderChatRichText("<script>\nnext")).toBe("<p>&lt;script&gt;<br>next</p>");
		expect(renderChatRichText('{"type":"paragraph"}')).toContain("&quot;type&quot;");
	});
});
