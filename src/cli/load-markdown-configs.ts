import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { warnConventionConflicts } from "./config-conflicts.ts";
import { type Frontmatter, parseFrontmatter } from "./frontmatter.ts";

export interface MarkdownConfigLoaderOptions<T> {
	type: "commands" | "skills" | "agents";
	/** Strategy for file discovery: 'flat' reads dir/*.md, 'nested' reads dir/<name>/SKILL.md */
	strategy: "flat" | "nested";
	/** The name of the required file if strategy is 'nested' (e.g. "SKILL.md") */
	nestedFileName?: string;
	/** Map the parsed file to the final object */
	mapConfig: (params: {
		name: string;
		raw: string;
		meta: Frontmatter;
		body: string;
		source: "global" | "local";
	}) => T;
	/** Whether to include `.claude` fallback dirs */
	includeClaudeDirs: boolean;
	cwd: string;
}

export function loadMarkdownConfigs<T>(
	opts: MarkdownConfigLoaderOptions<T>,
): Map<string, T> {
	const { type, strategy, nestedFileName, mapConfig, includeClaudeDirs, cwd } =
		opts;

	function loadFromDir(
		dir: string,
		source: "global" | "local",
	): Map<string, T> {
		const configs = new Map<string, T>();
		if (!existsSync(dir)) return configs;

		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return configs;
		}

		for (const entry of entries) {
			let name: string;
			let filePath: string;

			if (strategy === "flat") {
				if (!entry.endsWith(".md")) continue;
				name = basename(entry, ".md");
				filePath = join(dir, entry);
			} else {
				// nested
				try {
					if (!statSync(join(dir, entry)).isDirectory()) continue;
				} catch {
					continue;
				}
				name = entry;
				if (!nestedFileName) continue;
				filePath = join(dir, entry, nestedFileName);
			}

			if (!existsSync(filePath)) continue;

			let raw: string;
			try {
				raw = readFileSync(filePath, "utf-8");
			} catch {
				continue;
			}

			const { meta, body } = parseFrontmatter(raw);
			if (strategy === "nested" && meta.name) {
				name = meta.name;
			}

			configs.set(name, mapConfig({ name, raw, meta, body, source }));
		}
		return configs;
	}

	if (!includeClaudeDirs) {
		const globalAgentsDir = join(homedir(), ".agents", type);
		const localAgentsDir = join(cwd, ".agents", type);

		const globalAgents = loadFromDir(globalAgentsDir, "global");
		const localAgents = loadFromDir(localAgentsDir, "local");

		return new Map([...globalAgents, ...localAgents]);
	}

	const globalAgentsDir = join(homedir(), ".agents", type);
	const globalClaudeDir = join(homedir(), ".claude", type);
	const localAgentsDir = join(cwd, ".agents", type);
	const localClaudeDir = join(cwd, ".claude", type);

	const globalAgents = loadFromDir(globalAgentsDir, "global");
	const globalClaude = loadFromDir(globalClaudeDir, "global");
	const localAgents = loadFromDir(localAgentsDir, "local");
	const localClaude = loadFromDir(localClaudeDir, "local");

	warnConventionConflicts(
		type,
		"global",
		globalAgents.keys(),
		globalClaude.keys(),
	);
	warnConventionConflicts(
		type,
		"local",
		localAgents.keys(),
		localClaude.keys(),
	);

	// Merge precedence: local overrides global; at the same scope, .agents overrides .claude.
	return new Map([
		...globalClaude,
		...globalAgents,
		...localClaude,
		...localAgents,
	]);
}
