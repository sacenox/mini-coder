// ─── Frontmatter parser ───────────────────────────────────────────────────────

export interface Frontmatter {
	description?: string;
	model?: string;
	name?: string;
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseFrontmatter(raw: string): {
	meta: Frontmatter;
	body: string;
} {
	const m = raw.match(FM_RE);
	if (!m) return { meta: {}, body: raw };

	const meta: Frontmatter = {};
	const yamlBlock = m[1] ?? "";
	for (const line of yamlBlock.split("\n")) {
		const colon = line.indexOf(":");
		if (colon === -1) continue;
		const key = line.slice(0, colon).trim();
		const val = line
			.slice(colon + 1)
			.trim()
			.replace(/^["']|["']$/g, "");
		if (key === "name") meta.name = val;
		if (key === "description") meta.description = val;
		if (key === "model") meta.model = val;
	}

	return { meta, body: (m[2] ?? "").trim() };
}
