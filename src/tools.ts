/**
 * Built-in tool implementations: `edit`, `shell`, and `readImage`.
 *
 * Each tool is exposed as a pure-ish execute function that takes typed
 * arguments and a working directory, returning a result object. The pi-ai
 * {@link Tool} definitions (TypeBox schemas) are exported separately for
 * registration with the agent context.
 *
 * @module
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join } from "node:path";
import type { ImageContent, TextContent, Tool } from "@mariozechner/pi-ai";
import { Type } from "@mariozechner/pi-ai";
import type { ToolUpdateCallback } from "./agent.ts";

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/**
 * Result from executing a tool.
 *
 * Content blocks carry either text or image data. The agent loop
 * maps these directly into {@link ToolResultMessage.content}.
 */
export interface ToolExecResult {
  /** Content blocks for the tool result (text and/or images). */
  content: (TextContent | ImageContent)[];
  /** Whether the execution encountered an error. */
  isError: boolean;
}

/** Convenience: build a text-only {@link ToolExecResult}. */
function textResult(text: string, isError: boolean): ToolExecResult {
  return { content: [{ type: "text", text }], isError };
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
 * @returns A {@link ToolExecResult} with confirmation or error message.
 */
export function executeEdit(args: EditArgs, cwd: string): ToolExecResult {
  const filePath = isAbsolute(args.path) ? args.path : join(cwd, args.path);

  // Create new file
  if (args.oldText === "") {
    if (existsSync(filePath)) {
      return textResult(`File already exists: ${args.path}`, true);
    }
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, args.newText, "utf-8");
    return textResult(`Created ${args.path}`, false);
  }

  // Replace in existing file
  if (!existsSync(filePath)) {
    return textResult(`File not found: ${args.path}`, true);
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
    return textResult(`Old text not found in ${args.path}`, true);
  }
  if (count > 1) {
    return textResult(
      `Old text matches multiple locations (${count}) in ${args.path}`,
      true,
    );
  }

  // Exactly one match — replace
  const updated = content.replace(args.oldText, args.newText);
  writeFileSync(filePath, updated, "utf-8");
  return textResult(`Edited ${args.path}`, false);
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
  /** Maximum output lines before truncation. Default: 1000. */
  maxLines?: number;
  /** Maximum UTF-8 bytes before truncation. Default: 50_000. */
  maxBytes?: number;
  /** Abort signal to cancel the command. */
  signal?: AbortSignal;
  /** Callback for progressive output updates while the command is running. */
  onUpdate?: ToolUpdateCallback;
}

const DEFAULT_MAX_LINES = 1000;
const DEFAULT_MAX_BYTES = 50_000;

/** Format combined stdout/stderr for display in tool results. */
function formatShellOutput(stdout: string, stderr: string): string {
  if (stdout && stderr) {
    return `${stdout}\n\n[stderr]\n${stderr}`;
  }
  if (stdout) {
    return stdout;
  }
  if (stderr) {
    return `[stderr]\n${stderr}`;
  }
  return "";
}

/** Read a spawned shell stream into a string, reporting progressive updates. */
async function consumeShellStream(
  stream: ReadableStream<Uint8Array>,
  onChunk: (chunk: string) => void,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      output += decoder.decode();
      return output;
    }

    const chunk = decoder.decode(value, { stream: true });
    output += chunk;
    onChunk(chunk);
  }
}

/**
 * Run a command in the user's shell.
 *
 * Executes via `$SHELL -c` (falling back to `/bin/sh`). Returns combined
 * stdout/stderr and the exit code. Large output is truncated to keep
 * head + tail lines with a middle marker.
 *
 * @param args - Shell arguments (command).
 * @param cwd - Working directory to run the command in.
 * @param opts - Optional execution options (maxLines, signal, onUpdate).
 * @returns A {@link ToolExecResult} with the command output.
 */
export async function executeShell(
  args: ShellArgs,
  cwd: string,
  opts?: ShellOpts,
): Promise<ToolExecResult> {
  const shell = process.env.SHELL || "/bin/sh";
  const maxLines = opts?.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;

  try {
    const spawnOpts: Parameters<typeof Bun.spawn>[1] = {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    };
    if (opts?.signal) spawnOpts.signal = opts.signal;
    const proc = Bun.spawn([shell, "-c", args.command], spawnOpts);

    let stdoutBuf = "";
    let stderrBuf = "";
    const reportUpdate = (): void => {
      const output = truncateOutput(
        formatShellOutput(stdoutBuf, stderrBuf),
        maxLines,
        maxBytes,
      );
      if (!output) {
        return;
      }
      opts?.onUpdate?.(textResult(output, false));
    };

    const [stdout, stderr, exitCode] = await Promise.all([
      consumeShellStream(proc.stdout as ReadableStream<Uint8Array>, (chunk) => {
        stdoutBuf += chunk;
        reportUpdate();
      }),
      consumeShellStream(proc.stderr as ReadableStream<Uint8Array>, (chunk) => {
        stderrBuf += chunk;
        reportUpdate();
      }),
      proc.exited,
    ]);

    const output = truncateOutput(
      formatShellOutput(stdout.trimEnd(), stderr.trimEnd()),
      maxLines,
      maxBytes,
    );

    const isError = exitCode !== 0;
    const prefix = isError ? `Command failed with exit code ${exitCode}\n` : "";
    const text = prefix + output;

    return textResult(text || "(no output)", isError);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return textResult(`Shell error: ${message}`, true);
  }
}

// ---------------------------------------------------------------------------
// Output truncation
// ---------------------------------------------------------------------------

/** Build line-limited head/tail segments and their truncation marker. */
function buildLineTruncation(
  output: string,
  maxLines: number,
): {
  head: string;
  tail: string;
  marker: string;
} | null {
  const lines = output.split("\n");
  if (lines.length <= maxLines) {
    return null;
  }

  const headCount = Math.ceil(maxLines / 2);
  const tailCount = Math.floor(maxLines / 2);
  const omitted = lines.length - headCount - tailCount;

  return {
    head: lines.slice(0, headCount).join("\n"),
    tail: lines.slice(lines.length - tailCount).join("\n"),
    marker: `\n… truncated ${omitted} lines …\n`,
  };
}

/** Slice the largest UTF-8 prefix that fits within `maxBytes`. */
function sliceUtf8Prefix(input: string, maxBytes: number): string {
  if (maxBytes <= 0 || input === "") {
    return "";
  }
  let low = 0;
  let high = input.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = input.slice(0, mid);
    if (Buffer.byteLength(candidate, "utf8") <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return input.slice(0, low);
}

/** Slice the largest UTF-8 suffix that fits within `maxBytes`. */
function sliceUtf8Suffix(input: string, maxBytes: number): string {
  if (maxBytes <= 0 || input === "") {
    return "";
  }
  let low = 0;
  let high = input.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = input.slice(input.length - mid);
    if (Buffer.byteLength(candidate, "utf8") <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return input.slice(input.length - low);
}

/** Fit disjoint head/tail segments plus a marker within a UTF-8 byte budget. */
function fitSegmentsWithinBytes(
  headSource: string,
  tailSource: string,
  marker: string,
  maxBytes: number,
): string {
  const markerBytes = Buffer.byteLength(marker, "utf8");
  if (markerBytes >= maxBytes) {
    return sliceUtf8Prefix(headSource, maxBytes);
  }

  const availableBytes = maxBytes - markerBytes;
  const headBudget = Math.ceil(availableBytes / 2);
  const tailBudget = Math.floor(availableBytes / 2);

  let head = sliceUtf8Prefix(headSource, headBudget);
  let tail = sliceUtf8Suffix(tailSource, tailBudget);

  const usedBytes =
    Buffer.byteLength(head, "utf8") + Buffer.byteLength(tail, "utf8");
  let remainingBytes = availableBytes - usedBytes;

  if (remainingBytes > 0) {
    const expandedHead = sliceUtf8Prefix(
      headSource,
      headBudget + remainingBytes,
    );
    remainingBytes -=
      Buffer.byteLength(expandedHead, "utf8") - Buffer.byteLength(head, "utf8");
    head = expandedHead;
  }

  if (remainingBytes > 0) {
    tail = sliceUtf8Suffix(tailSource, tailBudget + remainingBytes);
  }

  return head + marker + tail;
}

/** Truncate output by UTF-8 byte size, preserving head and tail text. */
function truncateOutputByBytes(output: string, maxBytes: number): string {
  if (Buffer.byteLength(output, "utf8") <= maxBytes) {
    return output;
  }

  return fitSegmentsWithinBytes(
    output,
    output,
    "\n… truncated for size …\n",
    maxBytes,
  );
}

/**
 * Truncate output to keep useful head and tail content within line and byte budgets.
 *
 * The line budget avoids flooding the model with very tall outputs, while the
 * byte budget prevents context explosions caused by a small number of very long
 * lines.
 *
 * @param output - The full output string.
 * @param maxLines - Maximum number of content lines to keep.
 * @param maxBytes - Maximum UTF-8 bytes to keep.
 * @returns The (possibly truncated) output string.
 */
export function truncateOutput(
  output: string,
  maxLines: number,
  maxBytes: number,
): string {
  if (!output) return output;

  const lineTruncation = buildLineTruncation(output, maxLines);
  if (!lineTruncation) {
    return truncateOutputByBytes(output, maxBytes);
  }

  const lineLimited =
    lineTruncation.head + lineTruncation.marker + lineTruncation.tail;
  if (Buffer.byteLength(lineLimited, "utf8") <= maxBytes) {
    return lineLimited;
  }

  return fitSegmentsWithinBytes(
    lineTruncation.head,
    lineTruncation.tail,
    lineTruncation.marker,
    maxBytes,
  );
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

// ---------------------------------------------------------------------------
// readImage
// ---------------------------------------------------------------------------

/** Supported image extensions and their MIME types. */
const IMAGE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** Arguments for the `readImage` tool. */
export interface ReadImageArgs {
  /** File path (absolute or relative to cwd). */
  path: string;
}

/**
 * Read an image file and return it as base64-encoded content.
 *
 * Supports PNG, JPEG, GIF, and WebP. Returns {@link ImageContent} on
 * success or a text error message on failure. The MIME type is detected
 * from the file extension.
 *
 * @param args - ReadImage arguments (path).
 * @param cwd - Working directory for resolving relative paths.
 * @returns A {@link ToolExecResult} with image content or error message.
 */
export function executeReadImage(
  args: ReadImageArgs,
  cwd: string,
): ToolExecResult {
  const filePath = isAbsolute(args.path) ? args.path : join(cwd, args.path);
  const ext = extname(filePath).toLowerCase();

  const mimeType = IMAGE_MIME_TYPES[ext];
  if (!mimeType) {
    return textResult(
      `Unsupported image format: ${ext || "(no extension)"}`,
      true,
    );
  }

  if (!existsSync(filePath)) {
    return textResult(`File not found: ${args.path}`, true);
  }

  const data = readFileSync(filePath);
  const base64 = Buffer.from(data).toString("base64");

  return {
    content: [{ type: "image", data: base64, mimeType }],
    isError: false,
  };
}

/** pi-ai tool definition for `readImage`. */
export const readImageTool: Tool = {
  name: "readImage",
  description:
    "Read an image file and return its contents. " +
    "Supports PNG, JPEG, GIF, and WebP formats. " +
    "Use this to inspect screenshots, diagrams, or any image in the repo.",
  parameters: Type.Object({
    path: Type.String({
      description: "File path (absolute or relative to cwd)",
    }),
  }),
};
