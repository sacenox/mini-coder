import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Type, type Tool } from "@earendil-works/pi-ai";
import { createTwoFilesPatch } from "diff";
import type { ToolName } from "./config.ts";

export interface ToolContext {
  signal: AbortSignal;
  onOutput?: (chunk: string) => void;
}

export interface ToolResult {
  text: string;
  isError: boolean;
}

export const EDIT_TOOL: Tool = {
  name: "edit",
  description:
    "Edit a file by exact text replacement. oldText must occur exactly once. " +
    "With empty oldText, create a new file (fails if it exists).",
  parameters: Type.Object(
    {
      path: Type.String({ description: "File path" }),
      oldText: Type.String({ description: "Exact text to replace; empty to create a file" }),
      newText: Type.String({ description: "Replacement text" }),
    },
    { additionalProperties: false },
  ),
};

export const BASH_TOOL: Tool = {
  name: "bash",
  description: "Run a bash command in the current working directory.",
  parameters: Type.Object(
    { command: Type.String({ description: "Command to run" }) },
    { additionalProperties: false },
  ),
};

export function toolSchemas(names: ToolName[]): Tool[] {
  const available: Record<ToolName, Tool> = { edit: EDIT_TOOL, bash: BASH_TOOL };
  return names.map((name) => available[name]);
}

export function executeTool(name: ToolName, args: unknown, ctx: ToolContext): Promise<ToolResult> {
  if (name === "edit") return Promise.resolve(edit(args as EditArgs, ctx.signal));
  return bash(args as BashArgs, ctx);
}

interface EditArgs {
  path: string;
  oldText: string;
  newText: string;
}

function edit(args: EditArgs, signal: AbortSignal): ToolResult {
  const { path, oldText, newText } = args;
  const exists = existsSync(path);

  if (oldText === "") {
    if (exists) return { text: `edit failed: ${path} already exists`, isError: true };
    if (signal.aborted) return { text: "edit cancelled", isError: true };
    writeFileSync(path, newText);
    return { text: `created ${path}\n${unified(path, "", newText)}`, isError: false };
  }

  if (!exists) return { text: `edit failed: ${path} does not exist`, isError: true };
  const before = readFileSync(path, "utf8");
  const count = before.split(oldText).length - 1;
  if (count === 0) return { text: `edit failed: oldText not found in ${path}`, isError: true };
  if (count > 1) return { text: `edit failed: oldText matches ${count} times in ${path}`, isError: true };

  const after = before.replace(oldText, newText);
  if (signal.aborted) return { text: "edit cancelled", isError: true };
  writeFileSync(path, after);
  return { text: `edited ${path}\n${unified(path, before, after)}`, isError: false };
}

function unified(path: string, before: string, after: string): string {
  return createTwoFilesPatch(path, path, before, after, "", "", { context: 3 });
}

interface BashArgs {
  command: string;
}

function bash(args: BashArgs, ctx: ToolContext): Promise<ToolResult> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", args.command], {
      cwd: process.cwd(),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    const append = (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      ctx.onOutput?.(text);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);

    let settled = false;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      ctx.signal.removeEventListener("abort", onAbort);
      clearTimeout(killTimer);
      const exit = code ?? (ctx.signal.aborted ? "aborted" : "unknown");
      const text = output + (output.endsWith("\n") || output === "" ? "" : "\n") + `exit code: ${exit}`;
      resolve({ text, isError: code !== 0 });
    };

    let killTimer: NodeJS.Timeout | undefined;
    const onAbort = () => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
      killTimer = setTimeout(() => {
        try {
          process.kill(-child.pid!, "SIGKILL");
        } catch {
          /* already gone */
        }
      }, 300);
    };

    if (ctx.signal.aborted) onAbort();
    else ctx.signal.addEventListener("abort", onAbort, { once: true });

    child.on("error", (error) => {
      output += `${output ? "\n" : ""}bash failed: ${error.message}\n`;
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}
