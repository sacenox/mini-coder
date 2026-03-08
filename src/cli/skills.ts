// ─── Types ────────────────────────────────────────────────────────────────────

import { loadMarkdownConfigs } from "./load-markdown-configs.ts";

interface Skill {
	name: string;
	description: string;
	/** Full content of the SKILL.md (frontmatter + body) */
	content: string;
	/** "global" (~/.agents/) or "local" (./.agents/) — local wins on conflict */
	source: "global" | "local";
}

// ─── Load all skills (global + local, local wins) ────────────────────────────

export function loadSkills(cwd: string): Map<string, Skill> {
	return loadMarkdownConfigs<Skill>({
		type: "skills",
		strategy: "nested",
		nestedFileName: "SKILL.md",
		cwd,
		includeClaudeDirs: true,
		mapConfig: ({ name, meta, raw, source }) => ({
			name,
			description: meta.description ?? name,
			content: raw,
			source,
		}),
	});
}
