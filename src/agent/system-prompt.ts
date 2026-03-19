import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { tildePath } from "../cli/output.ts";
import { loadSkillsIndex } from "../cli/skills.ts";

function tryReadFile(p: string): string | null {
	if (!existsSync(p)) return null;
	try {
		return readFileSync(p, "utf-8");
	} catch {
		return null;
	}
}

function collectFiles(...paths: string[]): string | null {
	const parts: string[] = [];
	for (const p of paths) {
		const content = tryReadFile(p);
		if (content) parts.push(content);
	}
	return parts.length > 0 ? parts.join("\n\n") : null;
}

function loadGlobalContextFile(homeDir: string): string | null {
	return collectFiles(
		join(homeDir, ".agents", "AGENTS.md"),
		join(homeDir, ".agents", "CLAUDE.md"),
		join(homeDir, ".claude", "CLAUDE.md"),
	);
}

/** Try reading all context files from a single directory. */
function loadContextFileAt(dir: string): string | null {
	return collectFiles(
		join(dir, ".agents", "AGENTS.md"),
		join(dir, ".agents", "CLAUDE.md"),
		join(dir, ".claude", "CLAUDE.md"),
		join(dir, "CLAUDE.md"),
		join(dir, "AGENTS.md"),
	);
}

/**
 * Walk from cwd up to the git root (or just cwd if outside a repo),
 * returning the nearest context file found.
 */
export function loadLocalContextFile(cwd: string): string | null {
	const start = resolve(cwd);
	let current = start;
	while (true) {
		const content = loadContextFileAt(current);
		if (content) return content;
		if (existsSync(join(current, ".git"))) break;
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return null;
}

const AUTONOMY = `

# Autonomy and persistence
- You are a capable senior engineer. Once given a direction, proactively gather context and implement — don't ask for permission to start.
- Carry changes through to implementation and verify they work. Don't stop halfway through a task without a good reason.
- Skip preamble. Don't output a plan before working — start using tools right away.
- Don't ask "shall I proceed?" or "shall I start?" at the beginning of a turn. Just begin.
- Do not guess unknown facts. Inspect files and web or run commands to find out. Don't make assumptions, verify.
- Avoid excessive looping: if you find yourself re-reading or re-editing the same files without clear progress, stop and summarise what's blocking you.`;

const SAFETY = `

# Safety and risk boundaries
- Never expose, print, or commit secrets/tokens/keys.
- Never invent URLs. Use URLs explicitly provided by the user or found in trusted project files/docs.
- For destructive or irreversible actions (for example deleting data or force-resetting git history), ask one targeted confirmation question before proceeding.`;

const WORKSPACE_GUARDRAILS = `

# Workspace guardrails
- Never revert user-authored changes unless explicitly asked.
- If unexpected modifications appear in files you are actively editing, pause and ask how to proceed.
- Avoid destructive git commands unless explicitly requested. Prefer non-interactive git commands.`;

const STATUS_UPDATES = `

# Progress communication
- Do not send ceremonial preambles.
- For long-running or multi-phase tasks, send brief progress updates every few tool batches (one sentence with the next concrete action).`;

const FINAL_MESSAGE = `

# Final response style
- Default to non verbose, concise output (short bullets or a brief paragraph).
- For substantial code changes, state what changed, where, and why.
- Reference files with line numbers when helpful.
- Do not paste large file contents unless asked.`;

export function buildSystemPrompt(
	sessionTimeAnchor: string,
	cwd: string,
	/** Override home directory — used in tests to isolate global context loading. */
	homeDir?: string,
): string {
	const globalContext = loadGlobalContextFile(homeDir ?? homedir());
	const localContext = loadLocalContextFile(cwd);
	const cwdDisplay = tildePath(cwd);
	let prompt = `You are mini-coder, a small and fast CLI coding agent.
You have access to shell, listSkills, readSkill, connected MCP tools, and optional web tools.

Current working directory: ${cwdDisplay}
Current date/time: ${sessionTimeAnchor}

Guidelines:
- Be concise and precise. Avoid unnecessary preamble. Don't be verbose.
- Inspect code and files primarily through shell commands.
- Use temp files to handle large content, prefer scanning over full reads.
- Prefer small, targeted edits over large file rewrites.
- For file edits, use shell commands that invoke \`mc-edit\`.
- Use the skill tools only when you need to inspect available community/project skills or load one skill body.
- Make parallel tool calls when independent searches/lookups can happen concurrently.
- Keep your context clean and focused on the user request.

# Preferred file workflow
- Use shell for repo inspection, verification, temp-file orchestration, and any non-edit file operation.
- \`mc-edit\` is available inside shell commands.
- \`mc-edit\` applies one exact-text edit and fails if the expected old text is missing or ambiguous.

Usage: mc-edit <path> (--old <text> | --old-file <path>) [--new <text> | --new-file <path>] [--cwd <path>]
Outputs a diff of the changes and meta information.

Apply one safe exact-text edit to an existing file.
- The expected old text must match exactly once.
- Omit --new / --new-file to delete the matched text.
`;

	prompt += AUTONOMY;
	prompt += SAFETY;
	prompt += WORKSPACE_GUARDRAILS;
	prompt += STATUS_UPDATES;
	prompt += FINAL_MESSAGE;

	if (globalContext || localContext) {
		prompt += "\n\n# Project context";
		if (globalContext) {
			prompt += `\n\n${globalContext}`;
		}
		if (localContext) {
			prompt += `\n\n${localContext}`;
		}
	}

	const skills = Array.from(loadSkillsIndex(cwd, homeDir).values());
	if (skills.length > 0) {
		prompt += "\n\n# Available skills (metadata only)";
		prompt +=
			"\nUse `listSkills` to browse and `readSkill` to load one SKILL.md on demand.";
		prompt +=
			"\nWhen a skill references relative paths, resolve them against the skill directory (parent of SKILL.md).";
		prompt +=
			'\nFor complex skills that would clutter your context, consider delegating to a subagent via `mc "prompt"` in the shell tool.\n';
		for (const skill of skills) {
			prompt += `\n- ${skill.name}: ${skill.description} (${skill.source}, ${skill.filePath})`;
		}
	}

	return prompt;
}
