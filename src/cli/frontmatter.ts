// ─── Frontmatter parser ───────────────────────────────────────────────────────

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

type FrontmatterValue = string | Record<string, string>;

/**
 * Parse simple YAML-like frontmatter from a text string.
 * Supports one level of nesting (e.g. `metadata:` with indented sub-keys).
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

  for (const line of lines) {
    const stripped = line.replace(/\r$/, "");
    const indent = stripped.length - stripped.trimStart().length;

    if (indent > 0 && parentKey) {
      const colon = stripped.indexOf(":");
      if (colon === -1) continue;
      const key = stripped.slice(0, colon).trim();
      const val = stripped
        .slice(colon + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (!key) continue;
      const parent = meta[parentKey];
      if (typeof parent === "object") parent[key] = val;
      else meta[parentKey] = { [key]: val };
      continue;
    }

    const colon = stripped.indexOf(":");
    if (colon === -1) continue;
    const key = stripped.slice(0, colon).trim();
    const val = stripped
      .slice(colon + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!key) continue;

    if (val === "") {
      parentKey = key;
      meta[key] = {};
    } else {
      parentKey = "";
      meta[key] = val;
    }
  }

  return { meta, body: (m[2] ?? "").trim() };
}
