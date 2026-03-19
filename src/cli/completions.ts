import { join, relative } from "node:path";
import { loadAgents } from "./agents.ts";
import { loadCustomCommands } from "./custom-commands.ts";
import { loadSkillsIndex } from "./skills.ts";

// ─── Built-in commands ─────────────────────────────────────────────────────────

const BUILTIN_COMMANDS = [
	"model",
	"models",
	"undo",
	"reasoning",
	"verbose",
	"context",
	"agent",
	"mcp",
	"new",
	"help",
	"exit",
	"quit",
	"login",
	"logout",
];

// ─── Sub-command / parameter completions ───────────────────────────────────────

const COMMAND_PARAMS: Record<string, string[] | ((cwd: string) => string[])> = {
	model: ["effort"],
	reasoning: ["on", "off"],
	verbose: ["on", "off"],
	context: ["prune", "cap"],
	mcp: ["list", "add", "remove", "rm"],
	agent: (cwd) => {
		const agents = loadAgents(cwd);
		return ["off", ...agents.keys()];
	},
};

const NESTED_PARAMS: Record<string, Record<string, string[]>> = {
	model: { effort: ["low", "medium", "high", "xhigh", "off"] },
	context: {
		prune: ["off", "balanced", "aggressive"],
		cap: ["off"],
	},
};

// ─── Public API ────────────────────────────────────────────────────────────────

const MAX = 10;

/** Complete a `/`-prefixed command input. `text` includes the leading `/`. */
export function getCommandCompletions(text: string, cwd: string): string[] {
	const parts = text.slice(1).split(/\s+/);
	const p0 = (parts[0] ?? "").toLowerCase();

	// Completing the command name itself: `/mod` → `/model`
	if (parts.length === 1) {
		const results: string[] = [];

		// Built-in commands
		for (const cmd of BUILTIN_COMMANDS) {
			if (cmd.startsWith(p0)) results.push(`/${cmd}`);
			if (results.length >= MAX) break;
		}

		// Custom commands
		if (results.length < MAX) {
			const custom = loadCustomCommands(cwd);
			for (const name of custom.keys()) {
				if (name.startsWith(p0)) results.push(`/${name}`);
				if (results.length >= MAX) break;
			}
		}

		return results;
	}

	// Completing second token: `/model eff` → `/model effort`
	if (parts.length === 2) {
		const query = (parts[1] ?? "").toLowerCase();
		const paramDef = COMMAND_PARAMS[p0];
		if (!paramDef) return [];
		const options = typeof paramDef === "function" ? paramDef(cwd) : paramDef;
		return options
			.filter((o) => o.startsWith(query))
			.slice(0, MAX)
			.map((o) => `/${p0} ${o}`);
	}

	// Completing third token: `/model effort lo` → `/model effort low`
	if (parts.length === 3) {
		const sub = (parts[1] ?? "").toLowerCase();
		const query = (parts[2] ?? "").toLowerCase();
		const nested = NESTED_PARAMS[p0]?.[sub];
		if (!nested) return [];
		return nested
			.filter((o) => o.startsWith(query))
			.slice(0, MAX)
			.map((o) => `/${p0} ${sub} ${o}`);
	}

	return [];
}

/** Complete an `@`-prefixed reference (skills, files). */

export async function getAtCompletions(
	prefix: string,
	cwd: string,
): Promise<string[]> {
	const query = prefix.startsWith("@") ? prefix.slice(1) : prefix;
	const results: string[] = [];

	// Skills: @<skill-name>
	const skills = loadSkillsIndex(cwd);
	for (const [name] of skills) {
		if (results.length >= MAX) break;
		if (name.includes(query)) results.push(`@${name}`);
	}

	// Files: @<relative-path> — fill remaining slots up to MAX

	if (results.length < MAX) {
		const glob = new Bun.Glob(`**/*${query}*`);
		for await (const file of glob.scan({ cwd, onlyFiles: true })) {
			if (file.includes("node_modules") || file.includes(".git")) continue;
			results.push(`@${relative(cwd, join(cwd, file))}`);
			if (results.length >= MAX) break;
		}
	}

	return results;
}

/** Complete a bare file path (no `@` prefix). */
export async function getFilePathCompletions(
	query: string,
	cwd: string,
): Promise<string[]> {
	if (!query) return [];
	const results: string[] = [];
	const glob = new Bun.Glob(`${query}*`);
	for await (const file of glob.scan({ cwd })) {
		if (file.includes("node_modules") || file.includes(".git")) continue;
		results.push(file);
		if (results.length >= MAX) break;
	}
	return results;
}
