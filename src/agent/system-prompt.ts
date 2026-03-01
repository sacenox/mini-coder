import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tildePath } from "../cli/output.ts";
import { parseModelString } from "../llm-api/providers.ts";
import { getConfigDir } from "../session/db/index.ts";

function loadContextFile(cwd: string): string | null {
	const candidates = [
		join(cwd, "AGENTS.md"),
		join(cwd, "CLAUDE.md"),
		join(getConfigDir(), "AGENTS.md"),
	];
	for (const p of candidates) {
		if (existsSync(p)) {
			try {
				return readFileSync(p, "utf-8");
			} catch {
				// skip
			}
		}
	}
	return null;
}

const CODEX_AUTONOMY = `
# Autonomy and persistence
- You are an autonomous senior engineer. Once given a direction, proactively gather context, implement, test, and refine without waiting for additional prompts at each step.
- Persist until the task is fully handled end-to-end within the current turn: do not stop at analysis or partial work; carry changes through to implementation and verification.
- Bias to action: default to implementing with reasonable assumptions. Do not end your turn with clarifications or requests to "proceed" unless you are truly blocked on information only the user can provide.
- Do NOT output an upfront plan, preamble, or status update before working. Start making tool calls immediately.
- Do NOT ask "shall I proceed?", "shall I start?", "reply X to continue", or any equivalent. Just start.
- If something is ambiguous, pick the most reasonable interpretation, implement it, and note the assumption at the end.`;

export function isCodexModel(modelString: string): boolean {
	const { modelId } = parseModelString(modelString);
	return modelId.includes("codex");
}

export function buildSystemPrompt(cwd: string, modelString?: string): string {
	const contextFile = loadContextFile(cwd);
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
- Use glob to discover files, grep to find patterns, read to inspect contents.
- Use shell for tests, builds, and git operations.`;

	if (modelString && isCodexModel(modelString)) {
		prompt += CODEX_AUTONOMY;
	}

	if (contextFile) {
		prompt += `\n\n# Project context\n\n${contextFile}`;
	}

	return prompt;
}
