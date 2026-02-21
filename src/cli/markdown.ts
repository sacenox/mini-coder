import * as c from "yoctocolors";

// ─── Inline span renderer ─────────────────────────────────────────────────────
// Handles: `code`, **bold**, *italic* within a single line of text.

function renderInline(text: string): string {
	let out = "";
	let i = 0;
	// Track whether the previous character in the *source* was consumed as part
	// of a bold closing **. This lets the italic branch distinguish "the * right
	// after **bold**" (safe to start italic) from "the second * of an unclosed **"
	// (must not start italic).
	let prevWasBoldClose = false;

	while (i < text.length) {
		// Inline code: `...`
		if (text[i] === "`") {
			const end = text.indexOf("`", i + 1);
			if (end !== -1) {
				out += c.yellow(text.slice(i, end + 1));
				i = end + 1;
				prevWasBoldClose = false;
				continue;
			}
		}

		// Bold: **...**  (opening ** must not be followed by a third *)
		if (text.slice(i, i + 2) === "**" && text[i + 2] !== "*") {
			const end = text.indexOf("**", i + 2);
			if (end !== -1) {
				out += c.bold(text.slice(i + 2, end));
				i = end + 2;
				prevWasBoldClose = true;
				continue;
			}
		}

		// Italic: *...* — opening * must not be part of ** (next char is *).
		// We also require that the previous source character was NOT a * UNLESS
		// we just closed a bold span (in which case the adjacent * is a legitimate
		// italic opener, not the second star of a ** pair).
		if (
			text[i] === "*" &&
			text[i + 1] !== "*" &&
			(prevWasBoldClose || text[i - 1] !== "*")
		) {
			const end = text.indexOf("*", i + 1);
			if (end !== -1 && text[end - 1] !== "*") {
				out += c.dim(text.slice(i + 1, end));
				i = end + 1;
				prevWasBoldClose = false;
				continue;
			}
		}

		out += text[i];
		i++;
		prevWasBoldClose = false;
	}

	return out;
}

// ─── Block renderer ───────────────────────────────────────────────────────────

/**
 * Render a single source line given the current fence state.
 * Returns the rendered string and the updated fence state.
 * Use this for incremental streaming — call once per complete line.
 */
export function renderLine(
	raw: string,
	inFence: boolean,
): { output: string; inFence: boolean } {
	// Fenced code block toggle (``` or ~~~)
	if (/^(`{3,}|~{3,})/.test(raw)) {
		return { output: c.dim(raw), inFence: !inFence };
	}
	if (inFence) {
		return { output: c.yellow(raw), inFence: true };
	}
	// Horizontal rule: --- or *** or ===
	if (/^(-{3,}|\*{3,}|={3,})\s*$/.test(raw)) {
		return { output: c.dim("─".repeat(40)), inFence: false };
	}
	// Headings
	const h3 = raw.match(/^(#{3,})\s+(.*)/);
	if (h3) return { output: c.bold(renderInline(h3[2] ?? "")), inFence: false };
	const h2 = raw.match(/^##\s+(.*)/);
	if (h2)
		return {
			output: c.bold(c.cyan(renderInline(h2[1] ?? ""))),
			inFence: false,
		};
	const h1 = raw.match(/^#\s+(.*)/);
	if (h1)
		return {
			output: c.bold(c.cyan(renderInline(h1[1] ?? ""))),
			inFence: false,
		};
	// Blockquote: > ...
	const bq = raw.match(/^>\s?(.*)/);
	if (bq)
		return {
			output: c.dim(`│ ${renderInline(bq[1] ?? "")}`),
			inFence: false,
		};
	// Unordered list: - or * or +
	const ul = raw.match(/^(\s*)[*\-+]\s+(.*)/);
	if (ul) {
		const indent = ul[1] ?? "";
		return {
			output: `${indent}${c.dim("·")} ${renderInline(ul[2] ?? "")}`,
			inFence: false,
		};
	}
	// Ordered list: 1. ...
	const ol = raw.match(/^(\s*)(\d+)\.\s+(.*)/);
	if (ol) {
		const indent = ol[1] ?? "";
		const num = ol[2] ?? "";
		return {
			output: `${indent}${c.dim(`${num}.`)} ${renderInline(ol[3] ?? "")}`,
			inFence: false,
		};
	}
	// Plain text (inline spans still applied)
	return { output: renderInline(raw), inFence: false };
}

export function renderMarkdown(text: string): string {
	let inFence = false;
	return text
		.split("\n")
		.map((raw) => {
			const r = renderLine(raw, inFence);
			inFence = r.inFence;
			return r.output;
		})
		.join("\n");
}

/**
 * Render a multi-line chunk of markdown given an initial fence state.
 * Returns the ANSI-coloured output and the fence state after the last line.
 * Use this for chunk-based streaming where each chunk is a complete paragraph
 * or block (delimited by blank lines).
 */
export function renderChunk(
	text: string,
	inFence: boolean,
): { output: string; inFence: boolean } {
	let fence = inFence;
	const output = text
		.split("\n")
		.map((raw) => {
			const r = renderLine(raw, fence);
			fence = r.inFence;
			return r.output;
		})
		.join("\n");
	return { output, inFence: fence };
}
