/**
 * Grep-tool implementation and grep-specific helpers.
 *
 * @module
 */

import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, relative } from "node:path";
import type { Static, Tool } from "@mariozechner/pi-ai";
import { Type } from "@mariozechner/pi-ai";
import type { ToolHandler } from "./agent.ts";
import {
  type ToolExecResult,
  textResult,
  validateBuiltinToolArgs,
} from "./tool-common.ts";

const grepToolParameters = Type.Object({
  pattern: Type.String({
    description: "Text or regex pattern to search for",
  }),
  path: Type.Optional(
    Type.String({
      description:
        "Optional file or directory path to search (relative to cwd)",
    }),
  ),
  glob: Type.Optional(
    Type.String({
      description: "Optional glob to include or exclude files",
    }),
  ),
  ignoreCase: Type.Optional(
    Type.Boolean({
      description: "Whether the search should ignore case",
    }),
  ),
  literal: Type.Optional(
    Type.Boolean({
      description: "Whether to treat the pattern as a literal string",
    }),
  ),
  context: Type.Optional(
    Type.Integer({
      minimum: 0,
      description: "How many context lines to include before and after matches",
    }),
  ),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: "Maximum number of matches to return across the result set",
    }),
  ),
});

/** Default maximum number of matches returned when `limit` is omitted. */
export const DEFAULT_GREP_LIMIT = 50;

/** Arguments for the `grep` tool. */
export type GrepArgs = Static<typeof grepToolParameters>;

/** A single rendered grep result line. */
export interface GrepResultLine {
  /** Whether this line is a direct match or surrounding context. */
  kind: "match" | "context";
  /** 1-based file line number. */
  lineNumber: number;
  /** Full text for the line, including any trailing newline from ripgrep. */
  text: string;
}

/** Group of grep result lines for one file. */
export interface GrepResultFile {
  /** File path relative to the session cwd when possible. */
  path: string;
  /** Matching and context lines in emission order. */
  lines: GrepResultLine[];
}

/** Structured grep result returned to the model and parsed by the UI. */
export interface GrepResult {
  /** Effective match limit applied to this search. */
  limit: number;
  /** Whether additional matches were omitted after hitting the limit. */
  truncated: boolean;
  /** Grouped file results. */
  files: GrepResultFile[];
  /** Optional continuation hint for refining or broadening the query. */
  hint?: string;
}

/** Options for grep execution. */
export interface GrepOpts {
  /** Abort signal for interruption. */
  signal?: AbortSignal;
}

/** pi-ai tool definition for `grep`. */
export const grepTool: Tool<typeof grepToolParameters> = {
  name: "grep",
  description:
    "Search file contents with ripgrep-style options and structured results. " +
    "Takes a pattern plus optional path, glob, case-sensitivity, literal, context, and limit options. " +
    "Prefer this tool over raw `grep` / `rg` when you want to find relevant files or matching lines.",
  parameters: grepToolParameters,
};

interface RgTextField {
  text?: string;
  bytes?: string;
}

interface RgJsonEvent {
  type?: string;
  data?: {
    path?: RgTextField;
    lines?: RgTextField;
    line_number?: number | null;
    submatches?: unknown[];
  };
}

function resolveGrepPath(path: string | undefined, cwd: string): string {
  if (!path) {
    return cwd;
  }
  return isAbsolute(path) ? path : join(cwd, path);
}

function decodeRgText(field: RgTextField | undefined): string {
  if (!field) {
    return "";
  }
  if (typeof field.text === "string") {
    return field.text;
  }
  if (typeof field.bytes === "string") {
    return Buffer.from(field.bytes, "base64").toString("utf-8");
  }
  return "";
}

function normalizeDisplayPath(filePath: string, cwd: string): string {
  if (filePath === "") {
    return "(unknown path)";
  }

  if (!isAbsolute(filePath)) {
    const normalizedPath = normalize(filePath);
    return normalizedPath.startsWith("./")
      ? normalizedPath.slice(2)
      : normalizedPath;
  }

  const relativePath = relative(cwd, filePath);
  if (relativePath === "") {
    return ".";
  }
  if (relativePath.startsWith("..")) {
    return filePath;
  }
  return normalize(relativePath);
}

function readStreamText(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

function buildGrepSpawnArgs(args: GrepArgs, cwd: string): string[] {
  const searchPath = resolveGrepPath(args.path, cwd);
  const rgArgs = ["rg", "--json", "--color=never"];

  if (args.literal) {
    rgArgs.push("--fixed-strings");
  }
  if (args.ignoreCase) {
    rgArgs.push("--ignore-case");
  }
  if (args.glob) {
    rgArgs.push("--glob", args.glob);
  }
  if (args.context && args.context > 0) {
    rgArgs.push("--context", String(args.context));
  }

  rgArgs.push("--", args.pattern);
  if (args.path) {
    rgArgs.push(searchPath);
  }

  return rgArgs;
}

function parseRgEvent(rawLine: string): RgJsonEvent | null {
  if (rawLine.trim() === "") {
    return null;
  }

  try {
    return JSON.parse(rawLine) as RgJsonEvent;
  } catch {
    return null;
  }
}

function getRenderableGrepEvent(
  event: RgJsonEvent,
  cwd: string,
): {
  kind: "match" | "context";
  path: string;
  lineNumber: number;
  text: string;
} | null {
  if (event.type !== "match" && event.type !== "context") {
    return null;
  }

  const lineNumber = event.data?.line_number;
  if (typeof lineNumber !== "number") {
    return null;
  }

  return {
    kind: event.type,
    path: normalizeDisplayPath(decodeRgText(event.data?.path), cwd),
    lineNumber,
    text: decodeRgText(event.data?.lines),
  };
}

function getRgMatchCount(event: RgJsonEvent): number {
  const submatches = event.data?.submatches;
  if (Array.isArray(submatches) && submatches.length > 0) {
    return submatches.length;
  }
  return 1;
}

interface GrepTrailingContextWindow {
  /** File path for the included match that hit the limit. */
  path: string;
  /** Next trailing-context line number still eligible for inclusion. */
  nextLineNumber: number;
  /** Remaining trailing-context lines to include for that match. */
  remainingLines: number;
}

interface GrepParseState {
  totalMatches: number;
  truncated: boolean;
  limitReached: boolean;
  trailingContext: GrepTrailingContextWindow | null;
}

function appendGrepEvent(
  ensureFile: (path: string) => GrepResultFile,
  event: {
    kind: "match" | "context";
    path: string;
    lineNumber: number;
    text: string;
  } | null,
): void {
  if (!event) {
    return;
  }

  ensureFile(event.path).lines.push({
    kind: event.kind,
    lineNumber: event.lineNumber,
    text: event.text,
  });
}

function handleGrepMatchEvent(
  parsedEvent: RgJsonEvent,
  cwd: string,
  limit: number,
  contextLines: number,
  state: GrepParseState,
  ensureFile: (path: string) => GrepResultFile,
): void {
  if (state.limitReached) {
    state.truncated = true;
    return;
  }

  const event = getRenderableGrepEvent(parsedEvent, cwd);
  appendGrepEvent(ensureFile, event);
  state.totalMatches += getRgMatchCount(parsedEvent);
  if (state.totalMatches < limit) {
    return;
  }

  state.limitReached = true;
  state.trailingContext =
    contextLines > 0 && event
      ? {
          path: event.path,
          nextLineNumber: event.lineNumber + 1,
          remainingLines: contextLines,
        }
      : null;
  if (state.totalMatches > limit) {
    state.truncated = true;
  }
}

function handleGrepContextEvent(
  parsedEvent: RgJsonEvent,
  cwd: string,
  state: GrepParseState,
  ensureFile: (path: string) => GrepResultFile,
): void {
  const event = getRenderableGrepEvent(parsedEvent, cwd);
  if (!event) {
    return;
  }

  if (state.limitReached) {
    const trailingContext = state.trailingContext;
    if (
      !trailingContext ||
      event.path !== trailingContext.path ||
      event.lineNumber !== trailingContext.nextLineNumber
    ) {
      return;
    }

    trailingContext.nextLineNumber += 1;
    trailingContext.remainingLines -= 1;
    if (trailingContext.remainingLines <= 0) {
      state.trailingContext = null;
    }
  }

  appendGrepEvent(ensureFile, event);
}

function parseGrepEvents(
  stdout: string,
  cwd: string,
  limit: number,
  contextLines: number,
): GrepResult {
  const filesByPath = new Map<string, GrepResultFile>();
  const orderedFiles: GrepResultFile[] = [];
  const state: GrepParseState = {
    totalMatches: 0,
    truncated: false,
    limitReached: false,
    trailingContext: null,
  };

  const ensureFile = (path: string): GrepResultFile => {
    const existing = filesByPath.get(path);
    if (existing) {
      return existing;
    }

    const file: GrepResultFile = { path, lines: [] };
    filesByPath.set(path, file);
    orderedFiles.push(file);
    return file;
  };

  for (const rawLine of stdout.split("\n")) {
    const parsedEvent = parseRgEvent(rawLine);
    if (!parsedEvent) {
      continue;
    }

    if (parsedEvent.type === "match") {
      handleGrepMatchEvent(
        parsedEvent,
        cwd,
        limit,
        contextLines,
        state,
        ensureFile,
      );
      continue;
    }
    if (parsedEvent.type === "context") {
      handleGrepContextEvent(parsedEvent, cwd, state, ensureFile);
    }
  }

  orderedFiles.sort((left, right) => left.path.localeCompare(right.path));

  return {
    limit,
    truncated: state.truncated,
    files: orderedFiles,
    ...(state.truncated
      ? {
          hint: "Results truncated. Narrow the path or pattern, or rerun with a higher limit.",
        }
      : {}),
  };
}

function parseStructuredGrepLine(line: unknown): GrepResultLine | null {
  if (
    typeof line !== "object" ||
    line === null ||
    ((line as { kind?: unknown }).kind !== "match" &&
      (line as { kind?: unknown }).kind !== "context") ||
    typeof (line as { lineNumber?: unknown }).lineNumber !== "number" ||
    typeof (line as { text?: unknown }).text !== "string"
  ) {
    return null;
  }

  return {
    kind: (line as { kind: "match" | "context" }).kind,
    lineNumber: (line as { lineNumber: number }).lineNumber,
    text: (line as { text: string }).text,
  };
}

function parseStructuredGrepFile(file: unknown): GrepResultFile | null {
  if (
    typeof file !== "object" ||
    file === null ||
    typeof (file as { path?: unknown }).path !== "string" ||
    !Array.isArray((file as { lines?: unknown }).lines)
  ) {
    return null;
  }

  const lines = (file as { lines: unknown[] }).lines
    .map((line) => parseStructuredGrepLine(line))
    .filter((line): line is GrepResultLine => line !== null);
  if (lines.length !== (file as { lines: unknown[] }).lines.length) {
    return null;
  }

  return {
    path: (file as { path: string }).path,
    lines,
  };
}

/** Parse a serialized grep result into its structured form. */
export function parseGrepResult(text: string): GrepResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const candidate = parsed as {
    limit?: unknown;
    truncated?: unknown;
    files?: unknown;
    hint?: unknown;
  };
  if (
    typeof candidate.limit !== "number" ||
    typeof candidate.truncated !== "boolean" ||
    !Array.isArray(candidate.files)
  ) {
    return null;
  }

  const files = candidate.files
    .map((file) => parseStructuredGrepFile(file))
    .filter((file): file is GrepResultFile => file !== null);
  if (files.length !== candidate.files.length) {
    return null;
  }

  return {
    limit: candidate.limit,
    truncated: candidate.truncated,
    files,
    ...(typeof candidate.hint === "string" ? { hint: candidate.hint } : {}),
  };
}

function validateGrepSearchPath(
  args: GrepArgs,
  cwd: string,
): ToolExecResult | string {
  const searchPath = resolveGrepPath(args.path, cwd);
  if (!existsSync(searchPath)) {
    return textResult(`Path not found: ${args.path ?? "."}`, true);
  }

  try {
    statSync(searchPath);
    return searchPath;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return textResult(`Failed to stat ${args.path ?? "."}: ${message}`, true);
  }
}

function registerGrepAbort(
  proc: ReturnType<typeof Bun.spawn>,
  signal: AbortSignal | undefined,
): (() => void) | null {
  if (!signal) {
    return null;
  }

  const abortListener = (): void => {
    proc.kill();
  };
  if (signal.aborted) {
    proc.kill();
    return null;
  }

  signal.addEventListener("abort", abortListener, { once: true });
  return () => {
    signal.removeEventListener("abort", abortListener);
  };
}

async function readGrepProcess(
  proc: ReturnType<typeof Bun.spawn>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const [stdout, stderr, exitCode] = await Promise.all([
    readStreamText(proc.stdout as ReadableStream<Uint8Array>),
    readStreamText(proc.stderr as ReadableStream<Uint8Array>),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

/**
 * Search file contents with ripgrep and return structured JSON results.
 *
 * @param args - Grep arguments.
 * @param cwd - Working directory for resolving relative paths.
 * @param opts - Optional abort signal.
 * @returns A JSON text result containing grouped matches or an error.
 */
export async function executeGrep(
  args: GrepArgs,
  cwd: string,
  opts?: GrepOpts,
): Promise<ToolExecResult> {
  const searchPathValidation = validateGrepSearchPath(args, cwd);
  if (typeof searchPathValidation !== "string") {
    return searchPathValidation;
  }

  let cleanupAbort: (() => void) | null = null;
  try {
    const proc = Bun.spawn(buildGrepSpawnArgs(args, cwd), {
      cwd,
      env: { ...process.env },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    cleanupAbort = registerGrepAbort(proc, opts?.signal);

    const { stdout, stderr, exitCode } = await readGrepProcess(proc);
    if (opts?.signal?.aborted) {
      return textResult("Grep aborted", true);
    }
    if (exitCode !== 0 && exitCode !== 1) {
      return textResult(
        stderr.trim() || `rg exited with code ${exitCode}`,
        true,
      );
    }

    const result = parseGrepEvents(
      stdout,
      cwd,
      args.limit ?? DEFAULT_GREP_LIMIT,
      args.context ?? 0,
    );
    return textResult(JSON.stringify(result, null, 2), false);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return textResult(`Grep failed: ${message}`, true);
  } finally {
    cleanupAbort?.();
  }
}

/**
 * Tool handler that validates grep arguments before execution.
 *
 * @param args - Raw parsed tool-call arguments.
 * @param cwd - Working directory for path resolution.
 * @param signal - Optional abort signal.
 * @returns The grep tool result.
 */
export const grepToolHandler: ToolHandler = (args, cwd, signal) =>
  executeGrep(validateBuiltinToolArgs(grepTool, args), cwd, {
    ...(signal ? { signal } : {}),
  });
