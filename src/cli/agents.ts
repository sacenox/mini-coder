// ─── Types ────────────────────────────────────────────────────────────────────

import {
	baseConfigFields,
	loadMarkdownConfigs,
} from "./load-markdown-configs.ts";

interface AgentConfig {
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

export function loadAgents(
	cwd: string,
	homeDir?: string,
): Map<string, AgentConfig> {
	return loadMarkdownConfigs<AgentConfig>({
		type: "agents",
		strategy: "flat",
		cwd,
		homeDir,
		includeClaudeDirs: true,
		mapConfig: ({ name, meta, body, source }) => ({
			...baseConfigFields(name, meta, source),
			systemPrompt: body,
		}),
	});
}
