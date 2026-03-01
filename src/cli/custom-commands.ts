import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { warnConventionConflicts } from "./config-conflicts.ts";
import { parseFrontmatter } from "./frontmatter.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

import { loadMarkdownConfigs } from "./load-markdown-configs.ts";

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

// ─── Load all custom commands (global + local, local wins) ───────────────────

export function loadCustomCommands(cwd: string): Map<string, CustomCommand> {
	return loadMarkdownConfigs<CustomCommand>({
		type: "commands",
		strategy: "flat",
		cwd,
		includeClaudeDirs: true,
		mapConfig: ({ name, meta, body, source }) => ({
			name,
			description: meta.description ?? name,
			...(meta.model ? { model: meta.model } : {}),
			template: body,
			source,
		}),
	});
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
