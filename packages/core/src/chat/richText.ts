interface RichTextMark {
	type?: string;
	attrs?: { href?: string };
}

interface RichTextNode {
	type?: string;
	text?: string;
	attrs?: { level?: number; start?: number };
	marks?: RichTextMark[];
	content?: RichTextNode[];
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function renderMark(mark: RichTextMark, content: string): string {
	switch (mark.type) {
		case "bold":
			return `<strong>${content}</strong>`;
		case "italic":
			return `<em>${content}</em>`;
		case "underline":
			return `<u>${content}</u>`;
		case "strike":
			return `<s>${content}</s>`;
		case "code":
			return `<code>${content}</code>`;
		case "link": {
			const href = mark.attrs?.href?.trim() ?? "";
			if (!/^(https?:|mailto:)/i.test(href)) return content;
			return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${content}</a>`;
		}
		default:
			return content;
	}
}

function renderNode(node: RichTextNode): string {
	if (node.type === "text") {
		return (node.marks ?? []).reduceRight(
			(content, mark) => renderMark(mark, content),
			escapeHtml(node.text ?? ""),
		);
	}

	const content = (node.content ?? []).map(renderNode).join("");
	switch (node.type) {
		case "doc":
			return content;
		case "paragraph":
			return `<p>${content || "<br>"}</p>`;
		case "heading": {
			const level = Math.min(3, Math.max(1, node.attrs?.level ?? 1));
			return `<h${level}>${content}</h${level}>`;
		}
		case "bulletList":
			return `<ul>${content}</ul>`;
		case "orderedList": {
			const start = node.attrs?.start;
			const startAttribute =
				typeof start === "number" && Number.isInteger(start) && start > 1
					? ` start="${start}"`
					: "";
			return `<ol${startAttribute}>${content}</ol>`;
		}
		case "listItem":
			return `<li>${content}</li>`;
		case "blockquote":
			return `<blockquote>${content}</blockquote>`;
		case "codeBlock":
			return `<pre><code>${content}</code></pre>`;
		case "hardBreak":
			return "<br>";
		case "horizontalRule":
			return "<hr>";
		default:
			return content;
	}
}

/** Render the supported ProseMirror document subset using escaped text and safe tags. */
export function renderChatRichText(serialized: string): string {
	try {
		const document = JSON.parse(serialized) as RichTextNode;
		if (document.type !== "doc") return `<p>${escapeHtml(serialized)}</p>`;
		return renderNode(document);
	} catch {
		return `<p>${escapeHtml(serialized).replaceAll("\n", "<br>")}</p>`;
	}
}
