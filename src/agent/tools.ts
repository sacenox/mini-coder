import type { ToolDef } from "../llm-api/types.ts";
import { editTool } from "../tools/edit.ts";
import { globTool } from "../tools/glob.ts";
import { grepTool } from "../tools/grep.ts";
import { insertTool } from "../tools/insert.ts";
import { readTool } from "../tools/read.ts";
import { shellTool } from "../tools/shell.ts";
import { createSubagentTool } from "../tools/subagent.ts";
import { writeTool } from "../tools/write.ts";

// ─── Hook types ────────────────────────────────────────────────────────────────

export type ToolHook = (toolName: string, result: unknown) => Promise<void>;

const _hooks: ToolHook[] = [];

export function addToolHook(hook: ToolHook): void {
	_hooks.push(hook);
}

export async function runToolHooks(
	toolName: string,
	result: unknown,
): Promise<void> {
	for (const hook of _hooks) {
		try {
			await hook(toolName, result);
		} catch {
			// Hooks must not crash the agent
		}
	}
}

// ─── Tool registry ────────────────────────────────────────────────────────────

/**
 * Wrap a tool's execute function to inject a default cwd if not provided.
 */
function withCwdDefault(tool: ToolDef, cwd: string): ToolDef {
	const originalExecute = tool.execute;
	return {
		...tool,
		execute: async (input: unknown) => {
			const withDefault = {
				cwd,
				...(typeof input === "object" && input ? input : {}),
			};
			return originalExecute(withDefault);
		},
	};
}

export const MAX_SUBAGENT_DEPTH = 3;

export function buildToolSet(opts: {
	cwd: string;
	depth?: number;
	runSubagent: (
		prompt: string,
		model?: string,
		depth?: number,
	) => Promise<{
		result: string;
		inputTokens: number;
		outputTokens: number;
	}>;
}): ToolDef[] {
	const depth = opts.depth ?? 0;
	return [
		// Read-only: discover and inspect files
		withCwdDefault(globTool as ToolDef, opts.cwd),
		withCwdDefault(grepTool as ToolDef, opts.cwd),
		withCwdDefault(readTool as ToolDef, opts.cwd),
		// Write: create/overwrite, replace/delete, insert
		withCwdDefault(writeTool as ToolDef, opts.cwd),
		withCwdDefault(editTool as ToolDef, opts.cwd),
		withCwdDefault(insertTool as ToolDef, opts.cwd),
		// Shell and subagent
		withCwdDefault(shellTool as ToolDef, opts.cwd),
		createSubagentTool(async (prompt, model) => {
			if (depth >= MAX_SUBAGENT_DEPTH) {
				throw new Error(
					`Subagent depth limit reached (max ${MAX_SUBAGENT_DEPTH}). ` +
						`Cannot spawn another subagent from depth ${depth}.`,
				);
			}
			return opts.runSubagent(prompt, model, depth + 1);
		}) as ToolDef,
	];
}

export function buildReadOnlyToolSet(opts: { cwd: string }): ToolDef[] {
	return [
		withCwdDefault(globTool as ToolDef, opts.cwd),
		withCwdDefault(grepTool as ToolDef, opts.cwd),
		withCwdDefault(readTool as ToolDef, opts.cwd),
	];
}
