import * as c from "yoctocolors";

// ─── Inline span renderer ─────────────────────────────────────────────────────
// Handles: `code`, **bold**, *italic* within a single line of text.

function renderInline(text: string): string {
	let out = "";
	let i = 0;

	while (i < text.length) {
		// Inline code: `...`
		if (text[i] === "`") {
			const end = text.indexOf("`", i + 1);
			if (end !== -1) {
				out += c.yellow(text.slice(i, end + 1));
				i = end + 1;
				continue;
			}
		}

		// Bold: **...**
		if (text.slice(i, i + 2) === "**") {
			const end = text.indexOf("**", i + 2);
			if (end !== -1) {
				out += c.bold(text.slice(i + 2, end));
				i = end + 2;
				continue;
			}
		}

		// Italic: *...* (not preceded by another *)
		if (text[i] === "*" && text[i - 1] !== "*" && text[i + 1] !== "*") {
			const end = text.indexOf("*", i + 1);
			if (end !== -1 && text[end - 1] !== "*") {
				out += c.dim(text.slice(i + 1, end));
				i = end + 1;
				continue;
			}
		}

		out += text[i];
		i++;
	}

	return out;
}

// ─── Block renderer ───────────────────────────────────────────────────────────

export function renderMarkdown(text: string): string {
	const lines = text.split("\n");
	const out: string[] = [];
	let inFence = false;

	for (const raw of lines) {
		// Fenced code block toggle (``` or ~~~)
		if (/^(`{3,}|~{3,})/.test(raw)) {
			inFence = !inFence;
			// Show the fence line dimmed (language hint visible but subdued)
			out.push(c.dim(raw));
			continue;
		}

		// Inside fenced block — yellow, no inline processing
		if (inFence) {
			out.push(c.yellow(raw));
			continue;
		}

		// Horizontal rule: --- or *** or ===
		if (/^(-{3,}|\*{3,}|={3,})\s*$/.test(raw)) {
			out.push(c.dim("─".repeat(40)));
			continue;
		}

		// Headings
		const h3 = raw.match(/^(#{3,})\s+(.*)/);
		if (h3) {
			out.push(c.bold(renderInline(h3[2] ?? "")));
			continue;
		}
		const h2 = raw.match(/^##\s+(.*)/);
		if (h2) {
			out.push(c.bold(c.cyan(renderInline(h2[1] ?? ""))));
			continue;
		}
		const h1 = raw.match(/^#\s+(.*)/);
		if (h1) {
			out.push(c.bold(c.cyan(renderInline(h1[1] ?? ""))));
			continue;
		}

		// Blockquote: > ...
		const bq = raw.match(/^>\s?(.*)/);
		if (bq) {
			out.push(c.dim(`│ ${renderInline(bq[1] ?? "")}`));
			continue;
		}

		// Unordered list: - or * or +
		const ul = raw.match(/^(\s*)[*\-+]\s+(.*)/);
		if (ul) {
			const indent = ul[1] ?? "";
			out.push(`${indent}${c.dim("·")} ${renderInline(ul[2] ?? "")}`);
			continue;
		}

		// Ordered list: 1. ...
		const ol = raw.match(/^(\s*)(\d+)\.\s+(.*)/);
		if (ol) {
			const indent = ol[1] ?? "";
			const num = ol[2] ?? "";
			out.push(`${indent}${c.dim(`${num}.`)} ${renderInline(ol[3] ?? "")}`);
			continue;
		}

		// Plain text (inline spans still applied)
		out.push(renderInline(raw));
	}

	return out.join("\n");
}
