import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Type, type Static, type TSchema, type Tool, type ToolCall } from "@earendil-works/pi-ai";
import { Value } from "typebox/value";
import { createTwoFilesPatch } from "diff";
import type { ToolName } from "./config.ts";

export interface ToolContext {
  signal: AbortSignal;
  onOutput?: (chunk: string) => void;
}

export interface ToolDetails {
  truncated: boolean;
  omittedChars: number;
  totalChars: number;
}

export interface ToolResult {
  text: string;
  isError: boolean;
  details?: ToolDetails;
}

const EDIT_PARAMS = Type.Object(
  {
    path: Type.String({ description: "File path" }),
    oldText: Type.String({ description: "Exact text to replace; empty to create a file" }),
    newText: Type.String({ description: "Replacement text" }),
  },
  { additionalProperties: false },
);
type EditArgs = Static<typeof EDIT_PARAMS>;

const BASH_PARAMS = Type.Object(
  { command: Type.String({ description: "Command to run" }) },
  { additionalProperties: false },
);
type BashArgs = Static<typeof BASH_PARAMS>;

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

function parseArgs<T extends TSchema>(schema: T, value: unknown): Static<T> {
  try {
    return Value.Parse(schema, value);
  } catch {
    const first = [...Value.Errors(schema, value)][0];
    throw new Error(first ? `${first.instancePath || "/"} ${first.message}` : "invalid arguments");
  }
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

const MAX_HEAD = 10_000;
const MAX_TAIL = 6_000;
const TRUNCATED = "\n\n... output truncated ...\n\n";

function bash(args: BashArgs, ctx: ToolContext): Promise<ToolResult> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", args.command], {
      cwd: process.cwd(),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let head = "";
    let tail = "";
    let omitted = 0;
    const append = (chunk: Buffer) => {
      let text = chunk.toString();
      ctx.onOutput?.(text);
      if (head.length < MAX_HEAD) {
        const take = Math.min(MAX_HEAD - head.length, text.length);
        head += text.slice(0, take);
        text = text.slice(take);
      }
      if (text === "") return;
      tail += text;
      if (tail.length > MAX_TAIL) {
        omitted += tail.length - MAX_TAIL;
        tail = tail.slice(tail.length - MAX_TAIL);
      }
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
      const truncated = omitted > 0;
      const body = truncated ? head + TRUNCATED + tail : head + tail;
      const text = body + (body.endsWith("\n") || body === "" ? "" : "\n") + `exit code: ${exit}`;
      resolve({
        text,
        isError: code !== 0,
        details: truncated
          ? { truncated: true, omittedChars: omitted, totalChars: head.length + tail.length + omitted }
          : undefined,
      });
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
      append(Buffer.from(`${head || tail ? "\n" : ""}bash failed: ${error.message}\n`));
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}
