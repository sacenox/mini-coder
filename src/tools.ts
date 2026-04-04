/**
 * Built-in tool implementations: `edit` and `shell`.
 *
 * Each tool is exposed as a pure-ish execute function that takes typed
 * arguments and a working directory, returning a result object with `text`
 * and `isError`. The pi-ai {@link Tool} definitions (TypeBox schemas) are
 * exported separately for registration with the agent context.
 *
 * @module
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type { Tool } from "@mariozechner/pi-ai";
import { Type } from "@mariozechner/pi-ai";

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/** Result returned by a tool execution. */
export interface ToolResult {
  /** Human-readable result text. */
  text: string;
  /** Whether the execution encountered an error. */
  isError: boolean;
}

// ---------------------------------------------------------------------------
// edit
// ---------------------------------------------------------------------------

/** Arguments for the `edit` tool. */
export interface EditArgs {
  /** File path (absolute or relative to cwd). */
  path: string;
  /** Exact text to find. Empty string means "create new file". */
  oldText: string;
  /** Replacement text (or full content for new files). */
  newText: string;
}

/**
 * Execute an exact-text replacement in a single file.
 *
 * - If `oldText` is empty, creates a new file (with parent directories).
 *   Fails if the file already exists.
 * - Otherwise, reads the file, finds exactly one occurrence of `oldText`,
 *   and replaces it with `newText`. Fails if the text is not found or
 *   matches multiple locations.
 *
 * @param args - Edit arguments (path, oldText, newText).
 * @param cwd - Working directory for resolving relative paths.
 * @returns A {@link ToolResult} with confirmation or error message.
 */
export function executeEdit(args: EditArgs, cwd: string): ToolResult {
  const filePath = isAbsolute(args.path) ? args.path : join(cwd, args.path);

  // Create new file
  if (args.oldText === "") {
    if (existsSync(filePath)) {
      return { text: `File already exists: ${args.path}`, isError: true };
    }
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, args.newText, "utf-8");
    return { text: `Created ${args.path}`, isError: false };
  }

  // Replace in existing file
  if (!existsSync(filePath)) {
    return { text: `File not found: ${args.path}`, isError: true };
  }

  const content = readFileSync(filePath, "utf-8");

  // Count occurrences
  let count = 0;
  let idx = 0;
  while (true) {
    idx = content.indexOf(args.oldText, idx);
    if (idx === -1) break;
    count++;
    idx += args.oldText.length;
  }

  if (count === 0) {
    return { text: `Old text not found in ${args.path}`, isError: true };
  }
  if (count > 1) {
    return {
      text: `Old text matches multiple locations (${count}) in ${args.path}`,
      isError: true,
    };
  }

  // Exactly one match — replace
  const updated = content.replace(args.oldText, args.newText);
  writeFileSync(filePath, updated, "utf-8");
  return { text: `Edited ${args.path}`, isError: false };
}

// ---------------------------------------------------------------------------
// shell
// ---------------------------------------------------------------------------

/** Arguments for the `shell` tool. */
export interface ShellArgs {
  /** The command to run. */
  command: string;
}

/** Options for shell execution. */
export interface ShellOpts {
  /** Maximum output lines before truncation. Default: 500. */
  maxLines?: number;
  /** Abort signal to cancel the command. */
  signal?: AbortSignal;
}

const DEFAULT_MAX_LINES = 500;

/**
 * Run a command in the user's shell.
 *
 * Executes via `$SHELL -c` (falling back to `/bin/sh`). Returns combined
 * stdout/stderr and the exit code. Large output is truncated to keep
 * head + tail lines with a middle marker.
 *
 * @param args - Shell arguments (command).
 * @param cwd - Working directory to run the command in.
 * @param opts - Optional execution options (maxLines, signal).
 * @returns A {@link ToolResult} with the command output.
 */
export async function executeShell(
  args: ShellArgs,
  cwd: string,
  opts?: ShellOpts,
): Promise<ToolResult> {
  const shell = process.env.SHELL || "/bin/sh";
  const maxLines = opts?.maxLines ?? DEFAULT_MAX_LINES;

  try {
    const spawnOpts: Parameters<typeof Bun.spawn>[1] = {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    };
    if (opts?.signal) spawnOpts.signal = opts.signal;
    const proc = Bun.spawn([shell, "-c", args.command], spawnOpts);

    const [stdoutBuf, stderrBuf] = await Promise.all([
      new Response(proc.stdout as ReadableStream).text(),
      new Response(proc.stderr as ReadableStream).text(),
    ]);
    const exitCode = await proc.exited;

    const stdout = stdoutBuf.trimEnd();
    const stderr = stderrBuf.trimEnd();

    let output = "";
    if (stdout && stderr) {
      output = `${stdout}\n\n[stderr]\n${stderr}`;
    } else if (stdout) {
      output = stdout;
    } else if (stderr) {
      output = `[stderr]\n${stderr}`;
    }

    output = truncateOutput(output, maxLines);

    const isError = exitCode !== 0;
    const prefix = isError ? `Command failed with exit code ${exitCode}\n` : "";
    const text = prefix + output;

    return { text: text || "(no output)", isError };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { text: `Shell error: ${message}`, isError: true };
  }
}

// ---------------------------------------------------------------------------
// Output truncation
// ---------------------------------------------------------------------------

/**
 * Truncate output to keep head and tail lines with a marker in between.
 *
 * If the output has fewer lines than `maxLines`, it is returned unchanged.
 * Otherwise, keeps roughly half the budget for head lines and half for tail
 * lines, joined by a truncation marker showing how many lines were omitted.
 *
 * @param output - The full output string.
 * @param maxLines - Maximum number of content lines to keep.
 * @returns The (possibly truncated) output string.
 */
export function truncateOutput(output: string, maxLines: number): string {
  if (!output) return output;

  const lines = output.split("\n");
  if (lines.length <= maxLines) return output;

  const headCount = Math.ceil(maxLines / 2);
  const tailCount = Math.floor(maxLines / 2);
  const omitted = lines.length - headCount - tailCount;

  const head = lines.slice(0, headCount);
  const tail = lines.slice(lines.length - tailCount);

  return [...head, `… truncated ${omitted} lines …`, ...tail].join("\n");
}

// ---------------------------------------------------------------------------
// Tool definitions (pi-ai Tool schemas)
// ---------------------------------------------------------------------------

/** pi-ai tool definition for `edit`. */
export const editTool: Tool = {
  name: "edit",
  description:
    "Make an exact-text replacement in a single file. " +
    "Provide the file path, the exact text to find, and the replacement text. " +
    "The old text must match exactly one location in the file. " +
    "To create a new file, use an empty old text and the full file content as new text.",
  parameters: Type.Object({
    path: Type.String({
      description: "File path (absolute or relative to cwd)",
    }),
    oldText: Type.String({
      description:
        'Exact text to find and replace. Empty string means "create new file".',
    }),
    newText: Type.String({
      description: "Replacement text (or full content for new files)",
    }),
  }),
};

/** pi-ai tool definition for `shell`. */
export const shellTool: Tool = {
  name: "shell",
  description:
    "Run a command in the user's shell. Returns stdout, stderr, and exit code. " +
    "Use for exploring the codebase (rg, find, ls, cat), running tests, builds, git, etc.",
  parameters: Type.Object({
    command: Type.String({ description: "The shell command to execute" }),
  }),
};
