// ─── Frontmatter parser ───────────────────────────────────────────────────────

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Parse simple YAML-like frontmatter from a text string.
 * Returns key-value pairs (string values only) and the body after the closing `---`.
 */
export function parseFrontmatter(raw: string): {
  meta: Record<string, string>;
  body: string;
} {
  const m = raw.match(FM_RE);
  if (!m) return { meta: {}, body: raw };

  const meta: Record<string, string> = {};
  const yamlBlock = m[1] ?? "";
  for (const line of yamlBlock.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const val = line
      .slice(colon + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (key) meta[key] = val;
  }

  return { meta, body: (m[2] ?? "").trim() };
}
