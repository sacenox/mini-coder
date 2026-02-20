import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "./markdown.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip all ANSI escape sequences, leaving only the visible text. */
function strip(s: string): string {
	// Use a dynamic RegExp so the ESC literal doesn't trigger the lint rule
	// for control characters in regex literals.
	const esc = String.fromCharCode(0x1b);
	return s.replace(new RegExp(`${esc}\\[[0-9;]*m`, "g"), "");
}

/** Return true if the string contains the given ANSI SGR sequence (e.g. "[1m"). */
function hasAnsi(s: string, code: string): boolean {
	return s.includes(`${String.fromCharCode(0x1b)}${code}`);
}

/** Return true if the string contains ANSI bold codes. */
function hasBold(s: string): boolean {
	return hasAnsi(s, "[1m");
}

/** Return true if the string contains ANSI dim codes. */
function hasDim(s: string): boolean {
	return hasAnsi(s, "[2m");
}

/** Return true if the string contains ANSI cyan codes. */
function hasCyan(s: string): boolean {
	return hasAnsi(s, "[36m");
}

/** Return true if the string contains ANSI yellow codes. */
function hasYellow(s: string): boolean {
	return hasAnsi(s, "[33m");
}

// ---------------------------------------------------------------------------
// renderMarkdown — block elements
// ---------------------------------------------------------------------------

describe("renderMarkdown – headings", () => {
	test("h1 renders the heading text without the # prefix", () => {
		const out = renderMarkdown("# Hello World");
		expect(strip(out)).toBe("Hello World");
	});

	test("h1 is bold and cyan", () => {
		const out = renderMarkdown("# Hello");
		expect(hasBold(out)).toBe(true);
		expect(hasCyan(out)).toBe(true);
	});

	test("h2 renders the heading text without the ## prefix", () => {
		const out = renderMarkdown("## Section");
		expect(strip(out)).toBe("Section");
	});

	test("h2 is bold and cyan", () => {
		const out = renderMarkdown("## Section");
		expect(hasBold(out)).toBe(true);
		expect(hasCyan(out)).toBe(true);
	});

	test("h3 renders the heading text without the ### prefix", () => {
		const out = renderMarkdown("### Sub");
		expect(strip(out)).toBe("Sub");
	});

	test("h3 is bold but NOT cyan (only bold)", () => {
		const out = renderMarkdown("### Sub");
		expect(hasBold(out)).toBe(true);
		expect(hasCyan(out)).toBe(false);
	});

	test("h4+ is treated the same as h3 (#{3,} pattern)", () => {
		const h4 = strip(renderMarkdown("#### Deep"));
		const h3 = strip(renderMarkdown("### Deep"));
		expect(h4).toBe(h3);
	});

	test("multiple headings each rendered on own line", () => {
		const out = strip(renderMarkdown("# H1\n## H2\n### H3"));
		expect(out).toBe("H1\nH2\nH3");
	});
});

describe("renderMarkdown – horizontal rules", () => {
	test("--- renders as a dim rule", () => {
		const out = renderMarkdown("---");
		expect(hasDim(out)).toBe(true);
		expect(strip(out)).toMatch(/^─+$/);
	});

	test("=== renders as a dim rule", () => {
		const out = renderMarkdown("===");
		expect(hasDim(out)).toBe(true);
		expect(strip(out)).toMatch(/^─+$/);
	});

	test("*** renders as a dim rule", () => {
		const out = renderMarkdown("***");
		expect(hasDim(out)).toBe(true);
		expect(strip(out)).toMatch(/^─+$/);
	});

	test("---- (4 dashes) is also a horizontal rule", () => {
		const out = strip(renderMarkdown("----"));
		expect(out).toMatch(/^─+$/);
	});

	test("-- (2 dashes) is NOT a horizontal rule — passed through as plain text", () => {
		const out = strip(renderMarkdown("--"));
		expect(out).toBe("--");
	});
});

describe("renderMarkdown – fenced code blocks", () => {
	test("lines inside ``` fence are yellow", () => {
		const out = renderMarkdown("```\ncode line\n```");
		const lines = out.split("\n");
		// line index 1 is "code line"
		expect(hasYellow(lines[1] ?? "")).toBe(true);
	});

	test("fence delimiter lines are dim", () => {
		const out = renderMarkdown("```\ncode\n```");
		const lines = out.split("\n");
		expect(hasDim(lines[0] ?? "")).toBe(true);
		expect(hasDim(lines[2] ?? "")).toBe(true);
	});

	test("language hint on opening fence is preserved in stripped output", () => {
		const out = strip(renderMarkdown("```ts\nconst x = 1;\n```"));
		expect(out).toBe("```ts\nconst x = 1;\n```");
	});

	test("inline markdown inside fenced block is NOT processed", () => {
		const out = strip(renderMarkdown("```\n**not bold**\n```"));
		expect(out).toContain("**not bold**");
	});

	test("~~~ also opens and closes a fenced block", () => {
		const out = renderMarkdown("~~~\ncode\n~~~");
		const lines = out.split("\n");
		expect(hasYellow(lines[1] ?? "")).toBe(true);
	});

	test("two consecutive fenced blocks are both fenced correctly", () => {
		const input = "```\nfirst\n```\n```\nsecond\n```";
		const out = renderMarkdown(input);
		const lines = out.split("\n");
		// line 1 = "first" (inside first fence), line 4 = "second" (inside second fence)
		expect(hasYellow(lines[1] ?? "")).toBe(true);
		expect(hasYellow(lines[4] ?? "")).toBe(true);
		// line 3 = "```" (opening second fence), should be dim not yellow
		expect(hasDim(lines[3] ?? "")).toBe(true);
		expect(hasYellow(lines[3] ?? "")).toBe(false);
	});

	test("unclosed fence: lines after opening ``` are treated as code", () => {
		const out = renderMarkdown("```\ncode\nnormal line");
		const lines = out.split("\n");
		expect(hasYellow(lines[1] ?? "")).toBe(true);
		expect(hasYellow(lines[2] ?? "")).toBe(true);
	});
});

describe("renderMarkdown – blockquotes", () => {
	test("> line renders with │ prefix and dim styling", () => {
		const out = renderMarkdown("> quoted");
		expect(strip(out)).toBe("│ quoted");
		expect(hasDim(out)).toBe(true);
	});

	test("> with no space also matches", () => {
		const out = strip(renderMarkdown(">no space"));
		expect(out).toBe("│ no space");
	});
});

describe("renderMarkdown – unordered lists", () => {
	test("- item renders with · bullet", () => {
		const out = strip(renderMarkdown("- item"));
		expect(out).toBe("· item");
	});

	test("* item renders with · bullet", () => {
		const out = strip(renderMarkdown("* item"));
		expect(out).toBe("· item");
	});

	test("+ item renders with · bullet", () => {
		const out = strip(renderMarkdown("+ item"));
		expect(out).toBe("· item");
	});

	test("indented - item preserves leading whitespace", () => {
		const out = strip(renderMarkdown("  - nested"));
		expect(out).toBe("  · nested");
	});

	test("list item content goes through inline processing", () => {
		const out = strip(renderMarkdown("- **bold** item"));
		// bold markers stripped in plain text, content preserved
		expect(out).toBe("· bold item");
	});
});

describe("renderMarkdown – ordered lists", () => {
	test("1. item renders number with dim styling", () => {
		const out = strip(renderMarkdown("1. first"));
		expect(out).toBe("1. first");
	});

	test("multi-item ordered list", () => {
		const out = strip(renderMarkdown("1. alpha\n2. beta\n3. gamma"));
		expect(out).toBe("1. alpha\n2. beta\n3. gamma");
	});

	test("ordered list item content goes through inline processing", () => {
		const out = strip(renderMarkdown("1. **bold** text"));
		expect(out).toBe("1. bold text");
	});
});

describe("renderMarkdown – plain text", () => {
	test("plain text is passed through unchanged", () => {
		const out = strip(renderMarkdown("hello world"));
		expect(out).toBe("hello world");
	});

	test("empty string produces empty string", () => {
		expect(renderMarkdown("")).toBe("");
	});

	test("empty line in multi-line input is preserved", () => {
		const out = strip(renderMarkdown("line1\n\nline3"));
		expect(out).toBe("line1\n\nline3");
	});
});

// ---------------------------------------------------------------------------
// renderMarkdown — inline spans (via plain text lines)
// ---------------------------------------------------------------------------

describe("renderMarkdown – inline code", () => {
	test("`code` renders yellow and preserves backticks in stripped text", () => {
		const out = renderMarkdown("`code`");
		expect(hasYellow(out)).toBe(true);
		expect(strip(out)).toBe("`code`");
	});

	test("unclosed backtick is passed through as plain text", () => {
		const out = strip(renderMarkdown("hello `world"));
		expect(out).toBe("hello `world");
	});

	test("two separate inline code spans on one line both get highlighted", () => {
		const out = renderMarkdown("`foo` and `bar`");
		expect(strip(out)).toBe("`foo` and `bar`");
		// Two yellow regions should appear
		const yellowCount =
			out.split(`${String.fromCharCode(0x1b)}[33m`).length - 1;
		expect(yellowCount).toBe(2);
	});
});

describe("renderMarkdown – bold", () => {
	test("**bold** renders bold styling and strips markers from plain text", () => {
		const out = renderMarkdown("**bold**");
		expect(hasBold(out)).toBe(true);
		expect(strip(out)).toBe("bold");
	});

	test("bold with surrounding text", () => {
		const out = strip(renderMarkdown("before **bold** after"));
		expect(out).toBe("before bold after");
	});

	test("unclosed ** is passed through as plain text", () => {
		const out = strip(renderMarkdown("**not closed"));
		expect(out).toBe("**not closed");
	});
});

describe("renderMarkdown – italic", () => {
	test("*italic* renders dim styling", () => {
		const out = renderMarkdown("*italic*");
		expect(hasDim(out)).toBe(true);
		expect(strip(out)).toBe("italic");
	});

	test("italic with surrounding text", () => {
		const out = strip(renderMarkdown("before *italic* after"));
		expect(out).toBe("before italic after");
	});

	test("unclosed * is passed through as plain text", () => {
		const out = strip(renderMarkdown("*not closed"));
		expect(out).toBe("*not closed");
	});
});

describe("renderMarkdown – inline combinations", () => {
	test("bold and italic on same line both render correctly", () => {
		const out = strip(renderMarkdown("**bold** and *italic*"));
		expect(out).toBe("bold and italic");
	});

	test("inline code and bold on same line both render correctly", () => {
		const out = strip(renderMarkdown("`code` and **bold**"));
		expect(out).toBe("`code` and bold");
	});

	test("heading with inline bold strips # and bold markers", () => {
		const out = strip(renderMarkdown("## Section **key**"));
		expect(out).toBe("Section key");
	});

	test("italic immediately after bold (no space) renders both correctly", () => {
		const out = strip(renderMarkdown("**bold***italic*"));
		expect(out).toBe("bolditalic");
	});

	test("bold immediately after italic (no space) renders both correctly", () => {
		const out = strip(renderMarkdown("*italic***bold**"));
		expect(out).toBe("italicbold");
	});

	test("unclosed ** does not corrupt a following *italic* span", () => {
		const out = strip(renderMarkdown("**foo *bar*"));
		expect(out).toBe("**foo bar");
	});

	test("***text*** does not corrupt surrounding text — stray * passed through as plain", () => {
		// Triple-star is ambiguous; the parser should not silently eat content.
		// Current behaviour: outer * passed through as plain, inner text bolded.
		const out = strip(renderMarkdown("***text***"));
		expect(out).toContain("text");
		expect(out).not.toContain("**");
	});
});
