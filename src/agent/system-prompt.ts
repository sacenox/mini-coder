import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { tildePath } from "../cli/output.ts";
import { parseModelString } from "../llm-api/providers.ts";

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

const CODEX_AUTONOMY = `
# Autonomy and persistence
- You are an autonomous senior engineer. Once given a direction, proactively gather context, implement, test, and refine without waiting for additional prompts at each step.
- Persist until the task is fully handled end-to-end within the current turn: do not stop at analysis or partial work; carry changes through to implementation and verification.
- Bias to action: default to implementing with reasonable assumptions. Do not end your turn with clarifications or requests to "proceed" unless you are truly blocked on information only the user can provide.
- Do NOT output an upfront plan, preamble, or status update before working. Start making tool calls immediately.
- Do NOT ask "shall I proceed?", "shall I start?", "reply X to continue", or any equivalent. Just start.
- If something is ambiguous, pick the most reasonable interpretation, implement it, and note the assumption at the end.`;

const SUBAGENT_DELEGATION = `You are running as a subagent. Complete the task directly using your tools. Do not delegate to further subagents unless the subtask is clearly separable and self-contained.`;

function isCodexModel(modelString: string): boolean {
	const { modelId } = parseModelString(modelString);
	return modelId.includes("codex");
}

export function buildSystemPrompt(
	cwd: string,
	modelString?: string,
	extraSystemPrompt?: string,
	isSubagent?: boolean,
	/** Override home directory — used in tests to isolate global context loading. */
	homeDir?: string,
): string {
	const globalContext = loadGlobalContextFile(homeDir ?? homedir());
	const localContext = loadLocalContextFile(cwd);
	const cwdDisplay = tildePath(cwd);
	const now = new Date().toLocaleString(undefined, { hour12: false });

	let prompt = `You are mini-coder, a small and fast CLI coding agent.
You have access to tools to read files, search code, make edits, run shell commands, and spawn subagents.

Current working directory: ${cwdDisplay}
Current date/time: ${now}

Guidelines:
- Be concise and precise. Avoid unnecessary preamble.
- Prefer small, targeted edits over large rewrites.
- Always read a file before editing it.
- Use the \`subagent\` tool sparingly — only for clearly separable, self-contained subtasks. Prefer doing the work directly.
- Keep your context clean and focused on the user request.`;

	if (modelString && isCodexModel(modelString)) {
		prompt += CODEX_AUTONOMY;
	}

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
