import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentConfig {
	name: string;
	description: string;
	/** Override model for this agent (optional) */
	model?: string;
	/** System prompt (the markdown body after frontmatter) */
	systemPrompt: string;
	/** "global" (~/.agents/) or "local" (./.agents/) — local wins on conflict */
	source: "global" | "local";
}

// ─── Frontmatter parser ───────────────────────────────────────────────────────

interface Frontmatter {
	description?: string;
	model?: string;
}

function parseFrontmatter(raw: string): { meta: Frontmatter; body: string } {
	const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
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
		if (key === "description") meta.description = val;
		if (key === "model") meta.model = val;
	}

	return { meta, body: (m[2] ?? "").trim() };
}

// ─── Load agents from a directory ─────────────────────────────────────────────

function loadFromDir(
	dir: string,
	source: "global" | "local",
): Map<string, AgentConfig> {
	const agents = new Map<string, AgentConfig>();
	if (!existsSync(dir)) return agents;

	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return agents;
	}

	for (const entry of entries) {
		if (!entry.endsWith(".md")) continue;
		const name = basename(entry, ".md");
		const filePath = join(dir, entry);
		let raw: string;
		try {
			raw = readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}
		const { meta, body } = parseFrontmatter(raw);
		agents.set(name, {
			name,
			description: meta.description ?? name,
			...(meta.model ? { model: meta.model } : {}),
			systemPrompt: body,
			source,
		});
	}
	return agents;
}

// ─── Load all agents (global + local, local wins) ─────────────────────────────

export function loadAgents(cwd: string): Map<string, AgentConfig> {
	const globalDir = join(homedir(), ".agents", "agents");
	const localDir = join(cwd, ".agents", "agents");

	const global = loadFromDir(globalDir, "global");
	const local = loadFromDir(localDir, "local");

	// Merge: local overrides global
	return new Map([...global, ...local]);
}
