import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Skill {
	name: string;
	description: string;
	/** Full content of the SKILL.md (frontmatter + body) */
	content: string;
	/** "global" (~/.agents/) or "local" (./.agents/) — local wins on conflict */
	source: "global" | "local";
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
			const { meta } = parseFrontmatter(content);
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
