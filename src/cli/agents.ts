import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { parseFrontmatter } from "./frontmatter.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

import { loadMarkdownConfigs } from "./load-markdown-configs.ts";

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

// ─── Load all agents (global + local, local wins) ─────────────────────────────

export function loadAgents(cwd: string): Map<string, AgentConfig> {
	return loadMarkdownConfigs<AgentConfig>({
		type: "agents",
		strategy: "flat",
		cwd,
		includeClaudeDirs: false,
		mapConfig: ({ name, meta, body, source }) => ({
			name,
			description: meta.description ?? name,
			...(meta.model ? { model: meta.model } : {}),
			systemPrompt: body,
			source,
		}),
	});
}
