/**
 * Shell-tool implementation and shell-specific helpers.
 *
 * @module
 */

import type { Static, Tool } from "@mariozechner/pi-ai";
import { Type } from "@mariozechner/pi-ai";
import type { ToolHandler, ToolUpdateCallback } from "./agent.ts";
import {
  detectLineEnding,
  normalizeLineEndings,
  type ToolExecResult,
  textResult,
  validateBuiltinToolArgs,
} from "./tool-common.ts";

const shellToolParameters = Type.Object({
  command: Type.String({ description: "The shell command to execute" }),
});

/** Arguments for the `shell` tool. */
export type ShellArgs = Static<typeof shellToolParameters>;

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

/** pi-ai tool definition for `shell`. */
export const shellTool: Tool<typeof shellToolParameters> = {
  name: "shell",
  description:
    "Run a command in the user's shell. Returns stdout, stderr, and exit code. " +
    "Use this to explore the codebase, read tests/verifiers/examples, inspect required outputs, and run targeted checks, builds, or git commands. " +
    "Commands mutate the real working directory, so direct verification outputs to temporary paths or clean them up before finishing.",
  parameters: shellToolParameters,
};

/**
 * Tool handler that validates shell arguments before execution.
 *
 * @param args - Raw parsed tool-call arguments.
 * @param cwd - Working directory for command execution.
 * @param signal - Optional abort signal.
 * @param onUpdate - Optional progressive output callback.
 * @returns The shell tool result.
 */
export const shellToolHandler: ToolHandler = (args, cwd, signal, onUpdate) =>
  executeShell(validateBuiltinToolArgs(shellTool, args), cwd, {
    ...(signal ? { signal } : {}),
    ...(onUpdate ? { onUpdate } : {}),
  });

type ShellProcess = ReturnType<typeof Bun.spawn>;

const DEFAULT_MAX_LINES = 1000;
const DEFAULT_MAX_BYTES = 50_000;
const SHELL_UPDATE_INTERVAL_MS = 75;
const SHELL_STREAM_DRAIN_TIMEOUT_MS = 25;

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

interface ShellCommandLines {
  lines: string[];
  lineEnding: "\n" | "\r\n";
  hasTrailingLineEnding: boolean;
}

interface PendingHeredoc {
  startLineIndex: number;
  delimiter: string;
  stripLeadingTabs: boolean;
}

interface ShellQuoteState {
  quote: "'" | '"' | null;
  escaped: boolean;
}

function splitShellCommandLines(command: string): ShellCommandLines {
  const lineEnding = detectLineEnding(command) ?? "\n";
  const normalized = normalizeLineEndings(command, "\n");
  const hasTrailingLineEnding = normalized.endsWith("\n");
  const lines = normalized.split("\n");
  if (hasTrailingLineEnding) {
    lines.pop();
  }
  return { lines, lineEnding, hasTrailingLineEnding };
}

function joinShellCommandLines(parts: ShellCommandLines): string {
  const joined = parts.lines.join(parts.lineEnding);
  if (parts.hasTrailingLineEnding) {
    return joined + parts.lineEnding;
  }
  return joined;
}

function advanceShellQuoteState(char: string, state: ShellQuoteState): boolean {
  if (state.quote === "'") {
    if (char === "'") {
      state.quote = null;
    }
    return true;
  }

  if (state.quote === '"') {
    if (state.escaped) {
      state.escaped = false;
      return true;
    }
    if (char === "\\") {
      state.escaped = true;
      return true;
    }
    if (char === '"') {
      state.quote = null;
    }
    return true;
  }

  if (char === "'") {
    state.quote = "'";
    return true;
  }
  if (char === '"') {
    state.quote = '"';
    return true;
  }

  return false;
}

function isHeredocPrefixCharacter(char: string): boolean {
  return (
    char === "" ||
    char === " " ||
    char === "\t" ||
    char === ";" ||
    char === "(" ||
    char === "&" ||
    char === "|"
  );
}

function getHeredocStartAt(
  line: string,
  index: number,
): { index: number; stripLeadingTabs: boolean } | null {
  if (line[index] !== "<" || line[index + 1] !== "<") {
    return null;
  }

  const previousChar = index === 0 ? "" : (line[index - 1] ?? "");
  if (!isHeredocPrefixCharacter(previousChar)) {
    return null;
  }

  return {
    index,
    stripLeadingTabs: line[index + 2] === "-",
  };
}

function findUnquotedHeredocStart(
  line: string,
): { index: number; stripLeadingTabs: boolean } | null {
  const quoteState: ShellQuoteState = { quote: null, escaped: false };
  let heredocStart: { index: number; stripLeadingTabs: boolean } | null = null;

  for (let index = 0; index < line.length - 1; index++) {
    const char = line[index];
    if (char === undefined || advanceShellQuoteState(char, quoteState)) {
      continue;
    }

    const nextHeredocStart = getHeredocStartAt(line, index);
    if (!nextHeredocStart) {
      continue;
    }
    if (heredocStart) {
      return null;
    }

    heredocStart = nextHeredocStart;
    index += heredocStart.stripLeadingTabs ? 2 : 1;
  }

  return heredocStart;
}

function skipHeredocDelimiterWhitespace(line: string, cursor: number): number {
  let nextCursor = cursor;
  while (line[nextCursor] === " " || line[nextCursor] === "\t") {
    nextCursor++;
  }
  return nextCursor;
}

function readQuotedHeredocDelimiter(
  line: string,
  cursor: number,
): string | null {
  const quote = line[cursor];
  if (quote !== "'" && quote !== '"') {
    return null;
  }

  const endQuoteIndex = line.indexOf(quote, cursor + 1);
  if (endQuoteIndex === -1) {
    return null;
  }
  return line.slice(cursor + 1, endQuoteIndex);
}

function isHeredocDelimiterStopCharacter(char: string): boolean {
  return (
    char === " " ||
    char === "\t" ||
    char === "<" ||
    char === ">" ||
    char === "&" ||
    char === "|" ||
    char === ";" ||
    char === "(" ||
    char === ")"
  );
}

function readBareHeredocDelimiter(line: string, cursor: number): string | null {
  const startChar = line[cursor];
  if (startChar === undefined || !/[A-Za-z_]/.test(startChar)) {
    return null;
  }

  let endIndex = cursor;
  while (endIndex < line.length) {
    const currentChar = line[endIndex];
    if (
      currentChar === undefined ||
      isHeredocDelimiterStopCharacter(currentChar)
    ) {
      break;
    }
    endIndex++;
  }
  return line.slice(cursor, endIndex);
}

function findUnquotedHeredoc(
  line: string,
  startLineIndex: number,
): PendingHeredoc | null {
  const heredocStart = findUnquotedHeredocStart(line);
  if (!heredocStart) {
    return null;
  }

  const cursor = skipHeredocDelimiterWhitespace(
    line,
    heredocStart.index + 2 + (heredocStart.stripLeadingTabs ? 1 : 0),
  );
  const delimiter =
    readQuotedHeredocDelimiter(line, cursor) ??
    readBareHeredocDelimiter(line, cursor);
  if (!delimiter) {
    return null;
  }

  return {
    startLineIndex,
    delimiter,
    stripLeadingTabs: heredocStart.stripLeadingTabs,
  };
}

function getHeredocLineBody(line: string, stripLeadingTabs: boolean): string {
  if (!stripLeadingTabs) {
    return line;
  }
  return line.replace(/^\t+/, "");
}

function getSupportedHeredocTrailer(rest: string): string | null {
  const trimmedRest = rest.trimStart();
  if (!trimmedRest) {
    return null;
  }
  if (trimmedRest.startsWith("&&")) {
    return trimmedRest.slice(2).trim() ? rest : null;
  }
  if (trimmedRest.startsWith("||")) {
    return null;
  }
  if (trimmedRest.startsWith("|")) {
    return trimmedRest.slice(1).trim() ? rest : null;
  }
  if (trimmedRest.startsWith(">")) {
    return trimmedRest.slice(1).trim() ? rest : null;
  }
  return null;
}

function rewritePendingHeredocTrailer(
  parts: ShellCommandLines,
  line: string,
  lineIndex: number,
  pendingHeredoc: PendingHeredoc,
): PendingHeredoc | null {
  const body = getHeredocLineBody(line, pendingHeredoc.stripLeadingTabs);
  if (body === pendingHeredoc.delimiter) {
    return null;
  }
  if (!body.startsWith(pendingHeredoc.delimiter)) {
    return pendingHeredoc;
  }

  const trailer = getSupportedHeredocTrailer(
    body.slice(pendingHeredoc.delimiter.length),
  );
  if (!trailer) {
    return pendingHeredoc;
  }

  const startLine = parts.lines[pendingHeredoc.startLineIndex];
  if (startLine === undefined) {
    return pendingHeredoc;
  }

  parts.lines[pendingHeredoc.startLineIndex] = startLine + trailer;
  const leadingTabs = pendingHeredoc.stripLeadingTabs
    ? (line.match(/^\t*/) ?? [""])[0]
    : "";
  parts.lines[lineIndex] = `${leadingTabs}${pendingHeredoc.delimiter}`;
  return null;
}

function normalizeHeredocTrailingContinuations(command: string): string {
  const parts = splitShellCommandLines(command);
  let pendingHeredoc: PendingHeredoc | null = null;

  for (const [index, line] of parts.lines.entries()) {
    if (pendingHeredoc) {
      pendingHeredoc = rewritePendingHeredocTrailer(
        parts,
        line,
        index,
        pendingHeredoc,
      );
      continue;
    }

    pendingHeredoc = findUnquotedHeredoc(line, index);
  }

  return joinShellCommandLines(parts);
}

function normalizeLeadingDashPrintf(command: string): string {
  const parts = splitShellCommandLines(command);
  let pendingHeredoc: PendingHeredoc | null = null;

  for (const [index, line] of parts.lines.entries()) {
    if (pendingHeredoc) {
      const body = getHeredocLineBody(line, pendingHeredoc.stripLeadingTabs);
      if (body === pendingHeredoc.delimiter) {
        pendingHeredoc = null;
      }
      continue;
    }

    parts.lines[index] = line.replace(
      /^(\s*)printf(\s+)(['"])-/,
      "$1printf$2-- $3-",
    );
    pendingHeredoc = findUnquotedHeredoc(parts.lines[index] || "", index);
  }

  return joinShellCommandLines(parts);
}

function normalizeShellCommand(command: string): string {
  try {
    return normalizeLeadingDashPrintf(
      normalizeHeredocTrailingContinuations(command),
    );
  } catch {
    return command;
  }
}

interface ShellStreamCapture {
  done: Promise<void>;
  getOutput: () => string;
  isFinished: () => boolean;
  close: () => Promise<void>;
}

function startShellStreamCapture(
  stream: ReadableStream<Uint8Array>,
  onChunk: (chunk: string) => void,
): ShellStreamCapture {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  let closed = false;
  let finished = false;

  const done = (async (): Promise<void> => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        output += chunk;
        onChunk(chunk);
      }
    } catch (error) {
      if (!closed) {
        throw error;
      }
    } finally {
      const trailing = decoder.decode();
      output += trailing;
      onChunk(trailing);
      finished = true;
    }
  })();

  return {
    done,
    getOutput: () => output,
    isFinished: () => finished,
    close: async (): Promise<void> => {
      if (!finished) {
        closed = true;
        try {
          await reader.cancel();
        } catch {
          // Ignore cancellation errors while closing the pipe after exit/abort.
        }
      }
      await done;
    },
  };
}

async function finalizeShellStreamCaptures(
  captures: readonly ShellStreamCapture[],
): Promise<void> {
  const pending = captures
    .filter((capture) => !capture.isFinished())
    .map((capture) => capture.done);

  if (pending.length > 0) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, SHELL_STREAM_DRAIN_TIMEOUT_MS);
      void Promise.allSettled(pending).then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  await Promise.all(captures.map((capture) => capture.close()));
}

function buildShellSpawnOptions(cwd: string): Parameters<typeof Bun.spawn>[1] {
  return {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    ...(process.platform === "win32" ? {} : { detached: true }),
  };
}

function abortShellProcess(proc: ShellProcess): void {
  if (proc.killed || proc.exitCode !== null) {
    return;
  }

  if (process.platform !== "win32") {
    try {
      process.kill(-proc.pid, "SIGTERM");
      return;
    } catch {
      // Fall through to a direct kill when the process group is unavailable.
    }
  }

  proc.kill("SIGTERM");
}

function registerShellAbort(
  signal: AbortSignal | undefined,
  proc: ShellProcess,
): (() => void) | null {
  if (!signal) {
    return null;
  }

  const abortListener = (): void => {
    abortShellProcess(proc);
  };

  if (signal.aborted) {
    abortShellProcess(proc);
    return null;
  }

  signal.addEventListener("abort", abortListener, { once: true });
  return () => {
    signal.removeEventListener("abort", abortListener);
  };
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
  let updateTimer: ReturnType<typeof setTimeout> | null = null;
  let cleanupAbort: (() => void) | null = null;
  let lastReportedOutput = "";
  let lastReportAt = 0;
  let stdoutCapture: ShellStreamCapture | null = null;
  let stderrCapture: ShellStreamCapture | null = null;

  try {
    const clearPendingUpdate = (): void => {
      if (updateTimer) {
        clearTimeout(updateTimer);
        updateTimer = null;
      }
    };

    const buildOutput = (trimEnd: boolean): string => {
      const stdout = stdoutCapture?.getOutput() ?? "";
      const stderr = stderrCapture?.getOutput() ?? "";
      return truncateOutput(
        formatShellOutput(
          trimEnd ? stdout.trimEnd() : stdout,
          trimEnd ? stderr.trimEnd() : stderr,
        ),
        maxLines,
        maxBytes,
      );
    };

    const emitUpdate = (): void => {
      clearPendingUpdate();
      if (!opts?.onUpdate) {
        return;
      }

      const output = buildOutput(false);
      if (!output || output === lastReportedOutput) {
        return;
      }

      lastReportedOutput = output;
      lastReportAt = Date.now();
      opts.onUpdate(textResult(output, false));
    };

    const scheduleUpdate = (): void => {
      if (!opts?.onUpdate) {
        return;
      }

      const elapsed = Date.now() - lastReportAt;
      if (elapsed >= SHELL_UPDATE_INTERVAL_MS) {
        emitUpdate();
        return;
      }
      if (updateTimer) {
        return;
      }

      updateTimer = setTimeout(() => {
        emitUpdate();
      }, SHELL_UPDATE_INTERVAL_MS - elapsed);
    };

    const command = normalizeShellCommand(args.command);
    const proc = Bun.spawn([shell, "-c", command], buildShellSpawnOptions(cwd));
    cleanupAbort = registerShellAbort(opts?.signal, proc);
    stdoutCapture = startShellStreamCapture(
      proc.stdout as ReadableStream<Uint8Array>,
      () => {
        scheduleUpdate();
      },
    );
    stderrCapture = startShellStreamCapture(
      proc.stderr as ReadableStream<Uint8Array>,
      () => {
        scheduleUpdate();
      },
    );

    const exitCode = await proc.exited;
    cleanupAbort?.();
    cleanupAbort = null;

    await finalizeShellStreamCaptures([stdoutCapture, stderrCapture]);
    clearPendingUpdate();
    const output = buildOutput(true);
    if (opts?.onUpdate && output && output !== lastReportedOutput) {
      lastReportedOutput = output;
      opts.onUpdate(textResult(output, false));
    }

    const isError = exitCode !== 0;
    const body = output || "(no output)";
    return textResult(`Exit code: ${exitCode}\n${body}`, isError);
  } catch (err) {
    cleanupAbort?.();
    cleanupAbort = null;
    const captures = [stdoutCapture, stderrCapture].filter(
      (capture): capture is ShellStreamCapture => capture !== null,
    );
    if (captures.length > 0) {
      await Promise.allSettled(captures.map((capture) => capture.close()));
    }
    if (updateTimer) {
      clearTimeout(updateTimer);
      updateTimer = null;
    }
    const message = err instanceof Error ? err.message : String(err);
    return textResult(`Shell error: ${message}`, true);
  }
}

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

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

function findUtf8SliceLength(
  input: string,
  maxBytes: number,
  getCandidate: (length: number) => string,
): number {
  if (maxBytes <= 0 || input === "") {
    return 0;
  }

  let low = 0;
  let high = input.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = getCandidate(mid);
    if (Buffer.byteLength(candidate, "utf8") <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return low;
}

function normalizeUtf8PrefixEnd(input: string, end: number): number {
  if (end <= 0 || end >= input.length) {
    return end;
  }

  const previousCodeUnit = input.charCodeAt(end - 1);
  const nextCodeUnit = input.charCodeAt(end);
  if (isHighSurrogate(previousCodeUnit) && isLowSurrogate(nextCodeUnit)) {
    return end - 1;
  }

  return end;
}

function normalizeUtf8SuffixStart(input: string, start: number): number {
  if (start <= 0 || start >= input.length) {
    return start;
  }

  const previousCodeUnit = input.charCodeAt(start - 1);
  const nextCodeUnit = input.charCodeAt(start);
  if (isHighSurrogate(previousCodeUnit) && isLowSurrogate(nextCodeUnit)) {
    return start + 1;
  }

  return start;
}

/** Slice the largest UTF-8 prefix that fits within `maxBytes`. */
function sliceUtf8Prefix(input: string, maxBytes: number): string {
  const end = normalizeUtf8PrefixEnd(
    input,
    findUtf8SliceLength(input, maxBytes, (length) => input.slice(0, length)),
  );
  return input.slice(0, end);
}

/** Slice the largest UTF-8 suffix that fits within `maxBytes`. */
function sliceUtf8Suffix(input: string, maxBytes: number): string {
  const start = normalizeUtf8SuffixStart(
    input,
    input.length -
      findUtf8SliceLength(input, maxBytes, (length) =>
        input.slice(input.length - length),
      ),
  );
  return input.slice(start);
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
    const headBytes = Buffer.byteLength(head, "utf8");
    const expandedHead = sliceUtf8Prefix(
      headSource,
      headBytes + remainingBytes,
    );
    remainingBytes -= Buffer.byteLength(expandedHead, "utf8") - headBytes;
    head = expandedHead;
  }

  if (remainingBytes > 0) {
    const tailBytes = Buffer.byteLength(tail, "utf8");
    tail = sliceUtf8Suffix(tailSource, tailBytes + remainingBytes);
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
