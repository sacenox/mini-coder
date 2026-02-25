import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Skill {
	name: string;
	description: string;
	/** Full content of the SKILL.md (frontmatter + body) */
	content: string;
	/** "global" (~/.agents/) or "local" (./.agents/) — local wins on conflict */
	source: "global" | "local";
}

// ─── Frontmatter parser (name + description only) ────────────────────────────

function parseSkillMeta(raw: string): { name?: string; description?: string } {
	const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
	const m = raw.match(FM_RE);
	if (!m) return {};

	const meta: { name?: string; description?: string } = {};
	for (const line of (m[1] ?? "").split("\n")) {
		const colon = line.indexOf(":");
		if (colon === -1) continue;
		const key = line.slice(0, colon).trim();
		const val = line
			.slice(colon + 1)
			.trim()
			.replace(/^["']|["']$/g, "");
		if (key === "name") meta.name = val;
		if (key === "description") meta.description = val;
	}
	return meta;
}

// ─── Load skills from a skills root dir ──────────────────────────────────────
// Each skill lives at <dir>/<skill-name>/SKILL.md

function loadFromDir(
	dir: string,
	source: "global" | "local",
): Map<string, Skill> {
	const skills = new Map<string, Skill>();
	if (!existsSync(dir)) return skills;

	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return skills;
	}

	for (const entry of entries) {
		const skillFile = join(dir, entry, "SKILL.md");
		try {
			if (!statSync(join(dir, entry)).isDirectory()) continue;
			if (!existsSync(skillFile)) continue;
			const content = readFileSync(skillFile, "utf-8");
			const meta = parseSkillMeta(content);
			const name = meta.name ?? entry;
			skills.set(name, {
				name,
				description: meta.description ?? name,
				content,
				source,
			});
		} catch {
			// skip unreadable entries
		}
	}
	return skills;
}

// ─── Load all skills (global + local, local wins) ────────────────────────────

export function loadSkills(cwd: string): Map<string, Skill> {
	const globalDir = join(homedir(), ".agents", "skills");
	const localDir = join(cwd, ".agents", "skills");

	const global = loadFromDir(globalDir, "global");
	const local = loadFromDir(localDir, "local");

	// Merge: local overrides global
	return new Map([...global, ...local]);
}
