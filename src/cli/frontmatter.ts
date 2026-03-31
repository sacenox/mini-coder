// ─── Frontmatter parser ───────────────────────────────────────────────────────

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

type FrontmatterValue = string | Record<string, string>;
type BlockScalarStyle = ">" | "|";

function trimQuotedValue(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

function lineIndent(line: string): number {
  return line.length - line.trimStart().length;
}

function parseBlockScalarStyle(value: string): BlockScalarStyle | null {
  if (/^>[+-]?$/.test(value)) return ">";
  if (/^\|[+-]?$/.test(value)) return "|";
  return null;
}

function collectBlockScalarLines(
  lines: string[],
  startIndex: number,
  parentIndent: number,
): { lines: string[]; nextIndex: number } {
  const blockLines: string[] = [];
  let minIndent = Number.POSITIVE_INFINITY;
  let index = startIndex;

  for (; index < lines.length; index++) {
    const line = lines[index]?.replace(/\r$/, "") ?? "";
    if (line.trim() === "") {
      blockLines.push("");
      continue;
    }

    const indent = lineIndent(line);
    if (indent <= parentIndent) break;
    if (indent < minIndent) minIndent = indent;
    blockLines.push(line);
  }

  if (!Number.isFinite(minIndent)) {
    return { lines: blockLines, nextIndex: index };
  }

  return {
    lines: blockLines.map((line) =>
      line === "" ? "" : line.slice(Math.min(minIndent, line.length)),
    ),
    nextIndex: index,
  };
}

function foldBlockScalarLines(lines: string[]): string {
  let result = "";
  let pendingNewlines = 0;

  for (const line of lines) {
    if (line === "") {
      pendingNewlines++;
      continue;
    }

    if (result !== "") {
      if (pendingNewlines > 0) result += "\n".repeat(pendingNewlines);
      else result += " ";
    }

    result += line;
    pendingNewlines = 0;
  }

  return result;
}

function blockScalarValue(style: BlockScalarStyle, lines: string[]): string {
  return style === ">" ? foldBlockScalarLines(lines) : lines.join("\n");
}

/**
 * Parse simple YAML-like frontmatter from a text string.
 * Supports one level of nesting and block scalar strings (`>` / `|`).
 * Returns key-value pairs and the body after the closing `---`.
 */
export function parseFrontmatter(raw: string): {
  meta: Record<string, FrontmatterValue>;
  body: string;
} {
  const m = raw.match(FM_RE);
  if (!m) return { meta: {}, body: raw };

  const meta: Record<string, FrontmatterValue> = {};
  const lines = (m[1] ?? "").split("\n");
  let parentKey = "";

  for (let index = 0; index < lines.length; index++) {
    const stripped = (lines[index] ?? "").replace(/\r$/, "");
    const indent = lineIndent(stripped);

    if (indent > 0 && parentKey) {
      const colon = stripped.indexOf(":");
      if (colon === -1) continue;
      const key = stripped.slice(0, colon).trim();
      const rawValue = stripped.slice(colon + 1).trim();
      if (!key) continue;

      const style = parseBlockScalarStyle(rawValue);
      const parent = meta[parentKey];
      if (typeof parent !== "object") continue;

      if (style) {
        const block = collectBlockScalarLines(lines, index + 1, indent);
        parent[key] = blockScalarValue(style, block.lines);
        index = block.nextIndex - 1;
        continue;
      }

      parent[key] = trimQuotedValue(rawValue);
      continue;
    }

    const colon = stripped.indexOf(":");
    if (colon === -1) continue;
    const key = stripped.slice(0, colon).trim();
    const rawValue = stripped.slice(colon + 1).trim();
    if (!key) continue;

    const style = parseBlockScalarStyle(rawValue);
    if (style) {
      const block = collectBlockScalarLines(lines, index + 1, indent);
      parentKey = "";
      meta[key] = blockScalarValue(style, block.lines);
      index = block.nextIndex - 1;
      continue;
    }

    if (rawValue === "") {
      parentKey = key;
      meta[key] = {};
    } else {
      parentKey = "";
      meta[key] = trimQuotedValue(rawValue);
    }
  }

  return { meta, body: (m[2] ?? "").trim() };
}
