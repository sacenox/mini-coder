import type { ToolDef } from "../llm-api/types.ts";
import { globTool } from "../tools/glob.ts";
import { grepTool } from "../tools/grep.ts";
import { readTool } from "../tools/read.ts";
import { editTool } from "../tools/edit.ts";
import { shellTool } from "../tools/shell.ts";
import { createSubagentTool } from "../tools/subagent.ts";

// ─── Hook types ────────────────────────────────────────────────────────────────

export type ToolHook = (toolName: string, result: unknown) => Promise<void>;

const _hooks: ToolHook[] = [];

export function addToolHook(hook: ToolHook): void {
  _hooks.push(hook);
}

export async function runToolHooks(
  toolName: string,
  result: unknown
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (input: any) => {
      const withDefault = { cwd, ...(input as object) };
      return originalExecute(withDefault);
    },
  };
}

export const MAX_SUBAGENT_DEPTH = 3;

export function buildToolSet(opts: {
  cwd: string;
  depth?: number;
  runSubagent: (prompt: string, model?: string, depth?: number) => Promise<{
    result: string;
    inputTokens: number;
    outputTokens: number;
  }>;
}): ToolDef[] {
  const depth = opts.depth ?? 0;
  return [
    withCwdDefault(globTool as ToolDef, opts.cwd),
    withCwdDefault(grepTool as ToolDef, opts.cwd),
    withCwdDefault(readTool as ToolDef, opts.cwd),
    withCwdDefault(editTool as ToolDef, opts.cwd),
    withCwdDefault(shellTool as ToolDef, opts.cwd),
    createSubagentTool(
      async (prompt, model) => {
        if (depth >= MAX_SUBAGENT_DEPTH) {
          throw new Error(
            `Subagent depth limit reached (max ${MAX_SUBAGENT_DEPTH}). ` +
            `Cannot spawn another subagent from depth ${depth}.`
          );
        }
        return opts.runSubagent(prompt, model, depth + 1);
      }
    ) as ToolDef,
  ];
}
