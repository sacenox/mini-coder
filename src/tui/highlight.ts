import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import Parser from "tree-sitter";
import JavaScript from "tree-sitter-javascript";
import TypeScript from "tree-sitter-typescript";
import Markdown from "@tree-sitter-grammars/tree-sitter-markdown";
import { HEADINGS, INLINE_CODE, NORMAL_BG, NORMAL_FG, STYLES, channels, sgrPlain, type Style } from "./theme.ts";

/**
 * Syntax highlighting for committed scrollback, once, over the whole block.
 * Grammar queries ship with the grammar packages and are consumed as data, so
 * a capture name is the only thing that reaches the palette. The colours come
 * from the TokyoNight `night` palette in `theme.ts`, mapped the way
 * `folke/tokyonight.nvim` maps capture names to highlight groups. Truecolor only.
 */

function styleFor(capture: string): Style | undefined {
  for (let name = capture; ; name = name.slice(0, name.lastIndexOf("."))) {
    const style = STYLES[name];
    if (style !== undefined) return style;
    if (!name.includes(".")) return undefined;
  }
}

const require = createRequire(import.meta.url);

/** A grammar package keeps its queries next to its sources. */
function querySource(pkg: string, ...path: string[]): string {
  return readFileSync(join(dirname(require.resolve(`${pkg}/package.json`)), ...path), "utf8");
}

interface Syntax {
  parser: Parser;
  query: Parser.Query;
}

function syntax(language: Parser.Language, ...sources: string[]): Syntax {
  const parser = new Parser();
  parser.setLanguage(language);
  return { parser, query: new Parser.Query(language, sources.join("\n")) };
}

const JS_QUERIES = querySource("tree-sitter-javascript", "queries", "highlights.scm");
const TS_QUERIES = querySource("tree-sitter-typescript", "queries", "highlights.scm");

const JAVASCRIPT = syntax(JavaScript, JS_QUERIES);
/** TypeScript's own query only covers what it adds to JavaScript. */
const TYPESCRIPT = syntax(TypeScript.typescript, JS_QUERIES, TS_QUERIES);
const TSX = syntax(TypeScript.tsx, JS_QUERIES, TS_QUERIES);

/** Fence info string to grammar, for the languages we carry. */
const CODE: Record<string, Syntax | undefined> = {
  js: JAVASCRIPT,
  javascript: JAVASCRIPT,
  jsx: JAVASCRIPT,
  ts: TYPESCRIPT,
  typescript: TYPESCRIPT,
  tsx: TSX,
};

const MARKDOWN = syntax(
  Markdown,
  querySource("@tree-sitter-grammars/tree-sitter-markdown", "tree-sitter-markdown", "queries", "highlights.scm"),
);
const MARKDOWN_INLINE = syntax(
  Markdown.inline,
  querySource(
    "@tree-sitter-grammars/tree-sitter-markdown",
    "tree-sitter-markdown-inline",
    "queries",
    "highlights.scm",
  ),
);

/** One styled range of a line, in byte offsets into that line. */
interface Span {
  start: number;
  end: number;
  style: Style;
}

function spansOf(syntax: Syntax, node: Parser.SyntaxNode, offset = 0): Span[] {
  const spans: Span[] = [];
  for (const capture of syntax.query.captures(node)) {
    const style = styleFor(capture.name);
    if (style === undefined) continue;
    spans.push({ start: offset + capture.node.startIndex, end: offset + capture.node.endIndex, style });
  }
  return spans;
}

function parse(syntax: Syntax, text: string): Parser.SyntaxNode {
  return syntax.parser.parse(text).rootNode;
}

/**
 * A style's own attributes, with the defaults spelled out: a span that names no
 * color must not inherit the color of the span or token before it, and the
 * fallback is the palette's `Normal`, never the terminal's own pair.
 */
function sgr(style: Style): string {
  let out = "\x1b[";
  if (style.bold) out += "1;";
  if (style.italic) out += "3;";
  if (style.underline) out += "4;";
  out += `38;2;${channels(style.fg ?? NORMAL_FG)};48;2;${channels(style.bg ?? NORMAL_BG)}m`;
  return out;
}

/**
 * Wraps every span in its color. Spans nest, so the innermost one wins; text
 * outside any span falls back to `Normal`. The trailing close restores the same
 * pair, so a span may cross a line break and the last line still ends plain —
 * and no cell is ever left to the terminal. Because each row is painted on its
 * own, a span that outlives a line break re-asserts itself on the next line.
 */
function paint(text: string, spans: Span[]): string {
  const events: { at: number; open: boolean; span: Span }[] = [];
  for (const span of spans) {
    if (span.end <= span.start) continue;
    events.push({ at: span.start, open: true, span }, { at: span.end, open: false, span });
  }
  events.sort((a, b) => a.at - b.at || Number(a.open) - Number(b.open));

  const active: Span[] = [];
  let out = "";
  let plain = true;
  let at = 0;
  const emit = (end: number): void => {
    if (end <= at) return;
    const style = active.length === 0 ? undefined : active[active.length - 1].style;
    if (style === undefined) {
      if (!plain) out += sgrPlain();
      plain = true;
    } else {
      out += sgr(style);
      plain = false;
    }
    const chunk = text.slice(at, end);
    out += style === undefined ? chunk : chunk.replace(/\n/g, `\n${sgr(style)}`);
    at = end;
  };
  for (const event of events) {
    emit(event.at);
    if (event.open) active.push(event.span);
    else active.splice(active.indexOf(event.span), 1);
  }
  emit(text.length);
  return plain ? out : `${out}${sgrPlain()}`;
}

/**
 * Colors one committed block of Markdown. Inline markup is a separate grammar,
 * run over the ranges the block grammar hands over, as its injections do.
 */
export function highlightMarkdown(text: string): string {
  const root = parse(MARKDOWN, text);
  let spans = spansOf(MARKDOWN, root);
  // Two things the grammar's queries predate: a whole heading is colored by its
  // level, and inline code carries a background. Both replace what covers them.
  for (const inline of root.descendantsOfType("inline")) {
    const inlineRoot = parse(MARKDOWN_INLINE, inline.text);
    spans.push(...spansOf(MARKDOWN_INLINE, inlineRoot, inline.startIndex));
    for (const code of inlineRoot.descendantsOfType("code_span")) {
      spans = recolor(spans, code, INLINE_CODE, inline.startIndex);
    }
  }
  for (const heading of root.descendantsOfType(["atx_heading", "setext_heading"])) {
    const marker = heading.namedChildren.find((child) => /^(atx|setext)_h/.test(child.type))?.type;
    const level = marker === undefined ? 1 : Number(marker.replace(/\D/g, ""));
    spans = recolor(spans, heading, HEADINGS[Math.min(level, HEADINGS.length) - 1]);
  }
  return paint(text, spans);
}

/** Replaces every span inside `node` with one span covering the whole node. */
function recolor(spans: Span[], node: Parser.SyntaxNode, style: Style, offset = 0): Span[] {
  const start = offset + node.startIndex;
  const end = offset + node.endIndex;
  const kept = spans.filter((span) => span.start < start || span.end > end);
  return [...kept, { start, end, style }];
}

/** Colors a fenced code block's body, by its fence info string. */
export function highlightCode(info: string, text: string): string {
  const grammar = CODE[info.trim().toLowerCase()];
  return grammar === undefined ? text : paint(text, spansOf(grammar, parse(grammar, text)));
}
