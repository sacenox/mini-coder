import type { ToolDef, ToolExecuteOptions } from "../llm-api/types.ts";
import { webContentTool, webSearchTool } from "../tools/exa.ts";
import type { ShellOutput } from "../tools/shell.ts";
import { shellTool } from "../tools/shell.ts";
import { listSkillsTool, readSkillTool } from "../tools/skills.ts";

/**
 * Inject a default cwd if not provided by the LLM.
 */
function withCwdDefault(tool: ToolDef, cwd: string): ToolDef {
  const originalExecute = tool.execute;
  return {
    ...tool,
    execute: async (input: unknown, options?: ToolExecuteOptions) => {
      const patched = (
        typeof input === "object" && input !== null ? input : {}
      ) as Record<string, unknown>;
      if (patched.cwd === undefined) patched.cwd = cwd;
      return originalExecute(patched, options);
    },
  };
}

export function buildToolSet(opts: { cwd: string }): ToolDef[] {
  const { cwd } = opts;

  const shell = withCwdDefault(shellTool as ToolDef, cwd) as ToolDef<
    { cwd?: string; command: string },
    ShellOutput
  >;

  const tools: ToolDef[] = [
    shell as ToolDef,
    withCwdDefault(listSkillsTool as ToolDef, cwd),
    withCwdDefault(readSkillTool as ToolDef, cwd),
  ];

  if (process.env.EXA_API_KEY) {
    tools.push(webSearchTool as ToolDef, webContentTool as ToolDef);
  }

  return tools;
}
