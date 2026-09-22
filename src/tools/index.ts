import type { Tool, ToolCall } from "@earendil-works/pi-ai";
import type { ToolName } from "../config.ts";
import { parseArgs, type ToolContext, type ToolResult } from "./common.ts";
import { BASH_PARAMS, bash } from "./bash.ts";
import { EDIT_PARAMS, edit } from "./edit.ts";

export type { ToolContext, ToolDetails, ToolResult } from "./common.ts";

const TOOL_SCHEMAS: Record<ToolName, Tool> = {
  edit: {
    name: "edit",
    description:
      "Edit a file by exact text replacement. oldText must occur exactly once. " +
      "With empty oldText, create a new file (fails if it exists).",
    parameters: EDIT_PARAMS,
  },
  bash: {
    name: "bash",
    description: "Run a bash command in the current working directory.",
    parameters: BASH_PARAMS,
  },
};

export function toolSchemas(names: ToolName[]): Tool[] {
  return names.map((name) => TOOL_SCHEMAS[name]);
}

export function executeTool(name: ToolName, call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
  try {
    if (name === "edit") return Promise.resolve(edit(parseArgs(EDIT_PARAMS, call.arguments), ctx.signal));
    return bash(parseArgs(BASH_PARAMS, call.arguments), ctx);
  } catch (error) {
    return Promise.resolve({ text: (error as Error).message, isError: true });
  }
}
