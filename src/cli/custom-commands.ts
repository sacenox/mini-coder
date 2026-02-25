import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { warnConventionConflicts } from "./config-conflicts.ts";
import { parseFrontmatter } from "./frontmatter.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CustomCommand {
	name: string;
	description: string;
	/** Override model for this command (optional) */
	model?: string;
	/** Raw template string (after frontmatter is stripped) */
	template: string;
	/** "global" (~/.agents/) or "local" (./.agents/) — local wins on conflict */
	source: "global" | "local";
}

// ─── Load commands from a directory ──────────────────────────────────────────

function loadFromDir(
	dir: string,
	source: "global" | "local",
): Map<string, CustomCommand> {
	const commands = new Map<string, CustomCommand>();
	if (!existsSync(dir)) return commands;

	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return commands;
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
		commands.set(name, {
			name,
			description: meta.description ?? name,
			...(meta.model ? { model: meta.model } : {}),
			template: body,
			source,
		});
	}
	return commands;
}

// ─── Load all custom commands (global + local, local wins) ───────────────────

export function loadCustomCommands(cwd: string): Map<string, CustomCommand> {
	const globalAgentsDir = join(homedir(), ".agents", "commands");
	const globalClaudeDir = join(homedir(), ".claude", "commands");
	const localAgentsDir = join(cwd, ".agents", "commands");
	const localClaudeDir = join(cwd, ".claude", "commands");

	const globalAgents = loadFromDir(globalAgentsDir, "global");
	const globalClaude = loadFromDir(globalClaudeDir, "global");
	const localAgents = loadFromDir(localAgentsDir, "local");
	const localClaude = loadFromDir(localClaudeDir, "local");

	warnConventionConflicts(
		"commands",
		"global",
		globalAgents.keys(),
		globalClaude.keys(),
	);
	warnConventionConflicts(
		"commands",
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

// ─── Template expansion ───────────────────────────────────────────────────────

/**
 * Expands a command template:
 * - `$ARGUMENTS` → full args string
 * - `$1`, `$2`, … → positional tokens
 * - `!`cmd`` → stdout of running cmd in a shell
 */
export async function expandTemplate(
	template: string,
	args: string,
	cwd: string,
): Promise<string> {
	const tokens =
		args
			.match(/("([^"]*)")|('([^']*)')|(\S+)/g)

			?.map((t) => t.replace(/^["']|["']$/g, "")) ?? [];

	// Replace positional $1 … $9
	let result = template;
	for (let i = 9; i >= 1; i--) {
		result = result.replaceAll(`$${i}`, tokens[i - 1] ?? "");
	}
	// Replace $ARGUMENTS
	result = result.replaceAll("$ARGUMENTS", args);

	// Replace !`cmd` shell interpolations (10s timeout per command)
	const SHELL_RE = /!`([^`]+)`/g;
	const shellMatches = [...result.matchAll(SHELL_RE)];
	for (const match of shellMatches) {
		const cmd = match[1] ?? "";
		let output = "";
		try {
			const signal = AbortSignal.timeout(10_000);
			const proc = Bun.spawn(["bash", "-c", cmd], {
				cwd,
				stdout: "pipe",
				stderr: "pipe",
			});
			// Race the process exit against the timeout signal.
			await Promise.race([
				proc.exited,
				new Promise<void>((_, reject) =>
					signal.addEventListener("abort", () => {
						proc.kill();
						reject(new Error("timeout"));
					}),
				),
			]);
			const [stdout, stderr] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
			]);
			const exitCode = proc.exitCode ?? 0;
			// Only include stderr when the command succeeded — on failure it's
			// likely an error message that would confuse the LLM prompt.
			output =
				exitCode === 0
					? [stdout, stderr].filter(Boolean).join("\n").trim()
					: stdout.trim();
		} catch {
			// Timeout or spawn failure — leave output empty.
		}
		result = result.replaceAll(match[0], output);
	}

	return result;
}
