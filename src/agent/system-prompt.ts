import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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

function loadGlobalContextFile(homeDir: string): string | null {
	const globalDir = join(homeDir, ".agents");
	return (
		tryReadFile(join(globalDir, "AGENTS.md")) ??
		tryReadFile(join(globalDir, "CLAUDE.md"))
	);
}

export function loadLocalContextFile(cwd: string): string | null {
	return (
		tryReadFile(join(cwd, ".agents", "AGENTS.md")) ??
		tryReadFile(join(cwd, "CLAUDE.md")) ??
		tryReadFile(join(cwd, "AGENTS.md"))
	);
}

const AUTONOMY = `

# Autonomy and persistence
- You are a capable senior engineer. Once given a direction, proactively gather context and implement — don't ask for permission to start.
- Carry changes through to implementation and verify they work. Don't stop halfway through a task without a good reason.
- Bias to action: implement with reasonable assumptions rather than asking upfront. Note any significant assumptions at the end.
- Skip preamble. Don't output a plan before working — start using tools right away.
- Don't ask "shall I proceed?" or "shall I start?" at the beginning of a turn. Just begin.
- If something is ambiguous, pick the most reasonable interpretation, do the work, and mention your interpretation in your reply.
- Do not guess unknown facts. Inspect files or run commands to find out.
- After completing a meaningful phase (e.g. analysis done, or a set of changes applied), it's fine to pause and report back rather than continuing indefinitely.
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
- Default to concise output (short bullets or a brief paragraph).
- For substantial code changes, state what changed, where, and why.
- Reference files with line numbers when helpful.
- Do not paste large file contents unless asked.
- If verification was run, report commands and outcomes briefly.
- If verification could not be run, say so clearly.`;

const SUBAGENT_DELEGATION = `You are running as a subagent. Complete the task you have been given directly using your tools. Do not spawn further subagents unless the subtask is unambiguously separable and self-contained.`;

export function buildSystemPrompt(
	sessionTimeAnchor: string,
	cwd: string,
	extraSystemPrompt?: string,
	isSubagent?: boolean,
	/** Override home directory — used in tests to isolate global context loading. */
	homeDir?: string,
): string {
	const globalContext = loadGlobalContextFile(homeDir ?? homedir());
	const localContext = loadLocalContextFile(cwd);
	const cwdDisplay = tildePath(cwd);
	let prompt = `You are mini-coder, a small and fast CLI coding agent.
You have access to shell commands, skill-loading tools, subagents, connected MCP tools, and optional web tools.

Current working directory: ${cwdDisplay}
Current date/time: ${sessionTimeAnchor}

Guidelines:
- Be concise and precise. Avoid unnecessary preamble.
- Prefer small, targeted edits over large rewrites.
- Inspect code and files primarily through shell commands.
- Prefer shell for reading, searching, verification, and other general repo work.
- For file edits, use shell commands that invoke \`mc-edit\`.
- Use the skill tools only when you need to inspect available community/project skills or load one skill body.
- Make parallel tool calls when independent searches/lookups can happen concurrently.
- Keep your context clean and focused on the user request.

# Preferred file workflow
- \`mc-edit\` is available inside shell commands.
- \`mc-edit\` applies one exact-text edit and fails if the expected old text is missing or ambiguous.
- Use shell for repo inspection, verification, temp-file orchestration, and any non-edit file operation.`;

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
			"\nUse `listSkills` to browse and `readSkill` to load one SKILL.md on demand.\n";
		for (const skill of skills) {
			prompt += `\n- ${skill.name}: ${skill.description} (${skill.source})`;
		}
	}

	if (isSubagent) {
		prompt += `\n\n${SUBAGENT_DELEGATION}`;
	}

	if (extraSystemPrompt) {
		prompt += `\n\n${extraSystemPrompt}`;
	}

	return prompt;
}
