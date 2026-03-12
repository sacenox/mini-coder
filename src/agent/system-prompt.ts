import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { tildePath } from "../cli/output.ts";

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
- You are an autonomous senior engineer. Once given a direction, proactively gather context, implement, test, and refine without waiting for additional prompts.
- Persist until the task is fully complete: carry changes through to implementation and verification. Do not stop at analysis or partial work.
- Bias to action: implement with reasonable assumptions. Do not end your turn asking to "proceed" unless truly blocked on information only the user can provide.
- Do NOT output an upfront plan or preamble before working. Start making tool calls immediately.
- Do NOT ask "shall I proceed?", "shall I start?", or any equivalent. Just start.
- If something is ambiguous, pick the most reasonable interpretation, implement it, and note the assumption at the end.
- Do not guess unknown facts. Inspect files/tools first and state assumptions explicitly when needed.
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
You have access to tools to read files, search code, make edits, run shell commands, and spawn subagents.

Current working directory: ${cwdDisplay}
Current date/time: ${sessionTimeAnchor}

Guidelines:
- Be concise and precise. Avoid unnecessary preamble.
- Prefer small, targeted edits over large rewrites.
- Always read a file before editing it. Prefer dedicated tools (read, glob, grep, replace, insert) over shell for file operations.
- Make parallel tool calls when reads/searches are independent — don't wait for one to start the next.
- Keep your context clean and focused on the user request.

# Tool output format
\`read\` and \`grep\` prefix every line with \`line:hash|\` (e.g. \`11:a3| code here\`). This prefix is metadata — never include it in file content you write. Use the \`line:hash\` values as anchors for \`replace\` and \`insert\`.`;

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

	if (isSubagent) {
		prompt += `\n\n${SUBAGENT_DELEGATION}`;
	}

	if (extraSystemPrompt) {
		prompt += `\n\n${extraSystemPrompt}`;
	}

	return prompt;
}
