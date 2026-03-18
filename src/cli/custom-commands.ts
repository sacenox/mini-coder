// ─── Types ────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	baseConfigFields,
	loadMarkdownConfigs,
} from "./load-markdown-configs.ts";

export interface CustomCommand {
	name: string;
	description: string;
	/** Optional model override from frontmatter (e.g. "zen/claude-3-5-haiku") */
	model?: string;
	/** Raw template string (after frontmatter is stripped) */
	template: string;
	/** "global" (~/.agents/) or "local" (./.agents/) — local wins on conflict */
	source: "global" | "local";
}

// ─── Load all custom commands (global + local, local wins) ───────────────────

export function loadCustomCommands(
	cwd: string,
	homeDir?: string,
): Map<string, CustomCommand> {
	return loadMarkdownConfigs<CustomCommand>({
		type: "commands",
		strategy: "flat",
		cwd,
		homeDir,
		includeClaudeDirs: true,
		mapConfig: ({ name, meta, body, source }) => ({
			...baseConfigFields(name, meta, source),
			template: body,
		}),
	});
}
// ─── Template expansion ───────────────────────────────────────────────────────

/**
 * Expands a command template:
 * - `$ARGUMENTS` → full args string
 * - `$1`, `$2`, … → positional tokens
 * - `!`cmd`` → stdout of running cmd in a shell
 * - `@<filepath>` → contents of the file (relative to cwd), wrapped in a code fence
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

	// Replace @file references — resolve relative to cwd, wrap in code fence.
	// Matches @<path> where path is a non-whitespace sequence; silently skips
	// tokens that don't resolve to an existing file (e.g. email addresses).
	const FILE_REF_RE = /@([^\s,;!?'")\]]+)/g;
	const fileMatches = [...result.matchAll(FILE_REF_RE)];
	for (const match of fileMatches) {
		const filePath = match[1] ?? "";
		const fullPath = join(cwd, filePath);
		if (!existsSync(fullPath)) continue;
		let content = "";
		try {
			content = readFileSync(fullPath, "utf-8");
		} catch {
			continue;
		}
		result = result.replaceAll(
			match[0],
			`\`${filePath}\`:\n\`\`\`\n${content}\n\`\`\``,
		);
	}

	return result;
}
