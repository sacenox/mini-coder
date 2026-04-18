/**
 * Read-tool implementation and read-specific helpers.
 *
 * @module
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { Static, Tool } from "@mariozechner/pi-ai";
import { Type } from "@mariozechner/pi-ai";
import type { ToolHandler, ToolUpdateCallback } from "./agent.ts";
import {
  type ToolExecResult,
  textResult,
  validateBuiltinToolArgs,
} from "./tool-common.ts";

const readToolParameters = Type.Object({
  path: Type.String({
    description: "File path (absolute or relative to cwd)",
  }),
  offset: Type.Optional(
    Type.Integer({
      minimum: 0,
      description: "Zero-based line offset to start reading from",
    }),
  ),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: "Maximum number of lines to read in this call",
    }),
  ),
});

/** Default line window returned when `limit` is omitted. */
export const DEFAULT_READ_LIMIT = 200;

/** Number of logical lines to append between progressive UI updates. */
const READ_STREAM_CHUNK_LINES = 40;

/** Arguments for the `read` tool. */
export type ReadArgs = Static<typeof readToolParameters>;

/** Continuation metadata parsed from a successful read result. */
export interface ReadContinuationHint {
  /** Next zero-based line offset to request. */
  offset: number;
  /** Suggested line limit for the follow-up read. */
  limit: number;
}

/** Options for read execution. */
export interface ReadOpts {
  /** Abort signal for interruption. */
  signal?: AbortSignal;
  /** Callback for progressive content updates. */
  onUpdate?: ToolUpdateCallback;
}

/** pi-ai tool definition for `read`. */
export const readTool: Tool<typeof readToolParameters> = {
  name: "read",
  description:
    "Read a UTF-8 text file from disk. " +
    "Takes a file path plus optional line-based `offset` and `limit`. " +
    "Prefer this tool over shelling out to `cat`, `sed`, `head`, or `tail` when you need file contents.",
  parameters: readToolParameters,
};

function resolveReadPath(path: string, cwd: string): string {
  return isAbsolute(path) ? path : join(cwd, path);
}

function splitLinesPreservingEndings(content: string): string[] {
  if (content === "") {
    return [];
  }

  const lines: string[] = [];
  let start = 0;

  for (let index = 0; index < content.length; index++) {
    const char = content[index];
    if (char === "\n") {
      lines.push(content.slice(start, index + 1));
      start = index + 1;
      continue;
    }
    if (char === "\r" && content[index + 1] === "\n") {
      lines.push(content.slice(start, index + 2));
      start = index + 2;
      index += 1;
    }
  }

  if (start < content.length) {
    lines.push(content.slice(start));
  }

  return lines;
}

function waitForNextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Format the trailing continuation hint appended to truncated read results. */
export function formatReadContinuationHint(
  offset: number,
  limit: number,
): string {
  return `[use offset=${offset} limit=${limit} to continue]`;
}

/** Parse a standalone read continuation hint block. */
export function parseReadContinuationHint(
  text: string,
): ReadContinuationHint | null {
  const match = /^\[use offset=(\d+) limit=(\d+) to continue\]$/.exec(text);
  if (!match) {
    return null;
  }

  const offsetText = match[1];
  const limitText = match[2];
  if (!offsetText || !limitText) {
    return null;
  }

  return {
    offset: Number.parseInt(offsetText, 10),
    limit: Number.parseInt(limitText, 10),
  };
}

/** Parse a legacy flattened read result into file content plus any continuation hint. */
export function parseReadResult(text: string): {
  body: string;
  continuation: ReadContinuationHint | null;
} {
  const trailerMatch =
    /(?:\r?\n){2}(\[use offset=\d+ limit=\d+ to continue\])$/.exec(text);
  if (!trailerMatch) {
    return { body: text, continuation: null };
  }

  const continuation = parseReadContinuationHint(trailerMatch[1] ?? "");
  if (!continuation) {
    return { body: text, continuation: null };
  }

  return {
    body: text.slice(0, trailerMatch.index),
    continuation,
  };
}

async function streamReadPreview(
  lines: readonly string[],
  opts: ReadOpts | undefined,
): Promise<void> {
  if (!opts?.onUpdate || lines.length === 0) {
    return;
  }

  const chunkSize = Math.max(1, READ_STREAM_CHUNK_LINES);
  for (let index = chunkSize; index < lines.length; index += chunkSize) {
    if (opts.signal?.aborted) {
      return;
    }

    opts.onUpdate(textResult(lines.slice(0, index).join(""), false));
    await waitForNextTick();
  }
}

function loadReadContent(
  args: ReadArgs,
  cwd: string,
): ToolExecResult | { content: string } {
  const filePath = resolveReadPath(args.path, cwd);
  if (!existsSync(filePath)) {
    return textResult(`File not found: ${args.path}`, true);
  }

  try {
    if (!statSync(filePath).isFile()) {
      return textResult(`Not a file: ${args.path}`, true);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return textResult(`Failed to stat ${args.path}: ${message}`, true);
  }

  try {
    return {
      content: readFileSync(filePath, "utf-8"),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return textResult(`Failed to read ${args.path}: ${message}`, true);
  }
}

function getReadSlice(
  args: ReadArgs,
  content: string,
):
  | ToolExecResult
  | {
      lines: string[];
      offset: number;
      limit: number;
    } {
  const lines = splitLinesPreservingEndings(content);
  const offset = args.offset ?? 0;
  const limit = args.limit ?? DEFAULT_READ_LIMIT;

  if (offset > lines.length || (lines.length > 0 && offset === lines.length)) {
    return textResult(
      `Offset ${offset} is out of range for ${args.path} (${lines.length} lines)`,
      true,
    );
  }

  return {
    lines: lines.slice(offset, offset + limit),
    offset,
    limit,
  };
}

function buildReadResult(
  body: string,
  continuation: ReadContinuationHint | null,
): ToolExecResult {
  if (!continuation) {
    return textResult(body, false);
  }

  return {
    content: [
      { type: "text", text: body },
      {
        type: "text",
        text: formatReadContinuationHint(
          continuation.offset,
          continuation.limit,
        ),
      },
    ],
    isError: false,
  };
}

/**
 * Read a UTF-8 text file, optionally by line window.
 *
 * When `limit` is omitted, the tool returns a bounded initial slice and adds a
 * continuation hint when more content remains.
 *
 * @param args - Read arguments.
 * @param cwd - Working directory for resolving relative paths.
 * @param opts - Optional abort signal and progressive update callback.
 * @returns A text tool result containing file content or an error.
 */
export async function executeRead(
  args: ReadArgs,
  cwd: string,
  opts?: ReadOpts,
): Promise<ToolExecResult> {
  const loaded = loadReadContent(args, cwd);
  if ("isError" in loaded) {
    return loaded;
  }

  const slice = getReadSlice(args, loaded.content);
  if ("isError" in slice) {
    return slice;
  }

  await streamReadPreview(slice.lines, opts);
  if (opts?.signal?.aborted) {
    return textResult("Read aborted", true);
  }

  const body = slice.lines.join("");
  const totalLines = splitLinesPreservingEndings(loaded.content).length;
  if (slice.offset + slice.lines.length >= totalLines) {
    return buildReadResult(body, null);
  }

  return buildReadResult(body, {
    offset: slice.offset + slice.lines.length,
    limit: slice.limit,
  });
}

/**
 * Tool handler that validates read arguments before execution.
 *
 * @param args - Raw parsed tool-call arguments.
 * @param cwd - Working directory for path resolution.
 * @param signal - Optional abort signal.
 * @param onUpdate - Optional progressive output callback.
 * @returns The read tool result.
 */
export const readToolHandler: ToolHandler = (args, cwd, signal, onUpdate) =>
  executeRead(validateBuiltinToolArgs(readTool, args), cwd, {
    ...(signal ? { signal } : {}),
    ...(onUpdate ? { onUpdate } : {}),
  });
